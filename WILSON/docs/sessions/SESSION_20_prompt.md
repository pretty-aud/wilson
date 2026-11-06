# SESSION 20 launch prompt — the model control plane

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — everything currently broken
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` (S20 section + standing rules)

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

S19 is the strongest evidence yet for it, in both directions. Its launch prompt
said the migration was "close to a find-and-replace" on the strength of three
things "checked and found clean". A probe run *before* any of it was acted on
found that:

- O.T.T.E.R.'s old web-search tool version and beta header were **fine** —
  five working call sites were an hour from being rewritten for nothing;
- the Validator's continuation really was broken, but for a different reason
  than predicted, on a branch that could never fire;
- the thinking risk was real but **cost latency, not truncation** — the
  predicted symptom never happened and a different one did.

One theory in three survived contact. **Two of the instruments also lied**: a
probe control that wasn't one, because ai-proxy silently dropped the field it
varied; and a "FAIL" that was the probe not knowing D.O.G. retries. Check that
your instrument can see what you think it sees.

Label everything **MEASURED / INFERRED / GUESSED**. Audrey reads these as
claims and acts on them.

---

## Where S19 left things

**The outage is over.** All 28 call sites resolve through
`modelFor()` → `src/lib/aiModels.js`. Block E: 4/4 full-size generations parse.
Vitest 454. CI green. Deployed to all three envs.

Read **[[wilson_ai_model_registry]]** in the auto-memory, or
`docs/SYSTEMS_HANDBOOK.md` § ai-proxy, before touching any of this.

**What S20 inherits, already built and tested:**

| Piece | State |
|---|---|
| `REGISTRY` — 28 keys | Stable. **The key is the persistence contract** — renaming one discards whatever is stored against it. |
| `resolveModel()` cascade | user → workspace → platform → built-in. Built, tested, and *already used*. |
| `setModelSources()` | The injection point. Currently fed only by `userModelPrefs`. |
| `defaultModelFor()` | Resolves ignoring the user tier — what a picker must use to label "default". |
| `tuningFor()` | Per-function `thinking`/`effort`. Only `dog.fullDeck` sets one. |
| `ModelWarningBanner` | D6 loud fallback. Built and tested; fires on retired/malformed/unknown. |
| `userModelPrefs` | localStorage, the **user tier**. S20 replaces the storage, **not the keys**. |
| `ModelPicker` | Live in D.O.G.'s prompts tab, above each prompt. |

So S20 adds **stores and surfaces**, not mechanism.

---

## Do these first

1. **Rotate `smoke_admin`** — open CRITICAL, blocks the v1.0.0 tag.
   `OWED_AUDREY.md` §0. Audrey only.
2. **Rotate `wilson-staging`'s legacy `service_role` key** — S19 exposed it in
   a transcript (`docs/OUTSTANDING.md`). Audrey only.
3. **Re-link the Supabase CLI to `wilson-dev`** — S19 left it on staging.
   Check `supabase/.temp/project-ref` before anything that writes.

---

## S20 — the model control plane

**Goal: Audrey adds a model in one place, and every company can use it.**

| Block | Work |
|---|---|
| A | Migration 0032: `platform_approved_models` (operator-curated catalogue), `platform_model_defaults`, `workspace_model_overrides`. RLS per D4 — companies **read** the catalogue, only `platform_operators` write it. Follow the `workspace_ai_keys` precedent (S15). |
| B | Edge Function `operator-models`: add / retire / list. **Validation before save (D5)** reuses the proven `validateKey` call shape — a 1-token `POST /v1/messages` on the candidate. **404 = refuse; 429/5xx/network = inconclusive, do not treat as invalid.** Refusing a good model because Anthropic was briefly busy is its own bug. |
| C | Operator console: manage the catalogue (free text + validate), set platform defaults. |
| D | Admin Terminal: company admin overrides, **picker restricted to the approved catalogue**. |
| E | `SYSTEM SETTINGS`: per-user overrides, same restricted picker, showing which tier each value is inherited from. Migrate `userModelPrefs` (localStorage) into the user tier — **same keys**, so it is a read-and-rewrite. |
| F | pgTAP suite 39 for the new RLS. |

**Exit:** operator adds a model → it appears in every company's picker. An
admin's override beats the platform default; a user's beats the admin's. A
non-operator cannot write the catalogue — **proven by pgTAP, not inspection**.

### Decisions already taken — do not relitigate

- **D1/D2** per-function selection (all 28), three-tier cascade.
- **D4** 🔑 companies may only choose from operator-approved models. Free text
  is operator-only; admins and users get a picker.
- **D5** a new model id is validated against Anthropic before it can be saved.
- **D6** a dead/invalid configured model falls back **and warns**, naming the
  function. Built — reuse `ModelWarningBanner`, do not invent a second surface.

### Two things S19 changed about this plan

**1. Effort is now a second dimension, and it is load-bearing.**
`dog.fullDeck` carries `effort: 'medium'` because ai-proxy's **~150s Edge
deadline is a cliff** — a call that overruns loses its stream rather than
degrading. Measured: unset 137.9s / 15194 tokens; medium 69.1s / 7642.

So the stores are **two columns, not one**, and the console has a second
control per function.

> **Audrey's steer, to confirm before building:** keep **effort operator-only**.
> It is a performance/cost lever with a sharp edge — an admin setting `max` on
> the full deck puts it back over the deadline. Model stays per D4.

**2. `SELECTABLE_MODELS` in `aiModels.js` is a PLACEHOLDER** and marked as one.
It is the hardcoded list the S19 picker offers. **Block A/C replace it with the
catalogue; delete it when they do.**

---

## Traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** One rule, because they were one incident.
  On 2026-08-02 bash evaluated backticks inside a double-quoted `node -e "…"`
  and ran `config push` against wilson-dev — twice, `[Y/n]` defaulting to yes
  on absent stdin, nine auth settings applied (`docs/OUTSTANDING.md`). The same
  session had already printed a `service_role` key into a transcript via a
  `grep -v` that assumed line-per-key JSON.
  **Write scripts to a file and run the file.** Select fields (`jq -r '.x'`)
  rather than filtering output whose shape you have not seen. Prefer
  Edit/Write over shell heredocs. Neither was a reasoning error; both were
  quoting. There is no read-only form of `config push` — do not reach for it
  to inspect remote state either.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. There is still an untracked `docs/messed up handbook.pdf`.
- **The ai-proxy body whitelist drops unknown fields silently.** Adding a
  request parameter at a call site does nothing until it is added to the Edge
  Function too, with no error to say so.
- **Permissive RLS policies OR together.** A narrow policy beside a broad
  `FOR ALL` one changes nothing — the old one must be DROPPED.
- **Run the whole pgTAP set before pushing a migration**, not just the new
  suite: `python scripts/tap-hosted.py out.sql [migration.sql] suite.sql`, then
  `supabase db query --linked --file out.sql`. **`collected` MUST equal
  `planned`** — if not, the shim is missing a pgTAP function and the run is
  lying about coverage.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** It listed
  `claude-sonnet-4-20250514` as a live model for 47 days. Check the code.
- Vitest is at **454**, pgTAP 38 suites. If either moves, say why.

---

## Close-out ritual

Feature commit(s) → CI green (**all four jobs**, not just the badge) → deploy
migrations dev → staging → prod (dry-run each) → re-link CLI to `wilson-dev` →
write `docs/sessions/SESSION_21_prompt.md` → update `docs/MASTER_PLAN.md`
(§4 ledger, §6 gaps) and `MASTER_PLAN_S19_ONWARD.md` → update
`docs/SYSTEMS_HANDBOOK.md` if behaviour changed → **update
`docs/OUTSTANDING.md`** → update the Claude auto-memory → docs commit + push.

> **On `docs/OUTSTANDING.md`:** add only what is **broken and not yet fixed**,
> including anything this session breaks; delete what it fixes, citing the
> commit; tag MEASURED / REPORTED / INFERRED. **Adding nothing is a correct
> outcome.** Do not pad it to look thorough — padding buries the real entries.

## Still owed by Audrey

- 🚨 Rotate `smoke_admin` (blocks the tag) and the staging `service_role` key.
- ~~Upload  +  to dev and prod.~~ **DONE**,
  confirmed 2026-08-02 — all three projects carry both templates. They are
  pasted by hand; never .
- Complete `docs/RELEASE_TESTING.md`.
- **v1.0.0 is prepared, NOT tagged, NOT merged to `main`.** S18's reason to
  hold — every Sonnet-4 path 404ing — **is gone**. `smoke_admin` and the
  testing pass are what remain. **Ask before tagging, and ask again before
  merging to `main`** (Vercel's production branch).
