# PHASE 1 — D.O.G. GENERATES NOTHING

> **Audrey, 2026-08-10, verbatim:**
> *"BIGGEST ISSUE: dog tool stopped working. i just tried to make a deck and it
> did not generate any thing."*
> *"color theme generator in the dog app also did not work"*
>
> ⚠️ **This phase has two open questions.** Both are cheap to answer and both
> are listed under **Before you start**. Do not begin editing until at least the
> `ai-proxy` deployment check is done — the leading hypothesis is a deployment
> skew, and if it is right, no client code needs to change at all.

---

## What is NOT wrong

Establish this first, because the original report read as a total AI outage and
it is not one.

**O.T.T.E.R. course generation works.** Audrey confirmed it on 2026-08-10:
*"the generation of courses in otter are working well i was able to use the
system."* That single fact exercises the entire shared path — `callAI` →
session token → `ai-proxy` → key resolution → Anthropic → SSE reassembly.

So the following are all ruled out, and re-checking them is wasted time:

- The Anthropic key, the account balance, and `resolveAnthropicKey`
- `requireActiveMember` and the `workspace_id` claim
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- The model registry — `claude-sonnet-5` and `claude-haiku-4-5-20251001` are
  both current, not retired

**The failure is specific to D.O.G.**

---

## The two failing call sites

Both live in `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx`.
🚨 Re-verify by symbol; these line numbers were correct at `158172c`.

| Registry key | Symbol | Line | Tier | Error handling |
|---|---|---|---|---|
| `dog.fullDeck` | `generateFullDeck` | ~1747 | `REASONING` | `setError(...)` — visible |
| `dog.themes` | `generateAIThemes` | ~453 | `FAST` | `return null` — **silent** |

### Why the theme generator looks like "nothing happened"

```js
} catch (err) {
  console.error('Theme generation error:', err);
  return null;
}
```

No banner, no toast, no state change. Whatever the cause, the UI is identical to
success-with-no-themes. **This is a defect in its own right and must be fixed
even if the underlying cause turns out to be shared with the deck.**

### Why the deck may or may not have shown an error

```js
} catch (err) {
  setError('Error generating full deck outline. Please try again.');
  console.error(err);
}
```

This one *does* surface. Whether Audrey saw it is the first open question — it
splits the diagnosis cleanly:

- **She saw the red banner** → the API call threw. Deployment skew or timeout.
- **It spun and finished empty** → the call succeeded and `parseOutputToPages`
  produced zero pages. A parsing problem, not a transport one.

---

## ✅ MEASURED: the deck call THREW

Audrey, 2026-08-10, supplied a screenshot of the red banner:
**"Error generating full deck outline. Please try again."**

That is `generateFullDeck`'s catch. **The API call threw — this is not a parsing
problem.** Investigate the transport path, not `parseOutputToPages`.

---

## ❌ RULED OUT — `ai-proxy` deployment skew

**This was the leading hypothesis. It is dead. Do not re-run it.**

Measured 2026-08-10 by downloading each deployed function into a scratch
directory and diffing against the working tree:

| Env | Project ref | Version | Deployed | vs repo |
|---|---|---|---|---|
| `wilson-dev` | `eqjzmnvkrakroyqxfsvw` | 9 | 2026-08-02 22:09 | **identical** |
| `wilson-staging` | `rzkirvkotslbovzbsdfh` | 9 | 2026-08-02 18:42 | **identical** |
| `wilson-prod` | `rqyriuyldhovirbuievt` | 9 | — | **identical** |

The S19 commit `d1046b9` landed **2026-08-02 01:14**, before every one of those
deploys. **All three environments forward `thinking` and `output_config`.**

Reproduce the check safely with:

```bash
supabase functions download ai-proxy --project-ref rzkirvkotslbovzbsdfh
```

🚨 Run it from a scratch directory. `functions download` writes into
`supabase/functions/<slug>` relative to the working directory and **will
overwrite the repo's source** if run from the repo root.

### 🚨 A stale note sent this investigation the wrong way — fix it

`src/lib/aiModels.js`, in the doc comment on `tuningFor`, currently says:

> *"NOTE: ai-proxy must forward these. It gained that in S19 and is deployed to
> STAGING only — dev and prod still drop both fields, so this degrades to
> today's behaviour there rather than breaking."*

**That is false on both counts.** Dev and prod were measured above and both
forward the fields. The note was written mid-S19, before the dev and prod
deploys landed later the same day, and was never revisited.

It is not a harmless stale comment — it names a specific, wrong root cause for
exactly this bug, and it cost time in this pass. **Correct it as part of this
phase**, and date the correction.

