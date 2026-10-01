# WILSON — the post-overhaul plan (2026-09-29)

Branch `feat/post-overhaul-edit-versioning`. Five feature sessions, run as eight bundles in four waves, after the UI overhaul and the three paused tracks are merged. Where this file and `docs/design/UI_OVERHAUL_PLAN.md` disagree, this file wins for this branch; where this file is silent, the overhaul plan's §3 (design system), §4 (kit), §6 (mechanics) and `docs/sessions/HANDOFF_PROTOCOL.md` apply.

**Every session runs on Claude Opus 5.5.** The first line of every session's chat states its model; if the picker shows anything else the session stops and tells Audrey before doing any work. Review subagents pass `model: "opus"`.

---

## 0. What Audrey asked for, and what she ruled

Her brief (2026-09-29): five sessions on a new branch after the overhaul — (1) a quick pass on the R.A.B.B.I.T. Timeline; (2) D.O.G. and O.T.T.E.R. settings/help placement, a little orange back, VS-Code-style colouring in the function library, a wider lesson page; (3) versioned SHOT LISTS and EDITS for scenes and bins, "like the budget's versioning", with drag-and-drop, a save-edit button that pulses, and an ask-before-leaving guard; (4) project files: notes, a core-file toggle, a tagging system, a Files tab in R.A.B.B.I.T., previews and download; (5) budget versions viewable in the Timeline and a reworked Budget Summary. She asked for every question first; the question list and her answers are in §0.1.

**Her constraints that still bind (from the overhaul, C2–C9):** the page transition untouched; Home fonts only; D.O.G.'s preview box pixel-fixed (`scripts/dog-preview-probe.mjs --check` before and after any D.O.G. layout change); the pets untouched except where a ruling names them; on orange, text is white or black; the seven-step type scale with an 11px floor; everything repeated is a kit component and every colour is a token (a hex outside `@theme` / `tokens.js` fails); no white or near-white surfaces. **C1 ("no interaction or view changes") is lifted** for these sessions: they add controls and views. Her rule for that (A6): *"very strategic of how you move things around. we still want to keep things relatively the same. try to add things where they make sense."*

**Backends (A9):** *"the local one was just for testing … i need the system to work the same if im using a cloud based solution or a NAS server."* Every feature ships on the Supabase adapter AND the Local Server adapter (and the dev-fixtures adapter) in the same bundle; the desktop's signed-out Local Server is the test rig this week, not a product target. Where a gate cannot exist on the Local Server (it has no roles), the walkthrough says so in one line.

### 0.1 The rulings, by question number

