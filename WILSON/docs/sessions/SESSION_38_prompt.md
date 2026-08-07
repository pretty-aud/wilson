# SESSION 38 launch prompt — MULTI-GB FILES IN CLOUD MODE

> **Unit 2b** of `docs/NETWORK_STORAGE_DESIGN.md` (§3.6 Path 2, §4a2, §4a3).
> 🚨 **BLOCKED BY S37** (the quota plane; this brief was S37 and that
> blocker was S39 until Audrey renumbered both on 2026-08-07 so the numbers
> match execution order). S37 builds the operator-managed storage plans and
> quota enforcement — raising the 50 MB cap before the quota plane exists
> would turn an unmetered free tier into an unmetered MULTI-GIGABYTE free
> tier. Independent of the network-storage chain and of thumbnails
> otherwise; run S37 then this whenever cloud customers are the nearer need.

> **STATE — re-measure.** Confirm the next free migration number, suite count,
> vitest counts and HEAD from the working tree.


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

**Audrey, 2026-08-05:** *"i need to be able to store media so 50MB is not
acceptable. im going to have multiple GB files at times."* Then, decisively:
*"what if the company selected a cloud storage solution? they cant save large
files thats not acceptable."*

**She is right, and the first draft of the design was wrong about this.** It
measured the **Local Server** adapter and generalised the result to cloud. The
two adapters are different code.

### The three upload paths, measured

| Path | Mechanism | Ceiling | Fixable? |
|---|---|---|---|
| Local-Server `files` | base64 → JSON body | **~37 MB** | ❌ rewrite |
| **Cloud `files`** | `File` → Supabase Storage | **50 MB** (bucket setting) | ✅ **this session** |
| `managedFiles` | native stream-to-stream | none | already fine |

**Local Server** (`localServerAdapter.js:176-190`) does
`await file.arrayBuffer()` → base64 → `JSON.stringify` against
`express.json({ limit: '50mb' })` (`main.cjs:144`). Base64 inflates 33%, and a
multi-GB file exhausts renderer memory before the request is made.
**Out of scope — it stays small-file-only.**

**Cloud** (`supabaseAdapter.js:970-975`) passes the `File` object **straight to
`client.storage.upload()`** — no base64, no JSON body, none of the above:

```js
const { error: upErr } = await client
  .storage.from('rabbit-files')
  .upload(storagePath, file, { cacheControl: '3600', upsert: false, ... });
```

Its only ceiling is `file_size_limit = 52428800` (`0027_file_lifecycle.sql:287`)
— **one number in one migration.**

🚨 **A cloud customer has no office server to fall back on. This is not
optional.** *"A storage mode that cannot hold the customer's files is not a
storage mode."*

---

## What this needs

### 1. Raise the bucket cap

A migration re-asserting `file_size_limit`. The existing
`ON CONFLICT (id) DO UPDATE` already re-applies bucket settings on re-run — the
shape is there (`0027:287-291`).

⚠️ **Confirm the plan's actual maximum object size and the per-GB storage and
egress rates BEFORE picking a number.** Both are plan-dependent. The design
deliberately asserts no figure. The engineering ceiling and the ceiling Petal
Studios is willing to pay for are different numbers, **and for multi-GB video the
second one binds first.**

### 2. Resumable (TUS) uploads

Above the standard-upload threshold Supabase requires the resumable protocol.
`@supabase/supabase-js` is on `^2.101.1`, which supports it, and **the repo uses
it nowhere** — grep for `uploadToSignedUrl` / `createSignedUploadUrl` / `tus`
returns zero hits.

This is **new code, not a config flip**: chunking, resume after a dropped
connection, and progress reporting the cloud path does not currently have.

### 3. 🚨 Partial objects need a lifecycle term (`TPN-CONT-017`)

A resumable upload that is abandoned, interrupted or superseded leaves **partial
objects** in the bucket. The current vocabulary
(`0027_file_lifecycle.sql:85-86`) cannot describe them:

```sql
event TEXT NOT NULL CHECK (event IN
  ('uploaded','moved','relinked','trashed','restored','purged')),
```

They were never `uploaded`, so nothing certifies their disposal, and
`storage_gc_queue` is fed from `files`-row deletions a fragment never had.
**A multi-GB abandoned upload is both a content fragment and a recurring bill.**

**Design it WITH this session, not after:** a TTL sweep for incomplete uploads
plus an event term for the abandoned case. Lifecycle terms are never retrofitted
once a feature ships working.

### 4. The desktop-app notice (design §5f)

If a file exceeds the (new) cap, the upload **fails** and that is the one case
that gets a real dialog:

> *"This file is too large to add from a browser. Add it from the WILSON desktop
> app."*

A very large file **under** the cap uploads but slowly — an inline note, not a
blocker. **Agreed treatment (Audrey): inline note on the file row plus one
summary line per batch; a dialog only for the hard failure.**

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a PUBLIC
repo. Never interpolate content into a shell command. Query the database rather
than trusting migration text; read `supabase/.temp/linked-project.json` first.
One query per `--file`. Count `<!--` / `-->` after editing long markdown.

🚨 **`fetch` and `otterFetch` resolve for EVERY status.** An unchecked `await`
turns a 404 or an RLS 403 into a success — this cost the O.T.T.E.R. Validator
every fix Audrey ever accepted. A chunked upload has many more places to swallow
a failure than a single request does. **Check every response.**

⚠️ **Deploy order: dev → staging → prod BEFORE the git push** — `feat/multi-user-v1` auto-deploys the STAGING-backed beta, so a push before the staging migration means the beta runs new code against an old schema. **Re-link the CLI to `wilson-dev`** when the last env is verified.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. Migration + bucket settings verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest.
5. **Prove it with a real large file**, not a unit test — upload one, interrupt
   it, resume it, download it, delete it, and check the events.
6. **Refresh the STATE block of the next session's brief** (`SESSION_39_prompt.md`) with the numbers you leave behind — that block decays the moment you commit. Update the Claude auto-memory in the same pass.
7. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
