# SESSION 19 launch prompt — end the AI outage

> Paste into a new Claude Code conversation. **Start the session from
> `WILSON/`, not `Claude_Work/`.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.
> Then read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` in full — it is the whole
> context for what follows, and every claim in it is tagged MEASURED /
> INFERRED / UNKNOWN.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.**

Audrey, 2026-07-31: *"stop doing work off of theories until they are proven."*
Restated 2026-08-01: *"have a deductive reasoning mentality."* It is in the
auto-memory as `feedback_prove_before_acting.md`.

It cost her over an hour in S17 — five theories about one sign-in hang, two of
them shipped as fixes, all five wrong. S18 then produced three more lessons
worth carrying:

1. **Run the current code against real input before writing a replacement.**
   Six verbatim lines of the existing parser plus one `node` run proved a
   *second* defect nobody knew about.
2. **Before believing an absence, prove the instrument can see a presence.**
   "Zero network requests" was a worthless reading until a control fetch
   returning 200 proved the resource-timing buffer wasn't simply full.
3. **A reproduction that does not reproduce is not a bug.** An observed
   "the screen dismissed itself" was a race in the test harness. Say so; don't
   file it.

Label what is *measured*, *inferred*, and *guessed*. Audrey reads these as
claims and acts on them.

---

## The situation

**MEASURED: most of WILSON's AI has been failing since 2026-06-15.**

Anthropic retired `claude-sonnet-4-20250514` on that date. Their words:
*"Requests to retired models will fail."* WILSON hardcodes it at **17 call
sites**. That is 47 days of silent outage, and it explains both of the AI
faults Audrey reported — D.O.G. "says it's not working at all" and O.T.T.E.R.
"trying to reach sonnet 4".

**It is not a key problem and not an `ai-proxy` problem.** Everything still
working is on `claude-haiku-4-5-20251001`, which is Active. That asymmetry is
the diagnosis.

| Tool | Dead (Sonnet 4) | Alive (Haiku 4.5) |
|---|---|---|
| D.O.G. | `generateFullDeck`, `generatePageOutline`, `regeneratePage`, `generateImagePrompts` | `generateAIThemes`, `handleRewriteRequest`, `handleRewriteRedo`, `generateDeckVisualDesc` |
| O.T.T.E.R. | `generateCourse`, `generateSubjectContent`, `generateSingleSubject`, `agentGenerateCourse`, `agentGenerateSingleSubject`, `callValidatorAPI` | `generateQuiz` |
| R.A.B.B.I.T. | `MODEL_MATRIX`: script, treatment, gdd, brief, pitch_bible, lookbook | `haikuClassify`, `MODEL_MATRIX`: deck, outline, notes, other |
| Assistant | `sendAgentMessage` | `sendChat` (pet) |

**Confirm before fixing** — ask Audrey, or check the Logs tab: every "Alive"
item should work today and every "Dead" one should not. If a Haiku path is
*also* failing, the diagnosis is incomplete and this plan is wrong.

### Already checked and clean — do not re-investigate

- No `temperature` / `top_p` / `top_k` / `budget_tokens` anywhere in `src/` or
  `supabase/functions/`. All 400 on current models; their absence is why this
  is close to a find-and-replace.
- No trailing assistant prefills (they 400 too). Every `role: 'assistant'` is
  mid-history or UI state.
- `operator-ai-keys` validates with Haiku 4.5 — **the "Set key" flow is not
  also broken.**

---

## What S19 already has

`src/lib/aiModels.js` landed with the plan (`281d898`). **Nothing imports it
yet — it is additive and inert.** It provides:

- `REGISTRY` — all 28 call sites, each with a stable `key`, the real `fn` name,
  a user-facing `label` and `hint`, and a `tier`.
- `resolveModel(key, { user, workspace, platform })` → `{ model, source,
  warning, entry }`. Cascade: **user → workspace → platform → built-in**.
- `RETIRED` — known-dead IDs with their retirement dates.
- `BUILTIN` — `REASONING: 'claude-sonnet-5'`, `FAST: 'claude-haiku-4-5-20251001'`.
- `configWarnings()`, `modelsInUse()`, `registryByTool()` for S20's UI.

36 tests in `aiModels.test.js`, including one that fails the build if either
built-in is ever a retired model.

---

## Block B — rewire the 28 call sites

Replace every `model: 'claude-…'` literal with `resolveModel('<key>').model`.
Six files. **The registry `key` for each site is in `REGISTRY`; do not invent
new keys** — they are a persistence contract for S20.

⚠️ **`pipeline.js` is the one that is not a simple swap.** MEASURED:
`MODEL_MATRIX` is a **module-scope exported const** in
`src/tools/rabbit_v0.1.0/intake/pipeline.js`, and `runIngestion` is imported by
`RabbitProvider.jsx:36`. A module-scope const **cannot read React state**, so
it cannot resolve per-user or per-workspace overrides on its own.

Options, in preference order:

1. `runIngestion` takes a resolved `models` map as a parameter, and
   `RabbitProvider` — which has the settings — builds it. Keeps `pipeline.js`
   pure and testable, which it currently is.
2. `pipeline.js` imports `resolveModel` and calls it with no sources. Works for
   S19's built-ins, but silently ignores every override in S20 — a trap, not a
   solution. If you take this, leave a `TODO(S20)` that says so.

Do **not** leave `MODEL_MATRIX` as a static map of live IDs; that is exactly
the shape that caused this outage.

⚠️ **React dependency arrays.** Several call sites live inside `useCallback`.
If the resolved model becomes a dependency, add it to the deps array —
a stale closure here means a user changes their model and the old one keeps
being used, which is precisely the "the setting you see is not the one in
effect" failure the registry exists to prevent.

## Block C — surface the warning

`resolveModel` returns `warning` non-null when a configured model was rejected
and something else substituted. **Audrey chose loud fallback over silent
fallback** (decision D6): the call must succeed, and the user must see a banner
naming the function and the bad model.

A `console.warn` does not satisfy this. Silent fallback is how a dead model
went unnoticed for 47 days.

## Block D — the guard test

**This is the point of the session.** A source-level test that fails the build
if a raw `claude-` string literal appears anywhere in `src/` outside
`aiModels.js` (and its test).

Model it on `src/cloud/auth/authStateCallbacks.test.js` — same shape, same
reasoning: the failure it prevents is invisible at runtime until it bites in
front of a user. Include its guard against a silently empty sweep (a test that
scans zero files passes for the wrong reason).

Swapping the string fixes today. The test fixes the class.

## Block E — verify against staging

Not "the tests pass". One real generation per tool:

- D.O.G. → a deck outline renders.
- O.T.T.E.R. → a course generates.
- R.A.B.B.I.T. → a script intake parses assets/scenes.
- Each should leave a **`WIL-6001`** row with token counts in Admin Terminal →
  Logs.

If a generation fails, get the actual error body before theorising. `ai-proxy`
passes `model` straight through to Anthropic with no allowlist
(`body.model.slice(0, 100)`), so an invalid ID surfaces as Anthropic's own 404.

---

## Explicitly NOT in this session

S20 is the control plane — the stores, the validation Edge Function, and the
three admin surfaces. **Do not start it here.** S19 exists to end the outage
with the smallest safe change; the tools should not wait on a much larger build.

Audrey's decisions for S20, recorded so they are not relitigated:

- Per-function selection (all 28), three-tier cascade.
- **Companies may only choose from models the WILSON operator has approved.**
  Free text is operator-only; admins and users get a picker.
- New model IDs are validated against Anthropic before they can be saved.

---

## Traps

- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. There is an untracked `docs/messed up handbook.pdf` in the tree right
  now — do not commit it. (S17 pushed a 13 MB PDF this way; still in history at
  `e3c3fc5`, and whether to rewrite that commit is **still unresolved** — ask.)
- **The Supabase CLI is linked to `wilson-staging`, not dev.** Check
  `supabase/.temp/project-ref` before anything that writes.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle** — it has carried
  stale counts. Check the code.
- **The handbook and MASTER_PLAN must not be synced mechanically.**
- Vitest is at **416**. pgTAP 38 suites. If either number moves, say why.

---

## Still owed by Audrey — check before claiming anything is release-ready

- 🚨 **Rotate the `smoke_admin` password** — published in the PUBLIC repo,
  permanent in git history. `OWED_AUDREY.md` §0, TPN-SDLC-007. **The one open
  CRITICAL.**
- **Upload `invite.html` + `recovery.html` to dev and prod.** Staging is done
  and verified end-to-end (S18, +12 m 48 s redemption by click); the other two
  are not, so invites cannot work there.
- **v1.0.0 is prepared, NOT tagged, NOT merged to `main`.** Recommendation
  standing from S18: hold until the AI outage is fixed. Tagging a release where
  every Sonnet-4 path 404s is a version number on a broken build. **Ask before
  tagging, and ask again before merging to `main`** — it is Vercel's production
  branch.

## Close-out ritual

Feature commit(s) → CI green (all four jobs, not just the badge) → update
`docs/sessions/MASTER_PLAN_S19_ONWARD.md` (tick S19's blocks, record anything
learned) → update `docs/MASTER_PLAN.md` §4 ledger and §6 if a gap moved →
update `docs/SYSTEMS_HANDBOOK.md` if behaviour changed → update the Claude
auto-memory → docs commit + push.
