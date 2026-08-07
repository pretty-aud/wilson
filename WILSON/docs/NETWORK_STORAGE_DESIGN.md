# Network & remote storage access — design and scope

**Status:** DESIGN ONLY. Nothing here is built. Audrey's approval gates every phase.
**Requested by:** Audrey during S31 (2026-08-05), explicitly as its own session.
**Written:** 2026-08-05, against `feat/multi-user-v1` @ `c295956`.
**Measured against:** `wilson-dev` (`eqjzmnvkrakroyqxfsvw`), and the working tree.

---

## 1. What was asked for

Verbatim in substance:

- A **TPN-compliant** team logs into one computer only, so cross-computer local
  access is not needed for them.
- A company that does **not** need TPN compliance should be able to reach
  content stored on **their** server from outside the local network, as long as
  the server is on and internet-connected — *"which for a large company is
  true"*.
- The **company admin**, in the admin portal, should be able to toggle external
  access to network storage **on or off**.

## 1b. Audrey's answers (2026-08-05) — these are decisions, not options

The design's four open questions were put to her and answered. Recorded verbatim
in substance, because three of them change the shape of the work.

1. **Media is multi-GB. 50 MB is not acceptable.** *"i need to be able to store
   media so 50MB is not acceptable. im going to have multiple GB files at
   times."* → **every storage mode must carry multi-GB on its own terms** (§3.6).
   Follow-up, same day: *"what if the company selected a cloud storage solution?
   they cant save large files thats not acceptable."* → **correct, and the first
   draft was wrong about this.** Cloud is fixable (Phase 2b) and must be fixed.
2. **A VPN is optional, not assumable.** *"a VPN can be optional for some
   companies. some no. some may not want to setup a VPN."* → **Option C alone is
   insufficient**, and the gateway (Option D) is a real requirement for a real
   segment rather than a last resort. See §4b for how that reconciles with TPN —
   it does, and cleanly.
3. **The toggle is conditional on the storage mode.** *"the toggle should only
   exist for local network storage solution. so if that one is selected then the
   toggle is visible."* → settles §6, and it establishes that a **storage-mode
   selector** is part of the product.
4. **`storage_mode` / `storage_config`** — question withdrawn as badly posed;
   answer follows from (3). See §5b.
5. **Two levels of path permission, and a local drive takes two confirmations.**
   *"admins can set server/drive. managers can set folders within set drive...
   the admins can set the drive in the admin terminal. the managers set the
   project folder in the drive in the project control panel."* + *"give one
   first confirmation explanation this will only work for a single user with no
   team... then ask to confirm they are sure."* → **§5a2. Closes two measured
   gaps: no permission check on the storage control at all, and `folder_root`
   validated against nothing.**
6. **Cost model, and a mode that was missing.** Asked who pays when a company
   uses their own cloud → **§4a2.** Petal pays only for bytes crossing
   infrastructure Petal rents. The question surfaced **bring-your-own-cloud**, a
   storage mode with zero marginal cost that may remove the need for the gateway
   for some customers. Evaluate it **before** committing to Phase 3.
8. **Thumbnails on web and desktop; video preview.** *"all thumbnails need to be
   accessible on web and desktop"* + *"can we add a way to preview videos on the
   app?"* + *"for videos i would want... a single still frame... automatically"*
   → **§5d.** Generated at upload time (cheap, and it gives the dead
   `thumbnail_url` column its writer). Stored in a **new private
   `rabbit-thumbnails` bucket capped at 256 KB** — a separate bucket because one
   bucket has one size limit and the media bucket needs a large one.
9. ✅ **ffmpeg stays; generation is desktop-side.** *"ok keep ffmpeg then,
   desktop generation is fine. please make sure their is a warning prompt letting
   the user know large files and prores will require the desktop app."* →
   **§5e-pre, §5e, §5f.** LGPL build, invoked as a separate process, **no
   obligation to open-source anything**. Web users see every thumbnail; only
   generation for professional codecs is desktop-side.
10. ✅ **Notice treatment settled.** *"I'd use an inline note on the file row plus
    one summary line per batch — not a popup. agreed here."* → **§5f.** Inline
    per row + one summary per batch for the two non-failure cases; a dialog only
    for the genuine hard failure.
7. ⭐ **The NAS answer — support both routes, and let the NAS be the server.**
   *"VPN works for TPN companies. some companies may not have it so we need both
   possible. idea would be as long as the end user company has their own NAS
   drive it can be accessed 24/7."* → **§4c.** This is the strongest idea in the
   design: a NAS *is* the always-on server §2 said WILSON does not have, it
   presents as the UNC path Phase 1 already supports, and prosumer NAS boxes
   ship their own VPN/relay — so *"won't set up a VPN"* stops implying *"can't
   have remote access"*. **It makes the gateway probably unnecessary.**

## 2. The one sentence that reframes the request

**WILSON has no server to leave on.**

The Express instance is a private implementation detail of the desktop app. It
is created inside `createWindow()`, binds `expressApp.listen(0, '127.0.0.1')`
(`electron/main.cjs:2800`) — loopback only, on an **ephemeral port chosen fresh
every launch** — and dies when the app closes. It runs on whichever artist's
laptop happens to have WILSON open. There is no service, no stable port, no
host, and nothing that survives a lid closing.

So "toggle external access on the server" is not a setting over an existing
capability. The capability does not exist. Everything below is scoped on that
basis, and it is the single most important thing to agree before any work
starts.

## 3. What was measured

Five findings. All were established by query or by execution, not by reading.

### 3.1 The storage root is per-machine, and holds a local disk path

Confirmed as stated in the S31 brief. `getFilesConfigPath()`
(`electron/main.cjs:89`) writes `{ defaultRootDir }` to
`{userData}/rabbit-data/files-config.json`. Audrey's saved value on this machine
is `C:\Users\Audrey\Documents\My_Work` — a **local disk path**. A second computer
has never written that file, falls back to the internal rabbit-data files dir,
and sees nothing. Carrying the string across would resolve against *that*
machine's identically-named folder: pointing at the wrong content, not sharing
content.

### 3.2 🚨 A `\\server\share` root fails closed on every single file

**This is the finding that would have burned the implementation session.**

`resolveContainedFilePath` (`electron/main.cjs:1330-1337`) is the containment
guard every file read, write and unlink passes through. Executed against UNC
inputs, the security property **holds** — every escape attempt returns `null`:

| base | relPath | result |
|---|---|---|
| `\\fileserver\Projects\Hero_FILES` | `shot01.mov` | `\\fileserver\Projects\Hero_FILES\shot01.mov` |
| `\\fileserver\Projects\Hero_FILES` | `..\..\..\..\..\secret.txt` | `null` |
| `\\fileserver\Projects\Hero_FILES` | `\\attacker\share\x` | `null` |
| `\\fileserver\Projects\Hero_FILES` | `//attacker/share/x` | `null` |
| `\\fileserver\Projects\Hero_FILES` | `C:\Windows\win.ini` | `null` |

`path.resolve` clamps at the share root, so `..` cannot climb out of a UNC
share. **UNC is not a security problem for this guard.**

It is a *correctness* problem, and a total one. `path.resolve` appends a
trailing separator to anything it considers a **root**, and a two-component UNC
path is a root:

```
path.resolve('\\\\srv\\share')          -> '\\\\srv\\share\\'     (trailing sep)
path.resolve('\\\\FILESERVER\\Projects') -> '\\\\fileserver\\projects\\'
path.resolve('C:\\')                     -> 'C:\\'
path.resolve('\\\\srv\\share\\Projects') -> '\\\\srv\\share\\Projects'  (no trailing sep)
```

The guard then tests `a.startsWith(b + path.sep)`. With `b` already ending in a
separator that becomes `\\srv\share\\` — a doubled separator that no real path
ever matches. Executed:

```
guard('\\srv\share',          'a.mov')  ->  null      ← every file rejected
guard('\\srv\share\',         'a.mov')  ->  null      ← every file rejected
guard('C:\',                  'a.mov')  ->  null      ← every file rejected
guard('\\srv\share\Projects', 'a.mov')  ->  '\\srv\share\Projects\a.mov'   ← fine
```

Consequences if a root of this shape is ever configured:

- **Download** returns `400 invalid storage path` (`main.cjs:2035`) for every file.
- **Delete** takes `diskPath === null`, skips the `unlink` (`main.cjs:2066`), and
  writes a `purged` certificate with `blob_removed: false`. The certificate stays
  honest, but the body is orphaned on the share forever.
- **Relink** is refused: `isUserAuthorizedRelinkDir`'s prefix test
  (`main.cjs:1354-1357`) uses the same `startsWith(base + sep)`, so
  `\\srv\share\Hero` is judged *outside* `\\srv\share`. Measured: `false`.