The full question list with every default is `docs/design/POST_OVERHAUL_QUESTIONS.md`; her answers A–E verbatim are `docs/design/POST_OVERHAUL_ANSWERS.md`. F (budget versions) and G (the controller's own decisions) are answered in the morning of 2026-09-30; until then S5 is not briefed and G's defaults stand. The rulings that shape the bundles:

| # | ruling |
|---|---|
| A1 | Merge first: the overhaul (which contains the demo branch: bins, local storage, the FILES explorer) and the three tracks are merged onto this branch before any session starts. |
| A2 | Branch `feat/post-overhaul-edit-versioning`; session branches `po/<name>`. |
| A3 | Three sessions at a time, on files that do not overlap. |
| A4 | Wave order as proposed (§2). |
| A5 | Migration numbers: the next free (0084 after the merge's two fix migrations), pgTAP suites likewise; 0079/0080 stay reserved on paper; the controller keeps the ledger in memory and each migration's header says what it is. |
| A7 | Sessions do not wait for her walkthrough report; integrate after the two review rounds; she tests later. |
| A8 | Sessions may write her rulings into walkthrough 47 §2 and `docs/OUTSTANDING.md`, narrowly. |
| A10 | Nothing is cherry-picked to the beta early; the beta gets this branch as a whole. |
| B1–B9 | New ink token for phase names; week-header option B (measured no-overlap) now, option C offered later; the date parse is fixed for the gantt (she saw a gantt bar) and the fix's on-screen shift is accepted; stop the drift going forward, no audit of old data; one shared date helper (+ the Projects page); task-row borders go in the gantt half only; the minimap window animates on the four zoom tabs only; creation clicks floor to the cell and a 1st on a hidden weekend keeps its month label; "white" = the ink token, gutter column only. |
| C1 | The D.O.G. bar to stretch is the "Deck outline" bar (Undo/Redo delete, Import/export history, Clear history). |
| C2 | Generate buttons: no change (they are already the primary when enabled). |
| C3 | Section titles: orange text that reverts to the ink on hover; the step NUMERALS orange too; the circle unchanged; copy stays "deck context". |
| C4 | Lesson width: 66-character ceiling, the 720px cap dropped, both subject pages, 14px, centred; screenshots at 1440 and 1280 before the number is final. |
| C5–C8 | Breadcrumb never wraps; "Tool settings" leaves the nav strip for all three tools and O.T.T.E.R.'s drawer tab is renamed "Storage & data"; in-page Help opens the tool's own Help window and R.A.B.B.I.T. gets Help beside its gear; orange exactly: "Course library", the key-cap text in both hotkey tables, both lesson-card titles + icons; recorded as her exceptions in §3.2 of the overhaul plan. |
| C9 | Function library: VS-Code-like token colouring of the TEXT in the code blocks; the well background stays. |
| C10 | Language map for the common languages, unknown = plain; fix the category merger; her files untouched. |
| C11 | S2 runs as two bundles. |
| C12 | **The pet's toggle moves from Enter to a bare Shift tap**; Enter presses whatever is focused; Shift works normally while typing. |
| D1+D3 | Shot lists are REAL rows and a scene/shot may belong to MANY lists (a membership table with per-list order, not copies); a picker adds shots from earlier lists; links (tasks, assets, files, takes) stay on the shot row and are therefore visible from every list that contains it. |
| D2, D5 | "Load" = the Scenes tab views/edits that list (per person, per project), independent of which list is ACTIVE; shot-list field edits stay live-saved; "Save" records a version point, "Save as" makes a new version; draft mode, the pulse and the leave guard are for EDITS only. |
| D4, D18 | "Clear" empties the current unsaved working copy after a confirm; saved lists are never cleared; lists are ARCHIVED, never deleted; the active list cannot be archived. |
| D6 | Edits: ordered items referencing shot ids (repeats allowed), scene order, "new shots" become real shot rows, no in/out points, one linear chain per list; **edits may be created on any list, active or not**. |
| D7 | A new bar between the tiles and the toolbar holds the shot-list and edit controls; the toolbar stays as built. |
| D8 | **Managers, members AND reviewers may create and edit shot lists and edits** (a new gate: reviewers are comment-only in the database today). **Budget, budget versions and the Timeline's version picker: project managers / workspace admins only.** Set active and archive: managers/admins. |
| D9 | A tasks migration (scene_id, shot_id) and an assets link so the indicators work in the cloud. |
| D10 | Every other surface reads the ACTIVE list; only the Scenes tab shows the viewed list; every scene/shot name gains its list in a tooltip. |
| D11 | Existing scenes/shots are backfilled into "Shot list 1 · v1" (active) on both backends; no edit is created. |
| D12–D17 | All five exits ask (tab strip, tool/page switch, project switch, cross-tab jump, window close), three buttons; the first drop asks once and creates a draft edit; title + integer version; a 1.2s pulse with a reduced-motion twin; native drag on a handle with Move up/down; a deleted shot stays as "Missing shot" in an edit. |
| D19–D22 | Bundles S3a → S3b → S3c; tiles follow what is on screen; Escape asks before discarding popup drafts, P1-21..24 fixed in S3b, Enter on confirms keeps Cancel focused; `scenes.json` joins the desktop's readable database files; no export in v1; takes and files show from every list. |
| E1 | Both Summary file sections go; Add files, the Relink banner and File activity move to the Files tab's toolbar (uploads still file to the project root); the project-folder controls stay in the Control Panel. |
| E2 | The note IS `files.description` (Track C's 0075), shown as a multi-line field; "core project file" IS `files.is_core_definer`, its comment rewritten to her definition. |
| E3 | NINE tags (Notes removed): Production, Creative, Legal, Finance, Reference, Assets, Code, Shots, Documentation; several per file; beside Kind; monochrome badges. |
| E4 | Restriction: labels only in S4 (Finance derived read-only from `is_financial`; Legal labelled "not restricted yet"); the Legal gate is its own later bundle; restricted tags settable only by people who pass the gate. |
| E5 | S4a = UI now; S4b = schema + policies after Track C is on the branch. |
| E6 | No FBX / 3D viewer for now. |
| E7 | The "table view issue" is dropped. |
| E8–E14 | Files = a twelfth R.A.B.B.I.T. tab after Summary, picker hidden, the Resources page stays (one component, two hosts); previews inline for images, video (autoplay off), audio, text/markdown/code (≤ 2 MB; HTML/SVG escaped), PDF; everything else icon + Download; the Details panel becomes the editor, double-click/Enter previews, the Name cell is a button; managed desktop files get notes and tags, Core hidden for them; tags start empty; a preview logs one "downloaded" per file per session; a Files help page; the Drive research goes in the hand-off. |
| E-note | *"lets make sure the files page is not read only … dont have the cloud silently throw away kind and description. lets update the databases on supabase."* → the explorer becomes editable; Track C's 0075 (files.document_kind + description) is on this branch and must reach dev and staging. |

---

## 1. State at the start (measured 2026-09-29/30)

- `feat/post-overhaul-edit-versioning` was cut from `origin/feat/multi-user-v1` (`08d44d2`). `60a8981` merged `origin/feat/ui-overhaul` (`bbf3bcd`; the overhaul contains `feat/demo-2026-09-11` — bins, local storage, private projects 0072, the FILES explorer and 0081). Then `track-a-product`, `track-b-auth` (its LOCAL tip `b5a8646`, three commits ahead of origin) and `track-c-storage` were merged over it, each with two adversarial review rounds; the merge commits and the verification are recorded in `docs/sessions/handoffs/po-merge-2026-09-30.md`.
- vitest baseline: stated in that hand-off (the overhaul closed at 178 files / 3,892 tests; the tracks add their own).
- **Databases (read-only query, 2026-09-29).** dev has 0064, 0066–0071, 0073–0078 — missing **0072, 0081, 0082, 0083**. staging has 0064, 0066, 0067, 0070, 0071, 0073–0076, 0078 — missing **0068, 0069, 0077, 0072, 0081, 0082, 0083**. prod is at 0063. Nothing was applied by the controller. **The beta cannot receive this branch until staging carries those seven, in the order 0068, 0069, 0072, 0077, 0081, 0082, 0083**; the controller applies them (or Audrey does) after CI's pgTAP job is green on this branch and before the merge into `feat/multi-user-v1`. Migrations are applied by `supabase db query --linked --file <one file>` from a tree that has the file — never `db push` (it would drag in the unfinished 0065).
- **Numbers.** Migrations 0000–0078, 0081, 0082 and 0083 exist on this branch (0082 = the private-projects arm on Track A's milestone functions, 0083 = the same arm on Track C's file gates; both written by the merge's review rounds and never yet run against a database); 0079 (bins cloud) and 0080 (assemblies) are reserved on paper only. **Next free after S3a: 0085** (S3a took 0084). pgTAP suites 01–72, 74, 77–86 exist after S3a (73, 75, 76 reserved/free). **Next free suite: 87.** The coverage guard is `RLS_TABLES` in `.github/workflows/rls.yml` at the git root (one level ABOVE `WILSON/`); every new RLS table needs an `NN_<table>.sql` suite and an entry there in the same commit. Live apply order matters: 0082 needs 0067 and 0072 on the target; 0083 needs 0074, 0078 and 0082.
- Walkthroughs: 01–47 exist; **new ones start at 48**, copied to `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`.
- Dev-server ports: the overhaul used 5203–5271; **these sessions use 5272 onward** (one per bundle, in §2).

---

## 2. Waves and bundles

Three sessions run at a time (A3), never two on one file. A bundle is one session (protocol §1); a session that runs out of context hands off at a boundary and the controller spawns the continuation.

| wave | bundle | branch | port | walkthrough | starts when |
|---|---|---|---|---|---|
| 1 | **S1** Timeline pass | `po/s1-timeline` | 5272 | 48 | the merge is on the branch |
| 1 | **S2a** settings placement, orange, the pet's Shift | `po/s2a-settings-placement` | 5273 | 49 | same |
| 1 | **S3a** shot lists + edits: design, schema, adapters, Local Server, fixtures (no view code) | `po/s3a-shot-lists-schema` | 5274 | — (its hand-off is the deliverable) | same |
| 2 | **S2b** O.T.T.E.R. functions colouring + lesson width | `po/s2b-otter-functions-lesson` | 5275 | 50 | S2a integrated |
| 2 | **S3b** shot lists in the Scenes tab | `po/s3b-shot-lists-ui` | 5276 | 51 | S3a integrated (and S1, for the date helper) |
| 2 | **S4a** Files: the R.A.B.B.I.T. tab, the editable Details panel, the tags column (migration 0085, suite 87), previews, download, the Summary sections, the Bins key gate (S2a-01) | `po/s4a-files-ui` | 5277 | 52 | S2a integrated (Rabbit.jsx, help content) |
| 3 | **S3c** edits: drag-and-drop, the first-drop confirm, the pulse, the leave guard, the budget's shot-list dropdown, the task/asset indicators | `po/s3c-edits` | 5278 | 53 | S3b integrated |
| 3 | **S4b** the Legal gate (a new predicate, the files policies, the storage policies, a reserved path segment) — only after Audrey rules on Legal's audience (E4a). Kind/Description are already on the cloud (Track C's 0075 is merged and on dev) and the tags column moved to S4a | `po/s4b-legal-gate` | 5279 | 54 | S4a integrated; her E4 audience ruling |
| 4 | **S5** budget versions in the Timeline + the Budget Summary | `po/s5-budget-versions` | 5280 | 55 | S1 and S3c integrated; her F answers |

**Shared files and who owns them.** `TimelineView.jsx` + `rabbitTimeline.css`: S1, then S3c (group-by-scene rows) and S5. `BudgetView.jsx`: S3c (the shot-list dropdown on the create-version row), then S5. `Rabbit.jsx`: S2a (buttons), then S4a (the twelfth view). `rabbitHelpContent.jsx`: S2a, S3b, S4a, S5 (append-only sections). `supabaseAdapter.js` allowlists: S3a (tasks/assets/budget_versions/shot lists), S4b (files). `RabbitProvider.jsx`, `localServerAdapter.js`, `electron/main.cjs`: S3a, then S4a/S4b (file verbs). `App.jsx`: S2a (nav strip, the pet's key), S3c (the leave-guard hook in `navigateTo`). `src/ui/*` and `src/index.css`: any session may ADD a token or a kit prop only with a recorded kit request in its hand-off and a caller in the same commit. `docs/OUTSTANDING.md`, walkthrough 47, `UI_OVERHAUL_PLAN.md` §2/§3.2: append dated notes, never rewrite.

---

## 3. The bundles

Each bundle's full brief is `docs/sessions/briefs/po-<bundle>.md` (written before its chip is spawned; wave 1's and, from 2026-09-30 evening, S2b's and S4a's exist). The scope in one paragraph each:

**S1 — Timeline pass** (`docs/sessions/briefs/po-s1-timeline.md`). (1) A new ink token `--color-signal-ink` for small orange text on dark (asserted in `tokens.test.js` against paper and both phase-row bands); phase and sub-phase names in the gutter take it at 600; task names take the ink; the dead hover rule goes. (2) The week header takes the minimap's measured no-overlap rule (option B): `buildAxisTicks` moves beside `minimapTicks`, a label prints only when it fits before the next tick, the 1st always wins, a month label gets a paper backing so Day zoom prints cleanly, a 1st on a hidden weekend keeps its label on the first visible day; tests at all four zooms and three widths; option C described in the walkthrough. (3) One date helper `src/tools/rabbit_v0.1.0/dates.js` that reads `YYYY-MM-DD` as a LOCAL date; the Timeline's `parseDate` and `toDateInputValue`, the Projects page (P1-20) and the Tasks view go through it; creation clicks floor to the cell under the pointer; the 34 state shots are re-baselined and two tasks + one key date are verified against stored values. (4) Task rows lose their hairline in the gantt half only (every grouping; the "+ New task" row too); the rows probe's expectation changes accordingly. (5) The minimap window animates on the four zoom tabs only (`data-animate` window, `--duration-response`, a reduced-motion twin, the scroll compensation moved to a layout effect); the sheet joins `v2Motion.test.js`.

**S2a — settings placement, orange, the pet's Shift** (`po-s2a-settings-placement.md`). Remove "Tool settings" from the nav strip for all three tools and delete its plumbing; O.T.T.E.R.: Help + Settings icon buttons as a sibling group right of Validate; D.O.G.: the "Deck outline" bar becomes a full-width strip at the tab-strip height with "Deck outline" as its leading label, the four history buttons, then Help + Settings at the far right (the sidebar Panel loses its head; `dog-preview-probe --check` unchanged); R.A.B.B.I.T.: Help beside the gear, titles unified; the three help passages rewritten; O.T.T.E.R.'s drawer tab renamed "Storage & data". Orange: D.O.G.'s two section titles (text + numerals, reverting on hover), "Course library", the key-cap text in both hotkey tables, both lesson-card titles + icons — each a scoped rule reading `--color-signal`, recorded in §3.2 with a dated note beside the D9/D4 comments. The pet: a bare Shift tap toggles it (Shift down and up with no other key between, never while typing); Enter presses the focused control; help copy and P1-01 updated.

**S3a — shot lists + edits: design, schema, adapters** (`po-s3a-shot-lists-schema.md`). Migration 0084 + suites 84–86: `shot_lists` (title, version, summary, snapshot, archived_at), `shot_list_items` (list, scene or shot, position — the membership table), `edits` (list, title, version, summary, parent, items JSONB), `projects.active_shot_list_id`, `tasks.scene_id/shot_id`, `assets.scene_ids/shot_ids`, `budget_versions.shot_list_id` (and `summary` if F8 says column); a NEW gate `can_edit_shot_lists()` that admits reviewers; set-active and archive through SECURITY DEFINER RPCs that check manager/admin; the backfill of one active list per project with scenes (cloud in the migration, Local Server on read, fixtures seeded). Allowlists, `RLS_TABLES`, the six bundle-key places, provider mutators registered in `mutationsRef` with undo, selectors (`scenesOf(listId)`, `shotsOf`, `activeShotList`, `listsContaining(shotId)`), Local Server routes + `scenes.json` in the mirror, the dev fixtures, route and provider tests. Applied to dev; the staging command in the hand-off. No view code; the hand-off documents the API for S3b/S3c.

**S2b, S3b, S4a, S3c, S4b, S5**: scoped in §0.1's rulings and the question list; their briefs are written by the controller when their wave opens, from the preceding hand-offs.

---

## 4. Mechanics (mirrors the overhaul plan §6; differences in bold)

1. **Session branch** from the integration branch in the fresh worktree (the app cuts worktrees from `main`, so `docs/` is missing until this):
   ```
   git fetch origin
   git checkout -b po/s1-timeline origin/feat/post-overhaul-edit-versioning
   npm install --ignore-scripts && git checkout -- package-lock.json
   ```
   Copy `.env.local` from `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.env.local` into the worktree's `WILSON/`; never commit it. Schema bundles also run `supabase link --project-ref eqjzmnvkrakroyqxfsvw --password ""` (wilson-dev) from `WILSON/` and confirm `supabase/.temp/project-ref`.
2. Push early and often (`git push -u origin po/<name>`); CI (`rls.yml`, root) runs on every push; the run URL goes in the hand-off.
3. **Integrate by pushing, never by checking the integration branch out:**
   ```
   git fetch origin
   git merge --no-ff origin/feat/post-overhaul-edit-versioning
   npx vitest run
   git push origin HEAD:feat/post-overhaul-edit-versioning
   ```
   at every real milestone and before the hand-off; if rejected, merge again and retry.
4. **Never push to `feat/multi-user-v1`, `feat/ui-overhaul`, `feat/demo-2026-09-11` or any `track-*` branch; never deploy; never touch staging or prod.** The controller merges the integration branch into `feat/multi-user-v1` (which deploys the beta) at wave boundaries, after the staging migrations and Audrey's go.
5. Ownership as in §2. The kit (`src/ui/*`, `src/index.css` `@theme`, `tokens.js`) takes additions only with a recorded kit request and a caller in the same commit.
6. **Every session:** line one states the model (Opus 5.5) and stops if wrong; one bundle; a state-extraction commit first where it restyles; a hand-off at `docs/sessions/handoffs/po-<bundle>-<YYYY-MM-DD>.md` in protocol §4 order; a walkthrough at `docs/walkthroughs/NN_<name>.md` (48 onward) copied to the Desktop folder; **two adversarial review rounds (`model: "opus"`), the second attacking the first's corrections; the session does NOT wait for Audrey's walkthrough report (A7)**; enumerate exports and grep (case-insensitively) for callers before committing; `npx vitest run` count stated; `<!--` markers counted after editing any long doc; last command `git checkout --detach`.
7. Dependency changes regenerate the lock with npm 10 only (`npx --yes npm@10 install --package-lock-only --ignore-scripts`, then `npx --yes npm@10 ci --dry-run --ignore-scripts` exits 0).
8. **Schema bundles** apply their migration to dev with `supabase db query --linked --file supabase/migrations/<file>` (one file per call, from a tree that has it), verify by query, write the pgTAP suite and the `RLS_TABLES` entry in the same commit, run `tap-all` one at a time, and put the exact staging command in "Waiting on Audrey". Never `db push`.
9. **Chips.** **The controller spawns every chip** (it writes each bundle's brief from the preceding hand-offs); a session ends with its hand-off and a chat close-out, and spawns nothing. Chips: `spawn_task`, cwd `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`, title `Post-overhaul <bundle>: <name> (Opus 5.5)`, a self-contained prompt naming this plan, the bundle's brief, the protocol, the hand-off it continues, and §4.1's first commands. Audrey's click is her permission. Never more than three chips outstanding; never two bundles on one file.
10. **The real library.** Anything that reads, ranks or renders Audrey's O.T.T.E.R. content is replayed against her real library, not a fixture. `%APPDATA%` is virtualised for sessions (a session sees a stale copy): read `%APPDATA%\wilson\otter-data\software` and, if the files look empty or old, ask Audrey to copy the folder to her Desktop and read it from there.

---

## 5. Verification

As the overhaul plan §7, plus: every schema bundle's hand-off states the dev query that proves the migration and the pgTAP count; every UI bundle re-runs the pixel or probe script its area owns (`timeline-state-shots.mjs`, `timeline-rows-probe.mjs`, `dog-preview-probe.mjs --check`, `ui-shots.mjs`, `ui-audit.mjs`) and screenshots at 1440x900 and 1280x700 into `docs/sessions/handoffs/img/`; every new orange pair is in `tokens.test.js`; every new bundle collection is in the six bundle-key places and `loadProjectBundle.test.js` / `supabaseLoadProject.test.js`; every new mutator is in `mutationsRef`; every export has a caller.

## 6. Risks

- The five bundles that touch `TimelineView.jsx` (7,156 lines) and `ScenesView.jsx` (3,549 lines) edit files the plan already called unsafe to edit as they stand; hand off at the first protocol §1 trigger.
- Shared shot rows (D3): editing a shot's name or notes in one list changes it in every list; S3b's walkthrough says so in its first paragraph and the Scenes tab's tooltip names the lists a shot belongs to.
- The Local Server has no roles: the new `can_edit_shot_lists` gate, the manager-only set-active and the budget-version picker are labels there; each walkthrough says so.
- The beta deploy waits on five staging migrations (§1); a merge before them breaks the beta's Files, private-projects and milestone code.
- Reviewers gaining write on shot lists/edits is the first place a reviewer writes anything; the RLS suite proves reviewers cannot write scenes, shots, tasks or budgets through it.
