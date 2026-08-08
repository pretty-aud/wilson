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

> ℹ️ **S32 IS AN INTENTIONALLY RETIRED NUMBER — nothing is missing.** The design
> pass held it, and on 2026-08-05 Audrey asked for it to run last with the
> numbering fixed to match (*"move 32 to the last one. fix the numbering"*), so
> `SESSION_32_prompt.md` was `git mv`d to **`SESSION_39_prompt.md`**. Rather
> than renumber six freshly-written briefs to close the hole, the number was
> left vacant: **the sequence runs S31 → S33**. Recorded here because a gap in a
> numbered list otherwise reads as a lost session, which is exactly the
> confusion the note above exists to prevent.

| # | Session | Why here | Prompt |
|---|---|---|---|
| **S23** | R.A.B.B.I.T. creation unblock — ✅ **DONE (`2727328`)** | nothing could be created at all | `SESSION_23_prompt.md` |
| **S24** | **Budget system** — ✅ **DONE (`b07b6c9`)** | moved forward from S27; it was the gap that stopped R.A.B.B.I.T. doing its job | `SESSION_24_prompt.md` |
| **S25** | Scenes/shots/levels/experiences at **adapter parity** — ✅ **DONE (`183b4c2`)** | prerequisite for per-scene folders | `SESSION_25_prompt.md` |
| **S26** | Backend-agnostic **folder tree** + the project manifest — ✅ **DONE (`071682b`)** | needed scenes to exist before it could give each one a folder | `SESSION_26_prompt.md` |
| **S27** | **Files everywhere** + the manifest surfaced in Resources — ✅ **DONE (`5384d4e`)** | manages the folders S26 creates | `SESSION_27_prompt.md` |
| **S28** | **Task templates in cloud** — ✅ **DONE (`06bf564`)** | the oldest open item; deferred by S25, S26 and (deliberately) S27 | `SESSION_28_prompt.md` |
| **S29** | **The Timeline permission gate** — ✅ **DONE (`7443fed`)** | the only task-creating surface with no gate; Audrey was hitting it | `SESSION_29_prompt.md` |
| **S30** | **O.T.T.E.R. keeps its work** — ✅ **DONE (`2d8b658`, `c3317d4`)** | the largest genuinely broken thing left | `SESSION_30_prompt.md` |
| **S31** | **Per-user settings + the pet + logout** — ✅ **DONE (`272fb83`, `29d36fc`)** | her account must follow her between computers | `SESSION_31_prompt.md` |