---

## The original hypothesis, retained for context

This is the one thing that genuinely separates D.O.G. from O.T.T.E.R., and it is
documented in the registry itself.

`src/lib/aiModels.js`, on the `carriesEffort` flag:

> *"Today exactly one call site qualifies: DeckOutlineGenerator.jsx:1752.
> O.T.T.E.R.'s callAnthropicAPI wrapper and R.A.B.B.I.T.'s intake pipeline build
> their bodies without it."*

`dog.fullDeck` is the **only call in the entire app** that spreads
`...tuningFor(key)` — i.e. the only one that sends `thinking` and
`output_config.effort`.

`ai-proxy` rebuilds the upstream body from a **whitelist**. It only learned to
forward `thinking` and `output_config` in **Session 19**. Before that it dropped
both silently.

The chain, if the deployed function predates S19:

1. Client sends `thinking: { type: 'adaptive' }`, `output_config: { effort: 'medium' }`
2. An old `ai-proxy` drops both, silently — it is a whitelist, not a passthrough
3. The model thinks unbounded. S19 **measured** this: **137.9s unset vs 69.1s at
   `medium`**
4. `ai-proxy` streams through an Edge Function with a **~150s deadline**
5. A call that overruns **loses its stream rather than degrading**
6. O.T.T.E.R. never sends those fields, so it is completely unaffected

🚨 **Edge Functions deploy manually and do NOT ride the Vercel push.** The beta
auto-deploys the client on push to `feat/multi-user-v1`; the functions do not.
Client and function versions drift by construction. This is the same class of
problem as S42's `resolve-login` contract-version guard.

**This hypothesis does not explain `dog.themes`** — that key is `FAST` tier, has
no `effort` on its registry entry, and its call site does not spread
`tuningFor` at all. Treat the two as possibly-separate causes until proven
otherwise.

---

## ✅ DIAGNOSED — HTTP 546, the Edge resource limit

**Audrey's browser console, 2026-08-10, on the beta:**

```
generateFullDeck called  {hasFileContent: true, uploadedFiles: 1}
POST https://rzkirvkotslbovzbsdfh.supabase.co/functions/v1/ai-proxy   546
AIProxyError: AI request failed (546).
```

Two facts fall straight out of it:

1. **The host is `rzkirvkotslbovzbsdfh` — `wilson-staging`.** The failure is on
   the **beta**, not the desktop app. Debug staging.
2. **The status is 546.** That is not an HTTP status and not something Anthropic
   returns. **546 is the Supabase Edge Runtime's worker resource-limit signal** —
   the function was killed for exceeding its ceiling (wall clock / CPU / memory)
   rather than returning a response.

**This is exactly the cliff S19 measured and warned about**, now being hit in
real use:

> *"A call that overruns loses its stream rather than degrading — a cliff, not a
> slope."*

The generic banner is `callAI` falling through: 546 has no entry in its
`FRIENDLY` map, so `code` becomes `http_546` and the message degrades to
`AI request failed (546).`

🚨 **546 appears NOWHERE else in this codebase.** Not in `aiProxy.js`, not in
`ai-proxy/index.ts`, not in any doc. It has never been seen or handled here.

### The one thing still unmeasured

**`platform_model_defaults` on STAGING.** Dev was measured and is **empty** (zero
rows), so dev falls back to the registry's `effort: 'medium'` — the 69.1s
configuration. **Staging was not checkable**: the CLI is linked to `wilson-dev`,
and reaching staging needs either its database password or a re-link.

This matters more than anything else in the phase. If an operator effort of
`high` / `xhigh` / `max` is stored for `dog.fullDeck` on staging, it **overrides**
the registry's `medium` and puts the call straight back over the cliff — and the
fix is a one-row change, not a code change.

**Check it first**, via the operator console's effort control or a staging query.

### 1. The Edge resource limit — CONFIRMED CAUSE

S19's own commit message records the shape of this:

> *"One full D.O.G. deck call took 150.4s against this function's own ~150s Edge
> deadline, and D.O.G. makes up to four such calls per deck. A call that
> overruns loses its stream rather than degrading — a cliff, not a slope. It is
> new: sonnet-5 thinks before answering and sonnet-4 did not."*

`medium` measured **69.1s** against an unset baseline of **137.9s**. That is a
comfortable margin *for the deck S19 measured*. Audrey's real decks carry her own
source documents and may be substantially heavier. A slope that clears the cliff
on a test brief can still go over on a real one.

