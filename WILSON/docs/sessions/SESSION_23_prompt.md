# SESSION 23 launch prompt — make task creation work

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — everything currently broken
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` (S23/S24 sections + standing rules)
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S22 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

S22 is the fifth session running where this paid, and it paid three times in
one session:

- The documented lead for the assignee dropdown pointed at
  `ProjectTasksView.jsx:159`'s *staffed* branch. One query showed
  `project_members` has **zero rows**, so that branch never runs. The lead
  named the wrong half of an if/else.
- The plan's theory for "the task vanishes" was an optimistic insert being
  reconciled away. There is **no optimistic state on that path at all**; what
  vanishes is the typed text, cleared by `commitAdd` before the write resolves.
- Two independent agents both concluded `ProjectTasksView` was the only
  creation path missing `asset_id`. Adversarial verification **refuted** it —
  `ProjectAssetsView.jsx:1403` and `TimelineView.jsx:3767` both supply it.

**Label everything MEASURED / INFERRED / GUESSED.** Audrey reads these as
claims and acts on them.

---

## Why this session, and not "Files everywhere"

The plan has S23 = *Files everywhere*. **Recommend swapping it for the task
fix, and here is the argument — overrule it if you disagree.**

- *Files everywhere* is explicitly blocked in the plan itself: "Design
  decisions still open — do not start until they are made." Nobody has made
  them. Starting it means designing, not shipping.
- Task creation is **completely broken in cloud mode** — every "New task"
  click has always failed, silently, and the web build forces cloud mode. It
  is fully diagnosed and reproduced, so it is ready to fix now.
- It is the single largest gap between "the app looks fine" and "the app
  works". There is also **no automated coverage of task creation at any
  layer**, which is why a total failure shipped unnoticed.

---

## The defect, already reproduced (S22) — do not re-diagnose

**MEASURED, wilson-dev, 2026-08-03.** Inserting the exact payload the UI sends,
as an authenticated admin member via `tests.rls_setup()` and real JWT claims:

```
23502: null value in column "asset_id" of relation "tasks"
       violates not-null constraint
```

Chain, every hop read:
- `ProjectTasksView.jsx:406` `handleAddTask` sends `{title, status, priority}`.
  Toolbar button `:635` passes no defaults. Board inline add `:1582-1594` sets
  `asset_id` only when `kanbanGroup === 'asset'`; the default group is
  `'status'`.
- `RabbitProvider.jsx:1577` adds `id`/`project_id`/`status`/`priority` — no
  `asset_id`.
- `0000_rabbit_base_schema.sql:178` — `asset_id uuid not null references
  assets(id)`. Never relaxed. Contrast `workspace_id`, auto-stamped by
  `trg_tasks_populate_workspace` (`0004:161-164`) — which is why supplying
  `workspace_id` by hand changes nothing (measured).
- `supabaseAdapter.js:83` `unwrap` throws; `RabbitProvider.jsx:1584` awaits the
  adapter **before** `setBundle` at `:1587`, so state is never touched.
- `ProjectTasksView.jsx:406` has no `try/catch`; the `onClick` arrow drops the
  rejected promise; no `unhandledrejection` handler exists in `src/` or
  `electron/`. **Net effect on screen: nothing.**

### 🚨 The obvious fix is insufficient — this is the trap

Making `asset_id` nullable **moves** the failure rather than removing it.
`0014_soft_delete.sql:238` defines `tasks_select` as requiring
`EXISTS (SELECT 1 FROM assets a WHERE a.id = tasks.asset_id)`, so a task with a
NULL `asset_id` fails its own SELECT policy; `.single()` then returns PGRST116
and `unwrap` throws again. **Both must change together.**

### The actual decision to make first

**May a task exist without an asset?** This is a product question, not a schema
detail, and the answer picks the design:

- **Yes** → `asset_id` nullable + `tasks_select` relaxed to
  `(asset_id IS NULL OR EXISTS (...))` + backfill nothing. Matches local mode,
  which already accepts asset-less tasks (`main.cjs:1090-1098` writes
  `req.body` with no column check) — so the product already behaves this way
  on the desktop and cloud is the outlier.
- **No** → the UI must supply an asset. The toolbar button would need to
  create-or-pick one, and "New task" with no asset selected should be disabled
  with a reason rather than failing silently.

**Ask Audrey before implementing.** Both are defensible; only she knows which
matches how she works.

### Regardless of which is chosen

- **Surface the error.** `handleAddTask` swallowing a rejection is the reason
  a total failure looked like an inert button. A failed write must say so.
  `RabbitProvider.addProjectMember` (`:526-529`) already has the house pattern.
- **Add coverage.** There is none for task creation. A pgTAP probe on
  `tasks_insert`/`tasks_select` plus a vitest around the adapter payload would
  have caught this the day it shipped.
- **Cheap falsifying test first:** switch R.A.B.B.I.T. to Local Server and
  click New task. Works locally + dead in cloud confirms the diagnosis; dead
  in both refutes it.

---

## Also open, and smaller

### Assignee dropdown — cause NOT ESTABLISHED
Do **not** start from the old lead; it is wrong (see above). Two survivors:
1. The roster may simply be near-empty — dev has **2** `workspace_members` rows
   across **4** workspaces. Check the count in Audrey's workspace first; a
   dropdown with one name is accurate, not broken. No code change.
2. Two *other* assignee dropdowns are hard-empty in cloud:
   `ProjectAssetsView.jsx:2108` and `TimelineView.jsx:4228`. Both read a legacy
   roster the Supabase adapter never fills — `loadProject` (`:247`) omits
   `teamAssignments` and there is no `listTeamMembers`.

**Establish which dropdown Audrey means before writing code.**

---

## Traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** One rule, because they were one incident.
  **Write scripts to a file and run the file.** Select fields rather than
  filtering output whose shape you have not seen.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` is still untracked and must stay so.
