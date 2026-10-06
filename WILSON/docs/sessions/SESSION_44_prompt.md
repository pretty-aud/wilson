# SESSION 44 launch prompt — A THUMBNAIL LIVES WHERE ITS SOURCE LIVES

> **Runs BEFORE S40**, despite the number. Position is a table row; the number
> is identity (see `MASTER_PLAN_S19_ONWARD.md`'s 📒 ledger and
> [[wilson_hard_won_rules]], "move rows, not numbers"). **S40 builds video
> stills on top of whatever this session leaves**, so doing S40 first means
> rebuilding its thumbnail path afterwards.

> 🚨 **THE DECISION THIS IMPLEMENTS — Audrey, 2026-08-08:**
> *"the image should be kept in the company storage. if the thumbnail lived in
> the petal cloud it would break tpn inherently."*
>
> > **A thumbnail lives where its source lives, and dies with it.**
>
> The second half already holds (`trg_files_gc_enqueue`, teardown sweep,
> `WIL-7005`). **The first half does not exist.** Authority: handbook §12.7b
> (the decision and its reasoning), `OUTSTANDING.md` (the tracked defect).
>
> **Why it is a compliance boundary and not a preference:** a still frame **is**
> the content. A legible 256px frame of pre-release footage on Petal's
> infrastructure makes Petal a content-bearing party holding that studio's
> material — precisely what a customer choosing BYO storage is paying to avoid.
> S39's counter-arguments (10–30 KB, one code path, no presign per tile) are
> operational conveniences. **They lose to a compliance boundary, and one of
> them is this session's hardest problem — see Part 2.**

> **STATE — re-measure, do not trust this block.** After **S39**
> (2026-08-08): migrations **0000–0053** on all three envs, next free
> **0054**. pgTAP **63 suites / 1097 assertions**, next suite **64**. Vitest
> **1210 / 54 files**. CLI re-linked to wilson-dev.
> 🚨 **Read the working tree** — this block has been stale within the hour
> before now, and inside a single session more than once.

> **EXPOSURE IS ZERO TODAY, and that is the whole reason this is affordable.**
> Measured 2026-08-08 on dev: zero `byos` workspaces, zero non-Supabase `files`
> rows, zero rows carrying `thumbnail_url`; `public.files` was measured empty on
> all three environments at S36. **No customer content sits on the wrong side of
> this boundary, and no migration of existing objects is required.** Re-measure
> before assuming it is still true — the moment one workspace configures BYO
> storage and uploads an image, this session grows a data-migration half it does
> not currently have.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Re-measure the EXPOSURE block by query** on dev, staging AND prod — the
   count of `byos` workspaces, non-`supabase` `files` rows, and rows with
   `thumbnail_url` set. If any is non-zero, **stop and re-scope**: existing
   objects then need moving, which this brief does not cover.
4. **Read `docs/SYSTEMS_HANDBOOK.md` §12.1a, §12.7a, §12.7b and §17**, and the
   `OUTSTANDING.md` entry.
5. **Re-verify every `file:line` citation in this brief by SYMBOL.** The
   session that edits a file is the one that breaks its own citations.

---

## What is actually wrong

Three layers each hardcode Petal, independently. **All three must change, and
missing one leaves a half-routed thumbnail that is worse than the current
consistent-but-wrong behaviour.**

| Layer | Symbol | What it hardcodes |
|---|---|---|
| **Write** | `supabaseAdapter.uploadFile` → `putThumbnail(client, key, thumb)` | Takes the **Supabase client**; `putThumbnail` writes to `THUMBNAIL_BUCKET`, a module constant in `storage/thumbnails.js`, **not a parameter** |
| **Display** | `signedThumbnailUrls(client, keys, expiresIn = 3600)` | Batch-signs **Supabase** URLs, one call for a whole list |
| **Disposal** | `fn_files_gc_enqueue` (0053) | Enqueues the thumbnail row as bucket `'rabbit-thumbnails'`, provider `'supabase'` — its own COMMENT says *"always provider supabase"* |

There is **no provider decision anywhere in the thumbnail path**, while the
body's path has had one since S37 (`activeWorkspaceProvider` → the registry).

---

## Part 1 — the write path

Route the thumbnail write through **the same decision the body already uses**,
so the derived object inherits its source's destination rather than being
pinned to Petal.

