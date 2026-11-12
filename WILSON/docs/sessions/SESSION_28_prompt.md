# SESSION 28 launch prompt — TASK TEMPLATES IN CLOUD + the verification sweep

> **STATE AFTER S27 (2026-08-04, `5384d4e` feature + `424bc6b` docs), so you do
> not re-measure it:** migrations run **0000–0043** on dev, staging and prod
> (next free number is **0044**); pgTAP is **53 suites / 808 assertions**;
> vitest is **680**. `public.files` has **29 columns**. `public.projects` has
> 50. All four CI jobs green on both commits, Playwright included.
>
> ✅ **The manifest can be rewritten.** 0042 added the UPDATE arm the
> `rabbit-files` bucket had never had. Before it, `PROJECT.json` was written
> ONCE per project and every later write was refused in silence.
>
> ✅ **Project rates travel with the project folder.** `FINANCE/RATES.json`,
> gated by `can_access_project_money` exactly as `INVOICES` is. Audrey chose
> this over leaving rates app-only (2026-08-04).
>
> 🚨 **`public.rabbit_money_segment(text)` IS THE ONLY DEFINITION of a
> money-gated path segment.** The three base storage policies negate it, the
> four money policies assert it. Adding a third reserved segment is a one-line
> change to that function — **do not** add a parallel set of policies, which is
> how 0038 inverted the invoice gate. It is NULL-safe on purpose: a path with
> no third segment (i.e. `PROJECT.json`) must classify as NOT money-gated, or
> the manifest becomes unreachable for everyone.
>
> ✅ **The folder tree now reconciles on load.** It had produced **zero rows on
> every environment** because its only caller was `createProject`.
>
> ✅ **Files reach every backend.** `FileManager` picks a store via
> `ctx.supportsManagedFiles`, **never** `window.electronAPI` — that test is
> true whenever WILSON is a desktop app *including in cloud mode*, which is
> exactly why files were unreachable from every entity surface. `files` now has
> a `COLUMN_ALLOWLIST` entry.

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`**
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence table is
>    the authority
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S27 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).
>    ⚠️ **The CLI actually reads `supabase/.temp/project-ref`**, a plain-text
>    file beside it. Both exist and currently agree. If they ever disagree the
>    CLI follows `project-ref` while the standing rule points you at the JSON —
>    check both.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

**S27's addition to the standing corollary — and it is a new failure mode, not
a repeat.**

S20 named the wrong migration number. S24 named `margin` when the column was
`budget_margin_pct`. S25 named `code` when the writer was `project_code`. S26
was given a *correct* citation for `files_dir` and the right answer was still
to add nothing, because the writer could not run on that backend.

S27 found something none of those would have caught: **a feature with no
caller has no symptom.** The 0041 folder tree was correct, verified by query,
covered by a 22-assertion pgTAP suite and green in CI — and it had produced
**zero rows on dev, staging and prod**, because `ensureProjectFoldersFor` was
only ever called by `createProject` and every project predates it. Nothing was
wrong. Nothing had run.

> **So the question is now three questions.** Who WRITES this field, CAN that
> writer run on this backend, and **is anything actually calling it?**

The cheap check is a census, not a code read: `SELECT count(*)` on the table
the feature populates, in the environment the user is in. It takes one query
and it is the only thing that distinguishes "built" from "working".

🚨 **AND IT APPLIES TO THIS SESSION'S OWN WORK.** Task templates have a dead
UI branch (see below). Creating the table and the adapter methods will make
every test pass and change nothing on screen, because the thing that would
call them is unreachable. **Finish by proving a template can be created and
applied**, not by proving the table exists.

**Label everything MEASURED / INFERRED / GUESSED.**

---

## 🚨 CITE SYMBOLS, NOT LINE NUMBERS — S27 broke its own citation

The first draft of this brief said the local task-template routes were at
`electron/main.cjs:2088-2131`. They are at **2609–2656**. The number came from
`OUTSTANDING.md`, written in S23 and correct then — and **S27 itself inserted
~70 lines into that file**, shifting everything below by hundreds.

Every line number in a document decays, and the sessions that edit a file are
the ones that invalidate its citations. Two habits:

- **Grep for the symbol** (`getTaskTemplatesDir`, `rabbit_money_segment`) and
  read the number off the result. Never copy one forward from a doc.
- **Re-verify any line number you are about to write into a document**, at the
  moment you write it, after your own edits.

---

## 🚨 THE VERIFICATION DEBT — do this FIRST, it is small and it is overdue

Three items have been carried for multiple sessions purely because **nothing
in this repo automates a signed-in session against staging.** They are all
closable by one person looking at one browser for a few minutes. S25, S26 and
S27 were each asked and none could.

**Do this before writing any code**, because two of the three might already be
fixed and you would otherwise build on top of an unknown.

1. **The two assignee dropdowns.** The stated cause was removed at CODE level
   in S24 (`listTeamMembers` on the Supabase adapter, and `loadProject` now
   returning `teamAssignments` — read at `TimelineView.jsx` ~`:183`/`:357` and
   `ProjectAssetsView.jsx` ~`:1648-1659`; **grep `teamAssignments`, do not
   trust those numbers**). Nobody has watched them populate. **One look at the
   Timeline task editor on the beta closes it.**
2. **Files in cloud mode — all of S27 is unobserved.** FileManager serving
   `public.files`, the Resources drop zone, the folder/manifest panel and the
   rates mirror are code-complete and **have never been exercised by a
   signed-in user.** Upload one file to an asset on the beta; it should
   appear, download, and show up in Resources → PROJECTS → that project.
   Change a project rate and confirm a `FINANCE/RATES.json` object appears.
3. **The `canWrite` gate.** Read `OUTSTANDING.md`'s entry IN FULL before
   touching it. Exactly one theory is refuted (on code); the other rests on
   testimony. 🚨 **Audrey runs two accounts in two browsers at the same time.**
   Never ask "which account are you on" in general — pin it to the specific
   browser AND the specific moment. An account assumption has derailed this
   one investigation twice, from opposite directions. **Do not write a fix.**

---

## S28 — task templates in cloud

**The oldest open item on the list.** Deferred by S25 and S26 because those
sessions ran out of room, and by S27 because Audrey was asked directly and
chose to finish the file layer instead. It is not a missing adapter method.

### MEASURED starting position (2026-08-04, re-read this session)

**Local Server** — `electron/main.cjs:2609-2656`, five routes over one flat
directory, `<rabbitDataDir>/task-templates/`, one JSON file per template:

| route | behaviour |
|---|---|
| `GET /workspaces/:workspaceId/task-templates` | every template whose `workspace_id` matches |
| `GET /projects/:projectId/task-templates` | every template with **no** `project_id` **or** a matching one |
| `POST /workspaces/:workspaceId/task-templates` | stamps `workspace_id`; the body may carry `project_id` |
| `PATCH /task-templates/:id` | whole-row merge |
| `DELETE /task-templates/:id` | unlinks the file |

Two things fall out of that, and both shape the schema:

- **A template is EITHER global to the workspace OR pinned to one project** —
  `project_id` nullable, not a separate table or a join.
- 🚨 **The project-scoped read is NOT workspace-filtered.** `GET
  /projects/:id/task-templates` filters on `project_id` alone, so it would
  return another workspace's global templates. Harmless on a single-tenant
  local server and **a tenancy leak in cloud** — so do not port the predicate,
  port the intent. The cloud read must add the workspace scope the local route
  omits.

**Cloud** — `listProjectTaskTemplates` / `listTaskTemplates` have **zero
occurrences** in `supabaseAdapter.js`, so `useTaskTemplates` returns `[]` and
the New Asset dialog's Task Template dropdown is permanently empty.

**The dead branch, and it is TWO sites not one.** `ProjectAssetsView.jsx`
applies a template in two places — the create-with-template path (~`:1390-1435`)
and apply-to-existing-asset (~`:1710-1742`). Both build a task with
`role_slug: tmplTask.role_slug`.

🚨 **`role_slug` is not a column on `tasks`.** `TASK_COLUMNS`
(`supabaseAdapter.js:179`) has **`assigned_role_slug`**. So this is NOT a
PGRST204 that kills the request — `toColumns` **drops the key and warns**, and
the task is created successfully **with no role on it**. A quieter failure
than the S23 one, and it will not announce itself: the tasks appear, the roles
are simply missing, and every bid built from them is priced at nothing. Fix
**both** sites when the branch comes alive, not before.

`task_template_id` is deliberately **dropped by the allowlist** rather than
given a column, because a column for a feature with no cloud implementation is
schema debt. It arrives WITH the feature — and note the second site writes it
onto the ASSET (`ctx.updateAsset(asset.id, { task_template_id })`), so
`ASSET_COLUMNS` needs it too, not just `tasks`.

### ⚠️ THE ONE THING TO SETTLE BEFORE WRITING SQL — ask Audrey

**Who may create, edit and delete a task template?** This is **not** derivable
from the code: the local server has no roles at all, so its routes are open by
construction and tell you nothing about intent.

An earlier draft of this brief asserted the answer ("`can_write_project` is
the wrong gate, a template is not project content"). **That was a guess
presented as a finding, in a document whose entire purpose is to stop exactly
that** — and it is probably wrong, because the measured shape shows templates
*can* be pinned to a single project, which makes those ones project content.

What is actually known:
- Templates are workspace-level assets with an optional project pin, like rate
  cards with a narrower scope.
- Audrey has already settled the analogous question for money (project manager
  **or** workspace admin), and separately for the control panel (managers and
  reviewers, not members) — and 🚨 **those two answers are different**, so
  there is no house default to fall back on.

→ **Ask, then write the pgTAP probes for the NON-privileged case first.**

### What it needs — size it as its own block

A table, its own RLS, its own pgTAP suite (**54**), five adapter methods, a
`COLUMN_ALLOWLIST` entry, and `ASSET_COLUMNS` gaining `task_template_id`. Plus
**two** places in `.github/workflows/rls.yml`: `RLS_TABLES` (fails loudly) and
the failure-replay list (fails **silently**).

Decide early whether the template's TASKS are a second table or a JSONB column
on the template. The local store is one JSON document per template, so a JSONB
column is the faithful port; a child table is the faithful *schema*. Either is
defensible — **write down which and why**, because the next session will
otherwise assume the other one.

---

## Carried, and NOT to be guessed at

- **O.T.T.E.R. validator findings and quiz scores are not saved.** MEASURED,
  known #2, untouched for many sessions. Both generate correctly and neither
  persists, so the work is lost on navigation.
- **One hung `getSession()` pins the whole app's auth**, and `withTimeout`
  races without aborting. Bounding N call sites fixes N UIs, **not the app**.
  The real fix is probably an app-level circuit-breaker or forced re-hydrate.
  **Design it before writing it.**
- **Avatar does not persist.** Four hypotheses falsified by measurement; the
  success-masking is fixed so a failure is now loud. If it recurs, capture the
  message. The one candidate not excluded is whether the Storage API populates
  `request.jwt.claims` with `app_metadata` at all.
- **Welcome page phantom cursor.** REPORTED. Likely `AuthCursor` in
  `AuthShell.jsx` — **that is a guess, confirm in the DOM first.**

---

## Standing traps

- 🚨 **NEVER run `supabase config push`**, and never build a shell command by
  interpolating content into it. Write scripts to a file and run the file.
- 🚨 **`Set-Content -Encoding utf8` in PowerShell 5.1 writes a BOM.** S27 lost
  time to a CLI refusing a BOM'd config file it had written itself. Use the
  Write tool for files another program will parse.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** (S22).
- **`supabase db query --file` returns only the LAST result set.** One query
  per file.
- **`sanitize()` is a denylist; `toColumns()` is the allowlist.** Any new table
  written from the client needs a `COLUMN_ALLOWLIST` entry. 🚨 **A dropped key
  WARNS and continues; an un-allowlisted TABLE PGRST204s the whole request.**
  Those are different failures — the first loses one field silently (see
  `role_slug` above), the second loses the entire save.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · 0009 → 0020 · 0011 → 0033 · **0027 → 0038 →
  0039 → 0042** · 0040 → 0041 → **0043**. **Replay forwards only.**
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set** in one command.
  `collected` MUST equal `planned`.
- **`scripts/tap-hosted.py` can run an UNAPPLIED migration together with its
  suite** in one rolled-back transaction — the safe way to iterate. The shim
  has NO `has_index`, `col_type_is`, `col_default_is`, `col_not_null`,
  `results_eq` or `matches`; `throws_ok` matches **message text**.
- 🚨 **Prove a new suite by BREAKING it.** S27 ran three deliberate breakers
  against 0042 (drop the UPDATE policy; gate INVOICES but forget FINANCE; drop
  the coalesce) and a fourth against 0043 (CASCADE instead of SET NULL). Each
  failed exactly the probe it should. A suite that has only ever passed is a
  suite you have not tested.
- **Permissive RLS policies OR together** — DROP + CREATE, never add a
  narrower policy beside a broader one.
- 🚨 **THREE GREEN CI JOBS CAN MEAN NOTHING. Playwright is the only one that
  proves the app RENDERS.** Nothing in vitest mounts `RabbitProvider`, a TDZ
  error bundles fine, and there is no eslint config. A dependency array is
  evaluated DURING RENDER — declaring a `useCallback` below something that
  names it in its deps blanks the whole app. If Playwright fails, check
  `document.getElementById('root').children.length` against the dev server.
  **`RabbitProvider` wraps the entire tree including the unauthenticated
  branch, so the login screen rendering IS evidence it did not throw.**
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S21, S22, S24, S25,
  S26 and S27 each corrected it. Check the code.

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

1. Apply migrations to **dev**, verify **by query**, run `tap-all`.
2. Feature commit(s).
3. Apply to **staging**, then **prod** — dry-run each, verify each **by
   query**. ⚠️ **Staging goes BEFORE the push**: `feat/multi-user-v1`
   auto-deploys the STAGING-backed beta, so code that needs a migration would
   otherwise hit a beta that does not have it.
4. Push → **CI green on all four jobs** (a skip is not green, and neither is
   three-out-of-four).
5. Re-link the CLI to `wilson-dev`.
6. Write `docs/sessions/SESSION_29_prompt.md` → update `docs/MASTER_PLAN.md`
   and `MASTER_PLAN_S19_ONWARD.md` → update `docs/SYSTEMS_HANDBOOK.md` if
   behaviour changed → **update `docs/OUTSTANDING.md`** → update the Claude
   auto-memory → docs commit + push.

> **THEN, FINALLY, IN THE CHAT — both required, after everything is pushed:**
>
> 1. **List the remaining sessions**, one line each, a few words only, marking
>    any that are done. If the order changed, say so.
> 2. **A layman's breakdown of what this session accomplished**, in bullet
>    points, plain English. **No jargon, no table names, no migration numbers,
>    no file paths.** Write what CHANGED FOR AUDREY, not what was done to the
>    code. Say plainly what is fixed, what is only diagnosed, and what she
>    needs to do herself.
