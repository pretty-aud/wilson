# SESSION 26 launch prompt — the backend-agnostic FOLDER TREE

> **STATE AFTER S25 (2026-08-04, `183b4c2`), so you do not re-measure it:**
> migrations run **0000–0040** on dev, staging and prod (next free number is
> **0041**); pgTAP is **51 suites / 768 assertions**; vitest is **556**. All
> four CI jobs green. `public.projects` has **48 columns**.
>
> ✅ **Scenes, shots, levels and experiences are REAL on both adapters now.**
> Migration 0040 created all four with RLS enabled and forced, 16 policies, no
> `FOR ALL` arm and zero privileges held by `anon` or `PUBLIC`.
> `supabaseAdapter` has `list/upsert/delete` for each, they ride in
> `loadProject`, and all four have `COLUMN_ALLOWLIST` entries. Auto-naming now
> lives in `src/tools/rabbit_v0.1.0/entityNaming.js` — **use it, do not
> re-implement it**; `fileSlugify` is in there for you.

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — everything currently broken
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the REORDERED sequence
>    table is the authority
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S25 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

**S25 added the sharpest corollary yet, and it has now cost three sessions in
a row: GREP FOR THE WRITER, NOT THE READER.**

S25's brief said to add a `projects.code` column, and cited a real line of
code reading `project?.code` as proof. It was wrong. Nothing in `src/` or
`electron/` has ever *written* a bare `code` key — the writer is
`update('project_code', v)`. Adding `code` would have closed the documented
gap, passed review, and left the client topsheet printing `--` forever.

That is the same shape as S24 (`margin` vs `budget_margin_pct`) and S20
("migration 0032" when the next number was 0031). **A field appearing in a
read proves nothing about which column backs it.** One grep over the writers
found thirteen more drifted columns the plan had never listed.

**Label everything MEASURED / INFERRED / GUESSED.**

---

## S26 — the folder tree, in whichever backend the company chose

**Audrey's requirement, verbatim in substance (2026-08-03):** R.A.B.B.I.T. is
also a **project file manager**; the folder tree must reflect in **whichever
storage backend the company selected** — not local disk only, which is all
`fs.mkdirSync` in `electron/main.cjs` can do today. Assets are first-class
items each with their own folder; scenes, shots, levels and experiences each
get their **own** folder (5 scenes means 5 independent folders under
`SCENES/`, not one shared one). **Toggling a category off must only remove it
from the R.A.B.B.I.T. view and never delete the folders.**

### ✅ THE DESIGN DECISION IS MADE — do not re-open it

**Audrey, 2026-08-04: a `folders` TABLE is the source of truth.** Supabase
Storage has no real folders — it is object storage with path prefixes, so an
*empty* folder cannot exist, and "toggle off never deletes" needs a folder
that outlives its contents. The table records the tree; the storage path is
**derived** from it. It survives a backend switch and behaves identically on
Local Server, Supabase and Drive, where a `.keep` placeholder would exist only
where files already do.

### Scope

- **Migration 0041** — the `folders` table, plus the `projects` columns this
  session consumes: `folder_slug`, `folder_root`, `files_dir`. (`files_dir` is
  written by the relink reset at `ProjectSummaryView.jsx:949` and is dropped
  today.) Follow 0040's shape exactly: RLS enabled **and forced**, four
  policies, **no `FOR ALL` arm**, `REVOKE ALL … FROM PUBLIC, anon`, the
  `fn_populate_workspace_from_project` and `touch_updated_at` triggers.
  Use `can_write_project`, **not** `can_access_project_money` — folders are
  ordinary project content.
- **`rls.yml` at the GIT ROOT** must gain `folders` in `RLS_TABLES` **and**
  the new suite in the hardcoded failure-replay list. 🚨 **Both.** The
  allowlist failing is loud; the replay list failing is **silent** — S17
  recorded suites 33–38 failing invisibly for exactly that reason.
- **pgTAP `52_folders.sql`.** Include the standing
  `ok(NOT has_table_privilege('anon', …))` probe.
- **Adapter parity on all three backends.** `ensureProjectFolders`,
  `ensureAssetFolder` and the per-scene/shot/level/experience equivalents,
  implemented for `supabaseAdapter`, `localServerAdapter` and (read-only)
  `googleDriveAdapter`.
