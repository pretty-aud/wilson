# SESSION 27 launch prompt — the budget system

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`**
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence block first
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

S23's corollaries, both earned the hard way:
- **Measure the environment the user is IN.** `.env.local` = wilson-dev; the
  beta = wilson-**staging**. A conclusion drawn on dev was flatly wrong for
  staging.
- **A user action that requires a precondition is evidence about that
  precondition.** It outranks reading the code that computes it.

---

## The headline, MEASURED 2026-08-03 — read this before planning anything

**The cloud schema has NO budget tables.** Cross-checked against a full census
of all 36 public tables: there is no `budget_lines`, `budget_actuals`,
`budget_versions` or `expenses`, and **no `margin` or `contingency` column
anywhere in the database.** What exists:

- `projects.budget_currency` (text, default `'USD'`)
- `rate_card_entries`: `day_rate`, `week_rate`, `month_rate`, `currency`,
  `wage`, `burden`, `burden_type` (default `'percent'`), `overhead`,
  `overhead_type` (default `'percent'`)
- `rate_cards.type` — `'general'` | `'internal'` (0032)
- `tasks.bid_days` and `tasks.logged_days` (both numeric, nullable)

Those budget structures exist **only in the local JSON bundle**: on
`origin/main`, `mirrorProjectDatabases` writes `budget.json` containing exactly
`budgetLines`, `budgetActuals`, `budgetVersions` and `expenses`.

**So Audrey's report — "the default contingency and margin come up as 0% and
updating the percentage doesn't save" — is fully explained: there is nowhere in
the cloud to save them.** This is the same defect class as `tasks.asset_id`
(S23) and `assets.start_date` (S23): the UI was built against a local schema
that the cloud migration never gained. Expect the same shape everywhere in this
tab, and expect the fix to be mostly *migrations*, not React.

**Do not assume the local shape is the right cloud shape.** Audrey's rule from
the folder work applies here too: **database information lives in Supabase.**
`budget.json` was a datastore of necessity, not a design.

---

## What Audrey asked for (2026-08-03, verbatim in substance)

1. **Default contingency and margin show 0% and will not save.** There are TWO
   levels and both must persist: the **default percentages** *and* the
   **project-unique margin and contingency**.
2. **Crew/Team tab** must show each team member **and their title**.
   🚨 **Her clarification, and it is the sharpest design point in this
   session:** *"you can have a company/title role AND a separate project
   role."* The team view needs an **additional column for project role**, which
   **the manager can write in** (free text).
3. **Phases tab** in the budget must show the **same phases as the timeline**.
4. **Phase cost = the sum of all task costs in that phase.**
5. Those are **actual** costs — *"totaled by adding up the total days/hours a
   team member spent on the tasks and any costs like items, talent etc as well
   related to the phase"*. Her formula, exactly:

   > **phase actuals total = (all task cost in the phase, based on the rate ×
   > total days) + all expenses**

---

## 🚨 The trap in requirement 2 — do NOT write a job title into `project_role`

`project_members.project_role` already exists and holds `manager` / `member` /
`reviewer`. **It is a PERMISSION role, not a job title.** It is read by
`can_write_project()`, `can_comment_project()`, `can_manage_project_roster()`
and `project_role_for()` — the SECURITY DEFINER helpers behind the RLS policies
on tasks, assets, comments and the roster (0013), and by the client matrix in
`src/permissions/projectRoleMatrix.js`.

Audrey's "project role" is a **job title on this project** — "Lead Animator",
"Comp Supervisor" — free text the manager types. Writing that into
`project_role` would silently break every permission gate in R.A.B.B.I.T., and
it would do so in exactly the way S23 spent hours chasing: controls vanishing
with no error.

→ It needs its **own column** (e.g. `project_members.project_title`), separate
from the permission role. Say this back to Audrey explicitly so the distinction
is a decision, not an assumption. Note there are now three related concepts:
- `workspace_members.app_role` — admin/manager/user (permissions, workspace)
- `workspace_members.title` — company job title
- `project_members.project_role` — manager/member/reviewer (permissions, project)
- **NEW** — project job title, free text, per project

---

## Questions to put to Audrey BEFORE building (she invited them)

1. **Which rate prices a task?** `rate_cards.type` is `'general'` (client-facing
   day rates) or `'internal'` (per-person `wage`/`burden`/`overhead`). "Actual
   cost" suggests **internal**, but a client-facing budget would use general.
   Is the phase actual an *internal cost* number, a *client price* number, or
   both side by side?
2. **Which days?** `tasks` has `bid_days` (estimate) and `logged_days`
   (actual). Her formula says actuals → `logged_days`. **But is anything
   populating `logged_days` today?** If nothing does, the actuals total will be
   0 for a different reason, and time capture becomes part of this session's
   scope. **Measure before promising the formula works.**
3. **Days or hours?** She wrote "total days/hours". `bid_days`/`logged_days`
   are days; rate cards carry day/week/month rates. Is there an hours concept
   that needs a unit and a conversion, or is days the unit?
4. **Expenses** — no table exists. What are the categories (items, talent, …),
   and does "talent" come from the existing Talent tab? Are expenses attached
   to a **phase**, a **task**, or either?
5. **Default percentages — default for whom?** Workspace-wide (a company
   default every new project inherits) or per rate card? And when a project
   overrides, is the default a *fallback* or a *seed copied at creation*?
   (Fallback keeps projects in sync when the default changes; seed freezes
   them. This decides the schema.)
6. **Margin and contingency — applied to what, in what order?** On cost, on
   cost+contingency, before or after each other? A budget that computes these
   in the wrong order is wrong in a way nobody notices for months.
7. **Are per-person rates confidential?** `rate_cards.type='internal'` carries
   wages, and `workspace_members` has `grant_rate_card_view` /
   `grant_rate_card_edit`. If phase actuals expose internal cost, the *phase
   totals themselves* may need the same gating — this is an RLS design point,
   not a UI one.

---

## Scope sketch (subject to the answers above — do not treat as settled)

- **Migrations**: budget tables + `margin`/`contingency` at both levels +
  expenses, each with RLS, the `REVOKE ALL … FROM anon` shape from 0033, and a
  pgTAP suite carrying the standing
  `ok(NOT has_table_privilege('anon', …))` probe. **`RLS_TABLES` in
  `.github/workflows/rls.yml` (GIT ROOT) must gain every new table**, and any
  new suite file must also join the replay list at `rls.yml:114`.
- **`project_members.project_title`** — free text, distinct from
  `project_role`.
- **Adapter parity** — the budget must work on **local server and Supabase**,
  per Audrey's standing rule from the folder work. Add every new table to
  `supabaseAdapter`'s `COLUMN_ALLOWLIST` (S23) or the first invented field will
  PGRST204 the whole request.
- **Phases tab** reads the same `phases` the timeline does — one source, not a
  parallel list.
- **A computed phase-actuals rollup.** Decide deliberately whether it is a SQL
  view / generated column or client-side aggregation; a view keeps one
  definition of "actual cost" and is far harder to drift.
- **Tests.** There is still **no automated coverage of item creation**, which
  is how a total failure shipped unnoticed. Do not repeat that for money.
  Arithmetic this load-bearing deserves unit tests on the rollup and pgTAP on
  the policies.

---

## Traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** Write scripts to a file and run the file.
  **Prefer Write/Edit over shell heredocs** — a heredoc broke on quoting in S23.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** (S22): `REVOKE … FROM anon` is a
  silent no-op where the grant is held by `PUBLIC`.
- **`supabase db query --file` returns only the LAST result set.**
- **`sanitize()` is a denylist; `toColumns()` is the allowlist** (S23).
- **Ordering rules:** 0022 → 0025 AND 0026 · 0028 → 0031 · 0002 → 0029 ·
  0011 → 0030 · 0009 → 0020 · **0011 → 0033** (re-running 0011 silently undoes
  the entire S22 privilege sweep).
- **Run the whole pgTAP set before pushing a migration**, one suite per
  transaction; `collected` MUST equal `planned`. The shim has NO `has_index`,
  `col_type_is`, `col_default_is`, `col_not_null`, `results_eq` or `matches`.
- **Permissive RLS policies OR together** — replace by DROP + CREATE.
- **Numeric money**: use `numeric`, never float. Decide rounding once and
  write it down.

---

## Still owed by Audrey — blocking the v1.0.0 tag

1. **Rotate `smoke_admin`** — public repo, permanent in git history.
   `OWED_AUDREY.md` §0, TPN-SDLC-007. The one open CRITICAL.
2. **Rotate `wilson-staging`'s legacy `service_role` key.**
3. **Complete `docs/RELEASE_TESTING.md`.**
4. **v1.0.0 is prepared, NOT tagged, NOT merged.** Ask before tagging, and ask
   **again** before merging to `main`.

---

## Close-out ritual

Feature commit(s) → CI green (**all four jobs** — a skip is not green) → deploy
migrations dev → staging → prod (dry-run each, verify each **by query**) →
re-link CLI to `wilson-dev` → write the next session prompt → update
`docs/MASTER_PLAN.md` (§4 ledger, §6 gaps) and `MASTER_PLAN_S19_ONWARD.md` →
update `docs/SYSTEMS_HANDBOOK.md` if behaviour changed → **update
`docs/OUTSTANDING.md`** → update the Claude auto-memory → docs commit + push.
