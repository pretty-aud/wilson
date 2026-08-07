# SESSION 36 launch prompt — THUMBNAILS EVERYWHERE

> **Unit T** of `docs/NETWORK_STORAGE_DESIGN.md` (§5d.1, §4a2).
> 🚨 **DEPENDS ON NOTHING.** It was grouped with the network work only because it
> came up in the same conversation — it shares no code with the storage root and
> can run whenever it suits.

> **STATE — re-measure, do not trust this block.** After S35 (2026-08-07):
> migrations **0000–0049** on all three envs (verified by query), next free
> **0050**. pgTAP **59 suites / 982 assertions**, next free suite **60**.
> Vitest **1022 / 47 files**. CLI re-linked to wilson-dev.
> 🚨 **Read the working tree, never memory or a doc** — a design written
> mid-S31 cited "0046, next free" and was wrong within the hour.
>
> **What S34/S35 left that touches thumbnails:** the workspace drive
> (`workspace_storage`, 0048) and the bounded project folder
> (`fn_project_folder_root_guard`, 0049) mean a desktop in byos mode
> resolves media under a NAS root — a thumbnail read of a large original
> across a WAN link is one full-file read (design §4a2), which is exactly
> why the thumbnail BUCKET exists. `resolveConfiguredRootDir()` (main.cjs)
> is still the ONE definition of the machine's effective root; do not
> re-derive it in any thumbnail path.


## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** (what is broken) and
   **`docs/SYSTEMS_HANDBOOK.md` §17** (limits by design — a gate, not an
   oracle).
4. **Read the design sections this brief names in its header.**
5. **Re-verify every `file:line` citation in this brief by SYMBOL before using
   it** — sessions between its writing and now have moved them. The session
   that edits a file is the one that breaks its own citations.

---

## Why this exists

**Audrey, 2026-08-05:** *"all thumbnails need to be accessible on web and
desktop"* and *"lets store thumbnails within the supabase storage... and lets set
a file size limit for thumbnails. thats a very common thing."*

**MEASURED — today thumbnails are desktop-only and images-only:**

- Generation is `sharp` in the **Electron main process** — one HTTP route
  (`main.cjs:2412`) and two IPC handlers (`:3093`, `:3111`). Local, cached to
  `rabbit-data/thumbnails/`, free.
- `FileThumbnail.jsx:49` points an `<img>` at
  `/api/rabbit/projects/:id/managed-files/:id/thumbnail`, which **exists only on
  the Express server inside the desktop app**. In a browser it 404s and falls
  back to a file-type icon. **Web has no thumbnails at all.**
- `THUMB_EXTENSIONS` (`main.cjs:117`) and `IMAGE_EXTS`
  (`FileThumbnail.jsx:15`) are the same nine image extensions.
- 🚨 **`files.thumbnail_url` has never been written.** Declared on three tables
  in `0000_rabbit_base_schema.sql:164,232,246`, present in the Supabase read
  allowlist (`supabaseAdapter.js:369`), **no writer anywhere**. This session
  finally gives it one.

---

## What this needs

### 1. Generate at upload time, on the uploading machine

The file is already in memory there, so this costs nothing — and it avoids the
one expensive design: generating on demand means **downloading the source**,
gigabytes of egress for a postage-stamp JPEG (§4a2).

```
createImageBitmap(file) → draw to a 256px canvas → canvas.toBlob('image/jpeg', 0.8)
```

No library. Runs identically in the browser and the Electron renderer — which is
what makes one implementation serve both. Write the result's path into
`files.thumbnail_url`.

### 2. A new bucket — because the size cap forces it

🚨 **A bucket has exactly one `file_size_limit`.** `rabbit-files` must accept
multi-GB media once S37 raises its cap. A thumbnail cap and a media cap cannot
coexist in one bucket.

| Bucket | `public` | `file_size_limit` | Holds |
|---|---|---|---|
| `rabbit-files` | false | raised by S37 | source media |
| **`rabbit-thumbnails`** (new) | **false** | **256 KB** | derived previews |

256 KB is generous — a 256px JPEG at q80 is 10–30 KB — while still refusing
anything obviously not a thumbnail. Enforced by Storage, not by client code.

### 🚨🚨 Two ways to get this catastrophically wrong (`TPN-CLOUD-008`)

**1. A public bucket.** The instinct is *"thumbnails are small and harmless, make
it public so they load fast."* **That is `TPN-CLOUD-004` verbatim** — the
still-open CRITICAL where `user-avatars` is public with an unconditional SELECT
policy, enumerable with the public anon key. Repeating it for **frames of
pre-release content** would be materially worse. `public = false`, no exceptions.

**2. A partial policy port.** `rabbit-files` has **FOUR** policies
(`0027_file_lifecycle.sql:283-340`): three base + `rabbit_files_invoices_select`.
The adapter documents them as a pair where *"changing either without the other
opens a hole"* (`supabaseAdapter.js:909-940`). Copy three and forget the fourth
and **invoice thumbnails become visible to every project member** — the money
gate defeated by its own derived image, in the place nobody audits.

**Keep the path layout identical** so all four policies port by changing
`bucket_id` alone:

```
rabbit-files/      projects/{id}/{entity}/{entityId}/{ts}-{name}.ext
rabbit-thumbnails/ projects/{id}/{entity}/{entityId}/{ts}-{name}.ext.jpg
```

Storage RLS keys on path segments and the **third** segment is the money gate
(`public.rabbit_money_segment`, migration 0042). Do **not** introduce a `thumbs/`
folder level — it shifts every segment.

**pgTAP must include a probe that a non-manager cannot read an invoice
THUMBNAIL**, mirroring `05_files`.

### 3. Lifecycle

⚠️ **A thumbnail is a derived object and must be purged with its source.**
Otherwise this repeats `TPN-CONT-011` verbatim — derived content surviving the
purge of the file it came from, orphaned and uncertificated. Same deletion path,
same certificate, **not** a later sweep.

⚠️ Thumbnails may carry `cacheControl`; **source content may not** —
`TPN-CONT-003` requires `no-store` on content responses. Separate buckets make
that easy to get right, which is a second reason for the split.

### 4. Out of scope

**Video thumbnails are S38**, together with video preview — they share the
decoder and the codec limit, and managed-file video frames need S38's serve
route to exist. Do not start them here.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a PUBLIC
repo. Never interpolate content into a shell command. Query the database rather
than trusting migration text; read `supabase/.temp/linked-project.json` first.
One query per `--file`. Register any new pgTAP suite in
`.github/workflows/rls.yml` **by hand** — the list is not derived. Count
`<!--` / `-->` after editing long markdown.

🚨 **Guard the CALL SITE.** Six features in this repo have shipped complete with
no caller. A green unit test over the generation function proves nothing about
whether upload reaches it — prove a real upload writes a real `thumbnail_url`.

⚠️ **Deploy order: dev → staging → prod BEFORE the git push** — `feat/multi-user-v1` auto-deploys the STAGING-backed beta, so a push before the staging migration means the beta runs new code against an old schema. **Re-link the CLI to `wilson-dev`** when the last env is verified.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. Migration + bucket verified **by query on dev, staging AND prod** — including
   `public = false` and the size limit.
4. `tap-all` clean + full vitest.
5. **Refresh the STATE block of the next session's brief** (`SESSION_37_prompt.md`) with the numbers you leave behind — that block decays the moment you commit. Update the Claude auto-memory in the same pass.
6. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
