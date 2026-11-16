# Brief — MO2a · M.O.T.H.'s graph engine, built beside MO1 (session 2, part A, of `docs/sessions/PLAN_MOTH.md`)

**Her ruling of 2026-11-02 (multiple choice, verbatim):** *"Engine now, rest later (Recommended)"* — the part of Session 2 that needs nothing from Session 1 is built now, in parallel with MO1; the rest of Session 2 (MO2) follows once MO1 has merged. She also ruled that this work runs in the cloud on her credits.

**Model.** Opus 5.5 (`claude-opus-5-5`) for the build, the design round and both cold review rounds (her answer *"Opus for all sessions"*). State the model on your first line; if it is anything else, stop there and wait for "go".

**Read first, in full:** `docs/sessions/briefs/MOTH_PLANNING_BRIEF.md` §1, §1.1, §2 and §3 (the look, the one-engine idea, scale); `docs/sessions/PLAN_MOTH.md` §5 Session 2 (ordered build steps 2 to 5, the performance targets table, the fallback); and MO1's design from its branch — `git fetch origin && git show origin/po/moth1-foundations-9l5hbg:WILSON/docs/design/MOTH_DESIGN.md` (or the newest `origin/po/moth1-foundations*`) — for the tool folder (`src/tools/moth_v0.1.0/`), the lazy-page rule (I-9) and the shape of the catalogue its read path (0111) returns. Remeasure; stop and report a material contradiction.

**The list (the scope; plan §5, rule 1).**
1. **The graph model:** pure functions that turn a catalogue shaped like MO1's read path into nodes and edges — stable identities, the three line kinds (lives in, tagged with, related to), a folder as one dot with a count until opened, focus depth one or two steps — plus a deterministic fixture generator for tests and benchmarks.
2. **Layouts:** a force layout and a radial tree (`d3-force`, `d3-hierarchy`, exact versions pinned), run in a bounded Web Worker; the simulation suspends once settled; positions are plain data a later session saves.
3. **The renderer:** Canvas2D; pan, zoom and fly-to; clustering, culling and level of detail; no work at all when nothing moves.
4. **The light:** a glow centred on the viewport whose size and brightness follow the whole project's size (an input, never the folder in view), its colour a parameter, a soft shadow that fades in under text and dots over the bright core; reduced motion slows or stills the colour shift; a lighter mode chosen by sustained frame failures, with hysteresis and a manual override.
5. **Measure** against the plan's targets (1,000 dots and 2,000 lines at 60 fps with p95 frames at or under 20 ms; low power 300 and 600 at 30 fps, p95 at or under 34 ms; feedback within 100 ms; no loop when settled) on the fixture generator, recording the machine; this is the cloud box, not her PC — the acceptance replay on the debug sample and her saved local test project (her Q6) is MO2's, on her PC.

**Out of scope:** the HUD, list, cards, hover previews, link and move gestures, Move to, Settings, any page registration (`App.jsx`, `src/layout/pages.js` — MO1 makes the minimal page), every database, migration, adapter, Supabase and `electron/` file.

**Files:** only new files under `src/tools/moth_v0.1.0/engine/` and their tests, plus `package.json` and the lockfile for the two pinned D3 modules. Anything else you find necessary: stop and record it for MO2.

**Tests:** Vitest with a failing control for each rule — the model's counts and identities, clustering and culling, the glow's size depending only on the whole project (navigating folders never changes it), the calm and light modes, the worker protocol, and no animation frame requested once settled.

**Not merged.** Every export here has no production caller until MO2 wires the page (house rule 19), so this branch is **not merged into `feat/post-overhaul-edit-versioning`**: push `po/moth2a-engine`, read its CI through the public API, and MO2 merges it with its callers. Record the engine's chunk size for MO2's lazy-chunk accounting.

**Cloud specifics.** You run in the cloud: no dev database, no desktop app, and you cannot message the controller; your close-out is the hand-off `docs/sessions/handoffs/po-moth2a-<date>.md` (protocol order, at most 200 lines) plus your final chat message, which Audrey relays. No walkthrough: nothing here is visible to her until MO2. If the usage limit stops you, stop clean with everything pushed and the hand-off's "In flight" naming the next action. The Bash tool's command line may ignore `set -e`: make every check an explicit `|| exit`. Plan §5's eight rules hold.
