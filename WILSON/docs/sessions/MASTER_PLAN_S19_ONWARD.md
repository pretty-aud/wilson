# WILSON — Master plan, Session 19 onward

Written 2026-08-01, at the end of S18, from Audrey's first real testing pass.

`docs/MASTER_PLAN.md` is the historical record (§4 ledger, §6 gap dispositions)
and stays canonical for anything already shipped. **This file is the forward
plan** and is superseded by each session's own close-out.

---

## How to read this

Every claim below is tagged. The distinction is load-bearing — S17 lost an hour
to acting on plausible theories, and the rule that came out of it
(`feedback_prove_before_acting.md`) is that a theory earns a measurement, never
a commit.

- **MEASURED** — verified against the code, the database, or Anthropic's docs.
  Cited so you can re-check it.
- **INFERRED** — strongly supported by code reading, not yet observed failing.
  Each one names the artifact that would settle it.
- **UNKNOWN** — reported by Audrey, not yet diagnosed. Do not plan a fix around
  a cause; plan a diagnosis.

---

> **STATUS 2026-08-02 — the outage is over.** S19 shipped and Block E passed
> 4/4 against staging. The diagnosis below was confirmed by direct measurement:
> `claude-sonnet-4-20250514` returns `404 not_found_error` while
> `claude-haiku-4-5-20251001` returns 200 on the same call. Everything now
> resolves through the registry. The rest of this section is kept as the record
> of how it was reasoned about — including the parts it got wrong, which are
> marked in the S19 block below.

## The headline: WILSON's AI has been down for 47 days

**MEASURED.** Anthropic retired `claude-sonnet-4-20250514` on **2026-06-15**
(`platform.claude.com/docs/en/about-claude/model-deprecations`, "Model status"
table: *Retired*). Their wording: *"Requests to retired models will fail."*

WILSON hardcodes that ID at **17 call sites**. Every one has failed since that
date:

| Tool | Dead | Alive |
|---|---|---|
| D.O.G. | full deck, single page, regenerate page, image prompts | themes, text rewrite ×2, visual description |
| O.T.T.E.R. | course, subject content, single subject, both agent variants, validator | quiz |
| R.A.B.B.I.T. | intake for script, treatment, gdd, brief, pitch bible, lookbook | classifier, intake for deck/outline/notes/other |
| Assistant | agent chat | pet companion |

Everything in the "Alive" column is on `claude-haiku-4-5-20251001`, which is
**Active** (retirement not before 2026-10-15). That asymmetry is the diagnosis:
it is not a key problem, a proxy problem, or a WILSON bug. It is a date that
passed.

**Falsifiable prediction** — every "Alive" item works today; every "Dead" one
does not. D.O.G.'s theme generator working while full-deck generation fails
confirms it in about thirty seconds.

**Why nobody noticed for 47 days.** Not carelessness — there was nowhere to
look. No inventory of which model ran what, no surface that displayed it, and
the failure reached the user as a generic "try again". S19 and S20 exist to
make that specific blindness impossible rather than merely to swap a string.

### What was checked and found clean

Recorded so nobody re-investigates:

- **MEASURED** — no `temperature`, `top_p`, `top_k` or `budget_tokens` anywhere
  in `src/` or `supabase/functions/`. These 400 on current models; their absence
  is why the migration is close to a find-and-replace.
- **MEASURED** — no trailing assistant prefills. Every `role: 'assistant'` is
  mid-history or UI state, not a prefill. Prefills 400 on current models.
- **MEASURED** — `operator-ai-keys` validates with
  `VALIDATION_MODEL = 'claude-haiku-4-5-20251001'`, which is active. **The
  operator console's "Set key" flow is not also broken.** Worth stating: it was
  a reasonable worry and it is wrong.

---

## Decisions taken (Audrey, 2026-08-01)

| # | Decision |
|---|---|
| D1 | Model choice is **per function**, not per tool — all 28 call sites individually selectable. |
| D2 | Three-tier resolution: **user override → workspace override → platform default → built-in**. |
| D3 | Both admin surfaces: the **operator console** sets platform defaults; **Admin Terminal** lets a company admin override. |
| D4 | 🔑 **Company admins and users may only choose from models the WILSON operator has approved.** Free-text entry is operator-only. Everyone else gets a picker. |
| D5 | A new model ID is entered as free text by the operator and **validated against Anthropic before it can be saved**. |
| D6 | A dead or invalid configured model **falls back to a working one and warns**, naming the function. It never fails silently. |
| D7 | R.A.B.B.I.T. intake stays **per document type** (10 settings) — `MODEL_MATRIX` already works that way, and collapsing it would remove capability. |

**D4 is the one with teeth.** It means the catalogue of usable models is a
platform-level asset, and a company admin cannot put every generation on the
most expensive model available. Admins pick *from a list*; they do not type
model IDs.

---

## Session plan

Seven sessions. Audrey's original ask was "no more than 6" — that was before
per-function model selection was added as a feature. **S21–S25 are the five
sessions covering the original list; S19–S20 are the two for the new feature.**

Sessions are ordered by *what unblocks the most*, not by difficulty.

---

### S19 — Unblock the AI outage ✅ COMPLETE (2026-08-02)

**Goal: every tool generates again.** Achieved and measured end to end.

| Block | Work | Status |
|---|---|---|
| A ✅ | `src/lib/aiModels.js` — the registry: 28 functions, three-tier resolution, retired-model detection, loud fallback. | Done, committed with this plan |
| B ✅ | All 28 call sites now `modelFor(key)`. Six files. `MODEL_MATRIX` → `MODEL_KEYS`. | `8a73d44` |
| C ✅ | `activeModel.js` + `ModelWarningBanner` — loud fallback per D6. | `8a73d44` |
| D ✅ | `noHardcodedModels.test.js`. **Proven by breaking it three ways**, not by watching it pass. | `8a73d44` |
| E ✅ | Four full-size generations, checked the way WILSON parses them. **4/4.** | `scripts/probes/generation-e2e.mjs` |

**Exit criteria met.** Final Block E run, staging, `claude-sonnet-5`:

