# SESSION 24 launch prompt — the budget system

> **Moved forward from S27 (Audrey, 2026-08-03).** The budget depends on none
> of the folder/scene chain, and it is the one gap that stops R.A.B.B.I.T.
> being usable for the job it exists to do — there is no bid, no actuals, no
> margin, and rates cannot be overridden per project. Folders are painful; a
> budget you cannot record is a system you cannot run a production on.

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

## THE MODEL — Audrey's spec, 2026-08-03. Read this before the older list below.

**A production budget has THREE STATES, and they are computed in genuinely
different ways. This is the central fact of the session; treating them as one
table with a status column will produce the wrong system.**

### 1. BID — estimated cost
- `rate × days assigned`, plus all expenses on the project.
- 🚨 **Tasks must be creatable and costable BEFORE real people exist.** The
  producer assigns each task to a **ROLE from the rate card**, not a person.
  There must be a dropdown of the roles a project can have, sourced from the
  rate card, writing the task's assigned-role value.
- The system sums those into the bid.
- **Talent is NOT modelled through tasks.** Talent days are typed directly into
  the budget view.

**MEASURED — this is nearly schema-complete already:**
`rate_card_entries.role_label` and `.role_slug` are both **NOT NULL**, and
`tasks.assigned_role_slug` / `.assigned_position` already exist. So the bid
line is `tasks.bid_days × rate_card_entries.day_rate` joined on
`assigned_role_slug`. `member_id` on an entry is **nullable**, which is what
lets one card hold both role rates (no member) and person rates (member set).

### 2. ACTUAL — what it really cost
Computed a completely different way, **per pay period**, per line item:
- **Freelancers / external:** the production team manually enters each
  invoice total into that line item's actual cell for the pay period.
- **Internal staff:** a **timecard / time-tracking system that does not exist
  yet**. Audrey: *"this is for after we finish all our sessions."* At the end
  of each pay period its totals will be written into the matching cell.
  **Design the actuals store so that system can fill it later; do NOT build
  time tracking in this session.**

→ Actuals need a **line-item × pay-period grid**, not a single number.

### 3. FINAL — the simplest
A final version of the actual budget once the project is done, for the team to
review total cost, profit, and so on.

---

### The Team tab splits in two

1. **Actual team** — the real people and their details.
2. **Bid estimated team** — every ROLE assigned to a task during the bid, with
   rates pulled from the rate card.

As a project moves toward being awarded, the manager progressively replaces
roles with real people **in the bid view**, and the numbers move with it:
- The manager can **see and edit the rate for each team member**.
- Each rate **defaults from the rate card, by that person's role**.
- If a person's role is blank (it shouldn't be) the rate is blank and the
  manager types it in.
- **Assigning a real person to a project role switches that line to the
  person's INTERNAL rate.** The external/day rate is mainly a *bidding*
  instrument.
- Totals therefore change as real people land — *"latter is not always true"*,
  i.e. do not assume the bid and the staffed estimate agree.

### 🚨 Rate edits inside a project are PROJECT-SCOPED

Audrey, twice, for both real people and bid roles:

> *"when a manager makes a change on the rate card in a project that is going to
> be project specific meaning the managers change should not change the internal
> rate card. some projects will have different rates for people."*

**A rate edited inside a project must never write back to the workspace rate
card.** This is the single most important schema consequence in the session:
`rate_cards` / `rate_card_entries` are workspace-level, so the project needs
its own override layer — keyed by **role_slug** (bid) and by **member_id**
(staffed), resolving as: project override → rate card → blank.

Get this wrong in the obvious way (editing the shared card) and one project's
negotiated rate silently rewrites every other project's numbers. That is a
data-integrity failure that would be very hard to notice and impossible to
reconstruct afterwards.

---

## What Audrey asked for first (2026-08-03) — the tab-level asks

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

## ANSWERED by Audrey (2026-08-03) — do not re-ask

- **Which rate prices a task?** BID uses the **role's rate from the rate card**
  (external/day rate — "the external rate is mainly just used for bidding").
  Once a real person is assigned, the line switches to that person's
  **INTERNAL** rate. So both cards are in play, at different stages.
- **Which days for the bid?** `bid_days` × the role's rate card rate.
- **Actuals do NOT come from `logged_days`.** They are entered per pay period —
  manually from invoices for external people, and later automatically from a
  timecard system that will be built **after** all currently planned sessions.
  This removes time-capture from this session's scope.
- **Talent** is not modelled through tasks; its days are typed directly into
  the budget view.

## ANSWERED, round 2 (Audrey, 2026-08-03)

### Pay cadence — the selector already exists, and it also cannot save
**MEASURED.** `ProjectSummaryView.jsx:669` offers
`ACTUALS_MODE_OPTIONS = ['fortnightly', 'weekly', 'count']`, written to
`project.budget_actual_column_mode` and read by `BudgetView.jsx:638`,
`CrewTeamTab.jsx:259` and `TalentTab.jsx:308` (all defaulting to
`'fortnightly'`).

🚨 **`projects.budget_actual_column_mode` does NOT exist in the cloud schema.**
`projects` has 22 columns and that is not one of them. So the cadence dropdown
is the same defect as the contingency percentage: it renders, it accepts a
choice, and there is nowhere to persist it. Use the existing three-option
vocabulary — do not invent a new one — and add the column.

`'count'` is the odd one out and is not a time cadence at all; establish what
it means (a fixed number of unlabelled columns?) before building period
boundaries around it.

### The financial model — margin IS the profit
Audrey, verbatim in substance:
- **The bid has margin and contingency baked into EVERY LINE ITEM**, not
  applied once at the bottom.