⚠️ **An operator-set effort OVERRIDES the registry's `medium`.**
`activeModel.tuningFor` prefers `platformEffort[key]` — loaded from
`platform_model_defaults` — and only falls back to the registry. If someone set
`dog.fullDeck` to `high`, `xhigh` or `max` in the operator console, the deck is
slower than the measured 69.1s and back at the cliff. **Query
`platform_model_defaults` for `dog.fullDeck` before anything else.**

### 2. ❌ ELIMINATED — Anthropic rejecting a tuning shape

A rejected `thinking` or `output_config` returns **400**, forwarded verbatim by
`ai-proxy` with Anthropic's own message attached. The observed status is 546,
which the Edge runtime produces *instead of* a response. The request never got
far enough to be rejected on its merits.

### 3. ❌ ELIMINATED — the empty-assistant-turn continuation trap

Also a 400 (`text content blocks must be non-empty`), and also not 546. The
guard in *What to change* item 3 is still worth adding as hardening, but it is
**not** the cause here.

---

## Order of work

1. **Read the stored effort for `dog.fullDeck` on STAGING.** One row decides
   whether this is a config fix or an engineering one. Free, and it may end the
   phase outright.
2. **Reduce the work per Edge invocation** — see *What to change* item 1.
3. **Give 546 a real message** — see item 2. Do this regardless of cause; the
   next person to hit a resource limit should not get `AI request failed (546)`.
4. **Only if the sizing work needs numbers**, run the latency probe:

   ```bash
   node scripts/probes/deck-latency.mjs --staging
   ```

   ⚠️ **This is Audrey's to run, not the implementer's** — it prompts for her
   credentials interactively. It fires **four full 16k generations, costs real
   money, and takes several minutes.** Its own header says do not run it
   casually.

## ✅ RESOLVED — `dog.themes` is DOWNSTREAM, not a second bug

Audrey, 2026-08-10: *"because i have no deck in there i cant see the color gen."*

The theme controls are only rendered once a deck exists. `generateAIThemes` has
three call sites and **none of them is reachable with an empty deck**:

| Line | Caller | Reachable without a deck? |
|---|---|---|
| ~1816 | `generateFullDeck`, when `enableThemeGen` | No — dies at 546 first |
| ~1146 | `generatePageOutline`, when `enableThemeGen` | No — needs a page |
| ~504 | `refreshDeckColors`, the manual button | No — control not rendered |

So her report *"color theme generator in the dog app also did not work"* was the
theme pass **inside** deck generation, which never ran because the deck was
killed at 546 before reaching it.

🚨 **Phase 1 has ONE root cause, not two.** Fix the 546 and the theme generator
becomes both functional and testable. **Do not go hunting for a second defect.**

⚠️ Item 2 below — giving `generateAIThemes` a real error surface — **still
stands.** Its `catch` returns `null` silently, so if it ever does fail on its own
it will be invisible in exactly the same way. Fix the reporting even though the
reported failure was not its fault.

---

## What to change

### 1. Get the full-deck call under the Edge ceiling

If staging carries an operator effort above `medium`, **that is the fix** — clear
it and re-test before writing any code.

If it is already `medium`, the call is simply too big for one Edge invocation
with Audrey's real source documents (`uploadedFiles: 1`, and her decks will
grow). Levers, cheapest first:

- **Lower `effort`** on the `dog.fullDeck` registry entry — `low`, or
  `thinking: { type: 'disabled' }`. S19 measured both as variants. Its probe
  reports seconds **and slides produced**, because *"a variant that is fast but
  yields three slides has not helped."*
- **Reduce `max_tokens: 16384` per call** and lean harder on the continuation
  loop, which already exists and handles `stop_reason === 'max_tokens'`. The
  ceiling is **per invocation, not per deck** — more, smaller calls each get a
  fresh budget.
- **Cap the input.** System prompt plus a source document is a large input, and
  input processing spends the same wall clock.

🚨 **Whatever you pick must hold for a BIGGER deck than the one that failed.**
The failing deck had ONE uploaded file. Landing just under the ceiling for that
deck reproduces this bug the first time Audrey uploads two. **Aim for headroom,
and state in the close-out how much you achieved.**

### 1b. Give HTTP 546 a real message — do this regardless of cause

`callAI`'s `FRIENDLY` map has no entry for 546, so a resource-limit kill reaches
the user as `AI request failed (546).` Add one that says what actually happened
and what to do — a smaller deck, fewer source files.

⚠️ **Do NOT add 546 to `isRetryableAIError`.** It currently retries only 429,
503 and 529, and that is correct: replaying an oversized payload burns another
~150s and fails identically. The message is the fix, not a retry.