> ## 📒 The renumbering ledger
>
> Sessions past S35 have been renumbered three times. **The sequence table
> below is the authority; this ledger exists so an old reference can be
> resolved rather than guessed at.** Every move was a `git mv`, so each
> brief's history follows its content rather than its filename.
>
> | Session | Originally | 2026-08-05 | 2026-08-07 (a) | 2026-08-07 (b) | **Now** |
> |---|---|---|---|---|---|
> | Design pass | S29 | S32 | S39 → S40 | S40 | **S43** |
> | Petal cloud storage mgmt | — | — | created as S39 | S37 | **S41** |
> | Multi-GB files in cloud | S37 | S37 | S37 | S38 | **S42** |
> | Video preview + thumbs | S38 | S38 | S38 | S39 | **S40** |
> | Thumbnails everywhere | S36 | S36 | S36 | S36 | **S39** |
> | Storage provider registry | — | — | — | — | **S36** |
> | S3-compatible storage | — | — | — | — | **S37** |
> | Google Drive | — | — | — | — | **S38** |
>
> **Why each move happened, in Audrey's words:**
>
> - **2026-08-05** — *"move 32 to the last one. fix the numbering"*: the design
>   pass goes last, because a visual pass run before the sessions of new UI
>   would be redone immediately.
> - **2026-08-07 (a)** — *"lets make session 39 for making the operator
>   terminal solution. move design pass to 40"*: Petal-cloud storage
>   management created the day S34 shipped the storage-mode selector and
>   "Petal cloud" turned out to name an unmetered free tier.
> - **2026-08-07 (b)** — *"make 39 be 37 instead. move the numbering of the
>   ones after"*: the quota plane BLOCKS the cap raise, so it had to precede
>   it numerically as well as actually.
> - **2026-08-07 (c)** — after briefing the BYO storage family, Audrey chose
>   to run it next. The registry, S3 and Drive take **S36–S38**; thumbnails,
>   video and the Petal-cloud pair each shift back.
> - **2026-08-08** — *"lets set google drive for a later date. lets forego it
>   for the first build. lets move that session to last."* Drive leaves the
>   first build entirely and sits after the design pass. Two things made this
>   cheap: **S37 shipped S3-compatible storage**, which already covers AWS,
>   Backblaze B2, Wasabi, Hetzner, Cloudflare R2 and MinIO through one
>   adapter, so "bring your own cloud" is a solved problem without Google;
>   and Drive is the only item in the plan whose timeline belongs to another
>   company.
>
> 🚨 **S38 KEEPS ITS NUMBER. Its POSITION moved, not its identity.** This is
> the fourth reordering, and a fourth *renumbering* would have been the
> expensive kind: `s3`/`gdrive` vocabulary comments in migrations 0050–0052,
> the refusal probes in pgTAP suites 60 and 61 (*"gdrive is refused until S38
> ships the adapter"*), handbook §12.1a's add-a-provider recipe, S37's
> outcome block and `storage/index.js` all name S38 by number — several of
> them inside SQL that runs in CI. Position is a table row; identity is
> spread across the codebase. **Move rows, not numbers.**
>
> 🚨 **The design pass moves every time, and that is the rule working, not
> churn.** It is LAST on purpose. Add another UI session and it moves again.
>
> ⚠️ **Closed briefs are left as written** — `SESSION_29_prompt.md` and
> `SESSION_31_prompt.md` still say "S32" for the design pass. A shipped brief
> is a record of what was believed at the time. **This table is the
> authority.**

| # | Session | Size | Blocked by | Prompt |
|---|---|---|---|---|
| **S33** ✅ | **DONE (2026-08-07, `ed85072` + `439f702`)** — guard fix + the `downloaded` event; outcome block below | ~1 | — | `SESSION_33_prompt.md` |
| **S34** ✅ | **DONE (2026-08-07)** — `workspace_storage` on all three envs, Admin Terminal Storage section, classifier + probe + two-step confirm, TPN-AUTH-009 closed; outcome block below | 1 | S33 | `SESSION_34_prompt.md` |
| **S35** ✅ | **DONE (2026-08-07)** — 0049 folder_root guard on all three envs, `folderRootRefusal` on both routes + the IPC, Control Panel gate, §12.7 NAS/VPN guidance; outcome block below | ~1 | S34 | `SESSION_35_prompt.md` |
| **S36** ✅ | **DONE (2026-08-07)** — 0050 on all three envs: `workspace_storage.provider` + `provider_config` + four CHECKs, `files_money_provider_chk`, the four-function registry with Supabase routed through it, pgTAP suite 60. **Built no provider, by design.** S34's five path CHECKs are untouched; outcome block below | 1 | — | `SESSION_36_prompt.md` |
| **S37** ✅ | **DONE (2026-08-08)** — 0051 **and 0052** on all three envs: 's3' in the enum + the widened provider CHECK + the required-direction config arm (endpoint host-only), `workspace_storage_secrets` (0028 twin), the presign boundary (`storage-presign`/`storage-secret`), the registry's s3 entry, uploadFile's constant → the workspace's ACTIVE provider, GC parity by signed DELETE. pgTAP suites 61+62; outcome block below. ✅ **`WILSON_STORAGE_KEY_SECRET` set on all three envs 2026-08-08, digests verified identical (`OWED_AUDREY.md` §C2)** — S38's Drive refresh token shares it | 1 | — | `SESSION_37_prompt.md` |
| **S39** ✅ | **DONE (2026-08-08)** — 0053 on all three envs: the private `rabbit-thumbnails` bucket, **eight** policies, the derived object on the purge path; client-side generation; the first-ever `thumbnail_url` writer; teardown + GC parity. pgTAP suite 63; outcome block below | 1 | — | `SESSION_39_prompt.md` |
| **S44** ⬅️ **NEXT** | **A thumbnail lives where its source lives** — routes the thumbnail write through the same provider decision the body uses, so a BYO workspace's previews stop landing on Petal. Decided 2026-08-08 (*"if the thumbnail lived in the petal cloud it would break tpn inherently"*); handbook §12.7b, tracked in `OUTSTANDING.md`. **Runs BEFORE S40 despite the number** — S40 builds video stills on top of it. 🚨 The hard part is the DISPLAY path: no batch presign exists, and a presigned GET expires in 300s against Supabase's 3600s | 1 | **S39** | `SESSION_44_prompt.md` |
| **S40** | **Video preview + video thumbnails** — Range-capable route, auto still-frame, LGPL ffmpeg | 1–2 | **S39**, and **S44** (do not build video stills on a thumbnail path that is about to move) | `SESSION_40_prompt.md` |
| **S41** | **Petal cloud storage management** — operator-terminal plans, quotas, approval; 1 GB free tier; manual billing flips (design §4a3) | 1 | **none** | `SESSION_41_prompt.md` |
| **S42** | **Multi-GB files in cloud mode** — raise the cap + resumable uploads | 1 | **S41** (quota plane before the cap raise) | `SESSION_42_prompt.md` |
| **S43** | **Design pass** — last on purpose; must cover all the surface S33–S42 adds, including the provider picker and per-provider config forms | ? | **S42** | `SESSION_43_prompt.md` |
| **S38** ⏸️ | **Google Drive — MOVED TO LAST, OUT OF THE FIRST BUILD** (Audrey, 2026-08-08: *"lets set google drive for a later date. lets forego it for the first build. lets move that session to last."*). Petal-shipped OAuth client, **`drive.file` scope only**, encrypted refresh token, shared-drive requirement. **Nothing was built; the brief is untouched and correct**, and S37's corrections to it are already in. 🚨 **The NUMBER stays 38 deliberately — see the ledger.** | 1–2 | ⏳ **`OWED_AUDREY.md` §13 with Google** (calendar, outside Petal) — and note S37's research found this is **brand verification only, NOT mandatory app verification**, since `drive.file` is non-sensitive | `SESSION_38_prompt.md` |
| — | **The file gateway** (design §4b/§4c) — ⚠️ **probably unnecessary** | 3–5 | a customer who has refused NAS, VPN, own-cloud *and* Petal cloud | not written |

> **The real chains: S33 → S34 → S35 (done), S36 → S37 (done), S39 (done) →
> S40** (thumbnails before video frames), and **S41 → S42** (quota plane
> before the cap raise — §4a3). **S38 (Drive) hangs off S36 and can run at
> any point after it** — it is now positioned last by choice, not by
> dependency.
>
> ⭐ **REMAINING ORDER AFTER 2026-08-08: S44 → S40 → S41 → S42 → S43, then
> S38.** Three arrows in that line are real — **S44 → S40** (video stills must
> not be built on a thumbnail path that is about to move), **S41 → S42** (quota
> plane before the cap raise), and S43 wanting to be after the UI stops
> changing. The rest is priority.
>
> 📒 **S44 is numerically last and positionally first, and that is the rule
> working.** It took the next free number rather than renumbering S40–S43,
> because a number is identity and identity is spread across migrations,
> suites and comments. **Move rows, not numbers.**
>
> 🚨 **S36–S38 are the BYO storage FAMILY and the order inside it is
> deliberate.** The registry ships first so a provider is five functions and
> not a fork; S3 ships before Drive because it is cheaper (six providers, one
> adapter, no OAuth, no outside approval) and proves the registry's shape
> without a third party in the critical path. **That bet paid: S37 added a
> provider as one registry entry, one enum value and one widened CHECK, with
> no fork and no branch in `uploadFile`** — which is precisely why Drive can
> now wait without holding anything up. **Adding a provider must never narrow
> an existing one** — Audrey, 2026-08-07: *"dont remove other options"*.
>
> ⭐ **The family runs FIRST by Audrey's choice (2026-08-07)**, for two
> reasons worth keeping: S33–S35 just built `workspace_storage`, its CHECKs
> and its guards, so the registry's surgery on that table is lower-risk
> while the ground is warm; and BYO storage quietly demotes S42 — if a
> customer's dailies live on their own NAS or bucket, Petal cloud's 50 MB
> cap stops being the thing that blocks them.
>
> **Every brief derives from `docs/NETWORK_STORAGE_DESIGN.md`, which is the
> authority** — each carries the measurements, but the design carries the
> reasoning and Audrey's decisions verbatim.

> ### S39 outcome — thumbnails everywhere, and a brief that was wrong about the policy set (2026-08-08)
>
> **S38 was not run.** Its gate — `OWED_AUDREY.md` §13, Google's OAuth
> verification — was unfiled, and the brief's own instruction is to file it and
> run another session while it clears. Audrey chose that. S38's brief is
> untouched and still correct; S39 was one of the three independent roots and
> needed nothing.
>
> Migration **0053** applied and verified **by query** on dev, staging and prod
> (bucket private, 262144, `image/jpeg` only, 8 thumbnail policies, 4 carrying
> `can_access_project_money`, `rabbit_files%` still 8, trigger widened, s3 arm
> intact); CLI re-linked to wilson-dev. `storage-gc` and `operator-workspaces`
> deployed to all three. pgTAP suite **63** (20 assertions); full set **63
> suites / 1097 assertions** clean. Vitest **1210 / 54 files**.
>
> 🚨 **THE BRIEF AND DESIGN §5d.1 WERE BOTH WRONG ABOUT THE THING THE SESSION
> EXISTED TO COPY, and following them would have shipped the hole they warn
> about.** Both say *"`rabbit-files` has FOUR policies (`0027:283-340`): three
> base + `rabbit_files_invoices_select`"* and say to port those. Measured:
> **there are EIGHT**, they live in **0042** (0038 and 0039 rewrote them, 0042
> rewrote them again), and **`rabbit_files_invoices_select` has not existed
> since 0042:212-214 dropped it** in favour of four `rabbit_files_money_*`
> policies. A literal port yields a bucket with no UPDATE arm, one policy named
> after nothing, and **no money gate at all** — i.e. invoice thumbnails readable
> by every project member, which is precisely `TPN-CLOUD-008`'s "partial policy
> port" arriving through the instructions written to prevent it.
> **`supabaseProvider.js:19` had it right the whole time** — *"the private
> bucket whose eight RLS policies (0042) are the money gate."* Handbook §4.7 is
> corrected, including its stale claim that there is no UPDATE policy.
>
> **What shipped.** The private `rabbit-thumbnails` bucket (256 KB,
> `image/jpeg` only — both enforced by Storage, not client code), eight policies
> transcribed from 0042 with `bucket_id` swapped and **nothing else**, and the
> key held identical to its source's **plus `.jpg`** so the third path segment —
> the money gate — is inherited rather than re-derived. Generation is
> `createImageBitmap` → canvas → `toBlob` on the uploading machine, one
> implementation for browser and Electron renderer, best-effort by contract
> (`null`, never a throw: the body has already landed). `files.thumbnail_url`
> gets **its first writer since 0000**. Display URLs are signed **in one batch
> per list**. Disposal rides the existing purge: `fn_files_gc_enqueue` now
> enqueues up to two objects and the trigger's WHEN clause is widened, with the
> body INSERT guarded separately — a `local_server` row has no Supabase body but
> **can** carry a Petal thumbnail, and certifying a body that never existed
> would be a false entry in the ledger.
>
> 🚨 **Three measured corrections carried forward for S38**, all of which make
> it cheaper than its brief says:
> 1. **`google_drive` has been in the `storage_provider` enum since 0000:67** —
>    0051's own comment says so. S38 writes **no** `ALTER TYPE`.
> 2. **S38 therefore does NOT hit S37's flow wall.** The brief asserts twice
>    that it "hits the identical wall"; that trap is specific to *adding an enum
>    value* inside one transaction. S38 widens a TEXT CHECK, which is usable in
>    its own transaction — suite 60 already INSERTs `google_drive` rows and
>    passes pre-apply. The ordinary shim flow works.
> 3. **Two probes invert, not one** (60:168 and 61:291), and the vocabularies
>    differ: `workspace_storage.provider` is **`'gdrive'`** while
>    `files.storage_provider` is **`'google_drive'`**.
>
> **The eight breakers**, each failing exactly its own probes: public bucket →
> 1; money four dropped (the brief's shape) → 4,5,6,9,10; base SELECT ungated
> → 4,**13**; thumbnail enqueue removed → 17,19; 0051's WHEN restored → **19
> only** (the isolation proving 19 tests the clause, not the body); wrong policy
> prefix → 7; UPDATE arms dropped → 4,5,6,11,15; s3 arm lost → 20.
>
> ⚠️ **Probe 15 had to be rewritten mid-session and the reason generalises.** As
> a row count it **passed against a bucket with no policies at all** — the exact
> state it exists to catch. RLS treats the arms differently: a **USING** failure
> silently yields zero rows, a **WITH CHECK** failure **RAISES**. Breaker 7
> confirms it, failing 15 with *"no exception raised"*.
>
> 🚨 **The pre-deploy adversarial review earned its keep for the SIXTH session
> running: 20 findings, 8 verified, 4 confirmed and fixed before deploy.**
> 1. **Workspace teardown knew one bucket.** `WIL-7005` affirmatively states a
>    complete disposal, so every torn-down tenant's frames would have survived
>    while the certificate said otherwise — and after the CASCADE nothing can
>    attribute a project folder to a workspace ever again, so it was permanent.
>    Now swept, certificated, and counted. **Its `files` scan deliberately omits
>    the `storage_provider='supabase'` filter the body scan uses** — a BYO
>    workspace's media is its own, but its Petal-hosted preview is not.
> 2. **The signing effect depended on the whole `ctx`**, whose `useMemo` deps
>    include `bundle` and `presentUsers` — so an unrelated presence ping
>    re-signed every thumbnail, and because a fresh signed URL is a new `src`,
>    every tile reloaded. Now depends on the stable `useCallback`.
> 3. **`imgError` was a sticky boolean over an EXPIRING url.** A lazy tile
>    scrolled into view past the 1-hour expiry failed once and was pinned to a
>    generic icon for the component's life; a later valid URL could not repair
>    it. Now remembers *which* src failed. ⚠️ The first fix attempt — `key` on
>    the `<img>` — was wrong and caught immediately: the flag lives in the
>    parent, and when set the `<img>` is never rendered at all.
> 4. **`removeThumbnail` swallowed its Storage error** — supabase-js resolves
>    for every status, so an expired token turned the thumbnail's ONLY cleanup
>    path into a silent success. Now throws; the caller logs.
> Also fixed: the GC's restorability read failed **open** (S37's "a failed read
> pushes nothing"), so a statement timeout read as "nothing references this" —
> a licence to delete, then stamped `deleted` in the ledger.
>
> ⚠️ **And the review's own tooling reproduced the comment trap a third time.**
> The test file's comment-stripper ran block comments in a separate first pass;
> a **line** comment in `supabaseAdapter.js` containing the path
> `rabbit-files/projects/*` opened a block that closed at the next real `*/`,
> deleting ~40 lines of real code including the call being asserted. The wiring
> was fine; the assertion was blind. **One alternating pass, block alternative
> first**, and the stripper is now pinned by its own tests.
>
> ⚠️ **ONE DECISION AUDREY SHOULD CONFIRM: a BYO workspace's previews live on
> Petal.** Media goes to the customer's NAS or bucket; a legible 256px frame of
> every image does not. Argued in §12.7b (negligible size, uniform behaviour, no
> presign per tile) and grounded in her own §5d.1 instruction — but that
> instruction predates BYO media storage, so it does not settle the BYO case.
> Left as built and flagged rather than decided unilaterally; routing previews
> through the storage registry would be a provider lookup, not a fork.
>
> **Stated limits.** No orphan sweep over `rabbit-thumbnails` (queue drain and
> teardown cover it; a browser dying between the thumbnail put and a refused
> `files` insert strands one 10–30 KB JPEG uncertificated); Local Server's tier
> is untouched and still uses `sharp` and its six Express routes; TIFF has no
> cloud preview and SVG is excluded deliberately; the 256/q80 vs 512/q85 split
> between the desktop routes pre-dates this session and was matched, not
> resolved; `files.thumbnail_url` is client-writable through `FILE_COLUMNS`, the
> same asymmetry §17 already records for `storage_path`. **Nothing here has been
> watched working against a real upload by a human** — the round trip needs a
> signed-in cloud workspace and a real image.
>
> ### S37 outcome — S3-compatible storage, the first BYO provider (2026-08-08)
>
> Migrations **0051** and **0052** applied and verified **by query** on dev,
> staging and prod; CLI re-linked to wilson-dev. pgTAP suites **61** (39
> assertions) and **62** (24); suite 60's "s3 is refused" probe INVERTED in
> the same commit — the same INSERT now fails the required-config arm
> instead of the vocabulary, which was the tripwire working as designed.
> Full set **62 suites / 1077 assertions** clean; vitest **1159 / 53
> files**. Eight arm-level breakers, each failing exactly its own probes
> (drop the s3 arm → 15+1; un-widen the vocabulary → 21; drop the money
> constraint → 3; un-widen the trigger → 1; a vacuous write predicate → 5;
> DEFINER predicates → exactly the 2 structural probes, proving why they
> exist; a policy on the secrets table → 1; revert 0052's endpoint arm →
> the 3 endpoint probes plus the documented PK cascade). Run POST-apply
> with explicit DROPs — the pre-apply shim flow cannot serve suite 61 at
> all, see below.
>
> **What shipped.** One provider = one registry entry
> (`storage/s3Provider.js`, presign-then-fetch, all five contract
> functions), one enum value, the widened `workspace_storage_provider_chk`
> (**explicit DROP + re-ADD** — a wrapped ADD is a silent no-op against an
> applied database, S36's own measurement), and
> **`workspace_storage_s3_config_chk`**, the required-direction arm 0050
> demanded: required keys, a key ALLOWLIST (a typo'd key refuses at write
> time), https-only canonical endpoint, and the prefix under 0048's
> root_canon discipline. `workspace_storage_secrets` is the 0028 shape
> exactly (RLS forced, zero policies, ciphertext only, hint for the UI),
> under its OWN master key (`WILSON_STORAGE_KEY_SECRET`) so the two
> credential domains rotate independently. The presign boundary
> (`storage-presign`, memberGuard) EVALUATES the files policies as the
> caller — SECURITY INVOKER predicates (`can_presign_project_write/read`,
> 0051) called over PostgREST with the caller's own JWT — instead of
> replicating arms (S33's rule satisfied by construction), refuses
> money-segment keys wholesale, applies the workspace prefix server-side,
> and requires the ACTIVE choice for PUT while serving GET/DELETE from the
> retained config (resolve-from-the-row, S36). `storage-secret`
> (adminGuard) stores the secret and runs the two-half probe: a real server
> PUT→GET→DELETE with the failing stage named, plus presigns the client
> exercises itself — the only place CORS can be tested. uploadFile's
> constant became `activeWorkspaceProvider(getWorkspaceStorageCached())` —
> one argument, as S36's comment promised — failing CLOSED on an unreadable
> choice, and refusing a cloud-mode 'network' workspace with a sentence.
> GC parity: 0051 widens the enqueue trigger (BY TEXT COMPARISON — the new
> enum value cannot be referenced in its own transaction), and storage-gc
> drains s3 rows by signed DELETE against the CURRENT config
> (`queue_s3_drained` is the evidence counter). The SigV4 presigner
> (`_shared/s3Presign.ts`, runtime-agnostic) is pinned to **AWS's published
> example signature** in vitest — reproducing a constant we did not produce
> is what separates "signs consistently" from "signs correctly".
>
> 🚨 **The brief was wrong in three places, all measured.**
> 1. **"Desktop uploads do not hit CORS" is FALSE.** The desktop renderer
>    is Chromium with webSecurity on (no override in main.cjs) — CORS
>    applies on every surface. The bucket CORS rule (handbook §12.7a) uses
>    `AllowedOrigins: ["*"]` precisely because the desktop origin carries a
>    random localhost port; the presigned URL, not CORS, is the authority.
> 2. **The contract is FIVE functions, not four** — describe() is required
>    at registration (S36 shipped it that way; the brief's own §4a2b table
>    still said four).
> 3. **`secretRef` is not stored.** The brief's config shape carried it; in
>    practice the secrets table's PK (workspace_id) IS the reference — a
>    named slot arrives if a workspace ever needs two secrets, and a dead
>    config key today would be drift bait.
>
> 🚨 **Two flow discoveries worth carrying to S38:**
> - **The pre-apply breaker/suite flow cannot test a migration that adds an
>   enum value whose USERS are in the same suite.** tap-hosted's
>   migration-before-suite shim is ONE transaction, and a new enum value
>   cannot be used in the transaction that adds it — suite 61 INSERTs
>   files rows with 's3'. Order becomes: apply to dev FIRST, then suites,
>   then breakers via explicit DROP/replace in the rolled-back shim. S38's
>   gdrive migration hits the identical wall.
> - **supabaseAdapter.deleteFile never touches blobs** (soft delete only) —
>   the brief's "purge deletes at the provider and writes the certificate"
>   was already asynchronous for Supabase (0014 cron purge → queue →
>   admin-run GC), so s3 parity belongs at the TRIGGER + DRAIN, not in
>   deleteFile. Built there.
>
> 🚨 **The pre-deploy adversarial review earned its keep for the FIFTH
> session running: 25 findings raised, 13 refuted, 12 confirmed (5 medium,
> 7 low) against code already green on 62/62 pgTAP and 1143 vitest.** All
> twelve fixed before the migration reached staging, so per OUTSTANDING's
> rule they are commit content, not entries. The five worth carrying:
>
> 1. 🚨 **The two path gates disagreed about a filename the product itself
>    writes.** `checkRowShapedPath` rejects only a segment that IS `.` or
>    `..`; `presignS3Request` rejected `key.includes('..')` — a SUBSTRING
>    test. `uploadFile`'s sanitiser preserves dots, so `render..v2.mov`
>    passed the shape gate, passed authorisation, and then 500ed at the
>    signer — permanently untransferable, on this provider only. Worse, an
>    admin prefix of `wilson..media` passed the CHECK and the UI and broke
>    EVERY presign in the workspace. Both sides are now segment-wise (a
>    doubled dot inside a segment is an ordinary S3 key; only a standalone
>    `..` segment normalises in a URL path). **Two gates over one value is a
>    defect unless something pins them to the same rule** — now pinned on
>    both sides, because fixing one leaves the same class.
> 2. 🚨 **A warning that promised the opposite of what happens.** The S3→NAS
>    switch card said bucket files "stay readable — each file remembers where
>    its body lives". The ROW does; the CONNECTION does not. 0050's
>    `provider_config_chk` forbids a `network` row from carrying a config, so
>    the switch erases the only copy of the endpoint/bucket/prefix and every
>    pre-switch body becomes unreachable until retyped exactly. Now says so,
>    and names how many files are at stake (`countFilesAtProvider`). **Copy
>    that reassures is worse than no copy when the reassurance is false.**
> 3. **`byo_bodies_left` was single-source and error-blind** — it counted
>    live `files` rows only (missing purged-but-undrained bodies, i.e.
>    exactly what a failed drain leaves in the customer's bucket) and
>    reported `0` when the count query errored. After the CASCADE nothing can
>    re-derive it, so a failed query would have permanently certified
>    "nothing of yours remains". Now both sources, and **NULL means unknown**.
> 4. **The GC counted HTTP 404 as a successful disposal.** An absent S3 KEY
>    returns 204; a 404 is the BUCKET failing to resolve. So one flipped
>    path-style setting would have stamped TPN-CONT-002 certificates on a
>    whole batch of bodies still sitting in the bucket. 404 is now a failure
>    with a sentence naming the three fields to check.
> 5. **The 8th no-caller feature, caught before it shipped.**
>    `storageSecretClear`, the Edge `clear` branch and `WIL-3006` all existed
>    with nothing calling any of them — a tenant bucket credential could be
>    stored and never removed except by a service-role query. Now a Remove
>    button, pinned by a wiring test. **Enumerate the new exports and grep
>    each for callers; this is the ninth time.**
>
> Also fixed: the op allowlist used `op in METHOD`, so `constructor` and
> `__proto__` passed a four-value gate and ran the whole authorisation path
> (decrypting the bucket secret) before failing at the signer as a 500; an
> endpoint carrying a path (`https://host/minio` — the reverse-proxied MinIO
> shape) was accepted by the CHECK and then SILENTLY DROPPED by
> `s3HostAndPath`, signing against a URI the gateway never sees, so **0052**
> adds the host-only arm in all three layers; a failed secret-status read
> latched "Not stored yet." over a stored secret for the whole visit; and
> `clearWorkspaceStorageCache` was the one new call site with no wiring pin.
>
> ⚠️ **And the review's own fixes reproduced the 0038 trap twice.** Two new
> negative assertions — `not.toContain('op in METHOD')` and
> `not.toContain('EXCEPTION WHEN duplicate_object')` — failed against the
> COMMENTS that explain why those forms are wrong. **A `not.toContain` over
> a file that documents its own trap will match the documentation.** Both
> now assert the executable form (the full guard expression; comment-stripped
> SQL), which is the same correction S36's review forced on the money probe.
>
> **Stated limits.** The orphan scan never enumerates a customer bucket
> (stranded-upload coverage there = the uploader's compensation delete);
> teardown deliberately leaves customer buckets (their property — the
> WIL-7005 certificate carries `byo_bodies_left` so the choice is stated);
> `downloaded` is advisory for presigned GETs by construction; a single
> presigned PUT is provider-capped (5 GB) with multipart deliberately out
> of scope; the manifest and rates mirror stay on Supabase for s3
> workspaces (metadata-adjacent, and FINANCE is money anyway); the storage
> choice reaches other machines at next launch/sign-in (the drive's own
> S34 rule — one module-level cache, cleared on sign-out); switching
> NAS↔S3 clears the other's config by constraint (root_provider_path +
> provider_config arms), with the UI warning before either save; and a
> byos+network workspace's CLOUD uploads are now REFUSED with a sentence
> where they previously landed silently on Petal — that is S36's specified
> behaviour arriving, not a regression, but Audrey should see it once in
> the beta before it surprises a customer. **Nothing here has been watched
> working against a real bucket by a human** — no bucket credentials exist
> in this room; the presigner is proven against AWS's vector and the
> probe/round-trip is the first-run check.
>
> ### S36 outcome — the registry, and no provider (2026-08-07)
>
> Migration **0050** applied and verified **by query** on dev, staging and
> prod; CLI re-linked to wilson-dev. pgTAP suite **60**: 32 assertions. Full
> set **60 suites / 1014 assertions** clean; vitest **1048 / 48 files**.
>
> **What shipped.** `workspace_storage` gains `provider` (TEXT + CHECK — the
> post-0000 house shape; named enums exist only in 0000) and one JSONB
> `provider_config`, with four constraints: the vocabulary
> (`petal`|`network`), the mode↔provider rule, the **converse arm** (no
> `root_path` unless `provider='network'`), and per-provider config
> validation written as the general rule so S37 inherits it. `public.files`
> gains **`files_money_provider_chk`**. On the client,
> `src/tools/rabbit_v0.1.0/storage/` holds the four-function contract
> (`put`/`get`/`del`/`exists` + `describe`), `registerStorageProvider()`
> refuses an incomplete implementation, `fileProviderFor()` is the one mapping
> and the money pin, and `resolveFileProvider()` routes a read from **the file
> row** rather than from whichever adapter happens to be running. Supabase is
> registered and `uploadFile`/`downloadFile` go through it, so the registry
> has a live caller on day one rather than on S37's.
>
> 🚨 **The brief was wrong in four places, all found by measuring rather than
> by reading it.**
> 1. **0048's five CHECKs did NOT need conditioning on `provider='network'`,
>    and conditioning them would have been strictly worse.** A pathless row
>    satisfies all five already, so they are inert for a bucket provider and
>    binding for a NAS. Rewriting them could only weaken them. **They are
>    untouched** — a stronger proof the NAS path is unchanged than any test.
>    What was missing is the **converse**, which nothing had.
> 2. **The backfill's stated reason was false.** The brief asserted existing
>    `byos` rows carry a real filesystem root. Measured: the entire live corpus
>    of `workspace_storage` is **ONE row** (staging, `byos`, `root_path`
>    NULL — an admin mid-setup); `public.files` holds **zero rows on all three
>    envs**. `byos → network` survives, but because `network` was the only byos
>    provider that existed, not because of a path.
> 3. **The vocabulary is TWO lists, not one.** `workspace_storage.provider`
>    (chosen) and `files.storage_provider` (where this body is) cannot merge,
>    because a financial file is `supabase` whatever was chosen.
> 4. **"122-method backend adapter" is wrong** — 116 / 104 / 68, union 133,
>    and no declared interface exists (a 93-property JSDoc typedef,
>    unenforced). The **57 `readOnly()` stubs** figure IS exact.
>
> 🚨 **S34's own pgTAP suite caught a real defect in this session's first
> draft.** `provider` was bound to `mode` by a **biconditional**, which reads
> well and silently deletes 0048's retyping rule — *"a root, when present,
> survives a switch back to 'central'"*. Forcing `provider` back to `'petal'`
> on that switch loses the retained provider exactly as losing `root_path`
> would lose the retained path. The rule is one-directional (`byos` requires a
> real provider); **central + network + a path is legal, inert and retained**,
> and both layers that could act on it already gate on `mode`.
>
> 🚨 **MEASURED, and it will cost a future session otherwise: Postgres reports
> a CHECK violation by the ALPHABETICALLY FIRST constraint name, not the one
> declared first** (probed on dev with `zz_declared_first_chk` /
> `aa_declared_second_chk` over one predicate). `throws_ok` matches `SQLERRM`
> exactly, so a carelessly-named constraint steals an existing suite's message
> and the failure reads as unrelated. Hence
> `workspace_storage_root_provider_path_chk` (the `root_` prefix sorts it past
> `root_canon`/`root_pair`), and hence suites 58/59's fixtures now NAME
> `provider` so each probe violates exactly one constraint. **Adding a column
> also broke eight fixture INSERTs** across 58/59 until `provider` got a
> default that pairs coherently with `mode`'s.
>
> **The pre-deploy adversarial review earned its keep for the fourth session
> running: 40 findings raised, 35 refuted, 5 confirmed (1 medium, 4 low)
> against code already green on 60/60 pgTAP and 1048 vitest.** The medium is
> the one worth carrying: **the probe labelled "row axis" pinned nothing.** It
> inserted `is_financial=true` at an `INVOICES` path, so the PATH arm refused
> it anyway — delete `COALESCE(is_financial,false)` from the constraint and
> suite 60 still reported 31/31. The five whole-constraint breakers could not
> see it, because **a breaker that neuters a whole constraint is arm-blind by
> construction.** Fixed by isolating the row axis over an ordinary path, and
> **re-proven with ARM-level breakers**: dropping the row arm now fails
> exactly one probe, dropping the path arm exactly three.
> 🚨 **And that re-proof exposed a second trap: once a migration is APPLIED,
> migration-modifying breakers are silent no-ops**, because every `ADD
> CONSTRAINT` is wrapped in `EXCEPTION WHEN duplicate_object`. Both arm
> breakers passed 32/32 until the breaker was made to `DROP CONSTRAINT` first.
> **Run breakers before deploying, or drop explicitly.** The other four
> confirmed findings were comment defects in this session's own work: a
> `split_part` claim that was simply wrong (`projects/<id>/PROJECT.json`
> yields `'PROJECT.json'`, not `''` — the probe passes because
> `rabbit_money_segment('PROJECT.json')` is false), header probe ordinals off
> by one, an overstated "every one of 0048's five CHECKs" line, and a line
> citation this very diff invalidated.
>
> ⚠️ **Recorded rather than hidden:** the `split_part` extractor in
> `files_money_provider_chk` is NOT the same as 0042's
> `storage.foldername(name)[3]` — they agree for every four-field-or-longer
> path (i.e. every uploaded file) and diverge at depth three, where this CHECK
> is the **stricter**. Deliberate, and now written down.
>
> ⚠️ **Three things the review raised that are NOT defects today but are traps
> for the next session, recorded rather than dismissed:**
> - 🚨 **`provider_config_chk` PERMITS a config; it does not REQUIRE one.** A
>   future `provider='s3'` row with `provider_config` NULL would satisfy it —
>   "looks configured, resolves nowhere", i.e. this migration's own hole one
>   provider later. S36 cannot write the arm (it cannot know s3's required
>   keys), but **every provider that needs config must add its own
>   required-direction arm**. An earlier draft of 0050's comment implied S37
>   need not touch that constraint; corrected, and carried into S37's brief.
> - **The deploy order was load-bearing, not ceremony.** `fetchWorkspaceStorage`
>   now selects `provider, provider_config`; against a database without 0050
>   PostgREST errors, and App.jsx's catch (S34's "a failed read pushes
>   nothing") swallows it — every desktop would silently fall back to its local
>   disk. 0050 reached all three envs BEFORE the push, so no window existed.
>   **A future schema-dependent select must ship in the same order.**
> - **An already-installed client that predates this commit cannot select
>   "Your server / NAS".** It patches `{mode:'byos'}` with no provider, which
>   `mode_provider_chk` now refuses. Harmless in practice — the web bundle
>   redeploys on push and **no desktop release carries S34's Storage section
>   yet** (v1.0.0 is prepared, not tagged) — and the failure is a visible save
>   error, not silent. Recorded because the mechanism is real. Deliberately not
>   papered over with a trigger that repairs the row: 0049 set the precedent
>   that a malformed write is refused, not repaired.
>
> **Stated limits.** `uploadFile` passes `WORKSPACE_PROVIDERS.PETAL` as a
> **constant** — the cloud adapter IS Petal cloud, and S37 changes that one
> argument, not a branch. ⚠️ Not *quite* one line: `fileProviderFor('network')`
> returns `local_server`, which this registry deliberately does NOT register
> (a browser cannot write to a NAS), so a cloud-mode workspace configured as
> `network` must be refused with a sentence rather than routed. `provider_config` has **no reader yet**; it exists so
> S37 cannot add flat per-provider columns, and its CHECK is the live
> enforcement. The `rabbit:set-workspace-root` IPC payload still carries no
> provider, which is correct while only `network` has a path. **No provider UI
> was added** — `AdminTerminalPage` records that Storage was the seventh
> section and the terminal is at the 7±2 limit, so S37's picker must extend
> `StorageSection`, not append an eighth. And **nothing here has been watched
> working by a human**: no NAS exists in this room and nothing in this repo
> signs in as Audrey.
>
> ### S35 outcome — the folder half, bounded (2026-08-07)
>
> Migration **0049** (`fn_project_folder_root_guard` on `public.projects`)
> applied and verified **by query** on dev, staging and prod; CLI re-linked
> to wilson-dev. pgTAP suite **59**: 31 assertions, proven by **four
> breakers, each failing exactly its own probes and nothing else** —
> removing the COALESCE failed only the claim-less probe (the 0047
> NULL-skips-the-IF shape, live: `can_write_project`'s unstaffed arm admits
> a NULL-claim caller through RLS, so the guard's COALESCE is the only
> thing refusing them); removing containment failed the three boundary
> probes; removing the unchanged-skip failed the two overblock controls (a
> member's ordinary edit and the adapter-echo shape); removing the anchor
> check failed the three no-drive probes AND demonstrated the NULL
> propagation it exists to stop (`left(x, len+1) <> NULL` is NULL, which an
> IF skips — the anchor must precede containment). Full set **59 suites /
> 982 assertions** clean; vitest **1022 / 47 files**.
>
> 🚨 **The pre-push adversarial review earned its keep for the third
> session running: 8 confirmed findings (2 high) against code already green
> on 27/27 pgTAP and 1013 vitest, all fixed before the commit.** The two
> highs are the ones worth carrying:
>
> - **`files_dir` was the real bypass, and S35 had guarded the wrong
>   column first.** `resolveProjectFilesDir` consults `project.files_dir`
>   **before** `folder_root`, and `files_dir` rode the unfiltered
>   `...req.body` spread on both routes — so an unauthenticated local
>   caller could repoint every file read and write at any directory while
>   the shiny new folder_root guard looked on. It also *promotes* that
>   directory into `isUserAuthorizedRelinkDir`'s roots. Now: CREATE forces
>   it null (a new project has no relink base), PATCH may only CLEAR it
>   (the reset control) or echo it unchanged; a changed non-empty value is
>   refused — the relink-apply route stays its one writer. **Guarding a
>   field means guarding whatever OUTRANKS it in resolution.**
> - **The client gate applied a cloud-only seat in every adapter mode.**
>   `canSetProjectFolder` read `appRole` unconditionally, so a
>   `local_server` or signed-out solo desktop (role null, ready true) had
>   both Change buttons permanently greyed — a control that worked before
>   S35 and that no local layer refuses. Now keyed on `workspaceId`,
>   exactly as S34's `canEditMachineRoot` is: no workspace → the route
>   contains, the seat does not apply.
>
> The other six, all fixed: the preflight created the directory BEFORE the
> authoritative write, so a cloud refusal (seat, or "no byos drive" — which
> the local IPC cannot see) stranded an empty folder — the flow now
> **writes first and materialises second**; the web build showed both
> buttons enabled and silently did nothing (they now render only where the
> OS picker exists); the 0049 post-condition matched a bare `COALESCE`,
> which the ANCHOR's own COALESCE satisfied — so removing the load-bearing
> seat COALESCE passed the only check that runs against prod (now matches
> `COALESCE(public.current_app_role()`, and re-proven by breaker on dev,
> then run by hand on staging and prod); the cross-workspace anchor probe
> ran against an EMPTY `workspace_storage` and so could not tell
> "per-workspace anchor" from "no rows exist" (workspace B now configures
> its **own** drive, and the refusal names B's path); the guard's INSERT
> branch had zero coverage (two probes added); and `folderMsg` never reset
> on project switch.
>
> **What shipped:** `folderRootRefusal()` in main.cjs — the ONE local
> decision about a folder_root candidate (shape via the new
> `checkFolderRootShape` in `pathContainment.cjs`, unit-tested;
> containment via `isPathInside`) — enforced on the project CREATE route,
> the PATCH route, **and** `rabbit:ensure-project-folder` (the S34
> refusals-in-depth rule — the IPC refuses on its own, whoever calls it).
> `files_dir`, which OUTRANKS folder_root in resolution, is forced null at
> create and may only be cleared or echoed at patch. Rule: workspace root
> pushed → strictly inside it, dialog picks
> do not override; no workspace root → the S14 model stands (machine
> default or dialog-picked). Cloud: the 0049 guard — seat
> `current_app_role() IN ('admin','manager')` COALESCE'd, canonical-form
> refusals matching 0048's discipline, containment strictly inside a
> **byos** `workspace_storage.root_path`, per-workspace anchor. UI: both
> Change buttons ride one `pickAndSetProjectFolder` flow (write first,
> materialise second), rendered only where the OS picker exists and gated
> by `canSetProjectFolder` — **cloud-only, keyed on `workspaceId`**, fail-open
> on `ready` like `canOnProject` (unlike money — the enforcement below makes
> that safe), greyed-with-reason via `GatedAction`, refusal sentences
> surfaced instead of swallowed.
> **`folder_root` joined the supabase adapter's `PROJECT_COLUMNS`** — the
> cloud write had been silently stripped since 0040, so on a desktop
> running the cloud backend "Change folder" did nothing; it ships WITH its
> guard. `SYSTEMS_HANDBOOK.md` gained §12.7 (the workspace drive, the NAS,
> remote access — the customer-facing setup guidance S34 owed) and a §17
> limits block.
>
> **Seat scope, deliberate and visible:** the guard reads the app-role
> claim only — a project manager holding app role `user` cannot set their
> project's folder. Audrey's sentence names "managers" without qualifying;
> the brief resolved it to the workspace seat (the 0012/0013 pattern). If
> beta shows project managers need it, `fn_project_folder_root_guard` and
> `canSetProjectFolder` change together — recorded in §17 too.
>
> **Stated limits:** the folder controls are **desktop-only** (they need the
> OS directory picker — design §5f); clearing folder_root is seat-gated but
> needs no drive (a reset, not a placement); the guard leaves existing rows
> untouched
> (folder_root was NULL on every row of all three envs — measured before
> writing, and the unchanged-skip means legacy values would keep working
> anyway); `ensureProjectFolder` on the web build remains a no-op (the
> writers are desktop-only); the §4c five-minute check — does Audrey's
> NAS's remote-access mode preserve the UNC form? — is **STILL OWED**
> before remote work is promised to a customer.
>
> ### S34 outcome — the root lives with the workspace (2026-08-07)
>
> Migration **0048** (`workspace_storage` + the fn_workspaces_client_guard
> storage arms) applied and verified **by query** on dev, staging and prod;
> CLI re-linked to wilson-dev. pgTAP suite **58**: 31 assertions, proven by
> **five breakers** — deleting the claim arm failed EXACTLY the
> dual-workspace probe (perfect single-probe discrimination); deleting the
> membership arm failed its two probes; deleting the role arm failed its
> probe plus the expected cascade; stripping the guard arms was caught TWICE
> (once by 0048's own post-condition, which aborts a 0020-style replay, and
> once by probes 7/8/27/28 when the post-condition was also neutered); and
> the overblock control (an admin rename passing through the guard) passed in
> every run. Vitest **972 / 46 files**.
>
> **What shipped:** members read / admins write the workspace storage root
> (mode `central`|`byos`, canonical UNC `root_path`, `root_kind`); the Admin
> Terminal's seventh section (Storage) with the §5a2 refusal table — mapped
> drives (Electron `net use` detection), bare share/drive roots, dot-segment
> and device-namespace paths — the reachability probe at configuration time,
> and the two-step local-folder confirm; the legacy
> `workspaces.storage_mode`/`storage_config` live wire closed in the guard
> (TPN-CLOUD-007); `resolveConfiguredRootDir()` as the ONE definition of the
> machine's effective root (project `folder_root` → workspace root → machine
> default → internal), consulted by all four main.cjs resolvers, by
> `isUserAuthorizedRelinkDir`'s roots, and — via the computed
> `effectiveRootDir` on the read-files-config IPC — by FileManager's three
> renderer-side path builders; the S31-shaped teardown (sign-out pushes a
> null root); and the TPN-AUTH-009 gates on BOTH machine-root surfaces
> (StorageConnections **and** SettingsPage — the second was found by this
> session's mapping pass, not by the brief).
>
> **The pre-deploy adversarial review earned its keep again: 20 confirmed
> findings (3 high) against code that was already green on 31/31 pgTAP and
> 972 vitest.** The three highs: the IPC handler accepted the bare
> `\\server\share` the UI refuses (refusals now enforced in depth, not only
> at the surface); the App push-effect turned a TRANSIENT Supabase read
> failure into an active retarget onto the machine default — the
> split-storage failure the design itself calls worse than a visible one
> (now: a failed read pushes nothing; last-known-good wins; sign-out still
> pushes null because that is a real state change); and FileManager's three
> fallback path-builders still read `defaultRootDir` directly, so the
> renderer and main would have resolved DIFFERENT roots the day a workspace
> root existed. Also from review: a `root_kind='local'` row is §3.1 in a
> database — main now applies a local-kind root only where the folder
> actually exists; `net use` failure classifies 'unknown', never 'local'
> (the refusal must not vanish exactly when detection breaks); and the
> kind↔shape CHECK stops a row whose `root_kind` lies about its path.
>
> **Stated limits, deliberate and recorded here rather than hidden:** a
> changed root reaches other machines at their next launch/sign-in — there
> is no live re-broadcast, and the Storage section's success notice says so;
> the workspace root feeds the same SYNCHRONOUS fs calls every root always
> has, so a NAS that dies AFTER passing its configuration-time probe can
> stall the main process for the SMB timeout on a file operation (async
> resolution is S40/S42-scale work, not a patch); the web Admin Terminal
> cannot probe reachability or detect mapped drives and says so instead of
> pretending; and "root unknown because the read failed" is not modelled as
> a distinct state in main — last-known-good stands in for it.
>
> ⏳ **NOT YET WATCHED WORKING.** Nothing in this repo signs in as Audrey,
> and no NAS exists in this room. The section renders behind the admin gate,
> every wire is pinned by `workspaceRootWiring.test.js`, and the refusal
> table is unit-tested — but no human has watched a second computer resolve
> a root set on a first one. Her numbered checklist is in the S34 close-out
> chat message, and §4c's five-minute check (does her NAS's remote-access
> mode preserve the UNC form?) is STILL OWED before this is promised to a
> customer.
>
> ### S33 outcome — the guard takes a root, and reads leave a record (`ed85072`, `439f702`)
>
> Migration **0047** (`downloaded` in the `file_events` vocabulary +
> `log_file_downloaded`) applied and verified **by query** on dev, staging and
> prod. The guard lives in **`electron/pathContainment.cjs`** now — extracted
> so it is unit-testable — with the escape cases pinned BEFORE the root cases.
> pgTAP suite 33: plan **26 → 44**, proven by **six breakers** (three fired
> where designed, one passing breaker verified the 0027-re-run claim, and two
> found real holes — see below). Full set **57 suites / 920 assertions**,
> tap-all clean. Vitest **940 / 44 files**.
>
> **The session ran an adversarial review before deploy (TPN-NET-013), and the
> review earned its keep three times:**
>
> - **The RPC's first draft replicated `projects_select` and MISSED 0038's
>   money arm** — a plain member could confirm invoice ids exist, mint invoice
>   metadata (name, path, size) into `file_events`, and forge an audit record
>   of a read the storage policies would refuse. Three independent verifiers
>   confirmed it. Fixed; probes 28/29 pin it from both sides.
> - **The fix then failed its own probe: `can_access_project_money` returns
>   NULL, not false, for a claim-less non-manager.** In a policy that NULL
>   fails CLOSED; in the RPC's `IF` it failed OPEN — `true AND NOT NULL` is
>   NULL and the refusal never fired. The 0042 coalesce lesson, inverted:
>   **moving a policy predicate into procedural SQL flips its failure
>   direction.** The `COALESCE(..., false)` is load-bearing and commented so.
> - **Two breakers PASSED that should have failed**, and each taught something:
>   deleting the workspace-claim check left every probe green (the plain
>   cross-workspace caller is refused by membership first — only a
>   dual-workspace member signed into the wrong workspace discriminates, now
>   probe 24), and deleting the membership check was invisible until probe 30's
>   revoked-member-with-stale-JWT caller existed. **A refusal probe pins ONE
>   check only if every other check waves its caller through.**
>
> **Scope facts measured, not assumed:** the local GET now logs without
> stamping `project.updated_at` (a read must not reorder the project list) and
> inside try/catch (an audit hiccup must not 500 the download). The default
> desktop managed-files flow has **no WILSON-mediated read to log** — the
> "download" button is `openInExplorer` and content sits in user-visible
> folders — so AS-2.9 coverage there arrives with S40's serving routes, noted
> in that brief. Cloud logging is **advisory by construction** (a direct
> storage REST call bypasses the adapter); server-side enforcement would need
> its own design. `googleDriveAdapter.downloadFile` (legacy read-only) logs
> nothing, knowingly.
>
> **Also fixed in passing (`439f702`):** suites 56/57's final postgres-side
> counts were unscoped `count(*)` over per-user tables — correct only while
> the tables were empty, and dev now carries a real pet row. tap-all caught it
> the first run after 0047 landed. **A postgres-side probe must bring its own
> scope; RLS was doing the scoping everywhere else in those suites.**
>
> ⚠️ **One finding was real and deliberately NOT fixed here:**
> `file_events_select` (0027) has no money arm, so invoice lifecycle metadata
> is readable by every project reader — pre-existing, now in `OUTSTANDING.md`,
> and entangled with purged certificates (a purged invoice's certificate has
> no `is_financial` to classify by). It needs a design decision, not a patch.
>
> ### S31 outcome — the pet follows the person (`272fb83`, `29d36fc`)
>
> Migration **0046** (`user_pets`, `user_settings`) applied and verified **by
> query** on dev, staging and prod. pgTAP **56 + 57**, 48 assertions, proven by
> **seven breakers including a control**. Full set **57 suites / 902
> assertions**. Vitest **909 / 43 files**. All four CI jobs green on `272fb83`,
> Playwright included.
>
> 🚨 **THE SESSION'S REAL FINDING IS NOT THE FEATURE. The settings half shipped
> in `272fb83` with ZERO CALLERS** and was caught by grepping for callers while
> writing the close-out, not by any test. That is the **sixth** instance of the
> shape in this repo — after the folder tree (S27), task templates (S28), quiz
> history (S30), `setOtterAdapterMode`, and `POST /api/pet/reset` — and the
> circumstances are what make it worth recording:
>
> - This session's brief warned about it **in five separate places**.
> - A call-site guard (`userStateWiring.test.js`) had already been written **for
>   the pet half**, specifically because a test that pins a mechanism cannot
>   tell you the mechanism is reached.
> - `userState.test.js` covered the settings functions **in full and passed** —
>   the quiz-history situation exactly: a green unit test over a dead path.
>
> **Writing a call-site guard for half a change is how the other half goes
> dead.** Fixed in `29d36fc`, with five more breakers.
>
> **Three claims in the planning documents were wrong, and are corrected in the
> migration header rather than only here:**
>
> - **"Store `last_fed_at` and compute on read."** `lastFedAt` is written by
>   `handleFeed` and **read by nothing**. The decay anchor has always been
>   `lastUpdatedAt`.
> - **The schema census** — not "44 / 39 / one purely per-user", and not the
>   corrected "45 / 40 / two" either in the sense that mattered:
>   `auth_attempt_log` is **not per-user at all** (it has a `workspace_id`
>   column and an operator-read policy) and `platform_operators_self` is
>   **SELECT-only**. 0046 writes the project's **first** per-user
>   INSERT/UPDATE/DELETE policies. There was nothing to copy.
> - **0045's own header** says neither 0041 nor 0044 issues a `GRANT`. Both do.
>
> **The fix was a DELETION.** The 30-second whole-object auto-save is gone, and
> that — not any sync mechanism — is what stops two computers clobbering each
> other. It was worst where it looked safest: the decay reducer returns the
> identical object reference for an egg, a corpse, a ghost or `petMode` off, so
> `petData` never changed, the effect was never torn down, and it fired cleanly
> over the other machine's live state. **Audrey's pet is a ghost — one of those
> four.** Nothing was lost, because hunger and happiness are a value at an
> anchor and decay needs no writes at all.
>
> ⚠️ **Sign-out and the pet had to ship together.** `clearSession()` has never
> cleared the pet; the previous person's kept decaying, kept saving, and
> reappeared for the next person to sign in. Shipping the button Audrey asked
> for **without** the teardown would have turned a latent leak into a routine
> one. Sign-out is now `scope: 'local'` — it was an unscoped global revoke that
> would have dropped her operator console at its next token refresh.
>
> **Not carried between computers, all measured:** `adapterMode`,
> `activeProjectId`, `storageLocation`, `defaultRootDir` (a local disk path
> names a *different* folder on another machine), `departments` (workspace
> data), and `companionName` (a duplicate of the pet's name with zero readers).
>
> ⏳ **NOT YET WATCHED WORKING.** Nothing in this repo signs in as Audrey. The
> adoption path especially is proven by unit tests and reasoning, not by
> observation — and it is the part that could destroy a pet she likes. Her
> numbered checklist went into the chat at close-out.

> **S33–S42 are designed, scoped, TPN-reviewed and briefed** —
> `docs/NETWORK_STORAGE_DESIGN.md` + `TPN_AUDIT/DESIGN_REVIEW_network_storage.md`
> (2026-08-05). **Every open question was answered by Audrey the same day
> (§1b); nothing is blocking.** The design was first sized as one session and
> **that was wrong** — Audrey asked directly and it re-cut into the six above.
>
> The finding that reframes the whole request: **WILSON has no server to leave
> on.** The Express instance binds `listen(0, '127.0.0.1')`
> (`electron/main.cjs:2800`) — loopback, ephemeral port, created inside
> `createWindow()`, dead when the app closes, on whichever laptop has WILSON
> open. *"Toggle external access on the server"* is not a setting over an
> existing capability; the capability does not exist. ⚠️ It also has **94 routes
> and zero authentication** — the loopback bind is the entire access control.
>
> ⭐ **The answer is the customer's NAS (§4c).** A NAS *is* the always-on server,
> it presents as the UNC share S34 supports, and prosumer boxes ship their own
> VPN server and vendor relay as configuration rather than a project — so
> *"won't set up a VPN"* stops implying *"can't have remote access"*. **This
> makes the bespoke gateway probably unnecessary**, which matters because TS-2
> names bastion/VPN as *the* remote-access control. **The cheapest route and the
> compliant route turned out to be the same route.**
>
> 🚨 **Three upload paths, three different ceilings — never generalise one
> adapter's limit to another.** Local-Server `files` caps at **~37 MB** and no
> config fixes it (base64 through a JSON body, whole file buffered both ends);
> **cloud `files` caps at 50 MB and IS raisable** (it hands the `File` straight
> to Storage — different code entirely); `managedFiles` has **no ceiling**
> (native stream). The design initially generalised the Local-Server measurement
> to cloud and concluded "cloud is for the small stuff" — **Audrey caught it by
> asking what a cloud-only customer is supposed to do.** S42 exists because of
> that correction. **A storage mode that cannot hold the customer's files is not
> a storage mode.**
>
> ⚠️ **S33 is worth doing even if everything else stops** — it fixes a MEASURED
> live defect (a drive root or share root as the storage root breaks every file
> operation; see `OUTSTANDING.md`) and that defect blocks the rest.
>
> **Two more live defects were found while designing, both in the TPN review:**
> `TPN-AUTH-009` — `StorageConnections.jsx` imports `usePermissions` and gates
> on **nothing**, so any member can repoint the root (closed by S34); and
> `TPN-NET-015` — `projects.folder_root` is written straight from the request
> body with no containment check, on an unauthenticated local API (closed by
> S35). **Both were surfaced by Audrey specifying a permission model, not by the
> audit passes looking for them.**

> ⚠️ **THE SEQUENCE GAINED THREE SESSIONS (Audrey, 2026-08-04).** After S28's
> close-out she reported three things and asked for them to be split:
> *"parse them out into one session for timeline, one for otter, then
> settings."* The design pass moved S29 → S32 at the time; it has since moved
> again and is now **S40** (`SESSION_40_prompt.md`) — see the table above,
> which is the authority. Its brief already existed and was renamed twice, with
> a header explaining which of its contents are stale.
>
> **What each one is, and what was MEASURED before writing the brief** — none
> of these three was sized from the symptom:
>
> - **S29 — the Timeline gate.** The four-session "New task button disappears"
>   mystery is **resolved, and nothing was broken where everyone was looking**:
>   `tester` holds no seat on a staffed project, so the button is correctly
>   hidden. The real defect is the inverse — `TimelineView.jsx` has **zero**
>   occurrences of `canWrite`/`canOnProject`/`usePermissions`, the only
>   task-creating surface with no gate, so it offers a control the database
>   then refuses with a raw policy string. **A dozen affordances funnel through
>   one `openNewTask`; gating only the funnel would recreate the S23 "button
>   does nothing" bug.**
> - **S30 — O.T.T.E.R.** The one-line entry is **three defects and two are not
>   what it says**: validator findings genuinely need building; "apply fix"
>   works in CLOUD and 404s on Local Server; and **quiz scores have a complete
>   storage path — column, adapter, routes, a PASSING unit test — that nothing
>   ever calls.** Sizing it as "add persistence for two things" would have
>   produced a duplicate table.
> - **S31 — settings and the pet.** Not a sync bug: `localData.js` is
>   per-device by construction and says so in its own header. ✅ **Scope
>   settled — one pet and one set of settings per PERSON, everywhere**, not per
>   workspace. 🚨 **The migration is the dangerous part**: Audrey has a pet she
>   likes on this machine, and a naive cloud-read wipes it.

> ⚠️ **THE SEQUENCE GAINED A SESSION (2026-08-04).** The design pass was S28
> and is now S29. Task templates had been deferred three times — twice
> because a session ran out of room, and once (S27) because Audrey was asked
> directly and chose to finish the file layer properly instead.
>
> ⚠️ **S28 SHIPPED THE TEMPLATES AND DID NOT CLOSE THE VERIFICATION SWEEP.**
> Its brief scoped both. The templates are done and proven end to end at the
> database; the runtime items still need a signed-in session against the beta,
> which nothing in this repo automates. They carry to S29.
>
> ✅ **BUT THE CHANGE OF APPROACH WORKED, AND IT IS THE LESSON.** For four
> sessions Audrey had been asked, in general terms, to confirm things at
> runtime. S28 gave her a **numbered checklist naming the screen, the click and
> what a pass looks like** — and she came back within the hour with the
> observation that resolved the `canWrite` investigation outright, plus two
> defects nobody had found (the ungated Timeline, and the pet not following the
> user). **Ask specifically, at the START of the session, and the answers
> arrive.** A general "please verify this on the beta" produced nothing four
> times running.

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
- ~~**S26** → `folder_slug`, `folder_root`, `files_dir`.~~
  ✅ **DONE by 0041 — and this line was WRONG about the third column.**
  `folder_slug` and `folder_root` were added; **`files_dir` was not, and
  should not be.** MEASURED 2026-08-04: the writer this line rests on
  (`ProjectSummaryView.jsx:1010`, `update('files_dir', null)`) sits inside
  `{project?.files_dir && ( … )}`, so it renders only when the column is
  already NON-NULL and all it ever writes is null. The only thing that sets a
  non-null value is the local Express relink route, and
  `relinkScan`/`relinkApply` are **local_server ONLY** — zero occurrences in
  the Supabase and Drive adapters, and `adapters/index.js:121` says so in the
  contract. On Supabase the value can never become non-null, the block can
  never render, and the write can never fire.

  This is the FOURTH time a plan document has named a column the code does not
  write (S20's migration number, S24's `margin`, S25's `code`) — but it is not
  the same KIND of error as `code`, and conflating them would cause the
  opposite mistake. `code` is a wrong NAME that must never exist, and 0040's
  suite asserts its absence. `files_dir` is the RIGHT name for a feature with
  no cloud implementation, i.e. `task_template_id`. **It arrives with relink,
  not before, and nothing asserts its absence** — pinning that would only have
  to be deleted by the session that legitimately adds it.

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

### ✅ S26 OUTCOME (2026-08-04, `071682b`) — the folder tree, and a fourth plan-vs-code miss

**Migration 0041** creates `public.folders`, applied and verified **by query**
on dev, staging and prod: RLS enabled *and* forced, four policies, no `FOR ALL`
arm, nine CHECK constraints, eight FKs, and **zero privileges held by `anon` or
`PUBLIC`** — checked by scanning every grantee, not by trusting the REVOKE.
52 pgTAP suites / **790 assertions** (768 → 790), `planned == collected` on
every one. 658 vitest (583 → 658).

**A TABLE, not a path convention** (Audrey, 2026-08-04, settled). Supabase
Storage has no real folders — it is object storage with prefixes, so an EMPTY
folder cannot exist, and "toggling a category off must never delete the
folders" needs a folder that outlives its contents.

**Paths are computed CLIENT-side** in `folderPaths.js` and stored, following
S25's naming decision for the same stated reason: Local Server is a JSON bundle
with no Postgres in it, so a generated column would exist on one backend only.

> 🚨 **THE FOURTH CONSECUTIVE PLAN-VS-CODE MISS, and the first where the right
> answer was to add NOTHING.** S20 named the wrong migration number, S24 named
> `margin` instead of `budget_margin_pct`, S25 named `code` when the writer was
> `project_code`. This time both plan documents named `files_dir` — the right
> NAME, with a real citation — and the correct action was still to leave it
> out, because the writer is unreachable on the backend the column would live
> on.
>
> **The distinction is load-bearing and easy to get backwards.** `code` must
> never exist and pgTAP asserts its absence. `files_dir` SHOULD exist, later,
> alongside the relink feature it belongs to — so nothing asserts its absence,
> because that assertion would only have to be deleted by the session doing
> the legitimate work. "Grep for the writer" is not enough on its own: ask
> whether the writer can RUN on the backend in question.

> 🚨 **WHAT THE MANIFEST DELIBERATELY OMITS — the one part of Audrey's request
> S26 did not deliver.** She asked for "unique margin, unique contingency,
> unique team member rates". Margin and contingency are in `PROJECT.json`; the
> **rates are not**. MEASURED: `project_rate_overrides_select` is gated by
> `can_access_project_money` (manager only), while `rabbit_files_select` admits
> any authenticated user to any object under `projects/<id>/` whose third path
> segment is not `INVOICES` — and the manifest has no third segment. Including
> rates would hand every team member the figures RLS had just denied them, the
> S24 invoice defect in a new file. Recorded in `OUTSTANDING.md`; needs a
> money-gated path, which is S27's to design.

> ⚠️ **Two things found while building, both recorded rather than glossed.**
> A unit test caught a real defect before it shipped: `fileSlugify` strips
> everything non-alphanumeric, so an entity named `..` is TRUTHY and slugifies
> to `''`, giving a path of `SCENES/`. The idiom every existing caller uses
> (`name || 'Untitled-Thing'`) does not catch it — the guard has to be on the
> OUTPUT. And `.github/workflows/rls.yml`'s failure-replay list had **never**
> been exhaustive: thirteen original Session-2 suites were missing, so a
> failure in any of them produced the same misleading "no ERROR lines"
> annotation S17 was burned by. All 52 are now listed.

### ✅ S27 OUTCOME (2026-08-04, `5384d4e`) — and two defects nobody had recorded

**Migrations 0042 and 0043**, applied and verified **by query** on dev,
staging and prod. **53 pgTAP suites / 808 assertions** (52 / 790),
`planned == collected` on every one. **680 vitest** (658). All four CI jobs
green, Playwright included.

> 🚨 **THE PROJECT MANIFEST COULD ONLY EVER BE WRITTEN ONCE, AND THE CODE SAID
> OTHERWISE IN A COMMENT.** S26 shipped `PROJECT.json` as a mirror "rewritten
> whenever settings change". Supabase Storage implements upsert-over-an-
> existing-object as an UPDATE on `storage.objects`, and that bucket has never
> had an UPDATE policy — 0027 created SELECT/INSERT/DELETE, 0038 and 0039
> rewrote those and added three more for invoices, all SELECT/INSERT/DELETE.
> So the first write landed and every subsequent one was refused, silently,
> for the life of the project: `writeManifestSoon` caught the throw and logged
> *"the manifest is a mirror and is rewritten on the next change."*
>
> Found by reading the policy catalogue and then **measured before anything
> was written** — INSERT succeeds, UPDATE affects ZERO rows, and the same
> UPDATE against `user-avatars` succeeds, so the probe could see a presence
> rather than merely fail to see an absence (standing rule 2).

> 🚨 **THE FOLDER TREE HAD NEVER PRODUCED A ROW. ANYWHERE.** MEASURED on all
> three environments: `public.folders` held **0 rows** on dev (3 live
> projects), staging (1) and prod (0). Not a bug in 0041 — the tree was
> correct. `ensureProjectFoldersFor` had exactly ONE caller, `createProject`,
> and every project in existence predates 0041, so a tree only appeared if
> someone happened to create an asset or scene. Nobody had.
>
> That was invisible while nothing displayed the tree. S27 puts it on screen,
> where it would have read as broken software for every project Audrey owns.
> It now reconciles on load, idempotently, skipping read-only backends.
>
> **The general lesson: a feature with no caller has no symptom.** Three green
> CI jobs, a pgTAP suite of 22 assertions and a verified migration all said
> the folder tree was fine, and all of them were right. What none of them
> could say is that it never ran.

> ⚠️ **THE FILE LAYER WAS THREE DISCONNECTED STORES**, and this is what
> "files everywhere" actually meant:
>
> | store | state before S27 |
> |---|---|
> | `public.files` + `rabbit-files` | worked; the only surface using it was a read-mostly table |
> | `managedFiles` | local_server-ONLY, and FileManager gated it on `window.electronAPI` — true whenever WILSON runs as a desktop app, **including when the selected backend is Supabase**. Dead in cloud, and dead on the web twice over |
> | `project.documents` / `visualAssets` | base64 data-URLs on the project row. The cloud adapter REFUSES them (S15's `ATTACHMENTS_MSG`), so the Resources drop zone showed an honest error and went nowhere |
>
> The third one is worth stating precisely because it was nearly written up
> wrong: those uploads are **not** silent data loss. S15 made create and
> update throw rather than drop, deliberately. The defect was that the honest
> error was a **dead end** — it told the user to go to RABBIT, and completing
> the other half (routing that UI through `uploadFile`) had been deferred as
> §6 #31 ever since. That is now done for cloud; Local Server keeps the legacy
> arrays, because there they work and D.O.G. reads them.

> 🚨 **ONE PREDICATE, NOT A SECOND PARALLEL TRIO — the design decision.**
> Audrey chose (2026-08-04) to have project rates travel with the project
> folder, which needs a money-gated path beside `INVOICES`. Adding it the
> existing way would have written the reserved segment name into EIGHT
> policies that all had to agree, and the base three had to exclude BOTH —
> permissive policies OR together, so a base policy that forgot `FINANCE`
> serves the rates to every project member however correct the gated policy
> is. That is exactly how 0038 inverted the invoice gate.
>
> `public.rabbit_money_segment(text)` is now the only definition. It is
> **NULL-safe by construction**, which is load-bearing rather than tidy:
> `PROJECT.json` has no third path segment, so a bare `upper(seg) IN (...)`
> returns NULL, `NOT NULL` is NULL, and a NULL policy expression FAILS —
> making the manifest unreadable and unwritable by everybody. Removing the
> coalesce fails pgTAP 53 probes 1, 5 and 11 together.

> ⚠️ **WHAT IS BUILT AND NOT YET WATCHED WORKING.** Every new file surface —
> FileManager in cloud mode, the Resources drop zone, the folder/manifest
> panel, the rates mirror — is complete at code level and has **not** been
> exercised by a signed-in user. The app was confirmed to MOUNT (`#root` has
> 17 descendants and renders the login screen, and `RabbitProvider` wraps the
> whole tree including the unauthenticated branch, so that is real evidence it
> did not throw) — but nothing in this repo automates a signed-in session
> against staging. This is the same gap that has kept the two assignee
> dropdowns open since S24. → **S28 should watch them, once, and close both.**

> ⚠️ **A storage-path change was FREE this session and will not be again.**
> MEASURED 2026-08-04: 0 file rows, 0 folder rows, 0 storage objects and 0
> manifests on all three environments. That is why renaming
> `rabbit_files_invoices_*` and replacing every base policy was safe to do
> now. The ID-based object key (`projects/<id>/<entity>/<entityId>/…`) was
> deliberately KEPT rather than made human-readable: the third segment is the
> money gate, nobody browses a private bucket by hand, and the folder tree
> already provides the readable view. Local Server's real directories are
> where human-readable paths matter, and it has them.

### ✅ S28 OUTCOME (2026-08-04, `06bf564`) — and the first plan document in six sessions that named nothing wrong

**Migration 0044**, applied and verified **by query** on dev, staging and prod:
`public.task_templates` (RLS enabled *and* forced, four policies, no `FOR ALL`
arm, a composite FK, and **zero privileges held by `anon` or `PUBLIC`** —
scanned rather than assumed) plus `assets.task_template_id` with `ON DELETE SET
NULL` (`confdeltype` verified as `n`, not `c`). **54 pgTAP suites / 832
assertions** (53 / 808), `planned == collected` on every one. **698 vitest**
(680). Build clean.

> ✅ **AUDREY ANSWERED THE ONE QUESTION THAT GATED THE SQL** (2026-08-04):
> *workspace admins and managers globally; project managers additionally for
> templates pinned to their own project.* Asked because it genuinely was not
> derivable — the local server has no roles, so its wide-open routes say
> nothing about intent, and the two nearest precedents disagree with each other
> (money admits a project manager but **not** a workspace manager; the control
> panel admits reviewers but **not** members). A draft of the S28 brief had
> asserted an answer and it was struck out before the session started; that
> removal is the reason this is right.

> 🚨 **THE FEATURE HAD NEVER PRODUCED A ROW ON ANY BACKEND**, and this was
> MEASURED before a line was written rather than discovered afterwards.
> `%APPDATA%\wilson\rabbit-data\task-templates\` exists and is **empty** — so
> the count was zero on Local Server too, where the feature has worked the
> whole time, not merely in cloud where it was structurally impossible.
>
> That is S27's lesson arriving *before* the fact for the first time. Creating
> the table would have made 54 suites and 698 unit tests pass and changed
> nothing whatsoever on screen. So the session's exit criterion was not "the
> table exists" but "a template can be created and APPLIED":
> `scripts/probes/task-templates-e2e.sql` walks create → project read → asset
> stamped → template applied → **roles present** → template deleted without
> taking the asset, as an authenticated user against real rows, and rolls back.
> **6/6 on dev and on staging.**

> 🚨 **A DEAD BRANCH WAS HIDING A LIVE BUG, IN TWO PLACES.**
> `ProjectAssetsView` applied a template by sending `role_slug`. That is not a
> column — `tasks` has `assigned_role_slug` — and because `tasks` **has** an
> allowlist entry, `toColumns` dropped the key with a console warning instead
> of rejecting the request. Tasks were created successfully **with no role**,
> and every bid built from them priced at nothing.
>
> The probe's breaker reproduces it exactly: omit the key, as `toColumns` did,
> and step 5 reports `roles were [<NULL>, <NULL>]`. Two tasks, created fine,
> both worthless.
>
> ⚠️ **The allowlist tests could not have caught this and still cannot.** They
> pin `toColumns` — the mechanism — and say nothing about which key the CALL
> SITE sends, so reverting the view leaves every one of them green. That is
> what `taskPayloadKeys.test.js` is for, and it was proven by reverting one
> site: it named `ProjectAssetsView.jsx:1731`. It is deliberately narrow (the
> argument object of an `addTask()` call, nothing else) because a blanket
> "no `role_slug` in `src/`" scan would be wrong twice over —
> `TaskTemplateManager` uses the key legitimately inside the jsonb, and
> `budget_lines` has a real `role_slug` **column**.

> ✅ **`assets.task_template_id` ARRIVING HERE IS THE `files_dir` RULE BEING
> FOLLOWED, NOT AN EXCEPTION TO IT.** S23 kept it out because "a column for a
> feature with no cloud implementation is schema debt", and 0041 applied the
> same reasoning to `files_dir`. That rule was never "never add it" — it was
> **"it arrives WITH its feature"**, and both writers became reachable in this
> same commit. `files_dir` stays out, because its writer still cannot run on
> this backend. Three shapes now, and they must not be collapsed: `code` is a
> wrong NAME whose absence is asserted; `files_dir` is a right name still
> waiting for its feature; `task_template_id` is a right name whose feature has
> now landed.

> 🚨 **TWO OF THE SIX BREAKERS DID NOT FIRE, AND BOTH CORRECTED A COMMENT
> RATHER THAN THE CODE.** This is the part worth carrying:
>
> | breaker | result |
> |---|---|
> | `WITH CHECK` weakened to the workspace clause | probe 15 fails, alone ✅ |
> | **`WITH CHECK` omitted entirely** | **24/24 still pass** — Postgres reuses `USING` as the new-row check |
> | `can_write_project` instead of the new gate | probes 11 **and** 17 fail |
> | `CASCADE` instead of `SET NULL` | probe 22 fails |
> | composite FK dropped | probe 20 fails |
> | **`COALESCE` removed from the predicate** | **24/24 still pass** — defensive, not load-bearing today |
>
> The migration's first draft said "with `USING` alone a project manager could
> re-point their pinned template at NULL". **That was wrong**, and only running
> it showed so. The real hazard is a `WITH CHECK` that is merely *weaker* than
> `USING` — which is the shape `folders_update` and every other UPDATE policy
> in this schema already uses, so copying the house style is what would open
> it. The invariant is "WITH CHECK must not be weaker than USING on this
> table", not "remember to write a WITH CHECK".
>
> And the `COALESCE` result was predicted *in the comment being tested* — the
> header claims it is correct-by-accident through three-valued logic and one
> edit from inverting. The breaker confirmed the claim instead of refuting it,
> which is the point of writing a breaker you expect to pass.

> ⚠️ **WHAT S28 DID NOT DO, stated rather than glossed: the runtime
> verification sweep.** Its brief scoped both halves and this is the half that
> needs a signed-in session against staging, which nothing here automates. A
> concrete four-item checklist went to Audrey in the chat rather than a general
> ask; the observations had not returned before the work was committed. The
> three items carry to S29 **unnarrowed** — no entry was quietly closed.

> ⚠️ **ONE STATED LIMIT OF WHAT SHIPPED**, recorded here rather than in
> `OUTSTANDING.md` because it is a scope choice and not breakage.
> `canWriteTaskTemplate` needs the caller's seat on *that template's* project,
> and the only per-project role the app holds is `myProjectRole` for the
> project currently OPEN. So a project manager looking at a template pinned to
> a **different** project sees it read-only, while the database would let them
> edit it. It fails CLOSED, it is documented in the function, and the
> alternative is a roster query per project from a Settings screen with no
> project context.

### ✅ S29 OUTCOME (2026-08-05, `7443fed`) — the first session in this run with no migration, and four defects nobody had recorded

**No SQL.** The schema was already correct: `tasks_insert` requires
`can_write_project(project_id)` (0013) and always did. The entire defect was
that the client never asked. Migrations stay **0000–0044**, pgTAP stays **54
suites / 832 assertions** (unchanged, re-run green in CI). **803 vitest**
(698 → 803, 35 → 36 files). All four CI jobs green on `7443fed`, Playwright
included.

> 🚨 **THE FIX IS NOT "ADD A GATE TO THE TIMELINE", AND SIZING IT THAT WAY
> WOULD HAVE SHIPPED THE S23 BUG AGAIN.** ~12 create affordances funnel through
> one `openNewTask`. Gating the funnel alone leaves all twelve visible and
> inert — which is precisely "the button does nothing". The funnel and the
> affordances had to move together, and they did.
>
> **The brief's own citations were right but its characterisation was wrong on
> one point, which is worth recording because it changed the fix.** It called
> `:5826`–`:6440` "context-menu items". They are `kind: 'drop-zone'` **row
> descriptors** emitted by six `buildRowsBy*` functions. So the change was not
> "gate a menu" but "let the builders keep emitting them and have the two
> renderers show them disabled" — a different edit in a different place.

> 🚨 **THE TIMELINE'S WRITE SURFACE WAS WIDER THAN TASK CREATION**, and a
> session scoped to "the New task button" would have left most of it open. It
> also calls add/update/delete for **phases, milestones and assets** plus
> link/unlink dependency. Dragging a bar to move or resize it committed a real
> date change (`:634`, `:684`, `:730`, `:744`, `:762`); dragging a dependency
> arrow head onto empty space DELETED the dependency. All ungated.

> ✅ **AUDREY'S TREATMENT, APPLIED EVERYWHERE RATHER THAN ON THE TIMELINE
> ALONE.** *"Keep button gray and explain why"* (2026-08-04). `GatedAction` is
> that treatment; Tasks, Assets, Board and TaskDetailPopup previously **hid**
> these controls, so applying it only to the Timeline would have made the app
> contradict itself screen by screen. This also retires the S23 UX note that
> `OUTSTANDING.md` had been carrying — *"a reviewer should be told why they
> cannot add"* — rather than moving it forward again.
>
> Two implementation traps, both of which pass review while being wrong:
> a **`disabled` `<button>` does not fire mouse events**, so a `title` on it is
> invisible in Chrome (the reason now lives on an interactive wrapper); and
> `display: contents` generates **no box**, so `opacity` on it does nothing —
> the first draft of `GatedAction` would have rendered a control that looked
> perfectly enabled and did nothing.

> 🚨 **FOUR PRE-EXISTING DEFECTS FOUND, NONE OF THEM IN THE BRIEF, ALL FIXED.**
>
> 1. **`ready` was missing from THREE gates** — `TaskDetailPopup.jsx`,
>    `DashboardTasksView.jsx`, `TeamView.jsx`. It defaults to **true**, so each
>    read "denied" for the whole window before `getSession()` settled, and
>    permanently if it hung. **That is the S23 bug, still live in three files
>    that looked correctly gated**, five sessions after it was "fixed". A grep
>    for "does this file have a gate" says yes; only reading the ARGUMENT says
>    no.
> 2. **Inline row editing was completely ungated** in `ProjectTasksView` AND
>    `ProjectAssetsView` — title, five dropdowns, both dates, bid days, the
>    phase header's name and dates, and kanban drag-drop, all committing through
>    an unguarded funnel. **Both files read as "already gated" because their
>    CREATE buttons were.** The brief itself lists them among the seven files
>    that "carry a gate", which is true and was not enough.
>
> Neither was found by using the app — the people testing it all had
> permission, so neither has a symptom for them. Both were found by
> `writeGate.test.js`, which is the argument for the test existing.

> 🚨 **THE MOST USEFUL RESULT OF THE SESSION CAME FROM A BREAKER THAT DID NOT
> FIRE.** The first `writeGate.test.js` asserted only that `TimelineView.jsx`
> **mentioned** `useProjectAccess`. Replacing the gate with
> `const canWrite = true` while leaving the import in place kept **all five
> assertions green** — the exact defect this session existed to remove,
> reintroducible in one line, with a clean suite. Requiring the gate to be
> **called** is what closes it.
>
> A second breaker was expected to pass and did: deleting `GatedAction`'s
> dimming entirely leaves **803/803**. Nothing in this suite mounts React, so
> the treatment's APPEARANCE is unverifiable here. Recorded rather than implied.
>
> A third correction came the same way: the guard's first negative assertion
> ("the file contains no `canWrite = true`") **failed on the correct code**,
> because five sub-components legitimately declare `canWrite = true` as a
> DEFAULT PARAMETER. A blunt negative would have had to be deleted later, and
> the real assertion with it. It is stated positively now.

> ⚠️ **GATING THE HANDLER IS NOT THE WHOLE JOB.** Three follow-up commits
> (`3e40c1f`, `ced76ac`, `31dddd5`) were all the same class — surfaces still
> *promising* a write after the handler was gated:
> - **`flatSelect` sets `cursor: 'pointer'` INLINE**, which beats the
>   `disabled:cursor-not-allowed` class on the same element. A style attribute
>   always wins over a Tailwind variant, so a read-only row kept advertising,
>   cursor-first, that its dropdowns were live. Conditional at the source now,
>   in both table views.
> - **The Timeline's two empty states were instructions** — *"click + Phase"*
>   and *"drag on the overview above to draw a task"*. Telling a reviewer to do
>   the exact thing the screen refuses is the original complaint wearing
>   help-text clothing. They state the reason instead.
>
> **Check the copy and the cursor, not only the `onClick`.**

> ⚠️ **TWO STATED LIMITS OF WHAT SHIPPED**, here rather than in
> `OUTSTANDING.md` because they are scope choices, not breakage:
> - **Hover-revealed row icons still hide rather than grey** (the per-row
>   delete in Tasks/Assets, the Timeline's dependency grip). The rule applied
>   is: a control visible at rest greys out and explains itself; a grip that
>   only materialises on hover is withdrawn, because a greyed dot that appears
>   under the cursor and then refuses to work teaches nothing.
> - **`ProjectSummaryView`'s control-panel button still hides.** It gates
>   `project.settings.open` (correctly, `ready` included) and was not converted.
>   One surface, one line, whenever someone is next in there.

> ⚠️ **THE VERIFICATION SWEEP IS STILL OPEN — FIFTH SESSION.** The S28 lesson
> was applied properly this time: a numbered checklist naming the screen, the
> click and what a pass looks like went to Audrey in the FIRST message rather
> than at close-out. The observations had not come back before the work was
> committed. The three items (both assignee dropdowns, cloud files end to end,
> task templates in the UI carrying their roles) are unchanged in
> `OUTSTANDING.md` — nothing was quietly narrowed or closed.

### ✅ S30 OUTCOME (2026-08-05, `2d8b658` + `c3317d4`) — and the measurement that reshaped the session before any code

**Migration 0045**, applied and verified **by query** on dev, staging and prod:
`public.otter_quiz_attempts` (RLS enabled *and* forced, three policies, no
`FOR ALL` arm, five CHECKs, **zero privileges held by `anon` or `PUBLIC`** —
every grantee scanned, not assumed) plus `public.otter_prune_quiz_attempts()`,
and it **drops** `otter_progress.quiz_attempts` behind a guard that refuses if
any row ever carried data. **55 pgTAP suites / 854 assertions** (54 / 832),
`planned == collected` on every one. **834 vitest** (803), 38 files (36). All
four CI jobs green on `c3317d4`, Playwright included.

> 🚨 **THE FIRST QUERY OF THE SESSION CHANGED WHAT THE SESSION WAS.**
> `otter_courses` holds **0 rows on dev, staging AND prod** — including
> trashed — and so do `otter_subjects` and `otter_progress`. All six of
> Audrey's real courses (49 subjects, 138 lessons) are on Local Server in
> `%APPDATA%\wilson\otter-data`.
>
> That identified the backend her report came from, and it made the brief's
> framing wrong in both directions at once. **"Validator findings need
> building"** would have built a cloud table for a tool with no cloud content;
> **"apply fix works in CLOUD and 404s on Local Server"** named the one
> backend she is not on. The instrument was checked before the absence was
> believed (standing rule 2): the same connection reported 3 projects and 4
> workspaces on dev, 1 and 1 on staging, as `postgres` with `rolbypassrls`.

> ✅ **AUDREY ANSWERED THE THREE QUESTIONS THAT GATED THE WORK** (2026-08-05),
> and two of the answers removed work rather than adding it:
> - *"just make Accept actually save"* — **no audit-report storage.** The
>   findings still live only for the session. Recorded here rather than in
>   `OUTSTANDING.md` because it is a scope choice: the loss she was reporting
>   was the accepted CORRECTION, and that is fixed.
> - *"lets have one personal quiz history but wipe it every month. its not
>   needed"* — build it, keep it small.
> - *"we can start with otter being empty. i can generate new courses during
>   beta testing"* — **no migration of the six local courses is owed.** She
>   also stated the requirement plainly: *"i should be able to see all courses
>   i have access to in the desktop app and the web app."*

> 🚨 **THE REAL VALIDATOR DEFECT WAS A GREEN TICK OVER A WRITE THAT NEVER
> HAPPENED, AND IT WAS LIVE ON BOTH BACKENDS.** Express had no PUT route for a
> subject, so every accepted fix 404ed on Local Server — but `applyFix` also
> never checked `res.ok`, and `otterFetch` resolves for every status (in cloud
> it BUILDS the Response itself). So a 404 *and* an RLS refusal both rendered
> "Fix #n applied". Fixing only the route would have left the silent-success
> path intact for the cloud she is about to move to.
>
> The same trap was already written down thirty lines away, about a different
> write: `supabaseOtterAdapter.js:253-255`. The knowledge existed and had not
> travelled to the call site.

> 🚨 **"WIRING, NOT BUILDING" WAS WRONG, AND THE FACT THAT SETTLES IT IS ONE
> LINE.** `quizSelections` (`Otter.jsx:129`) is
> `{ [courseSlug]: 'all' | Set<subjectSlug> }` and `getQuizContent`
> concatenates content across every ticked course. `otter_progress` is keyed
> `(course_id, user_id)` with `course_id NOT NULL`, so a Blender+Unity attempt
> has nowhere to go and the "obvious" wiring files it under whichever course
> happened to be open. **The brief said wiring; the shape had to change first.**

> 🚨 **THE pgTAP SUITE CHANGED THE MIGRATION ON ITS FIRST RUN.** The 30-day
> window was put in the SELECT policy so retention is a database guarantee
> rather than a client promise. Probe pair came back `have: 2 want: 1`:
> **PostgreSQL applies SELECT policies to a DELETE that reads rows in its
> WHERE clause**, so the window hid expired rows from the statement meant to
> remove them. Shipped, "wiped every month" would have meant "hidden every
> month and kept forever" — worse than no window, because the rows pile up
> where nobody can look. Hence `otter_prune_quiz_attempts()`: SECURITY
> DEFINER, no arguments, hardcodes `auth.uid()`, REVOKEd from `PUBLIC` **and**
> `anon`. Probe 15 pins the refusal the plain path gets.

> 🚨 **A DEFECT WITH A COMPLIANCE FLAVOUR, CLOSED IN PASSING.** `export.all`
> called `quiz.get` once per course. That was the **only caller on the entire
> quiz path**, and it read a column nothing had ever written — so every data
> export WILSON has produced carried an empty quiz history while presenting
> itself as complete. Both backends now ship one honest top-level
> `quiz_history`.

> ⚠️ **FIFTH INSTANCE OF THE NO-CALLER SHAPE, AND A NEW ONE FOUND WHILE
> LOOKING FOR SOMETHING ELSE.** `setOtterAdapterMode` has **zero callers**, so
> the "Settings mode override" that `adapters/index.js:26` and
> `Otter.jsx:238` both describe does not exist. Consequence, now in
> `OUTSTANDING.md`: signing in on the desktop app moves O.T.T.E.R. to
> Supabase, the library empties, and there is no control to go back.

> ⚠️ **TWO STATED LIMITS OF WHAT SHIPPED**, here rather than in
> `OUTSTANDING.md` because they are scope choices:
> - **Validator audit reports are still not stored** — Audrey's call.
> - **Quiz history is per (workspace, user), not per person.** That diverges
>   from her S31 rule for the pet deliberately: an attempt is ABOUT courses,
>   courses are workspace-scoped, and carrying a score into another company
>   would list a course the reader cannot open. Stated in 0045's header so
>   S31 does not read it as a precedent.

> ⚠️ **NOTHING WAS WATCHED RUNNING IN THE APP.** Everything here is proven at
> the database (9-step e2e probe, 9/9 on dev and staging) and at the source
> (breakers on every new assertion), and the app builds and mounts. Whether
> "Accept Fix" turns green on Audrey's screen, and whether a finished quiz
> says "Saved to your quiz history", still needs one signed-in session — the
> same gap that has kept three items open since S24. `validatorSave.test.js`
> records the matching limit in its own header: rendering the failure banner
> unreachable leaves all 17 assertions green, because nothing here mounts
> React.

### 🚨 S30 POSTSCRIPT (`a905471`) — the first real use broke immediately, and it proves the paragraph above

Audrey tested O.T.T.E.R. within minutes of the close-out. **Every** course
generation failed: *"Failed to parse course outline JSON. Try again."*

**The generation had SUCCEEDED.** `stop_reason: 'end_turn'`, complete JSON in
the response. WILSON read `data.content?.[0]?.text`, and `content[0]` is a
**thinking block** — these models think when nothing asks them to (S19 measured
`thinking` omitted → `thinking=1`), `ai-proxy` pipes the stream through
untouched, and `anthropicStream.js` assigns every block to its own index, which
is why it has `thinking_delta` and `signature_delta` handlers at all. So
`rawText` was `''`, no `/\{[\s\S]*\}/` matched, and the error named the wrong
thing entirely. Deterministic: 100% of calls.

**EIGHT call sites across three tools** had the same read — O.T.T.E.R.'s course,
agent-course and quiz generators, R.A.B.B.I.T.'s intake classifier and chunk
analysis, the pet chat, the agent chat. Fixing only the reported one would have
been a correct fix to an eighth of the problem. All eight now use
`textFromMessage(data)`.

> 🚨 **THREE THINGS WORTH KEEPING.**
>
> 1. **`Otter.jsx` already contained the correct extractor** and used it at
>    three of its six sites. The knowledge was in the file; three call sites
>    had not received it. Third time in this session a defect was a rule the
>    codebase already knew and had not applied at the call site.
> 2. **Position-indexing was only ever right by luck.** `server_tool_use` and
>    `web_search_tool_result` also precede text, and a model emits several text
>    blocks around a tool call.
> 3. **This is the paragraph above, vindicated within the hour.**
>    Database-proven is not app-proven. Migration 0045 was verified on three
>    environments, 55 pgTAP suites and 834 unit tests were green, the e2e probe
>    was 9/9 — and the tool could not generate a single course. **The one thing
>    no artifact in this repo can do is run the app**, and that is exactly where
>    the defect was. It would also have killed the quiz feature this session had
>    just wired.
>
> Proven rather than reasoned: `anthropicStream.test.js` gains a thinking-first
> SSE fixture asserting `content[0].text` is undefined while `stop_reason` is
> `end_turn`; `textFromMessage.test.js` adds five behaviour cases plus a source
> scan, proven by reverting `AgentProvider.jsx` and watching it name the line.
> **845 vitest / 39 files.**

### ✅ S30 POSTSCRIPT IV (`73828c7`) — the pet's saves, and the fix that would have fixed nothing

Audrey read POSTSCRIPT-III's brief review, saw the note that `savePet` swallowed
its errors, and asked for it directly. **The obvious fix — replace
`catch { /* silent */ }` with a message — would have changed nothing**, because
that catch sat on two functions that could not throw:

1. `writeLocal` was `catch { /* storage disabled */ }`. localStorage throws
   `QuotaExceededError` when full and is unavailable outright in Safari private
   browsing and under some enterprise policies — none rare, all identical to
   success.
2. `savePetData` never checked `res.ok` on its Express POST, so a 404, a 500 or
   a server that had not started yet all returned normally.
3. Only then the visible catch.

**The pet is the worst possible subject for a silent save:** the old state stays
on screen and looks entirely right, so nothing distinguishes "saved" from "lost
until you next reload".

A second silent failure in the same function: the in-flight guard
`if (!data || petSaving) return` **dropped** the update, so a 30-second decay
tick colliding with a slow write was discarded and the pet aged backwards on the
next load. It now queues the newest state. `petSaving` also moved from state to
a ref — it was in `savePet`'s dependency list, so `savePet`'s identity changed
on every save and rebuilt the 30-second interval each time.

> 🚨 **THE RULE: before fixing a silent failure, walk DOWN the stack and find
> which layer actually eats it.** The one you can see is usually the last of
> several.
>
> ⚠️ **AND WHEN A HELPER STARTS THROWING WHERE IT ALWAYS RESOLVED, AUDIT EVERY
> CALLER.** The three savers share `writeLocal`, so `saveOtterSettings` and
> `saveAgentSkills` got the same treatment — leaving two of three silent is the
> mistake this session made three times over. But that made them able to reject
> where they never could: four callers already wrapped theirs, and
> `Otter.jsx`'s `saveSettings` did **not**, with two `onChange`/`onClick` call
> sites that drop the promise. **Trading one silence for an unhandled rejection
> is not a fix.** It now catches, shows the reason beside the control, and
> applies the new value only on success.
>
> `localData.test.js` (+9) drives the real module rather than scanning source —
> quota, blocked storage, 404, a server message, a non-JSON error body, and the
> control that reads still degrade to a default pet. Proven by reverting the
> `res.ok` check and watching exactly the three status tests fail.
> **864 vitest / 41 files.**

### ✅ S30 POSTSCRIPT III — the verification sweep, open since S24, is part-closed

Audrey ran the three checks and reported *"all three work."* **Verified by
query rather than accepted**, and the answer was two yes and one that had never
happened:

| check | verdict | how |
|---|---|---|
| Validator "Accept Fix" persists | ✅ | staging: a subject carries `updated_at > created_at`, so the fix landed |
| Timeline assignee dropdown | ✅ | a READ — no database trace exists, her eyes are the only instrument |
| Quiz saves to history | ❓ | `otter_quiz_attempts` = **0 rows** on dev, staging AND the local disk |

**The dropdown entry is DELETED from `OUTSTANDING.md`** — open since S22,
MEASURED since S23, carried unverified through five sessions because reaching
it needs a signed-in session nothing here automates. Deliberately precise about
scope: she watched the **Timeline** one; `ProjectAssetsView`'s shares the root
cause and the hook and is INFERRED-good, stated rather than folded in. And
`useRosterMembers` swallowing the RPC error was **split out as its own entry**
rather than deleted alongside it — it is a separate, still-true defect that the
old entry happened to house.

> 🚨 **THE RULE THIS PRODUCES: check the ones that WRITE, accept her word on the
> ones that only READ.** A dropdown populating leaves no trace and never can;
> a saved fix does. Knowing which is which is what turned one report into two
> confirmations and one open question, instead of three assumptions.
>
> The quiz write path reads correctly end to end — it posts, checks `res.ok`,
> and surfaces a failure — so the open question is whether a quiz was ever
> actually completed, not whether the code is wrong. **Asked rather than
> assumed in either direction.**

### 🚨 S30 POSTSCRIPT II (`ce11709`) — a paused web search, one hour later

The outline then generated and **"generate subject content" failed**: *"Failed
to parse subject JSON. Try again."* A different defect behind an almost
identical message.

Not the same cause and not either obvious one: `generateSubjectContent` already
uses `extractTextAndCitations` (so `content[0]` is irrelevant there) and already
guards `stop_reason === 'max_tokens'` with its own wording, so truncation would
have said so.

**The asymmetry names it, and it came from Audrey's observation rather than from
reading code:** the course OUTLINE carries no tools and works; subject content
passes `web_search_20250305` with `max_uses: 3` and fails. `pause_turn` is what
Anthropic returns when a SERVER-SIDE tool run hits its iteration limit
mid-answer — the turn ends on a `server_tool_use` block, so the last text block
is a preamble rather than the JSON, and the parse fails **on a request that
succeeded**.

**`Validator.jsx` has handled this since S19 (`dab9046`)**, added precisely when
web search made it necessary, with a written explanation of why `tool_use` is
the wrong signal. `Otter.jsx`'s own `callAnthropicAPI` never received it.

> 🚨 **THAT IS THE THIRD TIME IN THIS SESSION, AND IT IS THE SESSION'S REAL
> LESSON.** Every defect S30 fixed was a rule this codebase had already written
> down and had not carried to the call site: `res.ok` (documented thirty lines
> away in `supabaseOtterAdapter.js`), `content[0].text` (the correct extractor
> was in the same file, used at three of six sites), and now `pause_turn` (same
> folder, added for this exact reason a session earlier). **Finding a defect
> should be followed by two greps: has this already been solved here, and which
> OTHER sites should have received the answer.** Fixing only the reported
> instance was wrong all three times.

> ✅ **CONFIRMED AT RUNTIME AND AT THE DATABASE (2026-08-05, minutes later).**
> Audrey: *"it worked."* Queried staging rather than trusting the screen, which
> is this session's whole lesson: **`Blender 5.1 [personal]`, 9 subjects, 1
> carrying generated content across 2 sections.** Before tonight `otter_courses`
> held **0 rows on dev, staging and prod** — so that is the first O.T.T.E.R.
> course ever to exist in the cloud on any environment, and the first proof
> that the create → outline → generate → persist chain works through the app
> rather than through a probe.
>
> The caveat below stands as written for the record, but the inference is now
> corroborated by observation: the symptom is gone and the write landed.
> ⚠️ What "it worked" does NOT do is isolate the mechanism the way a captured
> `describeResponse` bracket would have — it is strong corroboration, not a
> measurement of the cause.

> ⚠️ **THIS FIX WAS INFERRED, NOT OBSERVED, WHEN IT SHIPPED — stated rather
> than glossed.** The
> thinking-block defect was reproduced from the real stream shape. This one is
> traced through code and matches the symptom exactly, but running the live API
> needs Audrey's password, which a session must not handle. **So the instrument
> shipped with the fix**: `describeResponse(data)` appends
> `[stop_reason; blocks; chars of text]` to all seven O.T.T.E.R. parse failures.
> Two distinct defects hid behind two near-identical "Try again" prompts in one
> evening and the second cost a full round trip to identify. If it recurs, the
> message names the cause.
>
> `pauseTurn.test.js` (+7) pins that the resume is present, BOUNDED, and appends
> the assistant turn with no trailing user turn (S19 measured a prefill 400ing),
> that the Validator keeps its own copy, and that no parse failure ships without
> a diagnostic — an assertion that earned its place immediately by catching two
> bare messages in `agentGenerateCourse` that the same commit had missed.
> Its header records the limit: this is a SOURCE scan, because
> `callAnthropicAPI` is declared inside the component and is not exported.
> **852 vitest / 40 files.**

### 🚨 CROSS-SESSION: `projects` is missing columns S24, S25 AND S27 all need

**MEASURED 2026-08-03.** `public.projects` has **22 columns**: id, workspace_id,
title, description, status, status_tag, start_date, end_date, budget_total,
budget_currency, client_name, cover_image_url, producer_id, director_id, and
the audit/soft-delete set. **Every one of the following is ABSENT:**

**STATUS 2026-08-03: the budget half is CLOSED, the rest is not.** Re-measured
after 0036: `public.projects` now has **31** columns.

**STATUS 2026-08-04, MEASURED on all three environments: this drift is now
CLOSED.** 0040 took it to 48 and 0041 to **50**. Every row below is struck
through except `files_dir`, which is struck through because it must not be
added here at all — see its cell.

| Missing column | Needed by | Symptom today |
|---|---|---|
| ~~`budget_actual_column_mode`~~ | ~~S24~~ | ✅ **added by 0036**, along with eight more the table below never listed |
| ~~`margin`, `contingency`~~ | ~~S24~~ | ✅ **the names were wrong** — shipped as `budget_margin_pct` / `budget_contingency_pct` in 0036 |
| ~~`code`~~ | ~~S25~~ | ❌ **NEVER ADDED, AND MUST NOT BE.** `project.code` is a wrong READ in ClientViewTab, not a missing column — nothing has ever written it. 0040 added **`project_code`** (the column the app writes) and fixed the reader. pgTAP asserts `code` stays absent |
| ~~`scene_start_number`, `scene_digits`, `shot_digits`~~ | ~~S25~~ | ✅ **added by 0040**, together with `scene_separator` and `fps`, which this table never listed and the auto-naming also reads |
| ~~`scenes_enabled`, `levels_enabled`, `experiences_enabled`~~ | ~~S25~~ | ✅ **added by 0040, WITH the entities.** They default FALSE, so applying the migration changed nothing on screen — the tabs appear only when a toggle is turned on |
| ~~`uses_realtime_engine`, `engine_*` ×5, `project_type`, `project_tier`~~ | ~~S25~~ | ✅ **added by 0040. Never listed here at all** — found by grepping the Project Control Panel for what it WRITES. `project_type` matters most: `handleTypeChange` applies a template that sets the three toggles, so without the column, choosing a type flipped the toggles and lost the type that explained why |
| ~~`folder_slug`, `folder_root`~~ | ~~S26~~ | ✅ **added by 0041.** `folder_root` had a reachable writer today — `ProjectSummaryView.jsx:401` and `:987`, both needing `window.electronAPI.pickDirectory`, which exists in Electron regardless of the SELECTED BACKEND. The desktop app in cloud mode was hitting it and the value was being dropped with a console warning |
| ~~`files_dir`~~ | ~~S26~~ | ❌ **NOT ADDED, deliberately.** Its stated writer (`ProjectSummaryView.jsx:1010`, and the line number here said :949) is unreachable in cloud: the block renders only when the column is already non-null, and only the local relink route ever sets one — `relinkScan`/`relinkApply` are local_server ONLY. Unlike `code` this is the RIGHT name for a feature with no cloud implementation, so nothing asserts its absence: it arrives WITH relink |

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
- ~~**The gap is real and precise:**~~ ✅ **CLOSED by 0041 + `071682b`.** `FileManager.jsx:84` (not :87) already computes
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

~~**Note the ordering consequence:**~~ ✅ **RESOLVED.** The worry was that the
manifest would be a file of nulls because the settings had no columns. 0036
and 0040 gave them columns, so when S26 wrote it (`071682b`) it carried real
values. **One exception, and it is not an ordering problem:** project-scoped
rates are deliberately EXCLUDED, because the manifest's storage path is
readable by every project member while `project_rate_overrides` is
manager-only. See `OUTSTANDING.md` — it needs a money-gated path, which is
S27's to design.

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
