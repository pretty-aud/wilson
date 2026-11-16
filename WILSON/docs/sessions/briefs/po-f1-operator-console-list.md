# Brief — F1 · The operator console's company list, and a type check in CI (wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`)

**The defect (OUTSTANDING REV-01; her ruling of 2026-10-31, verbatim *"Record it, fix at the release steps"*).** `supabase/functions/operator-workspaces/index.ts` reads `PAGE` at `:230-237` (the `list` action) and `:655-667` (teardown step 1d) but neither defines nor imports it: P8's commit `9bff662a` moved it to `_shared/teardownCollect.ts:50` and the import at `:73-76` never took it. The function answers the console's Companies tab with a bare 500 (`ReferenceError`); teardown step 1d is caught at `:674` and silently skips the abandoned-upload record. The version on staging (`3b471707`) and dev carries it. No CI step type-checks the functions; `deno` is not on the controller's machine.

**Model.** Opus 5.5; if you are on Fable, stop on this line and wait for "go". The two review rounds on Fable.

**Branch.** `po/f1-operator-console-list` from `origin/feat/post-overhaul-edit-versioning`; the usual setup (`npm install --ignore-scripts`, the lockfile restored, no `.env.local`). No migration, no SQL, no deploy (the controller deploys the function to dev and staging on her go), no sign-in anywhere, no database contacted.

**The list.**
1. Add `PAGE` to the import from `../_shared/teardownCollect.ts`; nothing else in the function changes.
2. A CI job in `.github/workflows/rls.yml` that runs `deno check` over every `supabase/functions/*/index.ts` (the Supabase CLI's pinned Deno, or `denoland/setup-deno` pinned by version; the import map the functions use), with a planted control: the job red on the unfixed `index.ts`, green after.
3. Tests: the existing function tests that read the file as text gain a pin that `PAGE` is imported where it is used; the control red first.
4. Docs: the handbook's CI section (the new job) and §17; OUTSTANDING REV-01 closed with the measurement; walkthrough 91's F1 section (two lines: what she sees on the beta's console after the controller's deploy); the hand-off `handoffs/po-f1-2026-11-04.md`.
5. Merge the tip in, your own `--no-ff` merge, CI read, the close-out to the controller (the session titled *Wilson branch planning*) with the hash and the runs.

**Rules.** Plan §5, all eight; the two review rounds; OUTSTANDING's comment markers four before and after; a secret's value never printed (names only).
