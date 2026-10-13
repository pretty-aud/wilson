# SESSION 27 launch prompt — FILES EVERYWHERE + the manifest in Resources

> **STATE AFTER S26 (2026-08-04, `071682b` + `ca27d47`), so you do not
> re-measure it:** migrations run **0000–0041** on dev, staging and prod (next
> free number is **0042**); pgTAP is **52 suites / 790 assertions**; vitest is
> **658**. `public.projects` has **50 columns**. All four CI jobs green.
>
> ✅ **The folder tree is REAL on both writable adapters.** Migration 0041
> created `public.folders` with RLS enabled and forced, four policies, no
> `FOR ALL` arm, nine CHECK constraints and zero privileges held by `anon` or
> `PUBLIC`. Root → category → entity, one folder per asset / scene / shot /
> level / experience. `supabaseAdapter` has `listFolders`,
> `ensureProjectFolders`, `ensureEntityFolder`, `deleteFolder` and
> `writeProjectManifest`; `localServerAdapter` has the same five over new
> Express routes that make REAL directories; `googleDriveAdapter` reads and
> throws on writes.
>
> 🚨 **Paths come from `src/tools/rabbit_v0.1.0/folderPaths.js`. USE IT, DO NOT
> RE-IMPLEMENT IT.** `electron/main.cjs` holds the one unavoidable duplicate
> (it cannot import from the renderer bundle) and `folderParity.test.js` reads
> that file as TEXT and fails when the two diverge — `fileSlugify`, the
> category list, AND both planners. S25 removed the third copy of `fileSlugify`
> (`43be524`) so this could be pinned; do not add a fourth.
>
> ✅ **`PROJECT.json` is written into the project folder** — a generated MIRROR
> of the project's settings, the database staying authoritative (Audrey,
> 2026-08-03). `projectManifest.js` builds it; the provider writes it
> debounced on every settings change.

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — everything currently broken
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence table is
>    the authority
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S26 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

**S26 sharpened the standing corollary, and the sharpening matters more than
the corollary now.**

For three sessions the lesson was *grep for the WRITER, not the reader* — S20
named the wrong migration number, S24 named `margin` when the column was
`budget_margin_pct`, S25 named `code` when the writer was `project_code`.

S26 was told to add `projects.files_dir`, **with a correct citation to a real
writer** (`ProjectSummaryView.jsx:1010`, `update('files_dir', null)`). Grepping
for the writer would have confirmed the plan and produced a dead column. The
writer exists and **cannot run on the backend the column would live on**: the
block renders only inside `{project?.files_dir && …}`, i.e. when the value is
already non-null, and only the local relink route ever sets one —
`relinkScan`/`relinkApply` are local_server ONLY.

> **So the question is now two questions.** Who WRITES this field, and **can
> that writer run on the backend I am adding the column to?**

And note the distinction S26 had to draw, because getting it backwards causes
the opposite error: `code` is a wrong NAME that must never exist, so pgTAP
asserts its absence. `files_dir` is the RIGHT name for a feature with no cloud
implementation, so **nothing asserts its absence** — it arrives WITH relink.

**Label everything MEASURED / INFERRED / GUESSED.**

---

## 🚨 READ THIS BEFORE YOU TRUST A GREEN CI RUN

S26's feature commit turned the entire app into a blank page, and **three of
the four CI jobs went green anyway.**

`ensureProjectFoldersFor` listed `writeManifestSoon` in its `useCallback`
dependency array while the `const` was declared fifty lines below. A dependency
array is evaluated **during render**, so `RabbitProvider` hit the temporal dead
zone on first render, threw, and `#root` had zero children.

- **658 vitest passed.** Nothing in the suite MOUNTS `RabbitProvider` — it is
  all pure modules, and there is no `@testing-library` in this repo.
- **52 pgTAP suites passed.** Not their department.
- **Both production builds succeeded.** A TDZ error is valid JavaScript.
- **There is no eslint config**, so `no-use-before-define` never ran.

**Playwright was the only job that could see it.** Its green status is
load-bearing in a way the other three are not: *"the app renders at all"* is a
claim only that job makes. If you break Playwright, do not shrug it off as
flaky — check whether the app still mounts, with
`document.getElementById('root').children.length` against the dev server. That
one line is what settled it in S26, in under a minute.

---

## S27 — files everywhere, and the manifest surfaced

