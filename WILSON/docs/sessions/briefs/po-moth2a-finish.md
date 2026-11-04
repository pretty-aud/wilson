# Brief — MO2a, the finish · its two review rounds and the re-measure on her PC (continues `docs/sessions/briefs/po-moth2a-engine.md`)

**Why a new session.** The cloud session that built M.O.T.H.'s graph engine stopped at `2467d661` on her ruling of 2026-11-04: the work moves to her PC. Everything is pushed. Its review round 1 stopped unfinished and kept nothing.

**Her rulings of 2026-11-04 (multiple choice, verbatim):** *"You take it back (Recommended)"*: the desktop controller, the session titled *Wilson branch planning*, runs Moth again, and your close-out goes there. *"MO1 or MO2 adds it (Recommended)"*: Moth's line in `src/ui/typeScale.test.js` is not yours. *"Small (Recommended)"*: the review size in the list below. That answer is her yes to those two workflows, so do not ask her again unless you would pass its bound.

**Model.** Opus 5.5 (`claude-opus-5-5`) for the session and both review rounds (her answer *"Opus for all sessions"*). State the model on your first line; if it is anything else, stop there and wait for "go". **Amended 2026-11-04:** her ruling, verbatim *"Fable for reviews only"*: the reviewer and checker agents of every review round run on Fable 5.1 (the agent model option `fable`, effort `high`); the session itself stays on Opus 5.5. **Amended again 2026-11-04 20:40 UTC:** her ruling, verbatim *"Opus for reviews from now"*: the reviewer and checker agents of every review round run on Opus 5.5 again, like the session; a round already running on Fable finishes as it is.

**Read first, in full:** the hand-off `docs/sessions/handoffs/po-moth2a-2026-11-02.md` on `origin/po/moth2a-engine` (§2 the harness and the last numbers, §4 and §7 the remaining work, §5 the traps); the first brief `docs/sessions/briefs/po-moth2a-engine.md`; `docs/sessions/PLAN_MOTH.md` §5 Session 2's targets and fallback; `docs/sessions/PLAN_TO_1_0.md` §5's eight rules. Remeasure; stop and report a material contradiction.

**🚨 One correction to the hand-off.** Its §7 step 1 says to set up "in her canonical checkout". **Do not.** That checkout, `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson`, holds her testing branch and is hers: never switch it, install in it or write to it. Work only in the worktree the desktop app gave you (`HANDOFF_PROTOCOL.md` §2): `git fetch origin`, `git checkout po/moth2a-engine`, then from `WILSON/` run `npm install --ignore-scripts`, and `git checkout -- package-lock.json` if the install rewrote it. You need no `.env.local`, no Supabase link and no Electron. Then, from `WILSON/`, the engine's suite: expect 10 files, 230 tests, green.

**The list (the scope).**

1. **A first pass of the measurement (item 4's method), before the reviews.** A performance fix should be reviewed, so find out now whether the zoom row needs one on a real GPU. If a row misses and the cost is the engine's, fix it inside `engine/` with a failing control before round 1.
2. **Review round 1, from scratch.** Hand-off §7 step 2's four lenses, one cold reviewer each, then one checker per finding, told to refute it. Every finding carries its code excerpt, so a checker need not re-read the engine, and its class: SECURITY, BREAKS-BRIEF or OTHER. Fix SECURITY and BREAKS-BRIEF, each with a failing control. Record OTHER in the hand-off for MO2 to put in `OUTSTANDING.md`; this branch may not touch it.
3. **Review round 2, on the corrections.** Cold: one reviewer over the diff of everything fixed since `2467d661` and what calls it, one checker per finding. Fix and record as in round 1. If nothing was fixed, it has nothing to review: say so.
   - **Her bound for both rounds together:** about 30 agents, never more than 15 at once, effort `high`. If you would pass 45 in all, stop and ask her in chat, with the count.
4. **Re-measure on her PC, on the final engine.** Recreate the scratch harness from hand-off §2 and do not commit it (rule 2). The rows: 1,000/2,000 pan and zoom; 4,000/8,000 pan; 300/600 with the light override at CPU throttle ×4; feedback while the layout streams; frame requests when idle; layout settle.
   - **Prove the GPU was used.** In the exact browser launch you measure with, read `chrome://gpu` (Canvas and Rasterization: hardware accelerated) or an equal readout, and put it in the hand-off. If headless Chromium will not use the GPU, use a headed window and say so. A number from software raster answers nothing here: the cloud already measured that.
   - **Prove frames flow.** A hidden, minimised or covered window throttles animation frames, and so does this app's browser pane when it is not shown: do not measure there. Run the blank animation-frame loop from §2 in the same mode as each row and report it beside the row; that baseline is what left the low-power row undecided in the cloud. Record the display's refresh rate, because the targets assume 60 Hz.
   - **Record her hardware:** CPU, GPU and driver, memory, browser version, viewport and scale.
   - **The PC is shared.** MO1 and her other jobs run on it, and she may be at it. Record what else was busy, run each row at least twice, and re-run a missing row when the machine is quieter before calling it a miss. Use a scratch browser profile.
   - **The fixture generator only.** Never open her real projects or her WILSON data. The replay on the debug sample and her saved test project (her Q6) is MO2's.
   - **A row that still misses** at the end: report the numbers plainly with the cause you measured, and name the plan's fallback. Never restate a target to make it pass.
5. **Close.** Update the same hand-off file in protocol order, at most 200 lines: the findings and their classes, the OTHER list, the final table, her hardware, the engine's chunk sizes again, and the first brief's item 5 marked with what is now measured on her PC.

**Files:** only `src/tools/moth_v0.1.0/engine/` and that hand-off. Not `src/ui/typeScale.test.js`, `OUTSTANDING.md`, `App.jsx`, `src/layout/pages.js`, or any database, migration, Supabase or `electron/` file. Anything else you find necessary: stop and record it for MO2.

**CI and tests.** The Vitest job stays red on one test by her ruling: `src/ui/typeScale.test.js`, "a tool directory belongs to no lane". Read the job's annotation through the public API at each push, and run the whole Vitest suite from `WILSON/` before you close: red on anything else is a real failure. Skipped counts differ by machine: 3 on Linux and 9 on her Windows PC is expected (`src/cloud/aiFilesProbe.test.js`).

**The bundle.** Assert by grep that nothing outside `engine/` imports the engine. The hand-off's "byte-identical" numbers were built on Linux, so compare only against a baseline built on this machine, or say you did not.

**Not merged.** Push `po/moth2a-engine`; MO2 merges it with its callers (house rule 19). No beta, no `main`, no staging, no production.

**Close-out.** Send the session titled *Wilson branch planning* the tip's hash, the CI run, the findings counts, the measurement table and her hardware. There is no walkthrough: nothing here is visible to her until MO2.

**Limits.** If the usage limit stops you, stop clean with everything pushed and the hand-off's "In flight" naming the next action. The Bash tool's command line may ignore `set -e`: make every check an explicit `|| exit`. The repository is public: no real person's name or email in any file, hand-off or chat.
