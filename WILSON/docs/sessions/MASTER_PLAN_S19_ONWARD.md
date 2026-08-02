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

> ⚠️ **`ai-proxy` is deployed to STAGING only.** dev and prod still drop
> `thinking`/`output_config`, so the deck runs at the old ~138s there. It
> degrades rather than breaks. Deploy with
> `npx supabase functions deploy ai-proxy --project-ref <ref>`.

> ⚠️ **The guard test in Block D was the point of the session.** A hardcoded
> model ID can no longer reach `main`, nor can a `modelFor()` key that is not
> in the registry, nor a retired `VALIDATION_MODEL` in `operator-ai-keys`.

---

### S20 — The model control plane

**Goal: Audrey adds a model in one place, and every company can use it.**

| Block | Work |
|---|---|
| A | Migration 0032: `platform_approved_models` (operator-curated catalogue), `platform_model_defaults`, `workspace_model_overrides`. RLS per D4 — companies **read** the catalogue, only `platform_operators` writes it. Follows the `workspace_ai_keys` precedent (S15). |
| B | Edge Function `operator-models`: add / retire / list approved models. **Validation before save (D5)** reuses the proven `validateKey` call shape — a 1-token `POST /v1/messages` on the candidate model. **404 = refuse; 429/5xx/network = inconclusive, do not treat as invalid.** That last clause is copied deliberately from `operator-ai-keys`: refusing a good model because Anthropic was briefly busy is its own bug. |
| C | Operator console: manage the catalogue (free text + validate), set the 28 platform defaults. |
| D | Admin Terminal: company admin overrides, **picker restricted to the approved catalogue**. |
| E | `SYSTEM SETTINGS`: per-user overrides, same restricted picker, showing which tier each value is inherited from. |
| F | pgTAP suite 39 for the new RLS. |

**Exit:** operator adds a model → it appears in every company's picker.
An admin's override beats the platform default; a user's beats the admin's.
A non-operator cannot write the catalogue — proven by pgTAP, not by inspection.

> Why `POST /v1/messages` and not `GET /v1/models/{id}` for validation: the POST
> shape is already proven in this codebase. The Models API's error semantics for
> an unknown ID have **not** been verified here. Reusing a proven call beats a
> plausible one.

---

### S21 — Data correctness and the reliability sweep

**Goal: the settings and rate-card surfaces stop lying.**

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

### S22 — Storage and connections

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

### S23 — Files everywhere

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
- **Deploy `ai-proxy` to dev and prod.** S19 taught it to forward `thinking`
  and `output_config.effort`; only staging has it. Until then D.O.G.'s deck
  runs at ~138s there instead of ~59s — degraded, not broken.
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
4. **Check `supabase/.temp/project-ref` before anything that writes.** The CLI
   is linked to **staging**, not dev.
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
6. **End every session by updating `docs/OUTSTANDING.md`** — the single answer
   to "what is broken right now". Add only what is **broken and not yet
   fixed**, including anything the session itself broke; delete what it fixed,
   citing the commit; tag each entry MEASURED / REPORTED / INFERRED.
   **Adding nothing is a correct outcome** — a session that fixes things and
   breaks nothing leaves the file alone. Do not pad it to look thorough;
   padding buries the real entries. Interim, unverified, or planned work is
   not an entry — that belongs in this file instead.