- **`FileManager.jsx:87` already computes**
  `parentType = sceneId ? 'SCENES' : shotId ? 'SHOTS' : 'ASSETS'` — that was
  designed in. Nothing ever creates a `SCENES/` or `SHOTS/` folder, and
  levels/experiences are not in that switch at all.
- **The project manifest.** Audrey wants project settings written into the
  project folder as a readable file, and surfaced in a Resources project view.
  ✅ **DECIDED and settled: the database is authoritative, the file is a
  generated MIRROR.** Written on change; read only for portability, recovery
  and handoff; never an input to normal operation. Any import is an explicit
  user action that shows a diff first. **Do not re-open this** — the reason is
  that RLS, realtime and last-writer-wins all assume a single authority, and
  `main`'s `_DATABASES/` folder is the cautionary tale of a second one.
  The settings it mirrors now exist as real columns (0036 + 0040), so unlike
  when this was first written, the manifest will not be a file of nulls.

### 🚨 Traps specific to this session

- **`fileSlugify` exists in TWO places** — `entityNaming.js` (renderer) and
  `electron/main.cjs`. They are identical today. A slug that disagrees between
  the renderer and the Electron main process creates **two folders for one
  scene**. Import the shared one wherever you can reach it, and if `main.cjs`
  cannot, pin the two together with a test.
- **`<slug>_DATABASES/` must NOT be ported.** On `main` that folder was not a
  files folder, it was the DATASTORE — `mirrorProjectDatabases` wrote
  `project.json`, `team.json`, `tasks.json`, `timeline.json`, `budget.json`
  into it. **Database information lives in Supabase.** Porting it verbatim
  reintroduces a second, diverging copy of every project on disk.
- **Renaming.** On `main`, renaming an asset renames its folder **and**
  rewrites the `ASSETS/<oldSlug>/` prefix on every managed file. Decide
  deliberately whether a rename moves the folder or the folder keeps its
  original slug — a `folders` table makes "keep the slug, change the label"
  possible, which the filesystem-only design could not do.

---

## Carried into S26, and NOT to be guessed at

### Task templates do not exist in cloud
**S25 was scoped to fix this and deliberately did not.** It is not a missing
adapter method: on Local Server, templates are individual JSON files in their
own directory (`electron/main.cjs:2088-2131`), workspace-scoped with a
project-scoped read. Cloud parity needs a **fifth table, its own RLS, its own
pgTAP suite and five adapter methods**. Size it as its own block. Until then
the New Asset dialog's Task Template dropdown is permanently empty in cloud
and its template branch (`ProjectAssetsView.jsx:1378-1419`) is dead code.

### The two assignee dropdowns have STILL not been watched working
`TimelineView.jsx:4228` and `ProjectAssetsView.jsx:2108`. S24 built
`listTeamMembers` on `supabaseAdapter` and `loadProject` now returns
`teamAssignments`, so at CODE level the stated cause is gone. **S25 was asked
to confirm at runtime and could not** — reaching those dropdowns needs a
signed-in session against staging with a staffed project, which nothing in
this repo automates. **One look at the Timeline task editor on the beta closes
it.** Do not delete the `OUTSTANDING.md` entry without that look.

### Every create button can vanish behind one `canWrite` flag
**Both leading theories are now REFUTED** (S25) and the entry in
`OUTSTANDING.md` carries the detail:
1. Not the wrong account — Audrey confirms she was `audrey`, who is workspace
   **admin** and project **manager**; `canOnProject:134` returns true for
   either before any other branch runs.
2. Not consumers ignoring `ready` — both R.A.B.B.I.T. views DO pass it, and
   `canOnProject:131` returns **true** when `ready === false`. A hung
   `getSession()` leaves the buttons **present**, not missing.

🚨 **The observation test was RUN and did NOT settle it — do not read the
result as a confirmation.** Audrey reported "Admin Terminal and New task are
gone" on 2026-08-04, which looks decisive and is not: she was on the
**`tester`** account, in a different browser from the one that produced the
original report. For a non-admin with no manager/member seat on a staffed
project, both controls are *correctly* absent.

**She runs two accounts in two browsers at once** — admin in one, `tester` in
the other. So "which account" has to be pinned to the specific browser AND
moment, never asked in general. This investigation has now been sent down a
wrong path by an account assumption **twice**, from opposite directions (S23,
then S25).