```
D.O.G. full deck       end_turn  out=6676  59.1s  12 slides parsed
O.T.T.E.R. outline     end_turn  out=2521  24.0s   9 subjects
O.T.T.E.R. + search    end_turn  out=3658  37.6s   JSON parsed
R.A.B.B.I.T. intake    end_turn  out=3283  31.0s   7 assets, 10 tasks
```

441 vitest (was 416: +15 activeModel, +5 guard, +5 tuning). Build clean.

#### The plan's framing was wrong, and the probe is why that was cheap

This file called the migration "close to a find-and-replace" and listed three
things as "checked and found clean". Reading Anthropic's current API reference
turned up three risks it missed, and **a probe settled all three before any of
them was acted on** (`scripts/probes/ai-models.mjs`):

| Risk | Verdict |
|---|---|
| O.T.T.E.R.'s `web_search_20250305` + old beta header predate sonnet-5 | **REFUTED.** 200 with and without the header, and with the new tool version. Five working call sites would have been rewritten for nothing. |
| The Validator's `tool_use` recursion ends on an assistant turn | **CONFIRMED.** 400: *"This model does not support assistant message prefill."* Fixed in `dab9046`. |
| Adaptive thinking eats the `max_tokens` budget | **Half right, and the wrong half.** It costs *latency*, not truncation — and the truncation it does cause D.O.G. already handles. |

**MEASURED — `ai-proxy` whitelisted the upstream body** to
`model/max_tokens/messages/stream/system/tools`, silently dropping `thinking`
and `output_config`. That is why the first probe's own "thinking is fine"
control was not a control at all. S19 added both fields (`d1046b9`).

**MEASURED — full-deck latency**, same prompt, same 16384 budget, one run:

| | seconds | tokens | slides |
|---|---|---|---|
| no effort field | 137.9 | 15194 | 14 |
| `thinking: disabled` | 51.8 | 5443 | 11 |
| `effort: low` | 57.5 | 6549 | 12 |
| **`effort: medium`** ← chosen | **69.1** | **7642** | **13** |

`ai-proxy` runs on an Edge Function with a **~150s deadline**, and a call that
overruns loses its stream rather than degrading. 137.9s was inside it but not
by enough to depend on — and at 15194 of 16384 tokens it was one long deck
from triggering the continuation loop and paying that four times over. `medium`
lives on the REGISTRY entry via `tuningFor(key)`, with the numbers beside it.

> ✅ **RESOLVED — this warning is obsolete (MEASURED 2026-08-03, S21).** All
> three environments run **byte-identical** `ai-proxy` source, matching the
> repo's HEAD: `index.ts` plus all four `_shared/` files compare equal on dev,
> staging and prod. The forwarding is present in that source
> (`ai-proxy/index.ts:239` `thinking`, `:251-254` `output_config.effort`).
>
> Verified by downloading each deployment into a throwaway `--workdir` and
> diffing — **not** by reading the version numbers, which are per-project deploy
> counters (prod v6, dev/staging v8) and say nothing about whether the code
> matches. Nothing to deploy.

> ⚠️ **The guard test in Block D was the point of the session.** A hardcoded
> model ID can no longer reach `main`, nor can a `modelFor()` key that is not
> in the registry, nor a retired `VALIDATION_MODEL` in `operator-ai-keys`.

---

### S20 — The model control plane ✅ COMPLETE (2026-08-02, `6e422d2`)

**Goal: Audrey adds a model in one place, and every company can use it.**

| Block | Work | Status |
|---|---|---|
| A ✅ | **Migration 0031** — `platform_approved_models`, `platform_model_defaults`, `workspace_model_overrides`, **and `user_model_overrides`**. | Done |
| B ✅ | Edge Function `operator-models`: list / approve / retire / restore / set_default / clear_default, with D5 validation. | Done, deployed to dev |
| C ✅ | Operator console → **Models**: catalogue (free text + validate) and the 28 platform defaults. | Done |
| D ✅ | Admin Terminal → **Models**: company overrides from a restricted picker. | Done |
| E ✅ | `SYSTEM SETTINGS` → **Models** tab: per-user overrides showing the inherited tier, plus `modelSources.js` and the localStorage migration. | Done |
| F ✅ | pgTAP **39–42**, one per table. | 42/42 suites |

**Exit criteria met.** 42/42 pgTAP (`collected == planned` in each; was 38
suites, +55 assertions), 472 vitest (was 454), both vite entries build clean.

#### Five things this plan got wrong, found before they cost anything