**`\\server\share` is the canonical way a person names a file share.** It is the
first thing anyone will type, and it is exactly the shape that breaks. Note this
is a **live defect today**, not a UNC-only one — `C:\` as a storage root has the
identical failure. It has never bitten only because nobody picks a drive root.

Fix: normalise by stripping a trailing separator before comparison, or compare
against `base.endsWith(sep) ? base : base + sep`. One line, plus tests that pin
`\\srv\share`, `C:\` and `Z:\` specifically — the three shapes that produce a
trailing separator.

### 3.3 Four strings, one folder — and the database would spread the problem

Measured normalisation of paths that address the *same bytes on disk*:

```
\\FILESERVER\Projects            -> \\fileserver\projects\
\\fileserver\projects            -> \\fileserver\projects\
\\fileserver.corp.local\Projects -> \\fileserver.corp.local\projects\
\\192.168.1.5\Projects           -> \\192.168.1.5\projects\
Z:\Projects                      -> z:\projects
```

Case folds. Hostname vs FQDN vs IP does not. **A mapped drive letter does not**
— and a mapped drive is per-machine by definition, so `Z:\Projects` in a shared
config is §3.1 all over again, wearing a network costume.

The implication for §5: moving the root into the database does **not** fix
machine-dependence on its own. It *spreads* it, because machine B now receives
machine A's spelling. A canonical form and a reachability probe are part of the
feature, not polish.

### 3.4 The `byos` storage mode was designed years ago and has zero readers

`public.workspaces` carries `storage_mode TEXT NOT NULL DEFAULT 'central'` with
`CHECK (storage_mode IN ('central','byos'))` and `storage_config JSONB`,
declared in `0001_workspaces_and_users.sql:29-30`. Its header states the intent
plainly: *"storage_mode drives the hybrid storage decision"*.

Queried on `wilson-dev`:

- All **4** workspaces are `'central'`. **0** rows have `storage_config` set.
- `grep` across `src/`, `electron/`, `supabase/functions/` and `scripts/` for
  `storage_mode` or `storage_config` returns **nothing**. The only non-migration
  reference is `0028_operator_console.sql:236,257`, which exposes it read-only in
  an operator view.

So `byos` — *bring your own storage*, precisely what Audrey is asking for — was
anticipated in the schema and **never built, never read, never surfaced**. This
is the fifth instance of the repo's most expensive pattern (folder tree S27,
task templates S28, quiz history S30, `setOtterAdapterMode`): a mechanism with
no call site. Here it is worse than dead — it is *live-wire dead*. An admin can
already set `storage_mode = 'byos'` today through `workspaces_admin_update`
(`0020:438`), because `fn_workspaces_client_guard` only protects `slug`, `id`,
`created_at` and `deleted_at`. Nothing reads it, so nothing happens. The moment
a reader is added, every workspace where anyone ever poked that column changes
behaviour.

### 3.5 The Express server is not exposable, and that is not a small gap

Measured on the current tree:

- **94** routes (`expressApp.get|post|patch|put|delete`).
- **Zero** authentication. No auth middleware, no `Authorization` header read
  anywhere in `main.cjs`. The loopback bind *is* the entire access control.
- `expressApp.use(cors())` at `main.cjs:143` — wildcard-open. This is already
  open TPN finding **TPN-NET-001** (HIGH).
- `/api/fetch-url` (`main.cjs:749`) and `/api/fetch-raw` (`main.cjs:786`) accept
  **any URL** with no allow-list and no SSRF protection — open **TPN-NET-002**
  (HIGH). `FINDINGS.md:674` already documents the live chain: *hostile web page
  → WILSON → the user's private network → data back to the page.*

Port-forwarding this to the internet would publish an unauthenticated file API
**and an open SSRF proxy sitting inside the studio's LAN**. That option is not
on the table below, and it should not be revisited.

### 3.6 The three upload paths, and what each can actually carry

Measured after Audrey's multi-GB answer, then **corrected** after she asked the
obvious follow-up: *"what if the company selected a cloud storage solution? they
cant save large files thats not acceptable."* She was right to push — the first
version of this section over-generalised a Local-Server measurement to cloud.

| Path | Mechanism | Ceiling | Fixable? |
|---|---|---|---|
| **Local Server `files`** | base64 → JSON body | **~37 MB** | ❌ needs a rewrite |
| **Cloud `files`** | `File` object → Supabase Storage | **50 MB** (bucket setting) | ✅ raise cap + resumable uploads |
| **Managed files** | native stream-to-stream copy | **none** | — already fine |

**Path 1 — Local Server `files`. Ceiling ≈ 37 MB, and not a tuning problem.**

```js
// src/tools/rabbit_v0.1.0/adapters/localServerAdapter.js:176-190
const buf = await file.arrayBuffer();
const base64 = arrayBufferToBase64(buf);
return jfetch(`${BASE}/projects/${projectId}/files`, {
  body: JSON.stringify({ name: file.name, ..., base64, scope }),
});
```

Three ceilings stack on that one function:

- `express.json({ limit: '50mb' })` (`electron/main.cjs:144`) caps the body.
- base64 inflates by ~33%, so 50 MB of body is **~37 MB of file**.
- `file.arrayBuffer()` loads the **entire file into renderer memory** first, and
  `downloadFile` does `res.blob()` coming back. A multi-GB file does not hit the
  limit — it exhausts the renderer before the request is ever made.

Raising `'50mb'` fixes nothing. Base64-over-JSON with a whole-file buffer on
both ends cannot carry gigabytes at any limit; it needs streaming, ranged reads
and resumable uploads, which is a rewrite of the plane rather than a config
change.

**Path 2 — Cloud `files`. Ceiling 50 MB, and it IS raisable.**

```js
// src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:970-975
const { error: upErr } = await client
  .storage.from('rabbit-files')
  .upload(storagePath, file, { cacheControl: '3600', upsert: false, ... });
