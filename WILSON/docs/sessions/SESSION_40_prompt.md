# SESSION 40 launch prompt — THE STORAGE PROVIDER REGISTRY

> **§4a2 + §4a2b of `docs/NETWORK_STORAGE_DESIGN.md`** — read both first.
> §4a2b carries Audrey's constraint verbatim and the five invariants every
> provider inherits. This session builds **no new provider**. It builds the
> shape the next two plug into.

> 🚨 **THIS SESSION BLOCKS S41 AND S42.** S41 is S3-compatible, S42 is Google
> Drive. Either one built before this exists becomes the fork §4a2b was
> written to prevent — and the second one then forks the first.
>
> ⚠️ **It is ADDITIVE BY CONTRACT.** Audrey, 2026-08-07: *"nas, gdrive, AWS
> s3 buckets, etc are all going to be options if we add the gdrive solution
> dont remove other options."* Nothing S34 shipped may be narrowed. The NAS
> path (`provider = 'network'`) must behave **identically** after this
> session — same refusals, same probe, same containment. The suite proves
> that, not the author's confidence.

> **STATE — re-measure, do not trust this block.** After S35 (2026-08-07):
> migrations **0000–0049** on all three envs (verified by query), next free
> **0050**. pgTAP **59 suites / 982 assertions**, next free suite **60**.
> Vitest **1022 / 47 files**. 🚨 **Read the working tree, never memory or a
> doc — a design written mid-S31 cited "0046, next free" and was wrong
> within the hour.** S37–S39 land before this one and will have moved every
> number.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** (what is broken) and
   **`docs/SYSTEMS_HANDBOOK.md` §12.7 + §17** (the workspace drive, and
   limits by design — a gate, not an oracle).
4. **Read `NETWORK_STORAGE_DESIGN.md` §4a2 + §4a2b** and the **S34 and S35
   outcome blocks** in `MASTER_PLAN_S19_ONWARD.md`.
5. **Re-verify every `file:line` citation in this brief by SYMBOL before
   using it** — sessions between its writing and now have moved them.

---

## Why this exists

**Audrey, 2026-08-07, verbatim:**

> *"So remember its bring your own storage solution … nas, gdrive, AWS s3
> buckets, etc are all going to be options if we add the gdrive solution dont
> remove other options"*

Bring-your-own-storage is a **family**. A customer with an office server uses
their NAS (S34, shipped). A customer with no server but a Google Workspace
uses Drive. A customer with neither uses an S3 bucket. All three are the same
product decision — *"my media, my storage, Petal's software"* — and they must
share one implementation.

**MEASURED 2026-08-07, and this is why the session exists now rather than
inside the first provider:**

- ✅ **`public.files.storage_provider` is already a per-file enum**
  (`0000_rabbit_base_schema.sql:67`) —
  `('supabase','google_drive','local_server')` — beside
  `files.storage_path TEXT NOT NULL`. **The per-file dimension is right and
  already exists.** A new provider is a value, not a column.
- 🚨 **`workspace_storage` (0048) encodes "byos means a filesystem path".**
  `root_path` + `root_kind ∈ ('unc','local')`, plus
  `workspace_storage_root_canon_chk` (no trailing separator, no whitespace)
  and `workspace_storage_kind_shape_chk`
  (`(root_kind='unc') = (left(root_path,2) = '\\')`).
- 🚨 **The trap, and it is the whole reason for this brief:** widening
  `root_kind` to `'gdrive'` would **PASS the shape CHECK vacuously** —
  `false = false` — while **nothing validated the config at all**. A
  provider that reads as configured and resolves nowhere. Then S3 forks
  Drive, and the fourth provider forks both.

## What this needs

### 1. Migration (0050+, re-measure) — the provider column

- **`workspace_storage.provider TEXT NOT NULL`**, CHECK over the known set
  (`'petal'`, `'network'`, and the values S41/S42 will use). `mode`
  (`central`|`byos`) stays as the **ownership/billing** axis; `provider` is
  the **how**. Do not collapse them — S37 keys billing off `central`.