- The body picks its store via `activeWorkspaceProvider(storageChoice)` →
  `fileProviderFor(...)` → the registry. **The thumbnail should follow the
  same result**, not re-derive it — one decision, used twice, so they cannot
  disagree.
- `putThumbnail(client, key, blob)`'s signature assumes Supabase. It needs to
  become provider-aware (or gain a sibling). 🚨 **Do NOT fork it per
  provider** — that is the `googleDriveAdapter` shape §4a2b exists to prevent.
- For `s3`: a **presigned PUT at `thumbnailKeyFor(storage_path)`**.
  `checkRowShapedPath` already accepts that key — appending `.jpg` to the last
  segment shifts no path segment — but **verify that by test, not by reading
  this sentence.**

🚨 **THE KEY LAYOUT IS LOAD-BEARING AND MUST NOT CHANGE.** The thumbnail key
is its source's key plus `.jpg` precisely so the **third path segment** — the
money gate (`public.rabbit_money_segment`, 0042) — is identical for both. A
`thumbs/` level, or any rename, silently moves the derived image out of the
gate it inherits. **Suite 63 probe 13 is the tripwire; keep it green.**

⚠️ **Money-gated files are the rule APPLIED, not an exception.** Invoices and
rate documents never leave Supabase (§12.1a), so **their thumbnails stay in
`rabbit-thumbnails`.** The routing decision already produces this for free —
`fileProviderFor` pins `financial` to Supabase before consulting the workspace
choice — **but add a probe that proves it**, because "thumbnails follow the
media" is one careless refactor away from moving invoice previews into a
customer bucket.

⚠️ **`rabbit-thumbnails` does not go away.** It stays correct for every
`petal` workspace, which is the default and today the only configured state.

---

## 🚨 Part 2 — the display path. THIS IS THE HARD PART, AND IT IS UNSOLVED

S39 signs a whole file list's thumbnails in **one** call
(`signedThumbnailUrls`), valid for **an hour**. Neither property survives the
move to a customer bucket, and the brief that sends you here does not pretend
to know the answer:

1. **There is no batch presign.** `storage-presign` authorises **one key per
   call**. A 50-file grid becomes 50 round trips.
2. **It is rate-limited** at `envInt('STORAGE_PRESIGN_RPM', 120)` per caller
   per minute. Two grid loads can approach it.
3. 🚨 **The expiries do not match.** A signed Supabase URL lasts **3600s**; a
   presigned S3 GET lasts **300s** (`EXPIRES` in `storage-presign`). **A file
   list left open for six minutes goes dead** — and S39's own review already
   caught the sibling of this bug (a sticky error boolean over an expiring
   URL).

**The recommended shape — argue with it, do not just implement it:**

- **Add a BATCH action to `storage-presign`** (N keys → N URLs, one call).
  🚨 **It must authorise EVERY key, not the first.** A batch endpoint that
  checks one key and signs the rest is a signing oracle — this is exactly the
  class of defect the last four adversarial reviews found. Bound the batch
  size explicitly and say what happens to a partial failure.
- **Give thumbnail keys a longer GET expiry** — matching Supabase's hour is
  parity, not a new risk: a 256px preview is a far lower-value bearer object
  than a master, and an hour-long signed thumbnail URL is exactly what ships
  today. Decide it deliberately and write down the reasoning.
- **Reuse the recovery behaviour S39 already built**: remember *which* URL
  failed, not merely that one did, so a tile recovers when a fresh URL
  arrives.

⭐ **THE ALTERNATIVE YOU MUST EVALUATE BEFORE BUILDING THE ABOVE:** give BYO
workspaces **no cloud thumbnail at all** — fall back to the file-type icon in
the browser, and keep desktop's local `sharp` cache for people next to the
media. It is nearly free, it satisfies the compliance decision completely, and
it costs those customers a nicety. **Audrey's wording — *"the image should be
kept in the company storage"* — reads as wanting the thumbnail to exist and be
stored correctly, so the customer-bucket route is the intent.** But if Part 2
proves expensive, **the fallback is a legitimate answer and should be brought
back to her as a choice rather than absorbed as a cost.**

---

## Part 3 — disposal, and the migration

`fn_files_gc_enqueue` (0053) hardcodes the thumbnail's queue row as bucket
`'rabbit-thumbnails'`, provider `'supabase'`. For a thumbnail in a customer
bucket that is **wrong in the destructive direction**: the drain would look for
it in a Supabase bucket, not find it, and mark it disposed.