**The live lead, measured as far as it goes:** the original sighting was in
"the browser logged into the admin portal", and the two surfaces use
**different session storage keys** — `supabaseClient.js:44`,
`surface === 'admin' ? 'sb-wilson-operator' : 'sb-wilson-app'`. **Not
established:** whether that produces the symptom. No session at all would show
the login screen rather than a project with a missing button, so crossover
alone is not sufficient. **Do not write a fix from one measured leg.**

---

## Standing traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** Write scripts to a file and run the file.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** (S22): functions and tables can
  carry a bare `=X/postgres` aclitem, so naming only `anon` is a silent no-op.
  Scan every object; do not check the list you wrote.
- **`supabase db query --file` returns only the LAST result set.** One query
  per file — 0040's post-condition is a single `SELECT` with eleven
  sub-selects for exactly this reason.
- **`sanitize()` is a denylist; `toColumns()` is the allowlist.** Any new table
  written from the client needs a `COLUMN_ALLOWLIST` entry or its first
  invented key PGRST204s the whole request. `columnAllowlist.test.js` now
  fails when a table is missing one.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · 0009 → 0020 · **0011 → 0033** · **0027 → 0038 →
  0039** (replaying an earlier one of those three silently re-opens every
  invoice to any project member, and reports success while doing it).
  **Replay forwards only.**
- **Run the whole pgTAP set before pushing a migration**, one suite per
  transaction. `collected` MUST equal `planned`. The shim has NO `has_index`,
  `col_type_is`, `col_default_is`, `col_not_null`, `results_eq` or `matches`;
  `throws_ok` matches **message text**, not a SQLSTATE. (0040's suites express
  nullability over `information_schema` for this reason.)
- **`scripts/tap-hosted.py` can run an UNAPPLIED migration together with its
  suite in one rolled-back transaction.** That is the safe way to iterate
  against real Postgres before pushing anything — S25 used it for all four
  suites before applying.
- **Permissive RLS policies OR together** — replace a policy by DROP + CREATE,
  never by adding a narrower one beside it.
- **`.github/workflows/rls.yml` is at the GIT ROOT**, not under `WILSON/`.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S21 corrected its
  counts, S22 its migration range, S24 its table count, S25 its CI allowlist
  size (it said 30 tables; it was 39). Check the code.

---

## Still owed by Audrey — blocking the v1.0.0 tag

1. **Rotate `smoke_admin`** — published in the PUBLIC repo, permanent in git
   history. `OWED_AUDREY.md` §0, TPN-SDLC-007. The one open CRITICAL.
2. **Rotate `wilson-staging`'s legacy `service_role` key** (S19 exposure).
   `supabase projects api-keys` returns all keys as ONE JSON line — never
   filter it, select the one field.
3. **Complete `docs/RELEASE_TESTING.md`.**
4. **v1.0.0 is prepared, NOT tagged, NOT merged.** Ask before tagging, and ask
   **again** before merging to `main` (Vercel's production branch).

---

## Close-out ritual

Feature commit(s) → CI green (**all four jobs** — a skip is not green) → deploy
migrations dev → staging → prod (dry-run each, verify each **by query**) →
re-link CLI to `wilson-dev` → write `docs/sessions/SESSION_27_prompt.md` →
update `docs/MASTER_PLAN.md` and `MASTER_PLAN_S19_ONWARD.md` → update
`docs/SYSTEMS_HANDBOOK.md` if behaviour changed → **update
`docs/OUTSTANDING.md`** → update the Claude auto-memory → docs commit + push.

> **On `docs/OUTSTANDING.md`:** add only what is **broken and not yet fixed**,
> including anything this session breaks; delete what it fixes, citing the
> commit; tag MEASURED / REPORTED / INFERRED. **Adding nothing is a correct
> outcome.**

> **THEN, FINALLY, IN THE CHAT — both required, after everything is pushed:**
>
> 1. **List the remaining sessions**, one line each, a few words only, marking
>    any that are done. If the order changed, say so.
> 2. **A layman's breakdown of what this session accomplished**, in bullet
>    points, plain English. **No jargon, no table names, no migration numbers,
>    no file paths.** Write what CHANGED FOR AUDREY, not what was done to the
>    code. Say plainly what is fixed, what is only diagnosed, and what she
>    needs to do herself. The technical record is already in the commits; this
>    is the part she actually reads.
