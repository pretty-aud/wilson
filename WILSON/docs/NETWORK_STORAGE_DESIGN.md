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
   times."* → **Option A is dead as the general answer.** See §3.6 — it is dead
   for a harder reason than the bucket cap.
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

### 3.6 🚨 The general file plane caps at ~37 MB, and it is not a tuning problem

Measured after Audrey's multi-GB answer. WILSON has **two** file planes, and
only one of them can ever carry her media.

**Plane 1 — `files` (the `files` table, the general Files UI). Ceiling ≈ 37 MB.**

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

**Plane 2 — `managedFiles`. No ceiling.** `rabbit:copy-file`
(`electron/main.cjs:3009-3030`) is a native `createReadStream` →
`createWriteStream` pipe with progress events. It never touches HTTP, never
buffers the file, and is **`local_server`-only** by construction
(`supportsManagedFiles`, `RabbitProvider.jsx:2715`).

**This is the finding that decides the architecture.** The plane that already
streams gigabytes is the same plane that reads from a configurable root on disk
— the one this whole design is about. So multi-GB media routes through managed
files and the network root, and the `files` plane is not a candidate at any
size. It also explains the shape of the product: cloud mode is for the metadata,
documents and small assets it already handles well; the network root is for the
media.

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
- ❌ **RULED OUT as the general answer (Audrey, 2026-08-05):** *"i need to be
  able to store media so 50MB is not acceptable. im going to have multiple GB
  files at times."* The bucket cap (`file_size_limit = 52428800`) was the
  obvious blocker; §3.6 found the harder one — **the upload path itself cannot
  carry gigabytes at any cap**, because it base64s the whole file through a JSON
  body after buffering it in renderer memory.
- ✅ **Still the right home for everything that is not media.** Cloud mode keeps
  metadata, documents, budgets, briefs and small assets, and keeps working
  exactly as it does now. This is not "A or B" — the product ends up with both,
  and §3.6 explains why that split is structural rather than a compromise.

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

| Phase | What | Gates |
|---|---|---|
| **0** | Fix the containment guard + adversarial tests | none — do this regardless |
| **1** | Storage-mode selector, UNC root in `workspace_storage`, reachability probe, `downloaded` event, guard the legacy columns | Phase 0 |
| **2** | VPN documented in `SYSTEMS_HANDBOOK.md` | Phase 1 |
| **3** | **The gateway** — for customers who refuse a VPN, off by default, carrying the §4b boundary | its own design review first |

Phases 0–2 remain roughly one session. Phase 3 is 3–5 and should not be designed
in detail until 0–2 are shipped and Audrey has a customer actually asking.

**What changed from the first draft, and why it matters:**

- **Option A is out as the general answer, for a harder reason than the cap.**
  §3.6 measured it: the `files` plane base64s whole files through a JSON body
  after buffering them in renderer memory. Multi-GB is impossible there at any
  limit. Media must ride the managed-files plane, which is the same plane this
  design gives a network root — so the architecture and the requirement point
  the same way.
- **The gateway is in scope, and TPN does not forbid it** (§4b). It was
  correctly scoped in Audrey's opening sentence — *"a company that does NOT need
  TPN compliance"*. The audit finding survives as the **label on the switch**
  rather than as a prohibition.
- **The toggle has a visibility rule and a job**: visible only in `byos` mode,
  and it is the point where a workspace knowingly leaves Gold eligibility.

**Still open, and genuinely small:** nothing blocking. Phase 0 can start on
approval.
