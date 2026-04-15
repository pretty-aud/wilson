# RABBIT v0.1.0

> **Status:** shipped as part of WILSON v0.6.0.

RABBIT (Resource Allocation, Budgeting & Breakdown Intake Tool) is a WILSON tool that ingests creative documents (scripts, treatments, GDDs, briefs, decks, outlines, notes, pitch bibles, lookbooks) and produces structured breakdowns (phases, assets, tasks, budgets) for film/TV, game, agency, and experiential production teams.

## What's in v0.1

- **Storage adapters** (`adapters/`): Local Server (default, file-backed under `userData/otter-data/rabbit-data/`), Supabase (multi-user Postgres), Google Drive (read-only — writes deferred to v0.2).
- **State layer** (`state/RabbitProvider.jsx`, `selectors.js`): provider with workspace + active project hooks, selectors for budget rollup, variance, and critical path.
- **Intake pipeline** (`intake/`): chunked extractor with 9 source-type chunkers (script, treatment, deck, brief, GDD, outline, notes, pitchBible, lookbook) and 3 personas (executive, creative, technical) merged through fuzzy reducers. Supports PDF, DOCX, PPTX, TXT, MD only.
- **Agent surface** (`agent/`): RABBIT system prompt + 8 agent action handlers, registered with the multi-tool AgentProvider as `'rabbit'`.
- **Views** (`views/`):
  - `IntakeWizardView` (5 steps: upload → classify → core → run → review)
  - `ProjectSummaryView` (header, phases, next-up, at-risk, budget)
  - `ProjectAssetsView` (table + gallery, inline edit, status warning modal)
  - `TimelineView` (synthetic Gantt with 5 zoom levels and critical-path highlight)
  - `BudgetView` — spreadsheet-style budget with Crew/Team, Talent, and Expenses/Travel tabs plus a Topsheet rollup. Each row carries bid (rate × days × qty) + actuals (per-column invoices/timecards) + variance. Agency fees apply additively: the global project % and any per-row talent rep % both stack. Topsheet groups talent lines by `talent_type` (Actors, Voice Actors, Extras, Backgrounds, Stunt Performers, Motion Capture Performers, Others). Wired to the workspace rate card.
- **Components** (`components/`): `ProjectPicker`, `ViewTabs`, `CurrencyDisplay`, `AssetStatusWarningModal`.

The workspace rate card lives outside the rabbit folder at `src/components/RateCard/` because it's intended to be reused by other tools. Settings hosts a RABBIT tab for adapter mode + default currency + default rate card.

## Hard rules (still in force)

- Do not touch `public/extensions/Code.gs` or `public/extensions/Sidebar.html`.
- Do not break DOG, Otter, Projects, Settings, or the pet.
- No new state management libraries.
- No GPL deps (the timeline is hand-rolled to avoid `wx-react-gantt`).
- All planning markdown stays in `Claude_Work/`, not in this repo.

## Versioning

- RABBIT version lives in `package.json` → `toolVersions.rabbit` (currently `0.1.0`).
- Injected into the bundle as `__RABBIT_VERSION__` via `vite.config.js`.

## Deferrals

See `RABBIT_v0.6_post_build_notes.md` in `Claude_Work/` for the full deferred-to-v0.2 list (Drive write path, swimlane grouping, multi-user auth, per-project status sets, version publishing, critical-path toggle, client review sessions, variance archival, burndown, dependency graph, triage mode, DCC publish hooks).