| The plan said | What was true |
|---|---|
| "Migration 0032" | There is no 0031 — the chain ran 0000–0030 contiguously. Numbered **0031** (Audrey's call). |
| Three tables | **Four.** Block E says "migrate `userModelPrefs` into the user tier" and Block A never listed a user table. It had nowhere to land. |
| "pgTAP suite 39" (singular) | CI's coverage guard globs `supabase/tests/rls/*_<table>.sql`, so four tables need **four files**. One suite cannot satisfy it. The hardcoded failure-replay list at `rls.yml:112` needed extending too — S17's own comment records suites 33–38 failing **invisibly** for exactly that reason. |
| "reuses the proven `validateKey` call shape" | The **body** is the same; the **status handling is inverted**. `validateKey` validates a KEY and returns ok for anything that is not 401/403 — *including a 404* — because an unknown model with a good key still proves the key works. Validating a MODEL makes 404 the refuse signal. Copying it wholesale would have made D5 accept every typo. |
| "Follows the `workspace_ai_keys` precedent" in the same sentence as "companies **read** the catalogue" | Incompatible. `workspace_ai_keys` is zero-policy, `REVOKE ALL FROM anon, authenticated` — readable by nobody. The catalogue needed the **first unscoped `USING (true)` read policy in the schema**. Stated in 0031's header because it looks like a mistake and is not. |

#### What review caught that testing would not have

- **`setModelSources` replaced all three tiers.** Correct when localStorage was
  the only writer; with three async loaders a `setModelSources({ workspace })`
  silently blanks the user's own choices, and nothing complains — resolution
  just falls through and generates with the wrong model. `updateModelSource`
  replaces one tier. Proven by breaking it and watching five tests fail.
- **The async-load window.** `resolveModel` warns when a *configured* model is
  rejected; an *absent* tier is not a misconfiguration, so it returns
  `warning: null`. A generation fired before the queries land uses the built-in
  floor and says nothing. localStorage is now a **cache** hydrated
  synchronously in `main.jsx`, not the source of truth.
- **Effort had no delivery path.** `tuningFor(key)` read only the REGISTRY entry
  and is spread at exactly ONE call site (`DeckOutlineGenerator.jsx:1752`). An
  operator control for all 28 would have been 27 settings that save, display and
  do nothing. `carriesEffort` marks the ones that work; `activeModel.tuningFor`
  now prefers the stored value.

> Why `POST /v1/messages` and not `GET /v1/models/{id}` for validation: the POST
> shape is already proven in this codebase. The Models API's error semantics for
> an unknown ID have **not** been verified here. Reusing a proven call beats a
> plausible one.

> **Migration 0031 is applied to dev and staging** (2026-08-02), each verified
> after apply with the same seven-check query rather than trusting the CLI's
> success line. `operator-models` is deployed to both. **Prod has neither** —
> apply 0031 and deploy the function there when you are ready.
> Staging was migrated before the push deliberately: `feat/multi-user-v1`
> auto-deploys the **STAGING-backed** beta host, and without the tables the new
> Models surfaces render "no models available" — honest, but it reads as broken.

---

### S21 — Data correctness and the reliability sweep ✅ DONE (`10fcd29`, 2026-08-02)

**Goal: the settings and rate-card surfaces stop lying.**

> **Outcome, and the three places this plan was wrong.** All four items landed;
> migration **0032** (not 0033 — S20 took 0031) is applied and verified on dev,
> staging and prod, as are 0031 and `operator-models`, which finally reached
> prod this session.
>
> 1. **"Migration 0033"** — wrong here and in `OUTSTANDING.md`; the chain is
>    contiguous and the next number was 0032. Only `SESSION_21_prompt.md` had it
>    right.
> 2. **"18 call sites"** below is wrong twice over. S20 had already corrected it
>    to 26. The deeper error is the *unit*: supabase-js awaits `getSession()`
>    inside `_getAccessToken()` for every PostgREST call, so counting explicit
>    `.auth.getSession()` occurrences understates the class by an order of
>    magnitude — and `withTimeout` races without aborting, so a bounded-but-
>    abandoned call still holds auth-js's global lock. **The sweep this plan
>    asked for would have gone green and left the app just as stuck.** It was
>    not done; the two reachable defects were fixed instead and the real
>    constraint is recorded in `OUTSTANDING.md`.
> 3. **"C — likely the same effect as B"** — false, and provably so. If the load
>    hangs, the component early-returns "Loading profile…" and the avatar
>    controls never mount, so no upload can start. The two are disjoint.
>
> One thing the plan did not anticipate at all: adding the column **unlocks** an
> auto-create race that cloud mode had been accidentally braking, and the
> pgTAP suite's standing `anon` assertion failed, exposing that `anon` holds ALL
> privileges on 26 of 36 public tables. Both are in `OUTSTANDING.md`.

**A. `rate_cards.type` does not exist — MEASURED.** Queried staging:

```
id, workspace_id, name, source_file_id, is_default, created_at,
last_updated_by, last_updated_at, deleted_at, deleted_by,
created_by, updated_by, updated_at
```

`useRateCard.js` reads and writes `c.type === 'general' | 'internal'`. The whole
internal-vs-general feature keys on a column never added to the cloud schema.
**One root cause, two of Audrey's reports** (the "type column" error, and being
unable to reach the internal card). `rate_card_entries` is fine — it already has
`burden_type`, `overhead_type`, `wage`, `member_id`, `department`.
→ Migration 0033: add `type`, backfill existing rows to `'general'`, pgTAP suite.

**B. The unbounded `getSession()` class — INFERRED.** 18 call sites; only 4
files use `withTimeout`, all of them the auth screens S17 fixed. S17 fixed the
symptom on two screens and never swept the class. `ProfileSection.jsx:66` awaits
`getSession()` inside a `Promise.all` with no ceiling — if it never resolves,
`setLoading(false)` never runs and the panel spins forever, which matches
"loading profile and then never loads anything".

> **Settle it before fixing it.** Open the stuck Profile panel, devtools →
> Network. If a `workspace_members` request appears and returns 200 while the UI
> still says loading, the fault is after the await and this is confirmed.
> `aiProxy.js:65` is on the same unbounded list and sits on the path of every AI
> call — worth bounding regardless.