### 2. `dog.themes` must never fail invisibly again — do this regardless

Replace `return null` with a real error surface. The theme generator has a
`setIsGeneratingTheme` spinner already; it needs the matching failure state.
Model it on `generateFullDeck`'s `setError`, and make sure the message reaches
a rendered element — 🚨 see Phase 3, where the pet's error was set into state
that no visible component reads.

### 3. Check the continuation loop for the empty-assistant-turn trap

`generateFullDeck` builds continuation messages as:

```js
currentMessages = [
  ...messages,
  { role: 'assistant', content: fullOutput },
  { role: 'user', content: 'Continue generating...' }
]
```

If a response arrives with a `thinking` block and **no** text block, `chunkOutput`
is `''` and `fullOutput` may still be empty when `stop_reason === 'max_tokens'`.
An assistant turn with empty content is a **400 from the Anthropic API**. Guard
the continuation on `fullOutput` being non-empty, and bail with a real error if
it is not.

⚠️ Note `generateFullDeck` extracts text with
`data.content.filter(i => i.type === 'text').map(i => i.text).join('\n')`, which
is thinking-block-safe. `generateAIThemes` uses
`data.content.map(i => i.text || '').join('')`, which is also safe. **Neither is
the S30 `content[0].text` bug** — do not "fix" them into it. If you touch either,
move to `textFromMessage(data)`.

---

## What NOT to change

- ❌ Do not touch `callAI`, `aiProxy.js`, or `anthropicStream.js`. They are
  proven working by O.T.T.E.R.
- ❌ Do not widen `ai-proxy`'s whitelist into a passthrough. It is a whitelist
  on purpose — shapes are rebuilt field by field so a client cannot smuggle keys
  upstream.
- ❌ Do not change the model tiers. They are current.
- ❌ Do not add a direct-to-Anthropic fallback. `aiProxy.js` header: *"There is
  NO direct-to-Anthropic fallback, on either host — a second code path is how
  gap #21 happened."*

---

## Risks — what this could break

- **Redeploying `ai-proxy` redeploys everything it does**, including rate
  limiting, usage logging and key resolution. O.T.T.E.R. currently works through
  it; confirm O.T.T.E.R. still generates *after* the redeploy, not only D.O.G.
- **Lowering `effort` trades quality for latency.** Audrey has not asked for a
  faster deck, she asked for one that appears. If you lower it, say so in the
  close-out in plain English.
- Adding an error surface to `generateAIThemes` changes a code path that
  currently returns `null` to callers. **Grep every caller of `generateAIThemes`**
  — `generateFullDeck` calls it via `enableThemeGen`, and a thrown error there
  would abort deck generation that previously continued without themes.

---

## Definition of done

- [ ] A full deck generates end to end on the beta, from Audrey's real source
      files — **with headroom**, not just barely
- [ ] A deck with MORE source files than the one that failed also generates
- [ ] The colour theme generator produces themes once a deck exists
- [ ] The theme generator shows a visible, specific error when it fails
- [ ] HTTP 546 has a `FRIENDLY` message that says what happened and what to do
- [ ] 546 is NOT added to `isRetryableAIError`
- [ ] O.T.T.E.R. course generation still works (regression check on the redeploy)
- [ ] No change to `callAI` / `aiProxy.js` / `anthropicStream.js`
- [ ] Deployed `ai-proxy` version recorded in the close-out, per environment
- [ ] 🚨 The stale `tuningFor` note in `src/lib/aiModels.js` corrected and dated
- [ ] Any stored `effort` for `dog.fullDeck` in `platform_model_defaults`
      recorded in the close-out, even if it turned out to be unset

---

## Test plan (Audrey)

Do these on the **beta** (`https://beta.petalstudios.co/wilson`), and then the
same two on the **desktop app**.

1. **Make a deck.** Load your usual source documents into D.O.G. and generate a
   full deck outline. It should produce slides. If it fails, tell me whether you
   saw a **red error banner** or just a spinner that stopped.
2. **Generate a colour theme.** It should produce themes. If it fails, it should
   now tell you *why* — an actual message on screen, not silence.
3. **Then make a BIGGER deck** — more source files than the one that failed.
   This is the real test. Landing just under the limit for a one-file deck is
   not a fix, it is the same bug waiting for your next project.
4. **Generate an O.T.T.E.R. course.** This is the regression check. It worked
   before this phase and must still work after.

If any step fails, the console output is the fastest thing you can give me —
F12 → Console, same as last time. That one line is what turned this from three
theories into one measured cause.
