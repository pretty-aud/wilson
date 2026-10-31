# 91 — WAVE 1 (the week of 2026-11-04)

One file for the wave (`docs/sessions/PLAN_WEEK_2026-11-04.md`;
`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one section per session: **F1**
(the operator console's company list, and a type check in CI). Each section
stands on its own; answer its questions by their numbers.

## F1 — The operator console's company list, and a type check in CI

Your ruling of 2026-10-31 on the code review's REV-01: *"Record it, fix at the
release steps"*. Fixed, checked in CI, and reviewed twice on Opus (your Fable
allowance was used up, and you chose Opus). It reaches the beta only when the
controller deploys the function to dev and staging, on your go.

1. **After that deploy, the operator console's Companies tab lists your
   companies again** (on the beta, `/wilsonadmin`, signed in as the
   operator). Since 2026-10-28 it has shown an error instead of the list; by
   the code that error reads *"Network error — check your connection."*,
   though your connection is fine. Nothing else on the console changes.
2. **Nothing to answer.** Every push now type-checks every Edge Function, so a
   function that uses a name it never brought in (this one) turns CI red as
   soon as it is pushed (CI cannot stop a deploy by itself; the controller
   reads it first). The check also found 28 older typing slips, in seven
   functions and three shared files, that break nothing; they are written
   down (`docs/OUTSTANDING.md` F1-01) and counted, so CI fails if one is
   added.