The largest single ask on the list: files visible and attachable from the
Resources page, D.O.G. and R.A.B.B.I.T. against one project, with the folder
tree S26 built underneath them.

### The measured starting position — do not re-derive these

- **`public.files` has NO `scene_id`, `shot_id`, `level_id` or
  `experience_id`.** MEASURED 2026-08-04 against wilson-dev; the columns are
  `project_id`, `phase_id`, `asset_id`, `task_id`. But
  `FileManager.jsx` filters on `f.scene_id === sceneId` and `f.shot_id ===
  shotId`, and passes both to `addManagedFile`. So the component is already
  written against columns that do not exist in cloud.
- **`managedFiles` is a local_server-ONLY subsystem.** `createManagedFile` and
  `listManagedFiles` exist on `localServerAdapter` and nowhere else;
  `RabbitProvider` feature-detects and throws *"Managed files require the Local
  Server backend"*. **So the entire FileManager add/download/open-folder flow
  is dead in cloud**, and `handleAddFiles` early-returns on
  `window.electronAPI?.rabbit` before that, so it is dead on the web twice
  over.
- **`uploadFile`'s scope is `{phaseId, assetId, taskId, kind, isCoreDefiner,
  financial}`** — no scene or shot. Its storage path is
  `projects/<id>/<entity>/<entityId>/<ts>-<name>`, i.e. **ID-based, not
  folder-based.** The folder tree S26 built is slug-based and human-readable.
  Reconciling those two is the heart of this session and is a real decision,
  not a rename: object keys cannot be moved without copying every object.
- **`<slug>_FILES` is deliberately NOT in the folder tree.** Its name embeds
  the project slug, so it is the one folder whose path is not backend-neutral.
  S26 left it out rather than invent a `FILES` category the disk does not
  have. Reconciling it is yours, because you own file storage.

### The manifest half

`PROJECT.json` exists and is written; **Resources does not show it.** Resources
today is only a nav slide-out (Projects, Rate Card, Settings — `App.jsx:784`),
so this is a new surface, not a tweak.

🚨 **The manifest is a MIRROR. It is never read back into normal operation.**
Any import is an explicit user action that shows a diff first. Do not add a
read-on-load path — `main`'s `_DATABASES/` is the cautionary tale, and
`electron/main.cjs` still creates that folder for existing local projects
precisely so nothing had to be migrated.

### 🚨 The one part of Audrey's request S26 did NOT deliver

She asked for "unique margin, unique contingency, **unique team member
rates**". Margin and contingency are in the manifest. **The rates are not**,
and this is measured rather than cautious:

```
project_rate_overrides_select :: workspace_id = current_workspace_id()
                                 AND can_access_project_money(project_id)
```

is manager-only, while

```
rabbit_files_select :: bucket_id='rabbit-files' AND authenticated
                       AND foldername[1]='projects'
                       AND upper(foldername[3]) IS DISTINCT FROM 'INVOICES'
                       AND EXISTS (SELECT 1 FROM projects p WHERE p.id = foldername[2])