```

The `File` object goes **straight to Supabase Storage** — no base64, no JSON
body, no `arrayBuffer()`. None of Path 1's problems apply here; the two adapters
are genuinely different code. The only ceiling is the bucket's
`file_size_limit = 52428800` (`0027_file_lifecycle.sql:287`), which is one
number in one migration.

Two things are needed to lift it, and both are bounded work:

1. **Raise the bucket cap.** A migration re-asserting `file_size_limit` — the
   existing `ON CONFLICT DO UPDATE` already re-applies bucket settings on
   re-run, so the shape is there.
2. **Switch large uploads to resumable (TUS).** Above the standard-upload
   threshold Supabase requires the resumable protocol. `@supabase/supabase-js`
   is on `^2.101.1` which supports it, and **the repo currently uses it
   nowhere** — grep for `uploadToSignedUrl` / `createSignedUploadUrl` / `tus`
   returns zero hits. So this is new code, not a config flip: chunking, resume
   after a dropped connection, and progress reporting the UI does not have yet
   on this path.

⚠️ **Confirm before promising a number.** Supabase's maximum object size and the
per-GB storage and egress rates are **plan-dependent**, and this design does not
assert a figure. Check the current plan and pricing before telling a customer
what cloud mode can hold — the engineering ceiling and the ceiling Petal Studios
is willing to pay for are different numbers, and for multi-GB video the second
one binds first.

**Path 3 — `managedFiles`. No ceiling.** `rabbit:copy-file`
(`electron/main.cjs:3009-3030`) is a native `createReadStream` →
`createWriteStream` pipe with progress events. It never touches HTTP, never
buffers the file, and is **`local_server`-only** by construction
(`supportsManagedFiles`, `RabbitProvider.jsx:2715`).

**What this actually decides.** Not "cloud can't do media" — cloud can, for
bounded work. What it decides is that **every storage mode must answer the
multi-GB question on its own terms**, because a company that picks cloud has no
office server to fall back on:

- **Network-storage customers** → managed files + the network root. Already
  streams, no ceiling, no per-GB bill. Nothing to build beyond Phase 1.
- **Cloud customers** → raise the bucket cap **and** implement resumable
  uploads. Real work, roughly its own phase, and it carries an ongoing storage
  and egress cost that network storage does not.
- **Local Server `files`** → stays small-file-only. It is the desktop app's
  offline path, not a media pipeline, and rewriting it serves nobody once the
  other two work.

🚨 **The first draft of this design said "cloud is for the small stuff." That was
wrong and Audrey caught it.** It would have shipped a storage mode that silently
could not do the customer's main job — which is the same class of defect as the
four features in this codebase that shipped with no caller. **A storage mode
that cannot hold the customer's files is not a storage mode.**

---

## 4. The options, honestly

Judged against: does it meet the requirement, what does it cost, and what does
it do to a TPN conversation.

### Option A — Use cloud mode. Build nothing.

Remote access to WILSON content **already exists and already works**. The
`rabbit-files` bucket (`0027_file_lifecycle.sql:283-340`) is private, path-scoped
by RLS that runs under the caller's own policies, wired to the file-event
lifecycle with real disposal certificates, and reachable over HTTPS from
anywhere with a Supabase Auth session.

- **Cost:** near zero.
- **TPN:** the strongest posture of any option here.
- ⚠️ **Not sufficient AS IT STANDS** (Audrey, 2026-08-05): *"i need to be able to
  store media so 50MB is not acceptable. im going to have multiple GB files at
  times."* The bucket caps at `file_size_limit = 52428800`.
- ✅ **But it IS fixable, and must be fixed** — see §3.6 Path 2. Cloud mode
  hands the `File` straight to Supabase Storage, so it has none of Local
  Server's base64 problems. Raising the cap plus implementing resumable uploads
  makes cloud a first-class media store. **A cloud customer has no office server
  to fall back on, so this is not optional** — it is its own phase, not a
  footnote to the network work.
- **The real trade is cost, not capability.** Multi-GB media in Supabase is a
  per-GB storage and egress bill every month; the same files on the company's
  own server are not. That is a pricing decision for Audrey, not an engineering
  constraint, and it should be made deliberately rather than discovered.

### Option B — UNC support + a workspace-scoped root (LAN only)

The storage root becomes a UNC path and lives in the database instead of
per-machine JSON. Every computer **in the office** resolves the same share. No
internet exposure whatsoever.

- **Cost:** moderate. Self-contained. No new infrastructure, no new deployable.
- **TPN:** neutral to positive. Adds no external surface. Satisfies the
  single-computer TPN team completely, and satisfies an office LAN.
- **This is the prerequisite for everything else.** Both C and D are built on it.

### Option C — VPN. ⭐ Recommended for the remote requirement.

The company's IT connects remote users into the office LAN. WILSON resolves the
same UNC path and **cannot tell the difference**. Zero WILSON code beyond
Option B.

- **Cost:** zero engineering. IT configuration, which a company large enough to
  run an always-on file server already has.
- **TPN:** this is what the MPA framework actually expects — remote access to
  content networks via VPN with MFA. It is the answer that *helps* a TPN
  conversation instead of complicating it.
- **Honest limitation:** it is not a WILSON feature, so it cannot be toggled
  from the admin portal. See §6 — the toggle still has a job.

### Option D — A WILSON File Gateway (a real new component)

A headless service the company installs on their server: terminates TLS,
verifies a Supabase Auth JWT, maps workspace membership onto filesystem access,
serves ranged reads out of the UNC root, and audits every byte.

- **Cost:** large. This is a product, not a feature — realistically 3–5 sessions
  before it is trustworthy, and it creates a second thing to version, ship,
  patch and support on customer hardware.
- **TPN:** passable but only with real work — TLS, authn, authz, per-request
  audit, rate limiting, no SSRF, and an answer on watermarking.
- ✅ **IN SCOPE (Audrey, 2026-08-05).** *"a VPN can be optional for some
  companies. some no. some may not want to setup a VPN."* Option C alone does
  not cover the customers she has in mind, so this is a real requirement for a
  real segment, not a last resort. **It is still the last thing built** — see
  §4b for the boundary it must carry, and §8 for the sequence.

### Option E — Reverse tunnel or hosted relay

WILSON dials out to a relay; remote clients reach the relay. Avoids inbound
firewall changes.

- **Cost:** large, plus permanent operational burden.
- **TPN:** **the worst option available.** Pre-release content would transit
  infrastructure Petal Studios operates, making Petal Studios a content-bearing
  sub-processor. Third-Party is already the audit's weakest domain (🔴 red, all
  three baseline findings fully open). This option makes a red domain redder.
- **Recommendation: rule out.** Documented here so the decision is on the record
  rather than rediscovered later.

### Ruled out — port forwarding

See §3.5. Not defensible at any effort level.

---

## 4a2. Who pays for the bytes — and the storage mode this question revealed

Audrey, 2026-08-05: *"i only start to incur cost when i start providing a cloud
solution i own and setup for companies? or if a company sets up connection to
their own cloud storage, am i paying for the traffic to store in their
solution?"*

**The rule, in one line: you pay for bytes that cross infrastructure you rent.
You do not pay for bytes that go direct.**

| Storage mode | Who stores it | Who pays for storage + transfer |
|---|---|---|
| **Petal-provided cloud** (today's `central`, Supabase) | Petal's Supabase project | **Petal**, per GB stored and per GB downloaded, every month, for every customer |
| **Company's own server** (this design's network root) | their file server | **nobody** — the bytes never leave their LAN |
| **Company's own cloud bucket** ⭐ *new — see below* | their S3 / their bucket | **the company**, provided WILSON talks to it **directly** |
| Any of the above **relayed** through something Petal runs | — | 🚨 **Petal, for every byte, forever** |

So: **yes** to the first half of her question, and **no** to the second — with
one condition that has to be designed in rather than assumed.

**The condition.** "Direct" means the customer's WILSON install talks to the
customer's storage without passing through a Petal-operated hop. If the bytes
were ever routed through a Supabase Edge Function, an `ai-proxy`-style relay, or
the hosted relay of Option E, Petal would pay egress on every gigabyte of every
customer's media — while also, per §7, becoming a content-bearing sub-processor.
**Option E was already rejected on TPN grounds; this is the second, independent
reason, and it is a recurring monthly one.**

⚠️ Two things that are Petal's cost regardless of storage mode, so they should
not be confused with the above: **AI calls** ride `ai-proxy` on Petal's Anthropic
account, and the cloud **metadata** (projects, budgets, tasks, the `files` rows
themselves) lives in Petal's Postgres. Only the *file bodies* move under this
design.

### Thumbnails — free today, and the reason is worth understanding

An earlier draft of this section said "thumbnailing is free" and left it there.
True, but narrow enough to mislead. Measured:

- **Generation is local.** `sharp` runs in the **Electron main process** — one
  HTTP route (`main.cjs:2412`) and two IPC handlers (`main.cjs:3093`, `:3111`).
  The source is read from disk, a 256px JPEG is cached to
  `rabbit-data/thumbnails/`, and nothing touches the cloud. **No bill.**
- **It is desktop-only.** `FileThumbnail.jsx:49` points an `<img>` at
  `/api/rabbit/projects/:id/managed-files/:id/thumbnail`, which exists **only on
  the Express server inside the desktop app**. In a browser that request 404s and
  the component falls back to a file-type icon. **Cloud/web mode has no
  thumbnails at all.**
- **It is images-only.** `THUMB_EXTENSIONS` (`main.cjs:117`) and `IMAGE_EXTS`
  (`FileThumbnail.jsx:15`) are the same nine image extensions. Video is routed
  to a generic `FileVideo2` icon (`:19`). **No video file is ever thumbnailed,
  on any backend, in any mode.**
- 🚨 **`files.thumbnail_url` has never been written.** Declared on three tables
  in `0000_rabbit_base_schema.sql:164,232,246` and present in the Supabase read
  allowlist (`supabaseAdapter.js:369`) — but a repo-wide grep finds **no
  writer**. Another dead field, in the same family as `storage_mode` (§3.4).

**Why this belongs in a cost section.** Thumbnails are free *because the source
is already on local disk*. That property does not survive either of the changes
this design proposes:

- **Network root:** `sharp(srcPath)` reads the source across the share. Still
  free (LAN traffic, no cloud), but a multi-GB read per first-time thumbnail —
  cached after, so slow once rather than slow always.
- **Cloud storage:** there is no local source. Generating a thumbnail would mean
  **downloading the file from Supabase first** — pulling gigabytes of egress, at
  Petal's expense, to produce a 256px JPEG. 🚨 **This is the one place
  thumbnails do cost real money, and it is exactly the case that Audrey's
  multi-GB media in cloud mode creates.**

**Recommendation.** If cloud-mode previews are ever wanted, generate the
thumbnail **once, on the uploading machine, at upload time** — the file is
already in memory there — and store the small JPEG alongside. That is what
`thumbnail_url` was evidently declared for and never wired to. Generating
thumbnails server-side, or on demand from cloud storage, turns every preview
into an egress charge against a file that may be several gigabytes.

**Not in scope for Phase 1** — her media is video, which has no thumbnail path
anywhere today, so nothing regresses. Recorded because the "free" property is
load-bearing and conditional, and the condition is about to change.

### The mode this question revealed: bring-your-own-cloud

Her phrasing — *"a company sets up connection to their own cloud storage"* —
describes a mode **this design did not have**, and it is the one where Petal's
marginal cost is zero:

| | Petal's cost | Needs an office server? | Works remotely? |
|---|---|---|---|
| Petal cloud | per GB, ongoing | no | ✅ built in |
| Company's server | none | **yes** | needs VPN or the gateway |
| **Company's own bucket** | **none** | **no** | ✅ built in |

That third row is strictly better than the second for a company with no office
server *and* no appetite for a VPN — which is exactly the customer that was
driving the gateway (Option D). **It may remove the need for the gateway
entirely for some of them**, because their storage is already internet-reachable
and already authenticated, by their own cloud provider, at no cost to Petal.

**Not designed here** — it needs its own pass covering which providers to
support, where the customer's credentials live and how they are encrypted
(WILSON has an AES-256-GCM precedent for per-tenant keys), and how the file
lifecycle and `downloaded` event work against a bucket Petal cannot see. Flagged
now because it changes the argument for Option D and should be evaluated
**before** committing 3–5 sessions to a gateway.

### 🚨 4a2b. BYO storage is a FAMILY, not a feature — Audrey, 2026-08-07

Stated while scoping the Google Drive question, and it is a constraint on every
storage session that follows:

> *"So remember its bring your own storage solution … nas, gdrive, AWS s3
> buckets, etc are all going to be options if we add the gdrive solution dont
> remove other options"*

**Adding a provider must be ADDITIVE. Nothing already supported may be
narrowed, and no provider gets its own parallel implementation.** The failure
this rules out is concrete and the schema is already leaning toward it.

**MEASURED (2026-08-07) — the shape today half-fits, which is the dangerous
kind of fit:**

- `public.files.storage_provider` is already a per-file enum
  (`0000_rabbit_base_schema.sql:67`) —
  `('supabase','google_drive','local_server')`. **This is the right dimension
  and it already exists**; a new provider is an `ALTER TYPE … ADD VALUE`.
- But `workspace_storage` (0048) encodes **"byos means a filesystem path"**:
  `root_path` + `root_kind ∈ ('unc','local')`, plus
  `workspace_storage_root_canon_chk` (no trailing separator) and
  `workspace_storage_kind_shape_chk` (`(root_kind='unc') = (left(root_path,2)
  = '\\')`). A Drive folder ID, or an S3 `{endpoint, region, bucket, prefix}`,
  is not a path and does not belong in `root_path`.

🚨 **Widening `root_kind` to `'gdrive'` would PASS the shape CHECK vacuously**
(`false = false`) while nothing validated the config — a provider that looks
configured and resolves nowhere. That is how the second provider forks the
first, and the third forks both.

**The shape this must take instead — one registry, not N modes:**

| Layer | Rule |
|---|---|
| `workspace_storage` | gains a **`provider`** column (`petal`, `network`, `gdrive`, `s3`, …). `root_path`/`root_kind` stay, and their CHECKs become **conditional on `provider = 'network'`** so S34's NAS rules are preserved exactly, not relaxed. |
| provider config | **one JSONB `provider_config`**, validated per provider — never three new flat columns per provider. |
| the adapter | **ONE storage-provider interface — put / get / delete / exists.** A provider is those four functions, never a fork of the 122-method backend adapter. `googleDriveAdapter`'s 57 `readOnly()` stubs are the shape to avoid, not to finish. |
| `files.storage_provider` | the per-file record of who holds this body, so a workspace that switches provider does not orphan what it already wrote. |

**Five invariants that hold for EVERY provider, so each new one cannot
re-litigate the security model:**

1. **The database always stays in Supabase.** Audrey's standing rule (§4a3):
   *"its only media etc that is saved on the selected storage solution"*.
2. 🚨 **Money-gated files NEVER leave Supabase**, whatever the media provider.
   `INVOICES/`+`FINANCE/` are manager-only because the storage path's third
   segment says so and Postgres enforces it (`rabbit_money_segment`, 0042).
   Drive has opaque IDs and its own sharing model; S3 has bucket policies —
   neither can bind to a WILSON project role. Moving invoices to either
   re-opens the exact hole 0038 shipped and 0039 closed, in a store where RLS
   cannot see it. **One rule, no second gate to get wrong.**
3. **Purge is provider-aware.** Deleting a file deletes the body at its
   provider AND writes the certificate (`TPN-CONT-002`); a derived thumbnail
   dies with its source wherever both live.
4. **`downloaded` logging is advisory outside Supabase** — already a stated
   limit (S33) and it generalises: WILSON cannot observe a read the customer's
   own provider serves directly.
5. **Credentials encrypted at rest**, per-tenant, on the AES-256-GCM precedent.

**Sequencing note, and it inverts the obvious order.** S3-compatible is
probably the *cheaper first provider*, not Drive: one adapter covers AWS S3,
Backblaze B2, Wasabi, Hetzner, Cloudflare R2 and MinIO, and it needs **no
OAuth consent screen, no Google app verification and no scope tiering** —
just endpoint, region, bucket, key and secret. Drive needs an OAuth client
Petal ships and verifies (`drive.file` scope keeps that out of the restricted
tier / CASA assessment — confirm against Google's current policy before
committing). The handbook already carries the locked decision that
S3-compatible providers arrive *through one adapter* (§12.1); this section is
that decision generalised to the whole family.

## 4a3. Petal cloud is a PAID, OPERATOR-MANAGED product — Audrey, 2026-08-07

Decided the day S34 shipped the storage-mode selector, when Audrey asked what
"Petal cloud" actually does today and was told the truth: uploads have gone to
the shared `rabbit-files` bucket since S14, 50 MB per file, **no metering, no
quota, no approval, no payment linkage** — every workspace defaults to it.
Verbatim:

> *"if the storage selection is petal cloud and it does store media on petal
> cloud, please make sure to set it up management of that in the operator
> terminal. so if the company selected the petal cloud option, the operator
> terminal should have control to partition server space for that company and
> approve access. so basically if users do want to use the petal offered
> storage they need to be paying the monthly payments for access. it needs to
> be controlled and managed by the operator terminal for when their are
> multiple companies using the tool"*

And the standing rule restated in the same message: *"all databases for tasks,
etc all of it should be saved in supabase databases. its only media etc that
is saved on the selected storage solution"* — already true by construction
(§4a2: only the file *bodies* move under this design), and every future
storage change must keep it true.

**Three decisions, settled 2026-08-07 (Audrey: "agree with all your
answers"):**

1. **No plan = a small free allowance (1 GB), then a plan is required.** A
   zero-allowance refusal makes the first-day experience feel broken; a free
   tier is a funnel, not a cost.
2. **"Petal cloud" stays VISIBLE to non-paying companies, but inert** — the
   selection shows "not yet active — contact Petal". Hiding it makes the
   product look like it lacks the feature.
3. **Billing is MANUAL in v1.** The operator flips a company active/suspended
   as payments start and stop; payment-provider automation is its own later
   session.

**The shape (built by S41, not before):** an operator-owned
`workspace_storage_plans` table following the model-control-plane precedent
(0031) — status, quota, audit trail via `platform_audit`; enforcement as a
**RESTRICTIVE** policy on `rabbit-files` INSERT (a permissive one would OR
into the existing set — the 0038 inversion); usage metered per workspace and
shown in both terminals. ⚠️ **"Partition" here means a metered quota, not a
physical partition** — Supabase Storage has no per-tenant partitions; if hard
isolation is ever wanted, bucket-per-company is the alternative, at the cost
of multiplying the policy surface 0042 deliberately collapsed to one
definition.

🚨 **Ordering: this lands BEFORE S42 raises the 50 MB cap.** Raising the cap
first would turn an unmetered free tier into an unmetered multi-gigabyte one.
S42 is blocked on S41 in the master plan's sequence table.

## 4c. ⭐ The NAS answer — Audrey, 2026-08-05

> *"so VPN works for TPN companies. some companies may not have it so we need
> both possible. idea would be as long as the end user company has their own NAS
> drive it can be accessed 24/7"*

**This is the strongest idea in the whole design, and it removes most of the
hard part.** It answers §2 directly: WILSON has no server to leave on — but a
NAS *is* an always-on server, it is the customer's, and it already exists in the
kind of company that has one.

### Why it collapses the problem

A NAS presents itself as an **SMB share** — `\\nas\projects`. That is precisely
the path shape Phase 1 already has to support. So:

- **On the LAN:** nothing extra. Phase 1 is the whole feature.
- **Remotely:** the NAS is reached however the customer chooses, and **WILSON
  cannot tell the difference** — it still resolves `\\nas\projects`.

🚨 **And it dissolves the objection that put the gateway in scope.** Audrey's
concern was *"some may not want to setup a VPN"* — reasonably, because "get IT
to stand up a corporate VPN" is a project. But a prosumer NAS (Synology, QNAP,
TrueNAS, Ugreen…) ships **its own remote access as a built-in feature**:

| NAS capability | What the customer does |
|---|---|
| Built-in **VPN server** (Synology VPN Server, QNAP QVPN) | enable a package in the NAS admin UI |
| Vendor relay (QuickConnect, myQNAPcloud) | tick a box; **no port forwarding, no firewall change** |
| WebDAV / vendor sync client | install the vendor's client |

So "the company won't set up a VPN" and "the company can't have remote access"
turn out to be different statements. **The NAS vendor has already built the
thing we were considering spending 3–5 sessions building** — and theirs is
maintained, patched and supported by someone else.

### What this means for Option D

**Option D (the WILSON File Gateway) should be considered probably-unnecessary
and moved behind a real customer.** Combined with §4a2's bring-your-own-cloud
row, there are now two independent ways to serve the customer who was driving
it, neither of which costs Petal a session or a sub-processor. Do not build a
gateway until a named customer has refused a NAS, refused a VPN, refused their
own cloud bucket **and** refused Petal's cloud.

### ⚠️ The caveat that has to be said out loud

**"Accessible 24/7" is true. "Usable for multi-GB video over the internet" is
not the same claim.**

SMB is a chatty, latency-sensitive protocol designed for a LAN. Mounting a share
across a home broadband connection and opening a 5 GB file off it is slow — not
broken, genuinely slow, and it will feel broken. This is well-trodden ground in
post-production, and it is why studios use purpose-built transfer tools
(Aspera, Signiant, MASV) rather than working directly off a remote-mounted share.

What works well remotely:
- Browsing the tree, reading metadata, opening documents and small assets.
- **Copying a file down, working locally, copying it back.**

What works badly:
- Scrubbing or editing multi-GB media *in place* over the WAN link.
- The first thumbnail of a large image (§4a2) — one full read across the link.

**This is an expectation to set with the customer, not a defect to fix.** It
should appear in the setup guidance beside the NAS instructions, because the
alternative is a customer concluding WILSON is slow when the physics is the
share.

### ⚠️ One thing to check before promising it

The workspace root must be stored as a **UNC path** (`\\nas\projects`), not a
mapped drive letter — §3.3 measured why: `Z:` means something different on every
machine, and the design refuses it for exactly that reason.

Most NAS remote-access methods preserve the UNC form (a VPN certainly does).
**Some vendor sync clients only surface the share as a mapped drive letter.** If
a customer's chosen method does that, the design's mapped-drive refusal will
block them. Worth confirming against whichever NAS Audrey actually has in mind
before this is promised to anyone — it is a five-minute check with a real box,
and it is the kind of thing that is much cheaper to learn now than in Phase 1.

## 4b. How the gateway reconciles with TPN — and it does, cleanly

The TPN pass (§7) found that TS-2 names *"Bastion host model only. VPN with
AES-256"* as **the** remote-access control, which read as a flat prohibition on
Option D. Audrey's answer that some companies will not set up a VPN looked like
a head-on collision with that.

**It is not, and the reason is in her original requirement.** She scoped the
gateway herself, in the sentence that opened this whole piece of work:

> *"A **company that does NOT need TPN compliance** should be able to reach
> content stored on their server from outside the local network."*

So the two populations were never the same population:

| Customer | Storage | Remote access | TPN posture |
|---|---|---|---|
| **TPN-compliant studio team** | network root on their own server | one computer, or VPN | Gold-eligible |
| **Company that will run a VPN** | network root | VPN | Gold-eligible |
| **Company that refuses a VPN** | network root | **gateway** | **not Gold-eligible, by their own choice** |

TS-2 is not violated by *offering* the third row. It is violated by a customer
who needs a Gold Shield turning it on. That makes the requirement a **product
boundary**, and the boundary needs to be enforced and visible rather than
buried in documentation:

1. **Off by default.** A workspace that never touches the setting is on the
   compliant path.
2. **The admin toggle IS the compliance boundary.** Turning on external access
   is the moment a workspace leaves Gold eligibility. The UI must say that, in
   those words, at the point of the switch — not in a manual. This is the single
   most useful thing the toggle can do, and it is a better answer than the
   read-only status panel the first draft proposed.
3. **Never marketed or documented as TPN-compliant.** A TPN-track customer
   asking for it gets steered to VPN or single-computer.
4. **The gateway does not weaken the LAN path.** A workspace with the toggle off
   must be provably identical to one where the gateway does not exist.

Recording it this way means a future session does not have to re-derive whether
the gateway was a mistake. It was scoped correctly from the first sentence; the
audit finding survives as the *label on the switch*.

---

## 5. Design — the parts that would actually be built

### Phase 0 — Fix the guard first (prerequisite, small)

Independent of every option, and worth doing even if Audrey stops here.

1. Normalise the trailing separator in `resolveContainedFilePath` and in
   `isUserAuthorizedRelinkDir`'s prefix test (§3.2).
2. Tests pinning `\\srv\share`, `C:\` and `Z:\` as roots — the shapes that
   produce a trailing separator. Guard the **call site**, not just the helper:
   a unit test over `resolveContainedFilePath` alone would pass today while
   downloads 400.

### Phase 1 — UNC + workspace-scoped root (Option B)

**Path handling.** `dialog.showOpenDialog` with `openDirectory`
(`main.cjs:2983`) already accepts and returns UNC paths on Windows — the picker
needs no work. What is needed:

- A `classifyRoot(p)` helper returning `local | unc | mapped`, so a mapped drive
  can be **refused with an explanation** ("Z: means something different on every
  computer — enter the `\\server\share` path instead") rather than silently
  saved and later broken. This is the §3.3 defence.
- A **reachability probe** before saving: does the path exist, is it readable,
  is it writable, how long did the round trip take. A share that is unreachable
  must fail at configuration time with a sentence a person can act on — not at
  the first download, six screens away.
- Honest UX about latency. A UNC read is a network round trip; thumbnail
  generation (`sharp`, `main.cjs:6`) over a share will be visibly slower than
  local disk.

**Where the root lives.** A dedicated table, following the house norm — of 45
policied tables on `wilson-dev`, 40 scope by workspace:

> ⚠️ **Take the next free migration number at the time, do not hardcode one.**
> 0000–0045 are on all three environments, but **S31 has already claimed 0046**
> (`0046_user_pets_and_settings.sql`) in the working tree, along with pgTAP
> suites **56 and 57**. This design was first written saying "0046, next free"
> and that was wrong within the hour — the working tree, not the deployed
> migration list, is what says a number is taken. Assume **0047+** and **suite
> 58+**, and re-check both before writing anything.

```sql
CREATE TABLE public.workspace_storage (
  workspace_id  UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  root_path     TEXT,                      -- canonical UNC, no trailing separator
  root_kind     TEXT CHECK (root_kind IN ('unc','local')),
  -- audit columns per house pattern
  created_at, created_by, updated_at, updated_by
);
```

RLS: **SELECT** for active members of the workspace; **UPDATE/INSERT** for
`admin` only, mirroring `workspaces_admin_update`'s shape
(`current_workspace_id()` + `current_app_role() = 'admin'` +
`has_active_membership(id)`). A pgTAP suite pins that a member cannot write and a
non-member cannot read, and it must be registered in `.github/workflows/rls.yml`
by hand — that list is not derived, and the CI comment says so.

### 5a2. Who may set a storage path, and the two-step confirmation

Two requirements from Audrey (2026-08-05), both landing on the same control:

> *"do not let a base user have access to setup paths only managers"*
>
> *"give one first confirmation explanation this will only work for a single
> user with no team since its on a single computer drive. then ask to confirm
> they are sure they want to do this"*

**🚨 There is no permission gate on this control today — MEASURED.**
`StorageConnections.jsx` **imports `usePermissions` and never gates on it**:

```js
// src/components/settings/StorageConnections.jsx
15: import { usePermissions } from '../../permissions'
46: const perms = usePermissions()
...
104: <Card icon={Cloud} ... connected={!!perms.workspaceId}>   // ← display label
106:   {perms.workspaceId                                       // ← display label
```

`perms` is read twice, both times for a **label**, never for a role check. So
the "Choose folder" and "Change" buttons that write `defaultRootDir` are
available to every signed-in user including a `user`-role member. This is the
same shape as S29's ungated `TimelineView` — the hook is present, which makes
the file *look* gated on a skim, and nothing is actually gated.

It is low-impact **today** only because the root is per-machine (§3.1): a member
repointing it changes their own computer and nobody else's. **Phase 1 makes the
root workspace-wide, which turns the same ungated button into "any member can
repoint the whole company's media."** The gate must land in the same phase as
the shared root, not after it.

**The gate — settled by Audrey, 2026-08-05, and it is sharper than either option
that was offered:**

> *"admins can set server/drive. managers can set folders within set drive. this
> stops anyone from breaking it. it only allows the admin to choose the drive.
> the admins can set the drive in the admin terminal. the managers set the
> project folder in the drive in the project control panel."*

The split is by **what is being set**, not just by who — and it maps onto a
distinction the code **already has**:

| Setting | Who | Where | Column |
|---|---|---|---|
| **The drive / server** (the root everything lives under) | **admin only** | **Admin Terminal** | `workspace_storage.root_path` |
| **A project's folder inside that drive** | **admin or manager** | **Project Control Panel** | `projects.folder_root` |
| Nothing | `user`, reviewer | — | — |

`electron/main.cjs:1438` already resolves `project.folder_root ||
cfg.defaultRootDir`, and `ProjectSummaryView.jsx:370` — the Control Panel — is
already where `folder_root` is displayed. So this is not a new concept to build;
it is an existing one that needs an owner and a boundary.

🚨 **The boundary is the part that does not exist, and it is the whole point of
her rule.** *"this stops anyone from breaking it"* only holds if a manager's
project folder must sit **inside** the admin's drive. Today it need not:

```js
// electron/main.cjs:1431 — create
folder_root: req.body.folder_root || null,
// electron/main.cjs:1455 — patch
bundle.project = { ...bundle.project, ...req.body, id: bundle.project.id };
```

`folder_root` is taken **straight from the request body and validated against
nothing**. A project can currently be pointed at any absolute path on the
machine. The relink flow has a containment check
(`isUserAuthorizedRelinkDir`) and this route does not.

**So Phase 1 must containment-check `folder_root` against the workspace
`root_path`** — the same `resolveContainedFilePath` logic that already guards
individual files, applied one level up to the folder itself. Without it, "only
admins choose the drive" is advisory: a manager could set a project folder
outside the drive entirely and the admin's choice would be bypassed by the next
project anyone creates.

Per `wilson_permission_gate_rules`: handle `ready` in both surfaces, or a real
admin sees the drive control disabled while their role resolves. And the RLS
policy is the enforcement — the two screens are the courtesy.

**The two-step confirmation.** It fires on **path kind**, not on every save —
a confirmation that appears every time is a confirmation nobody reads:

| What they picked | What happens |
|---|---|
| **Local folder** (`C:\Users\...\My_Work`) | **Step 1 — explain:** this folder is on *this computer only*. Nobody else on the team will be able to open these files, and you will not see them from another machine. If you work with a team, use a network path (`\\server\share\...`) instead. **Step 2 — confirm:** "Set this computer's folder anyway?" |
| **Network path** (`\\server\share\Projects`) | No single-user warning — this is the team case. Reachability probe, then save. |
| **Mapped drive** (`Z:\Projects`) | **Refuse.** A drive letter means something different on every computer. Show the `\\server\share\...` form and ask for that instead. |
| **Drive root** (`C:\`) **or bare share root** (`\\srv\share`) | **Refuse** — §3.2 measured that these break every file operation. After Phase 0's fix they still warrant refusing: a root hands WILSON the entire disk or share. Ask for a subfolder. |

The first step is an **explanation, not a question** — it states the consequence
in the words above. The second is the only place a button says "yes". Splitting
them is the point: a single "Are you sure?" gets clicked through, whereas being
told *what will happen* and then asked separately does not.

### 5b. The storage-mode selector, and what to do with the legacy columns

Audrey's answer to the toggle question — *"the toggle should only exist for
local network storage solution. so if that one is selected then the toggle is
visible"* — establishes that a **storage-mode selector** is part of the product.
A workspace picks where its media lives, and the external-access toggle only
appears for one of those choices.

That is exactly the concept `storage_mode`'s `CHECK (storage_mode IN
('central','byos'))` was declared for in 0001. The schema's original author had
the right model; it was simply never built (§3.4). So the answer to "drop or
guard?" is **neither, quite**:

- **Keep the concept.** `central` (cloud) vs `byos` (their own server) is the
  right vocabulary and it is already in the database.
- **Do not read the legacy columns.** Put `mode` on the new `workspace_storage`
  table alongside `root_path` and `root_kind`, so the feature starts from rows
  that have only ever been written by validated code. §3.4's problem is that
  `storage_mode` is admin-writable *today* with no validation; a new table has
  no such history.
- **Guard the old columns in the same migration** — extend
  `fn_workspaces_client_guard` to reject client writes to `storage_mode` and
  `storage_config`, exactly as it already does for `slug`. One `IF` per column.
  That closes the live wire without a destructive drop, and leaves the operator
  view (`0028:236,257`) reading a column that can no longer drift.

**Why not just use the JSONB blob.** `storage_config` is whole-object
last-writer-wins under a `FOR UPDATE` policy — the same clobbering failure mode
S31 is fighting in the pet right now. Explicit columns on a dedicated table let
two admins change two different settings without one erasing the other.

**A per-machine fallback must remain.** Local Server mode has to keep working
for a solo user with no workspace, and `files-config.json` is the only store
that works before sign-in. Resolution order: project `folder_root` → workspace
`root_path` → machine `defaultRootDir` → internal rabbit-data. The existing
`resolveFileBaseDir` / `resolveProjectFilesDir` chain already has this shape.

⚠️ **`isUserAuthorizedRelinkDir` must learn about the new root.** It currently
trusts `readFilesConfig()?.defaultRootDir` (`main.cjs:1352`). If the root moves
to the database and that lookup does not move with it, relink starts refusing
folders inside the configured root. Related: `userAuthorizedDirs` is an
in-memory `Set` rebuilt every launch, so a root that arrives from the database
is in nobody's authorized set on a fresh machine.

### Phase 2 — Remote reachability

Recommended content: **documentation, not code.** A section in
`SYSTEMS_HANDBOOK.md` describing the VPN arrangement (Option C), what WILSON
requires of it, and what it deliberately does not do. Phase 1 already makes it
work.

Phase 3 (Option D) is deliberately left un-designed in detail. It should not be
designed until Audrey has decided she wants it, because designing it is itself
most of a session.

---

## 5d. Thumbnails everywhere, and video preview

Two requirements from Audrey, 2026-08-05:

> *"all thumbnails need to be accessible on web and desktop. no videos for
> thumbnails is fine."*
>
> *"can we add a way to preview videos on the app?"*

### 5d.1 Thumbnails on web as well as desktop

Today they are desktop-only (§4a2): the `<img>` points at an Express route that
exists only inside the packaged app, so a browser gets a file-type icon.

**Generate at upload time, on the machine doing the upload.** The file is
already in memory there, so this costs nothing and — critically — avoids the
one expensive design (§4a2: generating on demand means downloading the source,
gigabytes of egress for a postage-stamp JPEG).

```
createImageBitmap(file) → draw to a 256px canvas → canvas.toBlob('image/jpeg', 0.8)
```

No library needed, and it runs identically in the browser and in the Electron
renderer — which is what makes one implementation serve both.

**This finally gives `files.thumbnail_url` a writer.** The column has existed on
three tables since `0000_rabbit_base_schema.sql` and has never been written
(§4a2). It was evidently declared for exactly this.

**Where they live — Audrey, 2026-08-05:** *"lets store thumbnails within the
supabase storage that stores database info. and lets set a file size limit for
thumbnails. thats a very common thing."*

She is right, and the size limit **forces a decision** the first draft had left
implicit: it has to be a **separate bucket**.

🚨 **A bucket has exactly one `file_size_limit`.** `rabbit-files` must accept
multi-GB media once Phase 2b raises its cap. A thumbnail cap and a media cap
cannot coexist in one bucket. So:

| Bucket | `public` | `file_size_limit` | Holds |
|---|---|---|---|
| `rabbit-files` | **false** | raised in Phase 2b | source media |
| **`rabbit-thumbnails`** (new) | **false** | **256 KB** | derived previews |

256 KB is generous — a 256px JPEG at q80 is typically 10–30 KB — while still
refusing anything that is obviously not a thumbnail. Enforced by Storage itself,
not by client code that can be bypassed.

🚨🚨 **The new bucket MUST be private, and this is the trap.** The instinct with
thumbnails is "they're small and harmless, make the bucket public so they load
fast." **That would recreate an open CRITICAL finding** — `TPN-CLOUD-004` is
exactly that defect on the `user-avatars` bucket (public, with an unconditional
SELECT policy, enumerable with the public anon key). Doing it again for
**frames of pre-release content** would be materially worse than the original.
`public = false`, no exceptions.

**Keep the path layout identical across both buckets:**

```
rabbit-files/      projects/{id}/{entity}/{entityId}/{ts}-{name}.ext
rabbit-thumbnails/ projects/{id}/{entity}/{entityId}/{ts}-{name}.ext.jpg
```

Storage RLS keys on path segments, and the **third** segment is the money gate
(`public.rabbit_money_segment`, migration 0042). Holding the layout identical
means the four `rabbit-files` policies port to the new bucket by changing
`bucket_id` and nothing else — including the invoice gate, so an invoice's
thumbnail stays manager-only.

🚨 **Port the invoice policy or it opens a hole.** `supabaseAdapter.js:909-940`
describes the base policies and the invoice policy as a pair where *"changing
either without the other opens a hole."* A new bucket with only the three base
policies copied would leave invoice thumbnails visible to every project member —
the exact hole, one level over, in the place nobody thinks to look. Pin all four
in pgTAP alongside the existing `05_files` coverage.

⚠️ Thumbnails may carry `cacheControl`; **source content may not** — `TPN-CONT-003`
requires `no-store` on content responses. Different buckets make that easy to
get right, which is a second reason to split them.

⚠️ **The thumbnail is a derived object and must be purged with its source.**
Otherwise this repeats `TPN-CONT-011` verbatim — derived content surviving the
purge of the file it came from, orphaned and uncertificated. Add it to the same
deletion path and the same certificate, not a later sweep.

### 5d.1b Video thumbnails — a still frame, automatically

**Supersedes the earlier "no video thumbnails" scope** (Audrey, 2026-08-05):
*"for videos i would want to be able to get a single still frame and make it the
thumbnail automatically lets add that."*

**Mechanism — the same shape as images, no new dependency.** In the browser or
the Electron renderer:

```
<video src={blobURL}> → seek to a chosen timestamp → drawImage to canvas → toBlob('image/jpeg')
```

Same canvas, same 256px output, same bucket, same upload-time timing, same zero
egress. It reuses 5d.1's machinery rather than adding a parallel path.

**Which frame.** Not frame 0 — video routinely opens on black, a fade-in, or a
slate, and a wall of black thumbnails is worse than icons. Seek to **~10% of
duration, clamped to 1–10 seconds**, and if the seek or decode fails, fall back
to the file icon rather than storing a black frame. Worth making the chosen
frame **replaceable by hand** later; the automatic pick is right most of the
time, not always.

🚨 **The codec limit from §5d.2 applies here too, for the same reason.** Frame
extraction uses the browser's decoder, so it works for H.264/AAC MP4, WebM and
AV1 — and **fails for ProRes, DNxHD and most professional MOV variants**. This
is not a bug to fix in this phase: the same file that will not preview will not
thumbnail, because it is one decoder answering both questions. Those files keep
the `FileVideo2` icon. If ProRes coverage is ever wanted, it is ffmpeg, and it
is the **same decision** as transcoding for preview — decide both together or
neither.

⚠️ **Managed files have no `File` object to read.** They are added by
`rabbit:pick-files` → `rabbit:copy-file`, a native path-to-path stream in the
main process (`main.cjs:3009`), so the renderer never holds the file. Two
options, and the second is better:

1. ffmpeg in the main process — handles ProRes, heavy dependency.
2. **Extract the frame *after* the copy, through §5d.2's serve route** — the
   renderer points a hidden `<video>` at the new Range-capable endpoint and grabs
   a frame exactly as it does for cloud files. **One implementation covers both
   backends, and it costs nothing extra because that route is being built
   anyway.**

**This makes §5d.2 a prerequisite for managed-file video thumbnails**, so the
two features should be sequenced together even though they are separately
useful.

### 5d.2 Video preview — yes, with three honest limits

**What has to be built.** There is **no serve route for managed files at all**
today — `main.cjs` has PATCH, DELETE and `/thumbnail` for managed files and
nothing that streams the bytes. They are opened through the OS
(`rabbit:open-in-explorer`). So desktop preview needs a new route.

🚨 **It must support HTTP Range requests.** Without ranges a `<video>` element
cannot seek, and the browser pulls the entire file before playing — on a 5 GB
master that is not a slow preview, it is a hang. Express's `res.sendFile`
handles ranges automatically (the existing `files` download route at
`main.cjs:2038` gets this for free); a hand-rolled `createReadStream` does
**not** unless the `Range` header is implemented explicitly. That is the single
most likely thing to get wrong here.

**Limit 1 — codec, and this is the big one.** Chromium plays H.264/AAC MP4,
VP8/VP9 WebM and AV1. It **cannot** play ProRes, DNxHD, or most professional MOV
variants — which is a large share of what a studio actually holds. Making those
play means transcoding (ffmpeg), which is a substantial dependency and its own
product decision, not part of this.

→ **Detect and say so.** Show a clear "Preview isn't available for this format"
with an **Open in default app** button (that path already exists) rather than a
black rectangle. A silent failure here reads as a broken feature; a named
limitation reads as a considered one.

**Limit 2 — cloud playback bills per view.** A signed Supabase URL in a
`<video>` tag works and supports ranges, but every play and every scrub streams
from Supabase as egress Petal pays for. A few passes over a multi-GB file is
real money. **Gate cloud video preview behind the §4a2 cost decision**; local
and NAS playback costs nothing.

**Limit 3 — NAS over a WAN link.** Playback is a large sequential read across
the connection, so §4c's slowness caveat applies at full force. Fine on the LAN;
expect buffering from home.

**Recommended order:** local/NAS first (no egress, immediate value, and it
proves the Range implementation), cloud second once the cost question is
settled, transcoding not at all unless a customer asks and pays for it.

**Sizing.** 5d.1 (image thumbnails + the new bucket) is small and belongs with
Phase 1. **5d.1b (video frames) and 5d.2 (preview) belong together in Phase 2d**
— they share the decoder, they share the codec limit, and managed-file video
thumbnails need 5d.2's serve route to exist. Splitting them would mean building
the same understanding twice.

## 5e-pre. Two corrections before reading §5e

Audrey, 2026-08-05: *"forget ffmpeg what is the webM soluition you are referring
to? i cant have local only nothing and i will not have the app be open source."*

Both objections come from §5e being written badly. Correcting them here rather
than editing the section, so the reasoning stays visible.

### Correction 1 — WebM is not an alternative to ffmpeg

There is no "WebM solution" that replaces ffmpeg, and §5e should not have read as
though there were. **WebM is an output format, not a tool.** It was mentioned as
*what ffmpeg should be told to produce* when making a preview proxy, in order to
sidestep H.264's patent pool. Drop ffmpeg and WebM solves nothing on its own —
something still has to decode the ProRes.

### Correction 2 — 🚨 ffmpeg does NOT force WILSON to be open source

This is the important one. §5e led with a GPL warning and buried the fact that
**the warning does not apply to what WILSON actually needs.**

- ffmpeg ships in two shapes. The **LGPL** build is explicitly intended for use
  by proprietary, closed-source software. Invoked as a separate executable — as
  WILSON would — it creates **no obligation to publish any of WILSON's code**.
  Commercial closed-source products ship it routinely.
- The **GPL** build is the one with copyleft consequences. You get it only by
  deliberately including GPL components (`libx264`, `libx265`, `--enable-gpl`).
  You have to opt in.
- **Still-frame extraction from ProRes/DNxHD needs the LGPL build and nothing
  more.** Decoders for both are in it; JPEG encoding is in it; JPEG's patents
  expired long ago.

**So: closed source and ProRes thumbnails are not in tension.** Dropping ffmpeg
on licensing grounds would give up professional-codec support in exchange for
avoiding a problem that does not exist at this scope. The GPL question only ever
arose for *encoding H.264 preview proxies*, and WebM/VP9 was the answer to that
narrower question.

### The real constraint is the one worth designing around

*"i cant have local only"* is a legitimate requirement and it is the substantive
part. §5e was also unclear here, so plainly:

**The proposal was never that web users get nothing.** Thumbnails are generated
once, uploaded to `rabbit-thumbnails`, and **every web user sees every
thumbnail**. What is desktop-only is *generating* one for a codec no browser can
decode.

So the actual question is narrow: **does a web-only user ever need to add a
ProRes file and have its thumbnail appear automatically?**

| Route | Works on web? | Petal's cost | Third-party in the content path? |
|---|---|---|---|
| **A. Browser-native** (H.264/MP4, WebM, AV1) | ✅ yes | none | no |
| **B. Desktop ffmpeg** (ProRes, DNxHD) | generation no, **viewing yes** | none | no |
| **C. Server-side ffmpeg worker** | ✅ yes | **compute + egress to pull the source** | no (Petal runs it) |
| **D. Hosted transcoder** (Mux, Cloudflare Stream, MediaConvert…) | ✅ yes | per-minute/per-GB | 🚨 **yes — new sub-processor** |

**Recommended: A + B, and treat C as the escape hatch if a real web-upload case
appears.**

- **A covers most files at zero cost on every platform** — the browser already
  has these decoders. No ffmpeg involved at all.
- **B covers the professional codecs.** And the practical point: a multi-GB
  ProRes file is not realistically *uploaded through a browser* anyway — that is
  the resumable-upload problem of Phase 2b at its worst. Studio media enters
  next to the NAS, on the desktop app. **The place the file arrives is the place
  the decoder already is.**
- **C is real but expensive**, and expensive in the specific way §4a2 warned
  about: the worker must download the source to read one frame, so a 5 GB file
  costs 5 GB of egress per thumbnail. Only worth it if web upload of
  professional codecs turns out to be a genuine workflow.
- 🚨 **D should be refused on the same grounds as the hosted relay (Option E,
  `TPN-3P-010`)** — it puts pre-release frames through a third party and makes
  them a disclosed sub-processor in the audit's weakest domain.

**Nothing here needs deciding now.** Phase 1 ships image thumbnails (browser-only,
route A, works everywhere). The ffmpeg decision belongs with Phase 2d, and by
then it will be clear whether anyone is uploading ProRes through a browser.

## 5e. ffmpeg — required, and what "free" means here

Audrey, 2026-08-05: *"do we need to add ffmpeg to the tech stack for those to
work? they will be necessary"* — and then: *"is it free?"*

**Yes to the first.** ProRes, DNxHD/DNxHR and most professional MOV/MXF variants
cannot be decoded by a browser engine. There is no second option worth
evaluating; ffmpeg is what everyone uses, including the tools these files come
out of.

> ⚠️ **Read §5e-pre first.** This section led with its GPL warning and buried the
> conclusion, which made it read as "ffmpeg threatens your closed source". **It
> does not.** The LGPL build is built for proprietary software and covers
> everything WILSON needs. Keep that in mind through what follows.

**Free — with a distinction that matters commercially.** The *software* costs
nothing. The obligations depend on **which build** ships and **what it is asked
to do**, and WILSON's two uses land on opposite sides of that line.

### The two uses are not equally clean

| Use | Needs | Licence position |
|---|---|---|
| **Still frame** (§5d.1b) — decode one frame, write a JPEG | ProRes/DNxHD **decode** + JPEG encode | ✅ **Clean.** Both are in an LGPL build. JPEG's patents expired long ago. No GPL component required |
| **Preview proxy** (§5d.2) — transcode to something a browser plays | H.264 **encode** | ⚠️ **Messy.** `libx264` is **GPL**, and H.264 itself is patent-pooled |

🚨 **The GPL trap.** A GPL-built ffmpeg bundled with a proprietary desktop app
creates a copyleft obligation. The standard way round it is well-trodden and
WILSON should follow it exactly:

1. Ship an **LGPL build** (no `--enable-gpl`, no libx264/x265).
2. Invoke it as a **separate process**, never linked into the app — calling a
   standalone executable is not derivative work.

**And the H.264 problem is avoidable entirely: encode previews as VP9/WebM.**
`libvpx` is BSD-licensed, VP9 is royalty-free by design, and every browser
Chromium-based or otherwise plays it natively. That removes both the GPL
question and the patent-pool question from the proxy path in one decision.

⚠️ **Confirm the licence of whichever build you package** rather than trusting a
convenience package's defaults — some npm ffmpeg distributions ship GPL builds.
And since WILSON is being sold to studios who will ask about third-party
licensing in their own assessments, this is worth a real check by whoever handles
contracts. It is a five-minute question with a clear answer; it is expensive
only if nobody asks it.

### The real costs, which are not licence fees

- **Installer size:** roughly +50–80 MB per platform. Needs to be an unpacked
  extra resource in `forge.config.cjs` (`packagerConfig`), not inside the asar.
- **Maintenance:** ffmpeg is a large C codebase with a steady CVE stream. TS-4.0
  expects vulnerability management, so it joins the dependency-scanning story.
- **Desktop-only, by nature.** It is a native binary; it cannot run in a browser.
  ffmpeg.wasm exists but is not viable for multi-GB ProRes — and would require
  downloading the whole file into the browser first, which is the egress problem
  from §4a2.

**That constraint is fine, and is arguably the right shape:** the person adding
studio media is on the desktop app, next to the NAS. Generation happens there;
the resulting small JPEG is uploaded and **every web user sees it**. So Audrey's
requirement — *"all thumbnails need to be accessible on web and desktop"* — is
still met in full. Only *generation* is desktop-side.

### Two implementation rules that will otherwise cost a session

1. 🚨 **`-ss` BEFORE `-i`, not after.** Input seeking jumps straight to the
   timestamp; output seeking decodes from frame zero. On a 5 GB ProRes file over
   a NAS share that is the difference between a second and several minutes, and
   it is the single most common way this is written wrong.
2. 🚨 **`execFile`/`spawn` with an argument array — never a command string.**
   Filenames arriving from a NAS are outside WILSON's control and may contain
   shell metacharacters. This is already a standing rule in this repo
   (*never build a shell command by interpolating content*); ffmpeg is exactly
   the case it exists for.

## 5f. The desktop-app notice — DECIDED (Audrey, 2026-08-05)

> *"ok keep ffmpeg then, desktop generation is fine. please make sure their is a
> warning prompt letting the user know large files and prores will require the
> desktop app. thats fine."*

**Settled:** ffmpeg stays, LGPL build, desktop-side generation (§5e-pre route
A+B). Web users see every thumbnail; only *generation* for professional codecs
is desktop-side. This section covers the one thing that makes that limitation
acceptable — **telling people, at the moment it matters.**

### Three different situations, three different messages

Lumping them into one warning would be wrong: only one of them is an actual
failure, and the other two are fine.

| Trigger | What actually happens | Message |
|---|---|---|
| **File exceeds the cloud cap** | ❌ Upload **fails** | *"This file is too large to add from a browser. Add it from the WILSON desktop app."* |
| **Very large file, under the cap** | ⚠️ Uploads, but slowly | *"Large file — this may take a while in a browser. The desktop app is faster."* |
| **ProRes / professional codec** | ✅ Uploads fine, **no thumbnail** | *"Preview images aren't available for this format in a browser. Add it from the desktop app to get one."* |

🚨 **Only the first is a stop. The other two must NOT block the upload** — the
file is perfectly valid and the user may not have a desktop app to hand. A
warning that prevents a working action is worse than the limitation it warns
about.

### How to detect each one honestly

**Size:** trivial and exact — `file.size` is known before upload, compared
against the bucket's `file_size_limit`.

**Codec:** harder, and worth being honest about. A `.mov` may hold ProRes *or*
H.264, so extension alone cannot answer it. Use both:

1. **Before upload — heuristic, for the heads-up.** Flag the extensions that are
   usually professional: `.mov`, `.mxf`, `.r3d`, `.ari`, `.braw`, `.dnx`. Cheap,
   instant, occasionally wrong in the harmless direction (an H.264 `.mov` gets a
   notice it did not need).
2. **After the thumbnail attempt — accurate, by construction.** The thumbnail
   path already loads the file into a `<video>` and seeks (§5d.1b). **If that
   fails, the browser genuinely cannot decode it** — that is not a guess, it is
   the same decoder answering the same question. Show the notice then, and it is
   always right.

The second is the one that matters. The first is a courtesy.

### Do not make it a per-file modal

This design already established the principle in §5a2: *a confirmation that
appears every time is a confirmation nobody reads.* Someone dragging in thirty
clips would face thirty dialogs and learn to dismiss them without reading —
which loses the one case that was a genuine failure.

**Recommended treatment:**

- **An inline notice on the affected rows**, not a modal — the file list already
  shows a per-file icon, so a small badge with a tooltip sits naturally there.
- **One summary line per batch** where the situation applies: *"3 files won't
  have preview images — add them from the desktop app."*
- **A blocking dialog only for the hard failure** (over the cap), because that
  one has no result to show and the user must do something different.
- A **persistent, dismissible note in the storage settings panel** explaining the
  desktop/browser split once, properly, for whoever wants the whole picture.

✅ **AGREED (Audrey, 2026-08-05):** *"I'd use an inline note on the file row plus
one summary line per batch — not a popup. agreed here."*

So the treatment above is settled, not a proposal: **inline note per row +
one summary line per batch for the two non-failure cases; a real dialog only for
the hard failure**, where there is no result to show and the user must do
something different.

### Where else it belongs

The same split should be stated **once, plainly, where storage is configured** —
`StorageConnections` for the workspace, and in the setup guidance beside the NAS
instructions (§4c). A person choosing where their media lives should learn then
that professional formats want the desktop app, not discover it on their
thirtieth upload.

## 6. The admin toggle

**Where.** `AdminTerminalPage.jsx` is the company-admin portal (Users, Company,
Models, Requests, Logs, Diagnostics). `src/admin/` is the *platform-operator*
console — a different audience; the toggle does not go there. The natural home
is **CompanySection**, beside the other workspace-level settings, or a new
**Storage** section if the surface grows past two controls.

**What it is backed by.** An `external_access_enabled BOOLEAN NOT NULL DEFAULT
false` column on `workspace_storage`, with the same admin-only UPDATE policy.

**Visibility rule (Audrey, 2026-08-05):** *"the toggle should only exist for
local network storage solution. so if that one is selected then the toggle is
visible."* So the toggle renders **only when `mode = 'byos'`**. On a cloud-mode
workspace it is absent, not disabled — there is no network storage for it to
expose, and a greyed switch would invite the question of how to un-grey it.

🚨 **It still must not ship in Phase 1.** Audrey's own standing rule, from S25:
*add a reveal-flag WITH the thing it reveals, never before.* Until the gateway
exists there is nothing for the switch to turn on — under Options B and C remote
access is either the LAN or the customer's VPN, neither of which WILSON controls.
`external_access_enabled` ships in the **same phase as the gateway that reads
it**, or it does not ship.

**What the switch must say when it does ship** (§4b): turning it on is the
moment the workspace leaves Gold Shield eligibility. That sentence belongs
beside the control, in those words. It is the most valuable thing the toggle
does — it turns a compliance boundary that would otherwise live in a PDF into
something the person making the decision actually reads.

**Phase 1's portal surface is therefore the storage-mode selector plus a
read-only status line** — which root this workspace uses, whether this machine
can currently reach it, when that was last checked. Useful on day one, and it
does not claim anything untrue.

**Gate rules that apply** (from `wilson_permission_gate_rules`): the gate must
handle `ready` — the field every gate implementation forgets, where a role that
has not resolved yet reads as "not admin" and the control renders disabled for a
real admin. And a gated control is not a gated capability: the RLS policy is the
enforcement, the greyed switch is only the courtesy.

---

## 7. TPN

Audrey's instruction was explicit: audit the **design**, before implementation.
Studio work involves pre-release content. `TPN_AUDIT/` currently reports **3
CRITICAL / 43 HIGH**, Shield tier **None**, and Network at 🟡 with both baseline
HIGHs untouched.

The load-bearing conclusion is already visible from §3.5 and §4: **Options B and
C add no external attack surface at all**, which is why they are recommended.
Options D and E do, and Option E adds a content-bearing sub-processor to the
audit's weakest domain.

Two existing open findings become **blocking prerequisites** the moment anything
in this area is exposed, rather than the background HIGHs they are today:

- **TPN-NET-001** — bare `cors()` over unauthenticated content routes.
- **TPN-NET-002** — `/api/fetch-url` / `/api/fetch-raw` as an unrestricted SSRF
  proxy.

**The audit has been run.** Result:
`TPN_AUDIT/DESIGN_REVIEW_network_storage.md` — five passes (Network, Content,
Authentication, Cloud, Third-Party) against this document. Six new findings, one
credit, five escalations of existing findings. Zero CRITICALs, because nothing
is built. It did not overwrite the existing 92-finding baseline.

Three results changed this design, and they are folded in below:

1. 🚨 **TS-2 settles the architecture outright.** The framework's remote-access
   text is *"Bastion host model only. VPN with AES-256. No split tunneling."*
   Option D is therefore not "the expensive option" — it is **the arrangement
   the control forbids**, while Option C **is the named control**. This is a
   much stronger reason to prefer C than effort, and it is the sentence to
   quote if a customer ever pushes for a bespoke gateway. (`TPN-NET-012`)

2. 🚨 **Phase 1 must add a `downloaded` event, in the same phase.** Verified:
   `file_events` is `CHECK (event IN ('uploaded','moved','relinked','trashed',
   'restored','purged'))` (`0027_file_lifecycle.sql:85-86`) — there is **no read
   event on either backend** — and the local download route
   (`main.cjs:2028-2039`) logs nothing at all. AS-2.9 requires logging every
   view and download. This is survivable today only because the content sits in
   one person's home directory, so "who read it" has one answer. **A shared root
   removes that answer.** This is the one place the safest option still moves a
   finding the wrong way, so it is called out rather than absorbed into the
   credit for adding no external surface. A `CHECK` change plus one call site
   per backend — small now, never retrofitted later.
   (escalates `TPN-CONT-008` / `TPN-LOG-002`)

3. **State an SMB3 + signing + encryption requirement.** "Point WILSON at
   `\\server\share`" says nothing about how the bytes cross the wire; a
   default-configured share moves pre-release content unsigned and unencrypted.
   WILSON cannot enforce the server's config, but the requirement belongs in the
   setup guidance, and SMB1 must be refused. (`TPN-CONT-016`)

Also recorded: **Option E is rejected on TPN grounds** (`TPN-3P-010` — it makes
Petal Studios a content-bearing sub-processor in the audit's weakest domain), and
`storage_mode` should be dropped or guarded rather than left admin-writable with
no reader (`TPN-CLOUD-007`). Phase 0's guard edit is flagged as a security-
sensitive change requiring adversarial tests, not just a happy-path test
(`TPN-NET-013`).

---

## 8. Recommendation, and what needs Audrey's decision

**Recommended sequence: Phase 0 → Phase 1 (Option B) → Option C documented.**
That meets the TPN team's needs completely, meets the non-TPN company's needs
via their existing IT, adds zero internet-facing surface, and is roughly one
session of work rather than five. The TPN pass (§7) endorses it: Option C **is**
the control the framework names for remote access, so the cheapest path is also
the compliant one — which is not usually how this goes.

Phase 1's scope gained one item from that pass: the `downloaded` file event
(§7.2). Treat it as part of Phase 1, not a follow-up.

**✅ All four questions are ANSWERED (§1b).** The sequence they produce:

🚨 **The phase numbers above were written as a dependency map, NOT as session
sizing, and Phase 1 in particular is roughly three sessions wearing one number.**
Audrey asked directly whether this is one session or several. It is several.
Re-cut below into units that are actually shippable, with the numbering kept so
cross-references still work.

| # | Session-sized unit | Size | Depends on |
|---|---|---|---|
| **0** | **Containment guard fix** + adversarial tests (§3.2) | **½** | nothing |
| **1a** | **The storage root** — migration, `workspace_storage` + RLS + pgTAP, mode selector, admin gate in **Admin Terminal**, UNC classifier, reachability probe, two-step confirm (§5a2), guard the legacy columns (§5b) | **1** | 0 |
| **1b** | **The manager half** — gate in the **Project Control Panel**, `folder_root` containment against the root (`TPN-NET-015`) | **½–1** | 1a |
| **1c** | **The `downloaded` event** — CHECK change + call sites on both backends (`TPN-CONT-008`) | **½** | ships **with 1a** |
| **2** | **VPN / NAS documented** in `SYSTEMS_HANDBOOK.md` (§4c) | **¼** | 1a |
| **T** | **Thumbnails** — `rabbit-thumbnails` bucket + 4 ported policies, client generation, `thumbnail_url` writer, purge-with-source (§5d.1) | **1** | **nothing** |
| **2b** | **Cloud multi-GB** — raise the cap + resumable/TUS uploads (§3.6 Path 2) | **1** | **nothing** |
| **2c** | **Bring-your-own-cloud** — design pass first (§4a2) | **design ½, build ?** | **nothing** |
| **2d** | **Video** — Range-capable route, preview surface, auto still-frame, ffmpeg packaging, the notice (§5d.1b, §5d.2, §5e, §5f) | **1–2** | T |
| **3** | **The gateway** — ⚠️ probably unnecessary (§4c) | **3–5** | a customer who refused everything else |

### What actually has to be sequential

Very little. **0 → 1a → 1b → 2** is the only real chain, and **1c ships inside
1a** because a shared root without a read event is the one place the safe option
still moves a TPN finding backwards (§7.2).

**T, 2b and 2c are independent of that chain and of each other.** They were
bundled into "Phase 1" only because they came up in the same conversation, not
because they share code. Thumbnails have nothing to do with network storage.

### Why splitting is the right call here specifically

Not a general preference — three things in this repo's own history:

- **S30 shipped green and still ran five defects past its own close-out**, every
  one found by Audrey using the beta rather than by the suite.
- **Six features have now shipped with no caller**, S31's settings half included
  — caught by grepping, not by tests. Bigger sessions make that more likely, not
  less.
- Audrey has split work herself before and been right: *"parse them out into one
  session for timeline, one for otter, then settings."*

A session carrying a migration, two RLS policies, two permission gates on two
different screens, a security fix, a storage bucket and a thumbnail pipeline is
a session where something ships unwired and nobody notices for twenty sessions.

### Recommended order

1. **0 + 1c** — both small, both fix or prevent real defects, neither needs UI.
2. **1a** — the actual feature. The one that makes a NAS work.
3. **1b** — the manager half, once 1a's shape is proven.
4. **2** — documentation, cheap, closes the loop for customers.
5. Then **T**, **2b**, **2c** in whatever order the customers demand.
6. **2d** when video matters. **3** probably never.

Steps 1–4 are the coherent "network storage" story: **about 2½ sessions**, not
one, and not seven.

Phases 0–2 remain roughly one session. **Phase 2b is its own piece of work and
does not depend on the network phases at all** — it could run first if cloud
customers are the nearer need. Phase 3 is 3–5 sessions and should not be
designed in detail until there is a customer actually asking **and 2c has been
evaluated** — bring-your-own-cloud may serve the same customer for a fraction of
the work and none of the compliance cost.

⚠️ **2b is not optional and was nearly missed.** The first draft treated cloud
as the small-file mode, which would have shipped a storage option that could not
hold the customer's main deliverable. Audrey caught it by asking the obvious
question the design had not asked itself.

**What changed from the first draft, and why it matters:**

- **Every storage mode has to answer the multi-GB question separately** (§3.6).
  Network storage already can. Cloud needs Phase 2b — a raised cap and resumable
  uploads — and that is bounded work, not a rewrite. **Local Server's `files`
  path genuinely cannot** (base64-over-JSON, whole file buffered both ends) and
  stays small-file-only.
  ⚠️ **Correction on the record:** an earlier version of this document
  generalised the Local-Server measurement to cloud and concluded "cloud is for
  the small stuff". That was wrong — the two adapters are different code, and
  cloud hands the `File` straight to Storage.
- **The gateway is in scope, and TPN does not forbid it** (§4b). It was
  correctly scoped in Audrey's opening sentence — *"a company that does NOT need
  TPN compliance"*. The audit finding survives as the **label on the switch**
  rather than as a prohibition.
- **The toggle has a visibility rule and a job**: visible only in `byos` mode,
  and it is the point where a workspace knowingly leaves Gold eligibility.

**Still open, and genuinely small:** nothing blocking. Phase 0 can start on
approval.