- **Actual cost to the company** = the total of all line items **minus** the
  margin and contingency that were added.
- **Profit** = bid total (the targeted budget) − actual final cost.
- **FINAL** is a **locked snapshot**, surfaced as a view inside the project.

Consequences to design for, and they are not cosmetic:
- A line item must store enough to reconstruct **base cost**, **contingency**
  and **margin** separately. If only the marked-up total is stored, "actual
  cost to the company" cannot be recovered and profit becomes underivable.
- The snapshot must be **immutable** once taken, and record who took it and
  when — a "final" that silently drifts is worse than no final.
- Store the percentages **as applied at the time** on the snapshot. If they are
  only ever read live from the project, changing a default later would rewrite
  history.

### 🚨 Money is manager-only, and this is an RLS requirement
Audrey, verbatim in substance: *"only managers should see anything relating to
money. so actuals, bids, rates, etc. reviewers and team members should not see
financial values anywhere AND should have NO ACCESS to the project control
panel."*

**This cannot be done by hiding UI.** Every R.A.B.B.I.T. table is reachable
through PostgREST with the caller's own JWT — a team member who opens devtools
can read any row RLS permits, whatever the React renders. So:
- Budget, expense, rate-override and actuals tables need **RLS policies that
  deny non-managers outright**, not just components that skip rendering.
- Any **phase/task rollup that exposes cost** is itself financial data and
  needs the same gating. A total is not less sensitive than its parts.
- The project control panel needs a route-level gate as well as a hidden nav
  entry.

**Open sub-question — WHICH manager?** "Reviewers and team members" are
*project* roles (`project_members.project_role` ∈ manager/member/reviewer), so
this most likely means `project_role = 'manager'`. But `workspace_members.app_role`
also has `admin`/`manager`. Is a workspace admin who holds no project seat
allowed to see a project's money? Confirm before writing the policy — this is
exactly the kind of "obvious" assumption that S22 and S23 both proved wrong.

**Also reconcile with what already exists:** `workspace_members` carries
`grant_rate_card_view` and `grant_rate_card_edit` (0015), which today gate rate
visibility independently of any project role. Does the new manager-only rule
**supersede** those flags, or layer with them? Two overlapping permission
systems for the same data is how the 0011 privilege spread happened.

## STILL OPEN — put these to Audrey before building

1. ~~"timecard" vs "rate card"~~ — Audrey: *"fine for now"*. Proceed on **rate
   card**; the timecard system does not exist yet.
2. **What does the `'count'` cadence option mean?** (see above)
3. **Does a workspace admin without a project seat count as a "manager" for
   money?** (see above)
4. **Do BID and ACTUAL both carry expenses**, and are they the same expense
   rows (estimated vs actual columns on one row) or two separate sets?
5. **When a real person replaces a role on a bid line** — does the role line
   convert in place, or does the person sit alongside it so the original bid
   stays comparable? This decides whether bid history survives staffing.
6. **Bid versioning.** main's local bundle had `budgetVersions`. Do bids need
   revisions (v1, v2, "client asked for a cheaper option")?
7. **Margin and contingency — order of application.** On cost, on
   cost + contingency, or each independently? A budget that applies these in
   the wrong order is wrong in a way nobody notices for months.
8. **Default percentages — fallback or seed?** If a project inherits the
   company default, does changing the default later move existing projects
   (fallback) or not (seed copied at creation)? This decides the schema.
9. **Are rates confidential?** `rate_cards.type='internal'` carries wages, and
   `workspace_members` already has `grant_rate_card_view` /
   `grant_rate_card_edit`. If actuals and phase totals expose internal cost,
   **those totals need the same gating** — an RLS design point, not a UI one.
   This matters more now that actuals are per-person invoice totals.

---

## Scope sketch (subject to the answers above — do not treat as settled)

- **Migrations**: budget tables + `margin`/`contingency` at both levels +
  expenses, each with RLS, the `REVOKE ALL … FROM anon` shape from 0033, and a
  pgTAP suite carrying the standing
  `ok(NOT has_table_privilege('anon', …))` probe. **`RLS_TABLES` in
  `.github/workflows/rls.yml` (GIT ROOT) must gain every new table**, and any
  new suite file must also join the replay list at `rls.yml:114`.
- **A PROJECT-SCOPED rate override table** — the one non-obvious table. Keyed
  by `role_slug` for bid lines and `member_id` for staffed lines, resolving
  project override → workspace rate card → blank. Without it, a manager
  negotiating one project's rate silently rewrites every other project.
- **An actuals grid**: line item × pay period, with the cell as the unit of
  storage. Built so the future timecard system can write internal totals into
  the same cells the production team types external invoice totals into.
- **Three states, not one flag.** Bid and actual are computed from different
  inputs by different people at different times; final is a review of actual.
  Model them so a bid can be revised without touching actuals, and so actuals
  can accrue per period without disturbing the bid.
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

> **THEN, FINALLY, IN THE CHAT — both required, after everything is pushed:**
>
> 1. **List the remaining sessions**, one line each, a few words only, marking
>    any that are done. If the order changed, say so.
> 2. **A layman's breakdown of what this session accomplished**, in bullet
>    points, plain English. **No jargon, no table names, no migration numbers,
>    no file paths.** Write what CHANGED FOR AUDREY, not what was done to the
>    code — "you can create tasks again, every one you made before tonight was
>    silently failing", not "dropped the NOT NULL on tasks.asset_id". Say
>    plainly what is fixed, what is only diagnosed, and what she needs to do
>    herself. The technical record is already in the commits; this is the part
>    she actually reads.