```

admits **any project member** to any object under `projects/<id>/` without a
third path segment — which `projects/<id>/PROJECT.json` does not have.
Including rates there hands every team member the figures RLS just denied them.
That is the S24 invoice defect in a new file.

Margin and contingency ARE safe, and that was checked separately:
`projects_select` admits any active workspace member, so those were already
readable by anyone who can open the project.

→ **Rates need a money-gated path of their own.** `INVOICES` is the only gated
segment that exists and is the wrong name for it. **Ask Audrey** whether she
wants a second gated namespace or is content for rates to stay in the app only.
🚨 If you build one: 0038 shipped that segment lowercase and 0039 had to fix
it, and in between the gate was **inverted** — objects missed the money-gated
policy and fell through to the base one. Case is load-bearing. Change the path
and the policy in the same migration or not at all.

---

## Carried into S27, and NOT to be guessed at

### Task templates do not exist in cloud
**Deferred by S25 AND S26.** Not a missing adapter method: on Local Server they
are individual JSON files in their own directory
(`electron/main.cjs:2088-2131`), workspace-scoped with a project-scoped read.
Cloud parity needs a **table, its own RLS, its own pgTAP suite and five adapter
methods**. Until then the New Asset dialog's Task Template dropdown is
permanently empty in cloud and its template branch
(`ProjectAssetsView.jsx:1378-1419`) is dead code. **Size it as its own block.**

### The two assignee dropdowns have STILL not been watched working
`TimelineView.jsx:4228` and `ProjectAssetsView.jsx:2108`. S24 built
`listTeamMembers` and `loadProject` now returns `teamAssignments`, so at CODE
level the stated cause is gone. **S25 and S26 were both asked to confirm at
runtime and neither could** — it needs a signed-in session against staging with
a staffed project, which nothing in this repo automates. **One look at the
Timeline task editor on the beta closes it.** Do not delete the entry without
that look.

### Every create button can vanish behind one `canWrite` flag

**Read `OUTSTANDING.md`'s entry in full — S26 rewrote it, because it
contradicted itself.** Its header claimed both leading theories were refuted
while its own body reopened one of them. The two are now separated by KIND of
evidence:

- **REFUTED on CODE, needs no re-checking:** not "consumers ignore `ready`".
  `canOnProject:131` already fails **OPEN** when `ready === false`, so a hung
  `getSession()` leaves the buttons **PRESENT**.
- **UNCERTAIN, rests on TESTIMONY:** the account. Audrey runs **two accounts in
  two browsers simultaneously** and said "I'm not sure" which front door the
  sighting came from.

🚨 **The observation test WAS run and did NOT settle it.** Audrey reported
"Admin Terminal and New task are gone" on 2026-08-04 — she was on **`tester`**,
in the other browser, where both controls are *correctly* absent. **The test
only means anything re-run in the browser that produced the symptom.** Twice
now this investigation has been sent down a wrong path by an account
assumption, from opposite directions. **Never ask "which account are you on" in
general — pin it to the specific browser AND the specific moment.**

**Live lead, one leg measured:** the two surfaces use different session storage
keys (`supabaseClient.js:44`, `sb-wilson-operator` vs `sb-wilson-app`). **Not
established** that this produces the symptom — no session at all shows the
login screen, not a project with a missing button. **Do not write a fix.**

---

## Standing traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** Write scripts to a file and run the file.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** (S22): objects can carry a bare
  `=X/postgres` aclitem, so naming only `anon` is a silent no-op. Scan every
  object; do not check the list you wrote.
- **`supabase db query --file` returns only the LAST result set.** One query
  per file — 0041's verification is a single `SELECT` with fourteen sub-selects
  for exactly this reason.
- **`sanitize()` is a denylist; `toColumns()` is the allowlist.** Any new table
  written from the client needs a `COLUMN_ALLOWLIST` entry or its first
  invented key PGRST204s the whole request. `columnAllowlist.test.js` fails
  when a table is missing one.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · 0009 → 0020 · **0011 → 0033** · **0027 → 0038 →
  0039** · **0040 → 0041** (0041's entity FKs point at 0040's four tables).
  **Replay forwards only.**
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set** against the linked
  project in one command — S26 added it because running 52 suites by hand is
  how one gets skipped. It fails on `planned != collected` as loudly as on an
  assertion, because a shim that silently loses probes lies about coverage
  rather than about correctness. `collected` MUST equal `planned`.
- **`scripts/tap-hosted.py` can run an UNAPPLIED migration together with its
  suite in one rolled-back transaction** — the safe way to iterate against real
  Postgres before pushing anything. The shim has NO `has_index`, `col_type_is`,
  `col_default_is`, `col_not_null`, `results_eq` or `matches`; `throws_ok`
  matches **message text**, not a SQLSTATE.
- **Permissive RLS policies OR together** — replace a policy by DROP + CREATE,
  never by adding a narrower one beside it.
- **`.github/workflows/rls.yml` is at the GIT ROOT**, not under `WILSON/`. A
  new table needs adding in **two** places: `RLS_TABLES` (fails loudly) and the
  failure-replay list (fails **silently**). S26 made the replay list
  exhaustive — all 52 suites — after finding thirteen had never been in it.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S21, S22, S24, S25
  and S26 each corrected it. Check the code.

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

Feature commit(s) → CI green (**all four jobs** — a skip is not green, and
neither is three-out-of-four) → deploy migrations dev → staging → prod
(dry-run each, verify each **by query**) → re-link CLI to `wilson-dev` → write
`docs/sessions/SESSION_28_prompt.md` → update `docs/MASTER_PLAN.md` and
`MASTER_PLAN_S19_ONWARD.md` → update `docs/SYSTEMS_HANDBOOK.md` if behaviour
changed → **update `docs/OUTSTANDING.md`** → update the Claude auto-memory →
docs commit + push.

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