**C.** Avatar not persisting — likely the same effect as B; re-check after.
**D.** Restore password change in `SYSTEM SETTINGS`. S15 deleted the panel
because it drove a dead local-credential route (§6 #32); the copy now tells
users to go to the sign-in screen. Wire it to Supabase properly.

---

### S22 — Storage, connections, and the privilege sweep ✅ DONE (`494a13d`, `8709b1e`, 2026-08-03)

**Shipped, all verified by query on dev, staging AND prod:**

- **Migration 0033 — the anon privilege sweep.** 25 tables → 0. It also closed
  two things that were not in this plan, because asking what *else* 0011's
  blanket grant touched turned them up:
  - **Seven SECURITY DEFINER functions were anon-executable** — they run as
    their owner and bypass RLS, and PostgREST serves them at `/rest/v1/rpc/`,
    so unlike the table grants this was a **live pre-auth RLS bypass**.
    `project_is_staffed(uuid)` is `SELECT EXISTS(...FROM project_members...)`
    with no caller dependency at all.
  - **0011's `ALTER DEFAULT PRIVILEGES` was still armed**, so the 25-table fix
    alone would have left table 37 born exposed.
  Proven safe before writing SQL: only two policies in the schema are
  anon-satisfiable (both `USING (true)`, both on already-clean tables), and an
  empirical `SET ROLE anon` probe read **0 of 25** tables. pgTAP 629 → **655**.
- **Storage tab honest copy** — tab renamed `RABBIT` → `Storage`, an "In use"
  badge on the active backend, and copy that finally says Supabase is WILSON's
  own zero-setup backend. No logic touched.
- **R.A.B.B.I.T. task creation diagnosed** — root cause reproduced at the
  database (`23502` on `tasks.asset_id`). **Not fixed by design**; see
  `OUTSTANDING.md` for why the obvious fix is insufficient. → S24.

**Corrections this session made to this document and the handbook:**
- Standing rule 4 below said the CLI is linked to **staging**. It was linked to
  **wilson-dev**, and S21's close-out says it left it there. Rule corrected.
- `SYSTEMS_HANDBOOK.md` said migrations `0000–0029` are on all three
  environments. It is `0000–0033`.
- **UNKNOWN narrowed:** `supabaseAdapter.uploadFile`/`listFiles` contain zero
  `electronAPI` references, so the cloud file path is not desktop-gated *at the
  adapter level*. Whether the web UI surfaces an upload control is still
  UNKNOWN — reaching it needs a signed-in session.

---

### S22 — original brief (kept for the record)

**Goal: the storage tab stops looking broken, and the web tells the truth.**

**MEASURED — why every backend button is dead on the web.**
`RabbitProvider.jsx:312` forces `'supabase'` when `window.electronAPI` is
absent. `SettingsPage.jsx:595` then disables each button when
`active || unavailableOnWeb`. On the web, Supabase is *active* (disabled) and
the other two are *unavailableOnWeb* (disabled). **All three disabled — by
construction, not a broken handler.**

- Rename the tab `RABBIT` → `Storage` (Audrey's ask).
- Make the picker honest: show Supabase as **connected**, not dead.
- Correct the mental model in the UI: **Supabase is already the zero-setup
  option** — it is WILSON's own backend, no login and no link required. It
  doesn't feel that way only because the UI never says so.
- Confirm cloud file upload/list works end to end on the web. `public.files`
  and the `rabbit-files` bucket exist (S14); whether the web path exercises them
  is **UNKNOWN**.
- Local Server and Google Drive stay desktop-only. Google Drive is read-only
  (Known #8) — a real feature, not a fix, and out of scope here.

---

### ⚠️ THE SESSION SEQUENCE CHANGED (2026-08-03) — read this before the sections below

Audrey specified a body of R.A.B.B.I.T. work that did not exist when this plan
was written, and capped it at **four sessions**. The old S23/S24/S25 sections
below are superseded; only one of them actually moves.

**REORDERED by Audrey, 2026-08-03 — this table is the authority.**

> ℹ️ **S22 and S23 were executed in ONE conversation** (2026-08-03). The
> conversation opened on the S22 brief, completed it (`494a13d`, `8709b1e`,
> `a92fa65`) and wrote `SESSION_23_prompt.md` — then Audrey reported she could
> not create anything, so it went straight on and executed that S23 brief in
> the same sitting (`2727328` … `c21e47d`) rather than stopping. Both sessions'
> work is done, deployed to all three environments and verified; there is no
> gap and nothing was skipped. **Session numbers track units of WORK, not
> conversations** — if a future session rolls into the next brief, say so
> explicitly at the time, because not saying it is what made this confusing.

| # | Session | Why here | Prompt |
|---|---|---|---|
| **S23** | R.A.B.B.I.T. creation unblock — ✅ **DONE (`2727328`)** | nothing could be created at all | `SESSION_23_prompt.md` |
| **S24** | **Budget system** — ✅ **DONE (`b07b6c9`)** | moved forward from S27; it was the gap that stopped R.A.B.B.I.T. doing its job | `SESSION_24_prompt.md` |
| **S25** | Scenes/shots/levels/experiences at **adapter parity** — ✅ **DONE (`183b4c2`)** | prerequisite for per-scene folders | `SESSION_25_prompt.md` |
| **S26** | Backend-agnostic **folder tree** + writes the project manifest | needs scenes to exist before it can give each one a folder | `SESSION_26_prompt.md` |
| **S27** | **Files everywhere** + the manifest surfaced in Resources | manages the folders S26 creates | *to write* |
| **S28** | Design pass | unchanged, still last | *to write* |

**The `projects` drift is SPLIT, each half closed by the session that consumes
it** (Audrey: *"splitting is fine"*) — rather than one orphan migration session,
or three separate rediscoveries:
- **S24** → `budget_actual_column_mode`, and whatever margin/contingency shape
  its line-item model actually needs. **Deliberately NOT pre-added**, because
  Audrey's spec bakes margin and contingency into *every line item*, so a
  `projects.margin` column is probably only the default a new line inherits.
  Guessing that shape before the model exists would put a wrong column in a
  money system, which is worse than a missing one — code starts reading it.
- ~~**S25** → `code`, `scene_start_number`, `scene_digits`, `shot_digits`.~~
  ✅ **DONE by 0040 — and this line was WRONG about the first column and
  incomplete about the rest.** S25 added **seventeen**, taking `projects` from
  31 to 48. `code` is **not** among them: nothing in the app has ever written
  a bare `code` key, so the column would have been dead on arrival. The real
  one is `project_code`. The thirteen this line never mentioned —
  `scene_separator`, `fps`, `uses_realtime_engine`, five `engine_*` fields,
  the three `*_enabled` toggles, `project_type` and `project_tier` — are all
  written by the Project Control Panel and were all being silently discarded.
  Derived from a grep of the panel and the views, not from this table.
- **S26** → `folder_slug`, `folder_root`, `files_dir`.

**DECIDED (Audrey, 2026-08-03): the database is authoritative and the project
folder's file is a generated MIRROR.** Written on change; read only for
portability, recovery and handoff; never an input to normal operation. Any
import must be an explicit, user-initiated action that shows a diff first.
This is settled — do not reopen it.

**S27 headline, MEASURED 2026-08-03:** the cloud schema has **no budget tables
at all** — checked against a full census of all 36 public tables. No
`budget_lines`, `budget_actuals`, `budget_versions` or `expenses`, and **no
`margin` or `contingency` column anywhere**. Only `projects.budget_currency`
and the rate fields on `rate_card_entries`. Those structures live solely in
main's local `budget.json`. That fully explains "contingency and margin come up
as 0% and won't save": there is nowhere to save them. Same defect class as
`tasks.asset_id` and `assets.start_date` — a UI built against a local schema
the cloud never gained, so the fix is mostly migrations.

### ✅ S24 OUTCOME (2026-08-03, `b07b6c9`) — and the two things this plan got wrong

**Shipped, applied and verified BY QUERY on dev, staging AND prod:** migrations
0036 (nine budget settings on `projects` + `project_members.project_title`) and
0037 (`budget_lines`, `budget_actuals`, `budget_versions`, `expenses`,
`project_rate_overrides`, all manager-only at the RLS layer via the new
`can_access_project_money()`); fifteen budget methods on `supabaseAdapter`
where there had been none; pgTAP 43–47 (**42 → 47 suites, 655 → 717
assertions**, `collected == planned` on every run); `budgetMath.js` + 24 vitest
cases (**488 → 512**), proven by breaking the source three ways.

> 🚨 **1. THIS DOCUMENT NAMED THE WRONG COLUMNS, and the wrong name would have
> shipped a fix that fixed nothing.** The table below said `margin` and
> `contingency`. The UI reads **`budget_margin_pct`** and
> **`budget_contingency_pct`**, and it reads **seven more besides**
> (`budget_agency_pct`, `budget_agency_enabled`, `budget_actual_column_count`,
> `budget_active`, `budget_active_version_id`, `budget_finalized`, alongside
> the `budget_actual_column_mode` this file did have right).
>
> Adding `projects.margin` would have closed the documented gap, passed review,
> and left Audrey's reported bug completely intact — the percentage would still
> have read 0% and still not saved. **A planning document is a claim about the
> code, and it decays exactly like any other claim.** The columns that shipped
> were taken from a grep of the budget views.

> 🚨 **2. "The fix is mostly migrations" was right for the wrong reason.** This
> file assumed the budget UI needed building. It was already **complete** —
> `useBudgetLines`, `CrewTeamTab`, `TalentTab`, `ClientViewTab` and
> `BudgetView` already implement the bid, the line × pay-period actuals grid,
> versions with an immutable snapshot, per-line margin/contingency inheriting
> from the project default, and the role-priced bid Audrey later specified from
> scratch. It had simply never been able to persist anything.
>
> Four of the session's nine "open questions" were therefore answerable from
> the code and should never have been put to Audrey: margin and contingency are
> applied **independently to the base, not compounded** (three files agree);
> per-line percentages are a **fallback, not a seed** (NULL inherits, and a
> reset writes NULL back); expenses already carry **estimated_cost AND
> actual_cost on one row**; and the budget's Phases tab already reads the
> **same `ctx.phases` the timeline does**. Read the UI before designing a schema
> for it.

**Follow-up shipped the same session (`dfdf386`)**, from Audrey's replies to
the close-out: the **Budget tab is hidden from non-managers**, and **invoice
attachment works on the web**. The second needed migration 0038, because the
obvious implementation would have served the invoice PDF to exactly the people
0037 had just denied the amount on it — the ordinary file and storage rules
admit any workspace member who can see the project. Invoices are now gated at
the row AND the blob, independently. 🚨 **0027 → 0038, and replaying 0027
silently re-opens them.** The Client View's `project.name` / `project.code` was
**deferred by Audrey** and stays in `OUTSTANDING.md`.

**Two further asks, both actioned 2026-08-04:**
- **Invoices live in `INVOICES`.** Audrey: *"invoices should go into the
  project folder. it should be in a nested folder in the project called
  INVOICES."* Migration 0039 makes the storage gate match the segment
  case-insensitively, so the rename could not invert it; on Local Server
  `INVOICES/` is created with the project as a SIBLING of `<slug>_FILES`, and
  main's three separate invoice folders are no longer created (nothing wrote
  to them once the desktop-only route went). Existing folders are never
  deleted.
- ~~**The project control panel gate is CARRIED TO S25**~~ ✅ **DONE in S25
  (`ccb90e7`).** Both questions this file said had to be settled first were,
  and neither answer was the expected one. **Which screen:** not a judgement
  call — `ProjectSummaryView.jsx:166` renders a header literally reading
  "Project Control Panel". **Which rule:** its own, not the money rule.
  Audrey, 2026-08-04: *"managers and reviewers should be able to see and press
  the button and open the control panel, the budget block is managers only.
  basic team members do not need access to the panel at all."*
  🚨 `project.settings.open` is the **only** action where a reviewer outranks
  a member — `project.entity.write` is the exact inverse on those two seats,
  and `canSeeProjectMoney` admits neither. Every existing gate was wrong here
  in a way that would have passed review.

**Answered by Audrey and now settled** (do not re-ask): money = a project
manager **or** a workspace admin — a workspace *manager* holding only a project
`member` seat does **not** qualify; the existing `grant_rate_card_view` /
`grant_rate_card_edit` flags do **not** gate budgets (nobody has either ticked,
including Audrey, so layering them would have hidden every budget); the project
job title is its **own column**; no rate-card seeding — *"i will input the rate
card later."*

**⚠️ The rate card is EMPTY on the beta** (0 cards, 0 entries, measured). Bids
are `role rate × days`, so every total stays zero until Audrey enters rates.
The budget now says so in a banner rather than rendering a confident $0.

### ✅ S25 OUTCOME (2026-08-04, `183b4c2`) — and the third repeat of one mistake

**Shipped, applied and verified BY QUERY on dev, staging AND prod:** migration
0040 — `scenes`, `shots`, `levels`, `experiences` (RLS enabled and forced, 16
policies, no `FOR ALL`, workspace-stamp and touch triggers, **zero privileges
held by `anon` or `PUBLIC`**, scanned across all four rather than assumed) and
seventeen `projects` columns (31 → 48). `supabaseAdapter` gained four list
methods it never had and real bodies for the eight that threw. Naming
extracted to `entityNaming.js`. pgTAP **47 → 51 suites, 721 → 768
assertions**, `collected == planned` on every suite, whole set re-run green.
vitest **521 → 556**. All four CI jobs green on `183b4c2`.

> 🚨 **THIS DOCUMENT NAMED THE WRONG COLUMN AGAIN — the THIRD time in three
> sessions.** S20 was told "migration 0032" when the next number was 0031.
> S24 was told the budget gap was `margin`/`contingency` when the UI reads
> `budget_margin_pct`/`budget_contingency_pct` and seven more. S25 was told to
> add `code`, when nothing in the app has ever *written* a `code` key and the
> real column is `project_code`.
>
> The pattern is identical every time: the plan names a field that appears in
> a **read** and never checks that anything **writes** it. Adding `code` would
> have closed the documented gap, satisfied review, and left the client-facing
> topsheet printing `--` forever — a fix that fixes nothing, which is worse
> than no fix because it also closes the ticket.
>
> **The habit that catches it, and it is cheap:** before adding a column,
> grep for the WRITER, not the reader. One command over `src/` enumerated
> every field the Project Control Panel writes and found thirteen more drifted
> columns this table never listed. pgTAP `48_scenes` probe 18 now asserts
> `projects.code` does not exist, so the documented-but-wrong fix fails loudly
> if anyone tries it later.

> ⚠️ **What S25 did NOT deliver, and why it is recorded rather than glossed.**
> **Task templates** were in the brief and were not built. They are not a
> missing adapter method: Local Server stores them as individual JSON files in
> their own directory, workspace-scoped with a project-scoped read, so cloud
> parity needs a fifth table, RLS, a pgTAP suite and five methods. That is its
> own block, not the tail of a session that had already added four tables.
> **The two assignee dropdowns were not confirmed at runtime either** — the
> job there was to WATCH them populate, and reaching them needs a signed-in
> session against staging that nothing in this repo automates. Both stay in
> `OUTSTANDING.md`; neither was quietly marked done.

### 🚨 CROSS-SESSION: `projects` is missing columns S24, S25 AND S27 all need

**MEASURED 2026-08-03.** `public.projects` has **22 columns**: id, workspace_id,
title, description, status, status_tag, start_date, end_date, budget_total,
budget_currency, client_name, cover_image_url, producer_id, director_id, and
the audit/soft-delete set. **Every one of the following is ABSENT:**

**STATUS 2026-08-03: the budget half is CLOSED, the rest is not.** Re-measured
after 0036: `public.projects` now has **31** columns.

| Missing column | Needed by | Symptom today |
|---|---|---|
| ~~`budget_actual_column_mode`~~ | ~~S24~~ | ✅ **added by 0036**, along with eight more the table below never listed |
| ~~`margin`, `contingency`~~ | ~~S24~~ | ✅ **the names were wrong** — shipped as `budget_margin_pct` / `budget_contingency_pct` in 0036 |
| ~~`code`~~ | ~~S25~~ | ❌ **NEVER ADDED, AND MUST NOT BE.** `project.code` is a wrong READ in ClientViewTab, not a missing column — nothing has ever written it. 0040 added **`project_code`** (the column the app writes) and fixed the reader. pgTAP asserts `code` stays absent |
| ~~`scene_start_number`, `scene_digits`, `shot_digits`~~ | ~~S25~~ | ✅ **added by 0040**, together with `scene_separator` and `fps`, which this table never listed and the auto-naming also reads |
| ~~`scenes_enabled`, `levels_enabled`, `experiences_enabled`~~ | ~~S25~~ | ✅ **added by 0040, WITH the entities.** They default FALSE, so applying the migration changed nothing on screen — the tabs appear only when a toggle is turned on |
| ~~`uses_realtime_engine`, `engine_*` ×5, `project_type`, `project_tier`~~ | ~~S25~~ | ✅ **added by 0040. Never listed here at all** — found by grepping the Project Control Panel for what it WRITES. `project_type` matters most: `handleTypeChange` applies a template that sets the three toggles, so without the column, choosing a type flipped the toggles and lost the type that explained why |
| `folder_slug`, `folder_root`, `files_dir` | **S26** | the folder tree has no anchor — `ensureProjectFolders` keys off `folder_slug`. `files_dir` is written by the relink reset at `ProjectSummaryView.jsx:949` and dropped today |

Not a missing column but the same family: `ClientViewTab.jsx:108,126,177` reads
`project.name`, which has never existed — the column is `title`. That is a
one-word fix, not a migration.

This is one defect class, not four bugs: **the UI was built against main's local
JSON project shape, and the cloud `projects` table never gained the fields.**
Same as `tasks.asset_id` and `assets.start_date`, which S23 fixed.

**Act on it early rather than per-session.** S24 will discover the naming
columns missing the moment it ports the auto-naming, and S25 will discover
`folder_slug` missing the moment it ports `ensureProjectFolders`. Consider one
migration that closes the `projects` drift up front — but **enumerate the local
shape against the cloud table first and decide each field deliberately**, rather
than copying main's bundle wholesale. Audrey's standing rule applies: database
information lives in Supabase, and `budget.json` / the local bundle were
datastores of necessity, not designs.

🚨 **The trap in that session:** Audrey wants a per-project **job title** column
on the crew/team view ("you can have a company/title role AND a separate
project role"). `project_members.project_role` is a **permission** role read by
`can_write_project()` and friends — writing a job title into it would break
every R.A.B.B.I.T. permission gate, in exactly the silent way S23 spent hours
chasing. It needs its own column.

**The requirements Audrey stated (2026-08-03), verbatim in substance:**
- R.A.B.B.I.T. is also a **project file manager**; the folder tree must reflect
  in **whichever storage backend the company selected** — not local disk only,
  which is all `fs.mkdirSync` in `electron/main.cjs` can do today.
- Assets are first-class items, each with its **own folder** of elements/files.
- Scenes, shots, levels and experiences each get their **own folder** — 5
  scenes means 5 independent folders under `SCENES/`, not one shared folder.
- Toggling a category **on** creates them; toggling **off** must only remove
  them from the R.A.B.B.I.T. view and **never delete the folders**.
- Scenes and shots take their names **from the auto-naming system**.
- Scenes/shots/levels/experiences must work on **local server too**, not
  cloud-only. One entity shape, implemented on both adapters.
- **Database information lives in Supabase.** This kills a naive port: on main
  `<slug>_DATABASES/` was not a files folder, it was the datastore —
  `mirrorProjectDatabases` wrote `project.json`, `team.json`, `tasks.json`,
  `timeline.json`, `budget.json` into it. In the cloud model that folder must
  become an **export target, not a source of truth**, or the port would
  reintroduce a second, diverging copy of every project on disk.

**What main actually does, MEASURED (`origin/main`, 2026-08-03):**
- `ensureProjectFolders` (`electron/main.cjs:823`) creates `ASSETS/`,
  `<slug>_DATABASES/`, `<slug>_FILES/`, `<slug>_RECEIPTS&INVOICES/`,
  `<slug>_CREWINVOICES/`, `<slug>_TALENTINVOICES/`.
- `ensureAssetFolder` → `<root>/ASSETS/<fileSlugify(assetName)>/`; renaming an
  asset renames the folder **and** rewrites the `ASSETS/<oldSlug>/` prefix on
  every managed file.
- `folder_slug` is persisted on the project and on each asset.
- Auto-naming: scene `CODE{sep}SC{n}` padded to `scene_digits` (default 3);
  shot `CODE{sep}SC{n}{sep}SH{n}` padded to `shot_digits` (default 4).
- **The gap is real and precise:** `FileManager.jsx:87` already computes
  `parentType = sceneId ? 'SCENES' : shotId ? 'SHOTS' : 'ASSETS'` — those were
  designed in — but nothing ever creates a SCENES/ or SHOTS/ folder, and
  levels/experiences are not in that switch at all.

### The project manifest file (Audrey, 2026-08-03) — S25 writes it, S26 surfaces it

> *"a lot of these project specific details like unique margin, unique
> contingency, unique team member rates, all project details in the project
> panel should be saved in the project folder as a file the system can read.
> these details of the project should also be seen in the project page in the
> resources section of wilson."*

So the project folder carries a **manifest** of the project's own settings —
project-unique margin and contingency, project-scoped team member rates, and
everything else in the project panel — and Resources gains a project view that
shows them. (Resources today is only a nav slide-out: Projects, Rate Card,
Settings — `App.jsx:784`. This is a new surface, not a tweak.)

✅ **DECIDED (Audrey, 2026-08-03): the database is authoritative; the file is a
generated MIRROR.** Settled — do not reopen.

- Written whenever settings change.
- Read **only** for portability, recovery and handoff. It is **never an input
  to normal operation.**
- If a folder is ever imported from elsewhere, that is an **explicit,
  user-initiated action that shows a diff before writing** — never a silent
  read-back.

The reason, recorded so it is not re-litigated: RLS, realtime and
last-writer-wins all assume a single authority. The moment a file can write
back, two people editing in two places produce a silent overwrite in which the
loser is whoever's edit landed second, with no record of it. A mirror delivers
everything asked for — the folder is self-describing, readable and portable —
at no such cost. main's `_DATABASES/` is the cautionary tale: it was a real
second datastore, and **database information lives in Supabase.**

**Note the ordering consequence:** the manifest cannot be written until the
project settings actually persist. `margin`, `contingency` and the
project-scoped rates do not exist as columns yet (see the cross-session finding
above), so S25 can create the folder and the file's *shape*, but the content
depends on S27. Sequence deliberately, or S25 ships a manifest of nulls.

✅ **DECIDED (Audrey, 2026-08-04): a `folders` TABLE is the source of truth.**
Asked in S25's close-out and answered. Supabase Storage has no real folders —
it is object storage with path prefixes, so an *empty* folder cannot exist,
and "toggle off must never delete" requires a folder that outlives its
contents. The table records the tree; the storage path is derived from it. It
survives a backend switch and behaves identically on Local Server, Supabase
and Drive, where a `.keep` placeholder would exist only where the files do.
**S26 is unblocked — do not re-open this.**

The names come from `entityNaming.js` (S25): `fileSlugify` lives there
precisely because `electron/main.cjs` holds an identical copy, and a folder
slug that disagrees between the renderer and the Electron main process would
create two folders for one scene.

---

### S23 — Files everywhere (SUPERSEDED — this content is now S26)

**Goal:** files visible and attachable from the Resources page, D.O.G., and
R.A.B.B.I.T. against one project — Audrey's largest single ask.

Today: D.O.G. cloud projects have no attachment surface (Known #1), managed
files are local-server-only (Known #6), and Resources redirects you to RABBIT.

**Design decisions still open** — do not start until they are made. What is one
project's "files": everything under the project folder, or only what's attached?
Does the Resources view write, or only read?

---

### S24 — R.A.B.B.I.T. task management

All **UNKNOWN** — reported, not yet diagnosed. Budget diagnosis time, not just
fix time.

- New-task button in Tasks does nothing.
- Board view: typing a task and pressing Enter makes it vanish.
- Assignee dropdown doesn't populate. **Partial lead:**
  `ProjectTasksView.jsx:159` filters the roster to `project_members` when
  `projectIsStaffed` is true, and falls back to the whole roster when not — so
  either staffing rows are missing or the roster is empty. Query both before
  touching code.
- Scenes / levels / experiences toggles. **MEASURED:** local-only *by design* —
  the Supabase adapter throws (Known #5). Audrey calls these crucial.
  **Decision pending:** make them cloud-capable (migration + RLS + adapter +
  suite, a session of its own) or keep them local and replace the silent throw
  with honest copy.

---

### S25 — Design pass

- Welcome page: a black cursor blinks permanently, unattached to any input, and
  keeps blinking on the right while typing elsewhere. **UNKNOWN** — likely the
  shared `AuthCursor` from `AuthShell.jsx`, but that is a guess and must be
  confirmed in the DOM first.
- Login and welcome no longer match the original single-field aesthetic. Audrey:
  *"the only password entry with no username input was a lot cleaner."*
- New R.A.B.B.I.T. settings tab: project currency, rate card, task templates.

---

## Still owed, independent of all the above

- 🚨 **Rotate `smoke_admin`** — published in the public repo, permanent in git
  history. `OWED_AUDREY.md` §0, TPN-SDLC-007. **The one open CRITICAL, and it
  blocks the tag.**
- 🚨 **Rotate `wilson-staging`'s legacy `service_role` key** (S19, 2026-08-02).
  `supabase projects api-keys` returns every key as one JSON blob; a filter
  that assumed line-per-key printed the whole thing into a session transcript.
  It bypasses RLS. Dashboard → wilson-staging → Settings → API → Legacy API
  keys → roll `service_role`. The `anon` key beside it is publishable and needs
  nothing. Rolling it updates the Edge Function secrets that read it.
- ~~**Deploy `ai-proxy` to prod.**~~ ✅ **DONE — nothing was owed.** MEASURED
  2026-08-03 (S21): dev, staging and prod all run **byte-identical** source
  matching the repo's HEAD — `ai-proxy/index.ts` and all four `_shared/` files
  diff equal on every project. The tuning-field forwarding is in that source
  (`index.ts:239`, `:251-254`).

  This entry was wrong for two sessions, and the reason is worth keeping: the
  only evidence ever cited was the deploy *version number*, which counts
  deploys per project and is not comparable across them (prod v6 vs dev/staging
  v8 — the lower number was the current code). **Diff the source; do not read
  the version.** Download each deployment into a throwaway `--workdir` so the
  repo's own `supabase/functions/` is never overwritten.

  ✅ **Runtime behaviour CONFIRMED too (2026-08-03, staging).** Probe cases
  7a/7b: `thinking` omitted → `thinking=1, out=551`; `thinking: disabled` →
  `thinking=0, out=453`. That field is the only difference between the two
  requests, so it reached Anthropic. Nothing about the tuning fields is open.

  The "~138s vs ~59s on dev" claim is **withdrawn** — it rested on the deploy
  version inference, and the forwarding was in place all along.
- ~~**Deploy `operator-models` to prod.**~~ ✅ **DONE (S21, 2026-08-02).** Now
  on all three projects; prod verified ACTIVE alongside migration 0031.
- **Apply migration 0031 to prod.** dev and staging are done and verified.
- ~~Upload  +  to dev and prod.~~ **DONE** —
  Audrey confirmed 2026-08-02 that both templates are in place on all three
  projects. Never ; they are pasted by hand.
- **v1.0.0 is prepared, not tagged, not merged.** Recommendation: hold. Tagging
  a release where every Sonnet-4 path 404s is a version number applied to a
  broken build. Revisit after S19.

---

## Standing rules for these sessions

0. **Read `docs/OUTSTANDING.md` before planning anything.** It is everything
   currently known to be broken, in one place. Several entries are REPORTED
   rather than diagnosed — starting to code against one of those is fixing a
   guess, which is rule 1 in a different costume. It is also the fastest way
   to see whether what you are about to build sits on top of something already
   broken.
1. **A theory earns a measurement, never a commit.**
   (`feedback_prove_before_acting.md`.) Label everything measured / inferred /
   guessed — Audrey reads these as claims and acts on them.
2. **Before believing an absence, prove the instrument can see a presence.**
   S18 spent a round on "zero network requests" that was an artifact of a full
   250-entry resource-timing buffer; a control fetch returning 200 was equally
   invisible.
3. **Run the whole pgTAP set before pushing a migration.** `tap-hosted.py` runs
   one suite; CI runs all of them against one database, and a new writer changes
   other suites' counts.
4. **Read `supabase/.temp/linked-project.json` before anything that writes —
   read it, never recall it.** Two corrections (S22, 2026-08-03): the file is
   `linked-project.json`, not `project-ref`; and it was linked to **wilson-dev**
   (`eqjzmnvkrakroyqxfsvw`), not staging, exactly as S21's close-out left it.
   The close-out ritual re-links to dev, so dev is the expected resting state —
   but a stale claim in this rule is precisely how someone writes to the wrong
   database, so **check, do not trust this sentence either.**
5. **Stage explicit paths.** `git add -A` sweeps untracked files into a public
   commit.
5b. 🚨 **Never run `supabase config push`, and never build a shell command by
   interpolating content into it.** These are one rule because they were one
   incident: on 2026-08-02 bash evaluated backticks inside a double-quoted
   `node -e "…"` and ran `config push` against wilson-dev — twice, prompts
   defaulting to yes on absent stdin, nine auth settings applied. The same
   session had already printed a `service_role` key into a transcript via a
   `grep -v` that assumed line-per-key JSON.

   Write scripts to a file and run the file. Select fields (`jq -r '.x'`,
   `python -c`) rather than filtering output you have not seen the shape of.
   Prefer Edit/Write over shell heredocs. Neither incident was a reasoning
   error; both were quoting.
7. **Finish every session with two things for Audrey, in the chat — not in a
   file she has to go and open.** Both are required, both go at the very end,
   after the work is committed and pushed:

   **a. The remaining sessions**, one line each, a few words only:

   > - **S25** — scenes/shots/levels/experiences on both adapters
   > - **S26** — folder tree in the company's storage backend
   > - **S27** — files everywhere + project manifest in Resources
   > - **S28** — design pass

   Mark any that are done. If the order changed, say so.

   **b. A layman's breakdown of what the session accomplished**, as bullet
   points, in plain English. **No jargon, no table names, no migration numbers,
   no file paths.** Write what CHANGED FOR HER, not what was done to the code.

   > ✅ "You can create tasks again — every one you made before tonight was
   > silently failing."
   > ❌ "Migration 0034 dropped the NOT NULL on `tasks.asset_id` and relaxed
   > `tasks_select`."
   >
   > ✅ "Your team's wages can't leak to people outside the company."
   > ❌ "Revoked anon EXECUTE on seven SECURITY DEFINER functions."

   Say plainly what is fixed, what is only diagnosed, and what she needs to do
   herself. The technical record already exists in the commits and the docs —
   this is the part she actually reads.

6. **End every session by updating `docs/OUTSTANDING.md`** — the single answer
   to "what is broken right now". Add only what is **broken and not yet
   fixed**, including anything the session itself broke; delete what it fixed,
   citing the commit; tag each entry MEASURED / REPORTED / INFERRED.
   **Adding nothing is a correct outcome** — a session that fixes things and
   breaks nothing leaves the file alone. Do not pad it to look thorough;
   padding buries the real entries. Interim, unverified, or planned work is
   not an entry — that belongs in this file instead.