- **Backfill deterministically, from the data**: existing `mode='byos'` rows
  carry a real filesystem root, so they are `'network'`; `mode='central'`
  rows are `'petal'`. ⚠️ **Query the live rows on all three envs first** —
  the backfill must be written against what is actually there, not what the
  table permits. (S24's lesson: the plan documents named the wrong columns.)
- **`provider_config JSONB`** — ONE column, per-provider shape, validated per
  provider. **Never three flat columns per provider**; that is the fork in
  slow motion.
- 🚨 **Make the S34 CHECKs CONDITIONAL, and make the converse explicit.**
  Not just *"the path rules apply when provider = 'network'"* but also
  *"`root_path` IS NULL when provider <> 'network'"*. Without the second
  half, a Drive row can carry a stray path that every resolver will happily
  read. **Both directions, and a breaker for each.**
- The `storage_provider` ENUM will need new values for S41/S42. ⚠️
  **`ALTER TYPE … ADD VALUE` cannot USE the new value in the same
  transaction** (PG12+ permits the DDL in a transaction; the value is
  unusable until commit). Measure whether the house prefers growing the enum
  or the newer TEXT+CHECK shape (`workspace_storage.mode` is TEXT+CHECK) —
  and if the enum stays, the value-add and anything that writes it are two
  migrations, not one.

### 2. The interface — four functions, not an adapter

Create `src/tools/rabbit_v0.1.0/storage/` with **one provider contract**:

```
put(key, blob, opts) → { key }      get(key) → blob
del(key)                            exists(key) → boolean
```

Plus a `describe()` for the config-time reachability probe (S34's
`rabbit:probe-storage-root` is the pattern: probe at CONFIGURATION time, with
a sentence a person can act on, not at first download six screens away).

🚨 **A provider is those functions and nothing else.**
`googleDriveAdapter.js` is **57 `readOnly()` stubs against a 122-method
backend interface** — it is a v0.1 relic modelled on single-user JSON
bundles, predating workspaces, RLS, the folder tree and the manifest. **It is
the shape to avoid, not to finish.** Leave it exactly as it is; S42 decides
its fate.

### 3. The seam — one call site, not N

`supabaseAdapter.uploadFile` builds `storagePath` today
(`projects/${projectId}/${entity}/${entityId}/${ts}-${safeName}`) and writes
the `files` row. That is the seam: the row records `storage_provider` +
`storage_path`, and the body goes to whichever provider the workspace
selected. Download/delete resolve the provider **from the file row**, never
from the workspace's current setting — 🚨 **a workspace that switches
provider must not orphan what it already wrote.** Pin that with a test.

### 4. 🚨 The invariant that must survive every provider

**Money-gated files NEVER leave Supabase.** `INVOICES/` and `FINANCE/` are
manager-only because the storage path's third segment says so and Postgres
enforces it (`rabbit_money_segment`, 0042 — which took 0038→0039 to get
right after shipping inverted). Drive has opaque IDs and its own sharing
model; S3 has bucket policies. **Neither binds to a WILSON project role.**

The enforcement point already exists and is one line:
`uploadFile` branches on `scope.financial` to choose the `INVOICES` segment.
**A financial upload pins `storage_provider = 'supabase'` there, whatever
the workspace selected** — and a test proves it, because this is the one
rule whose failure is silent and expensive.

### 5. Suite + proof

New pgTAP suite (**60+**, re-measure), registered in **BOTH** rls.yml lists
(the allowlist fails loud; the replay list fails **silent**). It must prove:

- **The NAS path is unchanged.** Re-run S34's shapes against
  `provider='network'`: mapped drive refused, bare share refused, trailing
  separator refused, canonical UNC accepted. **If any S34 refusal is looser
  after this session, the session failed its own contract.**
- A non-network provider row **cannot** carry `root_path` (the converse
  arm).
- 0049's `fn_project_folder_root_guard` still binds — it reads
  `workspace_storage` for the byos root, so its anchor must keep working for
  `provider='network'` and must not fire nonsensically for a bucket-backed
  workspace. **Decide and test what a project folder means when the provider
  is not a filesystem** (recommended: `folder_root` is meaningless and stays
  NULL — refuse it, with the sentence saying why).
- **A breaker per arm** (S33's rule), and a refusal probe pins one check only
  if every other check waves its caller through. Postgres-side counts bring
  their own WHERE — dev carries real rows.

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command. A migration's
text is not the database's state — query it, and read
`supabase/.temp/linked-project.json` first. One query per `--file`. Count
`<!--`/`-->` after editing long markdown. Deploy order: dev → staging → prod
BEFORE the git push; re-link to wilson-dev after.

🚨 **Run the adversarial review before deploying.** Three sessions running it
found real defects in already-green code (S33: 3; S34: 20, 3 high; S35: 8, 2
high). S35's own target was bypassable through a column it had not thought
about — **guard whatever OUTRANKS your field**, and this session is entirely
about a field that outranks others.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table + an S40 outcome block in `MASTER_PLAN_S19_ONWARD.md`;
   **unblock S41 and S42** (both blocked-by notes point here).
3. Migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest + new suite in BOTH rls.yml lists + CI green
   on the pushed head, Playwright included.
5. Refresh the STATE block of `SESSION_41_prompt.md`; update the Claude
   auto-memory in the same pass.
6. Close out in the chat with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