- **Needs migration 0054** (re-measure the number): the thumbnail enqueue must
  carry the provider its object actually lives at, the same way 0051 taught the
  body enqueue to. The body arm already does exactly this — copy its shape.
- **Widen it by explicit `DROP` + `CREATE OR REPLACE` and read the definition
  back in a post-condition.** A wrapped `ADD` is a silent no-op (S36, measured).
- 🚨 **Whoever writes a thumbnail into a customer bucket owns its cleanup.**
  There is **no orphan sweep over any thumbnail location** (§12.7b), and
  `storage-gc`'s orphan scan is `rabbit-files`-only by design — WILSON never
  enumerates a customer bucket. So a thumbnail whose `files` row insert was
  refused has **only** the compensating delete to save it. Make that path
  report its failures rather than swallow them; S39 already learned this.
- **Teardown**: `operator-workspaces` sweeps `rabbit-thumbnails`. A
  customer-bucket thumbnail is deliberately NOT swept — the same rule as the
  body (their storage, their property) — so **`byo_bodies_left`'s sibling count
  must include thumbnails, or the WIL-7005 certificate under-reports.** A
  certificate that under-reports is the failure S39's review caught.

---

## Part 4 — the tests that will fight you

⚠️ **`storage/thumbnails.test.js` is a source-text guard suite**, not a
behavioural one. It regex-matches the executable text of `supabaseAdapter.js`,
`RabbitProvider.jsx`, `FileManager.jsx`, `FileThumbnail.jsx`, `main.cjs`,
`storage-gc`, `operator-workspaces` and 0053 — including **exact-occurrence
counts** (`thumbnailUrl={thumbUrls.get(f.thumbnail_url)` exactly twice;
`downloadFile, thumbnailUrls,` exactly twice) and `signedThumbnailUrls(client`.

**These break on refactor, not on defect.** Budget for it, and when you change
one, **change it to assert the new EXECUTABLE form** — do not delete the
assertion, and do not write one a comment can satisfy (the 0038 trap, which
S37's own review fixes reproduced twice).

**New coverage this session owes:**
- pgTAP: the widened enqueue, per provider, **end-to-end** (insert → delete →
  read the queue), the way suite 61 proves the body arm.
- vitest: the routing decision (thumbnail destination === body destination for
  every provider), **the money pin** (financial → Supabase even on an s3
  workspace), and a wiring test that the batch presign has a real caller.
- 🚨 **Arm-level breakers, run BEFORE deploying or with an explicit `DROP`** —
  a wrapped `ADD CONSTRAINT` makes a post-deploy breaker a silent no-op, and a
  breaker that neuters a whole constraint is arm-blind.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command. Query the database
rather than trusting migration text; read `supabase/.temp/linked-project.json`
first, never recall it. One query per `--file`. Count `<!--` / `-->` after
editing long markdown.

⚠️ **Deploy order: dev → staging → prod BEFORE the git push** —
`feat/multi-user-v1` auto-deploys the STAGING-backed beta, so a push before the
staging migration means the beta runs new code against an old schema.
**Re-link the CLI to `wilson-dev`** when the last env is verified.

🚨 **Run the adversarial review before deploying.** Six sessions running have
found real defects in already-green code. A batch signing endpoint is exactly
the surface the last four found their highs in.

## Close-out ritual

1. `docs/OUTSTANDING.md` — **delete the BYO-thumbnail entry** and cite the
   commit, or narrow it to whatever genuinely remains.
2. Sequence table + an S44 outcome block in `MASTER_PLAN_S19_ONWARD.md`.
3. Migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest + any new suite registered in
   `.github/workflows/rls.yml` (⚠️ **ONE file at the git root, two lists
   inside it** — the `RLS_TABLES` coverage guard globs `*_<table>.sql` and
   cannot see a suite named for a concept; the replay list takes every suite)
   + CI green on the pushed head, Playwright included.
5. **`SYSTEMS_HANDBOOK.md` §12.7b** rewritten from "decided, not built" to what
   actually shipped — including the display design and its expiry, and the
   disposal limits stated in **both directions** (what is swept, what is
   deliberately left).
6. **Refresh the STATE block of `SESSION_40_prompt.md`** with the numbers you
   leave behind, and **tell S40 what the thumbnail path now looks like** — it
   builds video stills directly on this. Update the Claude auto-memory in the
   same pass.
7. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