- **A migration's text does not tell you the database's state.** Query the
  catalog.
- **Check the grantee, not just the grant** (S22). The 25 tables were granted
  to `anon` explicitly, but the seven SECURITY DEFINER functions were granted
  to **PUBLIC** — `REVOKE ... FROM anon` on those would have been a **silent
  no-op**, with the migration reporting success. Make post-conditions scan
  every object, not the ones you listed.
- **`supabase db query --file` returns only the LAST result set** (S22). A file
  with a summary SELECT then a detail SELECT shows you only the detail. One
  query per file.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · 0009 → 0020 · **0011 → 0033** (new, S22:
  re-running 0011 re-grants anon ALL on every table and re-arms the default
  privileges, silently undoing the entire S22 sweep — and 0011 has no
  post-condition that would notice).
- **Run the whole pgTAP set before pushing a migration**, one suite per
  transaction, never concatenated. `collected` MUST equal `planned`. The shim
  has NO `has_index`, `col_type_is`, `col_default_is`, `col_not_null`,
  `results_eq` or `matches`; its `throws_ok` matches **message text**, not a
  SQLSTATE.
- **`.select()` + a null-data check, or the write is unobserved.** An
  RLS-refused UPDATE returns 200 with a null body and no error. (With
  `.single()` it errors instead — PGRST116 — but a caller with no `catch`
  swallows that just as completely. That is this session's whole defect.)
- **Permissive RLS policies OR together.** A narrow policy beside a broad
  `FOR ALL` one changes nothing — the old one must be DROPPED.
- **`withTimeout` races, it does not abort.** Bounding a call site fixes that
  site's UI, not the app. See `OUTSTANDING.md`.
- **`.github/workflows/rls.yml` is at the GIT ROOT**, not under `WILSON/`.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S21 corrected its
  table/suite counts; S22 corrected its migration range (`0000–0029` → `0000–0033`)
  and its SECURITY DEFINER count (eight → seven). Check the code.
- Vitest is at **482**, pgTAP **42** suites / **655** assertions (629 + 26 in
  S22). If any moves, say why.

---

## Still owed by Audrey — unchanged, and still blocking the tag

1. **Rotate `smoke_admin`** — published in the PUBLIC repo, permanent in git
   history. `OWED_AUDREY.md` §0, TPN-SDLC-007. The one open CRITICAL.
2. **Rotate `wilson-staging`'s legacy `service_role` key** (S19 exposure).
3. **Complete `docs/RELEASE_TESTING.md`.**
4. **v1.0.0 is prepared, NOT tagged, NOT merged to `main`.** Ask before
   tagging, and ask **again** before merging to `main` (Vercel's production
   branch).

---

## Close-out ritual

Feature commit(s) → CI green (**all four jobs**, not just the badge — a skip is
not green) → deploy migrations dev → staging → prod (dry-run each, verify each
**by query**) → re-link CLI to `wilson-dev` → write
`docs/sessions/SESSION_24_prompt.md` → update `docs/MASTER_PLAN.md` (§4 ledger,
§6 gaps) and `MASTER_PLAN_S19_ONWARD.md` → update `docs/SYSTEMS_HANDBOOK.md` if
behaviour changed → **update `docs/OUTSTANDING.md`** → update the Claude
auto-memory → docs commit + push.

> **On `docs/OUTSTANDING.md`:** add only what is **broken and not yet fixed**,
> including anything this session breaks; delete what it fixes, citing the
> commit; tag MEASURED / REPORTED / INFERRED. **Adding nothing is a correct
> outcome.** Do not pad it to look thorough — padding buries the real entries.
