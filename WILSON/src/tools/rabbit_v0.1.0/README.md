# RABBIT v0.1.0 — scaffold

> **Status:** empty scaffold (Session 1 of 3). Do not expect anything in here to work yet.

RABBIT (Resource Allocation, Budgeting & Breakdown Intake Tool) is a WILSON tool that ingests creative documents (scripts, treatments, GDDs, briefs, decks, outlines, notes, pitch bibles, lookbooks) and produces structured breakdowns (phases, assets, tasks, budgets) for film/TV, game, agency, and experiential production teams.

## Session plan

- **Session 1 (this session):** scaffold only — empty stubs, branch `feat/v0.6-rabbit-tool`, WILSON bumped to `0.6.0-dev.0`. No functionality.
- **Session 2:** backend + data layer. See `C:\Users\Audrey\Documents\My_Work\Dev_Work\Claude_Work\RABBIT_v0.6_session2_prompt.md`.
- **Session 3:** UI layer + ship. See `C:\Users\Audrey\Documents\My_Work\Dev_Work\Claude_Work\RABBIT_v0.6_session3_prompt.md`.

## Hard rules

- Do not touch `public/extensions/Code.gs` or `public/extensions/Sidebar.html`.
- Do not break DOG, Otter, Projects, Settings, or the pet.
- No new state management libraries.
- All planning markdown stays in `Claude_Work/`, not in this repo.

## Versioning

- RABBIT version lives in `package.json` → `toolVersions.rabbit`.
- Injected into the bundle as `__RABBIT_VERSION__` via `vite.config.js`.
