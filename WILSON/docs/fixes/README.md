# BUG FIX BRIEFS — Audrey's build pass, 2026-08-10

> Audrey ran a full pass over the current build (beta + desktop) on
> **2026-08-10** and reported eight defects. This folder holds one brief per
> phase of fixes. **One folder per phase; the brief lives in `BRIEF.md`.**
>
> 🚨 **AUDREY TESTS AFTER EVERY PHASE.** Do not batch phases. Ship one, hand it
> over, wait for the verdict, then start the next. Each brief ends with a
> **Test plan (Audrey)** section written for her, not for the implementer.

---

## STATE — re-measure; this block decays

Last measured **2026-08-10**, on branch `feat/multi-user-v1` at `158172c`:

- Migrations **0000–0058** — next free **0059**
- pgTAP **66 suites** — next suite **67**
- Working tree clean

🚨 **Read the working tree, never this block and never memory.** Every session
that took the next number from memory collided.

---

## The eight reports, mapped to phases

Audrey's words are quoted verbatim in each brief. Nothing here is a paraphrase
of what she wants — only of what is broken.

| # | Reported | Phase |
|---|---|---|
| 1 | D.O.G. made no deck | 1 |
| 6 | D.O.G. colour theme generator did nothing | 1 |
| 2 | Timeline dependency would not attach | 2 |
| 7 | No blank "+ New task" row under a phase | 2 |
| 5 | Pet "Create Egg" did nothing | 3 |
| 4 | Mac: content hidden behind header/footer | 4 |
| 8 | Mac: white showing past the bars | 4 |
| 3 | O.T.T.E.R.: no way to submit a course company-wide | 5 |
| — | Pet cannot read O.T.T.E.R. lesson content | 6 |

Item 9 was not in the original list. It came out of diagnosing the pet: Audrey,
2026-08-10 — *"it has the content in the otter pages. please make sure the
system knows how to read the content of the otter pages."*

---

## Phases, in the order they should ship

| Phase | Scope | Migration? | Blocked? |
|---|---|---|---|
| [1](phase-1-dog-generation/BRIEF.md) | D.O.G. deck + colour theme generation | No | ✅ Diagnosed — one root cause |
| [2](phase-2-timeline-dependencies/BRIEF.md) | Timeline dependencies + the missing new-task row | **Yes — 0059** | ✅ |
| [3](phase-3-pet-new-egg/BRIEF.md) | Pet "Create Egg" after a death | No | No |
| [4](phase-4-mac-layout/BRIEF.md) | Mac viewport: bar heights + overscroll white | No | No |
| [5](phase-5-otter-course-submission/BRIEF.md) | O.T.T.E.R. course submission affordance | No | No |
| [6](phase-6-pet-reads-lessons/BRIEF.md) | Pet reads O.T.T.E.R. lesson content | No | No |

**Every phase is now unblocked.**

**Phase 1's deck failure is diagnosed:** `ai-proxy` returns **HTTP 546** on
staging — the Supabase Edge Runtime's resource-limit kill. It is the cliff S19
measured, hit in real use. The deployment-skew hypothesis was measured and
disproved; two other candidates were eliminated by the status itself. One datum
remains unmeasured and should be read first: **the stored `effort` for
`dog.fullDeck` on STAGING**, which may end the phase without any code change.

✅ **The colour theme generator is NOT a separate bug** — its controls are only
rendered once a deck exists, so it never ran. Two of Audrey's eight reports
share one root cause, which makes this **seven distinct defects, not eight**.

⚠️ **Audrey's standing directive on R.A.B.B.I.T.**, 2026-08-10: *"i just want
full functionality and look of the original main single user previous build."*
When behaviour differs from `main` and there is no documented reason for the
difference, `main` is the target. Diff against it before designing something new.

Audrey's own priority: Phase 1 is *"BIGGEST ISSUE"*. Phase 4 blocks her on the
MacBook right now.

---

## Rules that apply to every phase

These are the house rules that cost a session each. They are not optional.

1. 🚨 **Cite symbols, not line numbers.** Every `file:line` in these briefs was
   correct at `158172c` and will rot. Re-verify by symbol name before editing.
2. 🚨 **Ask what the fix BREAKS, not only what it repairs.** S44 shipped a
   defect *inside* the fix, twice, in the very path it was written to correct.
3. 🚨 **Enumerate the exports and grep each for a caller before committing.**
   Ten features have now shipped with no caller. Phase 5 is the tenth.
4. 🚨 **An unchecked `await` is a silent success.** `fetch` and `otterFetch`
   resolve for *every* status — 404 and RLS 403 included.
5. 🚨 **Never read `data.content[0].text`.** Use `textFromMessage(data)` from
   `src/cloud/anthropicStream.js`. These models think when nothing asks them to.
6. 🚨 **Never take the next migration or suite number from memory.** Read the
   working tree.
7. 🚨 **Do not open an HTML comment in a long markdown file.** S30 opened one,
   never closed it, and 227 lines vanished from the rendered doc — including
   three live entries. After editing any long doc, count the comment markers.
8. ⚠️ **All functionality must be identical on desktop and web.** Audrey,
   2026-08-10: *"remember all functionality should be the same in both versions
   of the app."* Phase 3 exists because that rule was broken.
9. ✅ **Run an adversarial review before deploying.** Eight sessions have found
   real defects in already-green code. Give one lens *"what does this break
   elsewhere"* and add a completeness critic.
10. ✅ **Close out in chat, and update `docs/OUTSTANDING.md`.** Broken-and-unfixed
    only; adding nothing is a valid outcome. Never let a diagnosis read as a fix.

---

## What this pass already ruled out

Recorded so no one re-runs these:

- **AI is not globally broken.** O.T.T.E.R. course generation works, which
  exercises `callAI` → `ai-proxy` → Anthropic end to end. Phase 1 is
  D.O.G.-specific.
- **The model registry is current** — `claude-sonnet-5` and
  `claude-haiku-4-5-20251001`. Not a retirement.
- **Env vars are populated.** `aiProxy.js` and `supabaseClient.js` read the same
  `import.meta.env` source, and sign-in works.
- **The dependency drag overlay is not intercepting the drop.** That SVG is
  correctly `pointer-events-none`.
- **The pet's AI connection is healthy.** Its "I'm not connected to Claude"
  reply is a persona flourish from `COMPANION_PROMPT`, not an error. Phase 6 is
  a retrieval gap, not an access one.
- **`ai-proxy` is NOT stale on any environment.** Measured 2026-08-10: dev,
  staging and prod all run code **byte-identical** to the working tree, all at
  version 9. `thinking` and `output_config` are forwarded everywhere. See
  Phase 1 for the method and the table.

🚨 **`src/lib/aiModels.js` contains a stale note claiming the S19 forwarding is
"deployed to STAGING only — dev and prod still drop both fields".** It is false,
it names a wrong root cause for the D.O.G. bug, and it cost time in this pass.
**Phase 1 corrects it.** Until then, do not trust it.
