# PLAN_MOTH.md

Complete execution plan for Claude Code, incorporating Audrey's six answers of 2026-11-01. This is the hand-off document, not an addendum. The repository was inspected read-only; no implementation code is included.

## 1. Summary

**MEASURED — approved brief sections 1–2, 7, 12 and 12a:** M.O.T.H. means Mapping, Organization & Tagging Hub, said “Moth”; it is WILSON's editable visual world for files, production items, tags, notes and boards. **Proposed:** one graph model supports folder and tag views, persistent spatial layouts, cross-project exploration and file-backed collaborative boards. **MEASURED — approved brief section 12:** Moth is part of the release, and the v1.0.0 tag waits for it. **Proposed end condition:** every release requirement below is implemented through shared adapters and permissions, security and interaction tests pass with demonstrated failing controls, the approved debug sample and saved local test project meet the performance budget, and Audrey passes the four session walkthroughs on desktop and web.

## 2. Release position

**MEASURED — approved brief section 12:** build Moth before optimisation waves 2–4. Wave 1 stays completed. **TPN-AI-009's AI-files sweep remains due before 2026-11-09, independently of Moth's progress.**

**MEASURED — repository documents:** PLAN_TO_1_0.md, “The end, stated once” and “What 1.0 contains,” do not include Moth. PLAN_WEEK_2026-11-04.md, “Before the tag or after,” still permits remaining waves before Moth exists.

**Proposed — Session 1 updates, in words:**

| Document | Required change |
|---|---|
| PLAN_TO_1_0.md | Add Moth to the feature list and feature-completion gate. Preserve the closed nine-defect list. Add these four sessions, dependencies, walkthroughs and approved answers. Distinguish the completed baseline from Moth still required. |
| PLAN_TO_1_0.md | Preserve Audrey's testing, browser actions, production procedure, security gate, and permission before main merge or tag. Expand eventual deployment inventory for Moth migrations/functions. |
| PLAN_WEEK_2026-11-04.md | Mark Wave 1 done. Make Wave 2 depend on Moth completion. Preserve F4/F7/F8, then F5/F6/F9, then F10/F11/F12. |
| PLAN_WEEK_2026-11-04.md | Remove the answered question about waves waiting for Moth. Preserve unrelated unanswered decisions. |
| PLAN_WEEK_2026-11-04.md | Replace F7's provisional migration 0107/suite 110 with a next-free-number measurement after Moth. Preserve identities and historical records. |
| Both | Keep the AI-files sweep deadline before 2026-11-09 prominent. It does not wait for Moth. |

**Proposed:** optimisation waves do not become extra Moth acceptance requirements; their established release position otherwise stays unchanged unless Audrey separately changes it.

## 3. What exists today

### Measurement boundary

**MEASURED — Git inspection during planning:** Audrey's open checkout was at 7d00376f5ad994e8d0d1e20864325a0f6bec7913. The existing controller worktree was clean at 91d696b07683a15a23b95e29565ec3fc87820c78, matching the reference document. The open checkout was 131 commits behind this integration commit. Its missing week plan was a checkout-age difference. This plan measures the pinned controller tree, without checkout, pull, fetch, build, test, install, migration, deployment or repository edit.

**MEASURED — all three source documents were read in full:**

- C:/Users/Audrey/Downloads/ASTRA_MOTH_PLAN_PROMPT.md
- C:/Users/Audrey/Documents/My_Work/Dev_Work/Claude_Work/wilson-claude-project/WILSON_PROJECT_CONTEXT.md
- C:/Users/Audrey/Downloads/WILSON — Visual Graph & Boards Tool Planning Brief(1).md, whose document title is the M.O.T.H. Planning Brief.

**Evidence convention:** MEASURED means source observation or recorded evidence, not a newly executed runtime result. INFERRED names an unconfirmed conclusion and the measurement that settles it. New names, schema boundaries, budgets and implementation choices are proposed. Audrey's decisions are requirements.

**MEASURED path key:** application files in the evidence inventory sit under C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/.claude/worktrees/post-overhaul-merge/WILSON. Its parent is the measured Git root, holding .github/workflows. These paths identify the observed snapshot; future sessions use their own checked current integration worktree.

### Reusable implementation and gaps

| Evidence | MEASURED file, symbols and finding |
|---|---|
| E1 | Application file src/tools/rabbit_v0.1.0/adapters/index.js, RabbitAdapter and FullProjectBundle: Supabase, Local Server and read-only Google Drive provide the shared seam. |
| E2 | Application file src/tools/rabbit_v0.1.0/state/RabbitProvider.jsx, runBatch, undoHistoryEntry, patchFile, deleteFile, uploadFile: queued entity undo exists; file mutators do not automatically create undo entries. Switching active project clears undo history. |
| E3 | Application file src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js, deleteFile, restoreFile, uploadFile, projectIsPrivate: cloud soft-delete/restore; private non-money uploads routed to owner's computer; ordinary network-storage uploads refused. |
| E4 | Application file src/tools/rabbit_v0.1.0/adapters/localServerAdapter.js, deleteFile and listEditHistory; electron/main.cjs, file DELETE route: local deletion permanently removes body and row; no local restoreFile. |
| E5 | Application file supabase/migrations/0085_file_tags.sql, files_tags_known_chk; src/tools/rabbit_v0.1.0/fileTags.js, FILE_TAGS, displayTags, tagSettable: nine fixed categories. Finance derived; Legal fixed at upload. |
| E6 | Application file supabase/migrations/0017_notes.sql, notes, note_subjects, notes_select: notes already workspace-scoped and project-independent; owner-private, no admin bypass, soft deletion or history. |
| E7 | Application files src/components/Dashboard/NotesView.jsx, NoteEditor; noteSync.js, saveWithMerge; noteText.js, noteEditorExtensions and noteTextFromState: Yjs snapshot/version merge and decoder reuse, not live co-typing. D.O.G. uses the shared decoder. |
| E8 | Application file supabase/migrations/0041_folders.sql, folders: project hierarchy, entity associations, relative paths and live-parent RLS; no independent folder soft-delete. |
| E9 | Application files supabase/migrations/0072_private_projects.sql, projects_select; 0082_private_project_definers.sql, passes_project_privacy and fn_trash_authz: creator/admin visibility; definers repeat privacy checks. |
| E10 | Application file supabase/migrations/0098_table_views.sql, table_views, fn_table_views_pin and set_table_view_last: shared project views, bounded config, owner last-view memory. Existing keys exclude Moth. |
| E11 | Application file supabase/migrations/0091_bins_on_the_cloud.sql, bins, bin_files and shot_takes: references without media copies. A bin-file entry need not have a files row. |
| E12 | Application files supabase/migrations/0016_realtime_broadcast.sql, fn_realtime_broadcast and can_read_project_topic; 0018_workspace_channel.sql, fn_workspace_realtime_broadcast and can_read_workspace_topic: database broadcasts/private-channel lifecycle. Existing project sends permit presence, not Moth cursor broadcasts. |
| E13 | Application file src/tools/rabbit_v0.1.0/state/realtimeMerge.js, mergeRow, isStaleIncoming and applyRealtimeEvent: pending-field protection, stale-event rejection, soft-delete/reconnect patterns. |
| E14 | Application files src/permissions/roleMatrix.js, ACTIONS and can: 15 app actions; projectRoleMatrix.js, canOnProject: eight project actions. project.entity.write matches Moth editing; shot-list gate deliberately admits reviewers. |
| E15 | Application file src/permissions/GatedAction.jsx, GatedAction; src/tools/rabbit_v0.1.0/views/writeGate.test.js, canOnProjectCallSites: visible denial reasons and explicit ready enforcement. |
| E16 | Application files src/ui/tokens.js, THEME, TYPE, DURATION and radius tokens; Drawer.jsx, Dialog.jsx, Toolbar.jsx and corresponding components: reusable kit. Dialog does not portal. tokens.test.js tests composited contrast. |
| E17 | Application file src/App.jsx, renderAllPages, navigateTo and onOpenOtterCourse; src/layout/pages.js, PAGE_LIST and validatePage: twelve page wrappers/registry-driven chrome. Files child conditional; main tools remain mounted. Moth needs first-entry lazy loading. |
| E18 | Application file src/tools/rabbit_v0.1.0/storage/index.js, WORKSPACE_PROVIDERS, FILE_PROVIDERS, NEW_BODY_GOES_TO and resolveFileProvider: company storage and body provider are separate axes. Ordinary NAS media has no cloud catalogue. |
| E19 | Application files supabase/functions/_shared/readUrls.ts, classifyOwned; teardownCollect.ts, collectBlobPaths: authorization/cleanup depend on project-prefixed keys. Changing project ID alone is not a safe body-preserving move. |
| E20 | Application files src/components/Resources/filePreview.js, previewKindFor, tooLargeToRead and unavailableSentence; FilePreviewDialog.jsx, readBounded and PreviewStage: bounded reads, inert content, provider-aware previews. Hover autoplay is new. |
| E21 | Application file supabase/migrations/0092_legal_gate_managers.sql, files_select, rabbit_money_segment, file_row_is_money and fn_trash_authz: leadership access remains in Files/Rabbit; Moth needs unconditional exclusion. |
| E22 | Git-root file .github/workflows/rls.yml, “Enforce per-table test coverage”: 61 allowlisted tables. Application migrations: 101 files through 0106. pgTAP: 103 suites through 109. Next free migration 0107 and suite 110. |
| E23 | Application file docs/sessions/handoffs/po-sb1-2026-11-01.md, “State, measured”: recorded main 5,013,763 bytes, CSS 501,838 bytes, total web 7,935,032 bytes. Historical results, not a fresh planning build. |
| E24 | Application file docs/sessions/HANDOFF_PROTOCOL.md, “The hand-off file”: eight required sections in order. |

**MEASURED — E1–E23:** graph/HUD, general typed tags, shared workspace-note tiers, boards/elements, sticky leases and board-specific collaboration protocol are missing.

**Proposed:** add typed tags alongside existing categories; extend shared file operations before Moth relies on moves, undo and trash.

## 4. Data model proposal

### Shared rules

**Proposed:** every new table uses workspace/current-membership isolation and live role checks for writes. Project children follow the 0014 live-parent pattern; personal records the 0017 owner-only pattern; shared note tiers O.T.T.E.R.'s visibility pattern.

**Proposed:** one reusable eligibility helper, proposed name moth_can_read_target, plus corresponding write checks, validates actual type, existence, workspace, parent and audience. Caller-supplied kind/identifier pairs are never authority.

Exclude financial files/canonical locked-folder descendants, including Legal, for every role; another person's personal space/tags/private notes; unreadable private projects. Apply to catalogue, search, counts, glow, positions, history, trash, backlinks, previews, embeds and channels. Hidden content produces no revealing placeholders or counts.

### New tables

**Proposed provisional allocation:** remeasure before creating anything. Every table needs its own exact table-named suite and matching RLS_TABLES entry before dependent work is pushed.

| Proposed table | Purpose/main fields in words | Proposed RLS | Suite / RLS_TABLES entry |
|---|---|---|---|
| moth_views | Workspace; project or personal aggregate scope; owner; name; dot/edge kinds; layout/safe filters; revision/trash. | Live parent/project-write for shared; owner-only aggregate. Shared config contains no private target IDs. | 110_moth_views.sql / moth_views |
| moth_layout_positions | View/target identity; coordinates; fixed position; revision; owner overlay where private. | Both view and target visible; private coordinates owner-only. Reviewer cannot persist rearrangement. | 111_moth_layout_positions.sql / moth_layout_positions |
| moth_tag_types | Name/normalization; company/personal tier; owner; shape/appearance; retirement. | Company read by active members, management by live admins; personal owner-only. | 112_moth_tag_types.sql / moth_tag_types |
| moth_tags | Type; label/normalized label; tier/owner; canonical merge target; retirement/revision. | Company read by active members, write by live admins; personal owner-only, no admin bypass. | 113_moth_tags.sql / moth_tags |
| moth_tag_assignments | Tag/target; assigning user; audit/trash. | Both tag/target readable. Company assignments require target write. Personal annotations remain owner-only and never travel. | 114_moth_tag_assignments.sql / moth_tag_assignments |
| moth_tag_nominations | Proposer; consented tag/type label snapshot; status/decision/admin; canonical result. | Proposer/live admins; never expose private assignment targets. Managers nominate but cannot decide. | 115_moth_tag_nominations.sql / moth_tag_nominations |
| moth_relationships | Source/destination; optional label; manual/inline origin; mention occurrence; private owner overlay; revision/trash. | Both endpoints visible; source writable and destination eligible; recheck destination changes. Backlinks require visible source. | 116_moth_relationships.sql / moth_relationships |
| workspace_notes | Workspace/owner/tier; title; Yjs snapshot/preview/version; audit/trash. | Personal owner-only, no admin bypass. Shared active-member reads; owner/admin share rules; company-standard transitions live-admin only. | 117_workspace_notes.sql / workspace_notes |
| boards | Real folder; project/local scope; title/fixed semantic colour; revision/channel generation; audit/trash. | Eligible live parent; personal-space Moth owner-only; local owner/device scope. | 118_boards.sql / boards |
| board_elements | Board/kind; geometry/rotation/stack; style; appropriate text; file reference; endpoint element IDs/anchors; version/trash. | Board/write gate plus every referenced file/endpoint; same-board connectors. Layout deletion never cascades into files. | 119_board_elements.sql / board_elements |
| sticky_locks | Sticky file/element; authenticated holder session; expiry/fencing generation/renewal. | Atomic authorized claim/renew/release; publication requires current lease/generation; no forged holder. | 120_sticky_locks.sql / sticky_locks |
| moth_local_scopes | Owner/workspace; machine-origin and opaque local project identity; technical backing project; last observation. | Owner-only Moth; no live channels/absolute paths; cannot impersonate cloud identity. | 121_moth_local_scopes.sql / moth_local_scopes |
| moth_history | First baseline/subsequent structural metadata; target/scope; observation time; prior/current state; audience/retention. | Server capture; reader satisfies present and original audience. No money/private-overlay leakage. 90 days; no historical bodies. | 122_moth_history.sql / moth_history |
| file_body_locations | Stable body identity/workspace; verified provider/immutable locator; thumbnail; publication generation/lifecycle; current file association. | Current authorized file association, not former prefix alone. Server-controlled location/ownership; no arbitrary path adoption. | 123_file_body_locations.sql / file_body_locations |

**Proposed:** these 14 additions would take RLS_TABLES from 61 to 75 if these boundaries survive design review. No pinned-card table: five live cards only. Preferences/recent folders are separate from views.

### Existing changes and coverage

| Existing area | Proposed change and protection | Existing suite/allowlist treatment |
|---|---|---|
| Projects, E9 | Protected personal-space owner/classification; exactly one private backing project/root folder per person/workspace. Narrow ordinary-member provisioning without general project-create privilege. Moth owner-only; Files owner/admin. | Extend 01_projects, 80_private_projects and definers; retain projects entry. |
| Local scopes, E1/E18 | Keep legacy production source local. For new file-backed Moth data needing cloud identities, map owner-only technical catalogue parent through moth_local_scopes. No implicit full migration. Hide technical parents from normal lists. | New local-scope suite plus project/file suites; new Moth databases stay Supabase. |
| Folders, E8 | Board-folder identity/reversible independent trash; preserve children/bodies. Validate cycles, parents, scope changes/reserved folders. | Extend 52_folders; retain folders entry. |
| Files, E3/E5/E18–E21 | Preserve nine categories; stable-body association/company-network catalogue; real logical folder membership on move. Recheck source/destination. | Extend 05_files, 90_legal_files/private/storage suites; retain files entry. |
| Storage, E19 | Coordinate stable body across RLS/signing/reservations/thumbnails/GC/teardown. Body stays put, association changes atomically. Old project loses body access; destination gains it; deleting old container cannot collect moved body. | Extend storage/object policy suites and file_body_locations suite; preserve money rules. |
| NAS catalogue, E18 | Add distinct network body provider alongside all existing providers. Containment-checked relative locator; metadata only. Refresh on desktop project open and Refresh; show last checked. | Explicit complete constraint widening; 05_files, 58_workspace_storage, 60_workspace_storage_provider/provider contracts. No watcher this release. |
| Notes, E6/E7 | Owner-only soft-delete/restore; Dashboard uses same path. Retain save-and-merge, no live transport. | Extend 21_notes and note_subjects if parent changes; no residual hard-delete bypass. |
| User settings, E10 | Bounded workspace-keyed Moth last view/appearance/recent folders/first visit. Account/workspace memory reset and re-authorization on reuse. | Extend 57_user_settings; retain user_settings entry. |
| Trash/history, E2/E6/E21 | Extend explicit allowlists/shared undo/captures; no broadened private readership. | Extend 17_edit_history/trash/affected suites; preserve latest full guard bodies. |
| Tasks/assets, E12 and A-R2-03 | Add missing parent-privacy checks as explicit Moth write prerequisite. | Extend 03_assets/04_tasks; forged insert/destination update and valid positive controls. |
| Realtime, E12/E13 | Suppress private/personal workspace payloads. Scoped Moth channels; audience-generation changes. | Extend 20_realtime, 23_workspace_realtime, 104_versions_and_items_realtime; separate proposed channel-behaviour suite in failure replay. Existing entries remain. |
| Rabbit text, E7/actual writers | Preserve field format; separate relationship identity. Shared picker/rendering reaches create/table/detail writers. | Writer invocation, mention removal/conflicts/safe fallback; TipTap alone insufficient. |

**Proposed move contract:** validate complete selection, source/destination, cycles and workspace before commit. Failure leaves membership unchanged. Record reversible operation without switching Rabbit active project, which would clear history.

**Proposed personal move:** actual Files membership changes; body locator stays in company storage. Legacy project-prefixed keys remain physical locators, while checked current association controls authority. Personal tags remain owner-only.

**Proposed links:** existing task-item/shot-take/bin/asset relationships remain derived edges; store new labelled manual/inline relationships once. No fabricated bin-file/file match. Inline occurrences do not eagerly embed private destination metadata. Hidden destinations render ordinary safe text without tooltip/URL/hidden target ID/revealing count. Personal-tag metadata never serializes into shared bodies. Share preview catches system-inserted sensitive labels; RLS cannot redact arbitrary author-written prose by itself.

**MEASURED — Audrey's answers:** history is baseline-forward graph structure/metadata for 90 days, labelled missing periods, no historical bodies. Long notes retain save-and-merge; live co-typing after release. **Proposed:** local history labels actual observation gaps; history scrub is read-only. Help and sharing UI plainly describe save-time merging. Sticky markdown publication checks lease/fencing even through Files; database-time expiry recovers after disconnect. Deferring long-note transport does not defer live boards/soft locks.

## 5. Sessions

**Proposed:** four dependent long sessions. S1 is necessary because measured shared file/security/storage prerequisites are missing. Continue stalled sessions via hand-off, not new leftover sessions.

**MEASURED — Audrey Q1:** Opus for all sessions. **Required:** Opus 5.5 for each build, design and both cold adversarial rounds. Round two reviews corrections; stop if model differs. No Fable allowance dependency.

**Common instructions for every brief:** read current project context, approved brief, this plan, OUTSTANDING, Systems Handbook and hand-off protocol; use current integration. All six decisions are settled; do not re-ask them. Stop/report material code contradictions instead of improvising. Follow controller/Audrey start process; this plan does not launch sessions automatically. Use established po/ session branches; stage explicit paths; merge checked commit by hash, never moving ref. Read CI at pushed head. Ask before main merge/tag. Controller beta/staging actions require Audrey's go. No secrets, new per-session scripts/launch entries/screenshot scripts, uncalled exports or unbounded scope. New files need justification. Findings outside scope go to OUTSTANDING. Actual deployment evidence is environment queries/source comparisons, not CLI success/version alone. Every session records bundle before/after and explains growth over 20 KB.

### Session 1 — Shared foundations, storage and security

**Model: Opus 5.5 for build, design and both review rounds. Stop if different.**

**Goal:** establish secure Moth schemas and shared file operations. Deliver reachable minimal Moth entry/personal-space and Files workflows, with real production callers for foundational client exports.

**Audrey's acceptance/walkthrough checklist — proposed:**

1. Ordinary member opens Moth and receives exactly one personal space.
2. Owner sees space in Moth; admin in second browser sees it through Files, not Moth.
3. Move test file from personal space into writable project; Files agrees and it still opens.
4. Local/cloud delete, undo and restore recover exact file.
5. Neither account sees Legal/finance in Moth search, counts, selection or trash.
6. Reviewer denied action stays visible with reason and performs no write.

**In scope:** brief 4.3, 8, 12 release changes, 12a.1/5/7–10, 13; checklist 1–2/13–16 foundations. All section 4 schemas/security/suites; NAS metadata; stable bodies; later sessions own complete interfaces.
**Out of scope:** graph, full tag/notes UI, toolkit, gateway previews, NAS watcher, long-note live transport, optimisations/unrelated fixes.

**Measure first:** integration/cleanliness/free numbers; latest guard bodies where authorized; provider constraints/all writers/cleanup; OUTSTANDING A-R1-04/A-R2-03. Confirm actual file undo/delete behaviour. Locate established debug sample and saved local WILSON test project from project context. Stop on material contradiction.

**Files/areas — MEASURED:** E1–E6, E8–E10, E12, E14–E19/E21–E22; shared signing, presigning, reservations/teardown. **Proposed:** new Moth tool area/minimal entry and section 4 tables.

**Ordered build — proposed:**

1. Record settled section 9 answers. Opus design review of schema/storage/audiences.
2. Update both release plans.
3. Schemas/backfills/identity constraints/live membership/RLS/grants/suites/allowlist together. History baseline-forward metadata/90 days/gaps.
4. Narrow provisioning/Moth catalogue; owner-only Moth separate from admin Files.
5. Stable-body transition, preserving physical bodies and updating every auth/cleanup consumer together.
6. Metadata-only NAS provider/registration; desktop open/manual Refresh/last checked; preserve provider family.
7. Shared checked moves, restorable local delete, restore/trash/file undo, existing atomic local writer.
8. Named task/asset privacy repairs and private/personal workspace suppression; invalidate indexes without exposing hidden rows.
9. Minimal lazy Moth entry and production callers. No feature-specific client exports before consuming UI.
10. Two cold Opus review rounds, corrections verified, tests/docs/hand-off.

**Database — proposed:** remeasure; starting measured free 0107. Order schema/backfill, guards/constraints, policies/grants, capture/channel plumbing, verification. Preserve deployed guard bodies; complete constraint/policy restatement. Suite and RLS_TABLES entry before dependencies. Channel-only suites enter replay list. Whole pgTAP set before push; collected equals planned. Read linked environment before writes; rolled-back rehearsal/file-by-file authorized apply/history digest. No broad database/config push.

**Tests/controls — proposed:** every new table tenant/inactive/owner/admin/manager/reviewer probes. Removing audience guard fails named test. Admin Files positive/Moth negative for another space. Forged endpoints/private insert/move/cross-company locator/reserved folders fail; valid controls pass. Moved body survives old-container deletion/GC; removing current-association protection fails. Local delete/restore and real undo writer; permanent-delete substitution fails. NAS containment/metadata-only refresh; arbitrary absolute path or body upload fails. History baseline/expiry/gaps/no bodies. Home does not load Moth; exports have production callers.

**Docs — proposed:** Handbook, CHANGELOG, release plans/runbook inventory, RELEASE_TESTING strings, newly numbered session walkthrough; OUTSTANDING last, broken/unfixed only. Preserve artifacts/history; check long-doc comment pairing.

**Hand-off, at most 200 lines, protocol order:** (1) Where you are: branch/checked hash/integration/beta. (2) State measured: environment queries/functions/source/suites/tests/CI/bundle before-after. (3) Done and verified, commit/proof. (4) In flight, exact action/no uncommitted work. (5) Traps hit. (6) Waiting on Audrey. (7) Next first three steps: remeasure integration/schema; read foundation hand-off/approved decisions; replay file/privacy checks before graph. (8) Auto-memory: none.

**Closing chat:** Sessions 1–4 one line each, completed marked; then plain-English change/testing explanation without jargon, paths or migration numbers.

### Session 2 — Graph, glow, HUD and navigation

**Model: Opus 5.5 for build, design and both review rounds. Stop if different.**

**Goal:** editable graph/complete viewing UI over authorized catalogue. Spatial memory, previews, adaptive input and measured scale are acceptance requirements.

**Audrey's acceptance/walkthrough checklist — proposed:**

1. First visit: “What do you want to map?”, everything by tags/everything by folders; later visit restores last view.
2. Folder/layout/search navigation leaves centred glow stable.
3. Toolbar Settings opens right appearance Drawer; HUD holds viewing controls.
4. Five scrollable pins, sixth handled; reopen shows only minimal recent icon until pressed.
5. Hover/glow-link/grow-move/Escape/Move to; successful real moves agree with Files.
6. Mouse/pen/finger-pan/pinch adapt smoothly and return on mouse movement without flicker.
7. Saved layout, trash, confirmed/cancelled tool jumps and baseline-forward history/gaps work.

**In scope:** brief 1–4.3/9; graph portions 5–6/8; 12a.1–6/8/11; checklist 3–5/12–16. Agreed metadata history; S3 supplies tag/note management.
**Out of scope:** nomination/admin UI, full note sharing, board editing/live, historical bodies, gateway previews, NAS watcher/general optimisation.

**Measure first:** S1 hand-off/deployed prerequisites/catalogue/mutation callers; registry/hidden effects/tokens/preview capability. Baseline bytes and both approved projects: debug-mode sample and saved local test project in local WILSON. Claude locates them; no production-project request. Stop/report contradictions.

**Files/areas — MEASURED:** E1–E2/E10–E20/E23; src/layout/PageSurface.test.jsx, Shell; src/tools/rabbit_v0.1.0/state/rabbitNavigate.js, useNavigateTarget, under measured application root. **Proposed components:** graph/view/list/cards/move picker/input-mode controller.

**Ordered build — proposed:**

1. Measure approved projects/dependency footprint before final pins.
2. One normalized graph model: real hierarchy/tags/relations/stable identities.
3. Proposed D3 force/hierarchy modules and Canvas2D graph; bounded worker layout. D3 supports renderer-independent force output/radial coordinates; WILSON results require measurement. Sources: [D3 force](https://d3js.org/d3-force), [D3 tree](https://d3js.org/d3-hierarchy/tree).
4. Cluster/cull/level-of-detail; folder one dot/count; suspend settled simulation.
5. Viewport-centred whole-authorized-project glow, not current folder. Aggregate only authorized scope; subtle smoothly fading text/dot shadow. Retain light in calm/fallback, reduce motion/detail.
6. Kit toolbar Help/Settings right; Drawer glow colour/size by contents or recency/colour by file type, tag or last editor. Board semantic colour overrides all.
7. HUD view pick/save/reset/new; dot/edge toggles; layout/history/focus one-two steps/fly-to search/tag filters. Right breadcrumb glossary; tags grouped by type/count.
8. Five independent pinned cards/inter-card and graph drops; recent-folder memory separate, no saved pins.
9. Half-second bloom, press/drag immediately cancels, departure fades, silent video; bounded/inert reads. NAS web says “Preview available on the desktop app”.
10. Exclusive glow/link versus grow/move, cursor word, Escape, empty-space layout only; searchable Move to with writable projects/folders/personal space through shared moves.
11. Selection delete/undo/trash and confirmed tool jumps. Proposed events wilson:open-rabbit-item, wilson:open-project-file, wilson:open-dashboard-note; reuse wilson:open-otter-course. Ship actual destination/pending-selection handlers.
12. Lazy/active-page gating; pointer adaptation ignores synthetic mouse during pen/touch, switches on genuine mouse movement, smooth/no flicker/keyboard accessible. Two cold Opus reviews.

**Database — proposed:** S1 view/layout/preferences/history. Remeasure additive numbers; affected suites/full replay. Read-only history has current/original audience, 90 days/gaps/no bodies.

**Performance targets — proposed, not results:**

| Mode | Acceptance target |
|---|---|
| Normal | Up to 1,000 expanded visible dots/2,000 lines before clustering; target 60 fps, p95 frame no worse than 20 ms on recorded hardware. |
| Low power | Up to 300 dots/600 lines; target 30 fps, p95 no worse than 34 ms. |
| Response/idle | Selection/drag feedback within 100 ms; no typing/pointer blocking; no continuous settled layout/hidden render loop. |
| Delivery | Proposed initial registration growth 20 KB uncompressed; proposed total new graph/board code 300 KB gzip in lazy chunks. Measure and explain overruns before acceptance. |

**Required dataset choice:** debug sample plus saved local WILSON test project. Record hardware/host/storage/raw and visible counts/load/memory/frame distribution/chunks for both. Do not claim production-scale proof from these alone. If numerical limits exceed these datasets, disclose gap and use a documented expanded replay of non-sensitive test data as supplementary stress measurement; do not replace requested projects or request production data.

**Proposed fallback:** sustained frame failures trigger lighter mode with hysteresis/manual Settings override. Reduced motion changes animation, not a claim of slow hardware. Retain centred simpler light and complete operations.

**Tests/controls — proposed:** mounted HUD/first-last/breadcrumb/fifth-sixth/contrast/Drawer/gesture/Escape/Move to/reviewer. Removing ready, swapping to shot-list gate, persisting pins, initial Home load of Moth, hidden-page key listener must fail. Real writer reached; signed preview expiry; identity reset; jump cancel; history boundaries/gaps; adaptive pointers. Replay both projects before performance acceptance.

**Docs:** Handbook/CHANGELOG/RELEASE_TESTING/session walkthrough/benchmark; OUTSTANDING last.
**Hand-off ≤200 lines:** (1) Where: branch/hash/merge. (2) State: environments/functions/tests/CI and initial/graph/total before-after bytes, projects/hardware/results. (3) Done/proof. (4) In flight. (5) Traps. (6) Waiting. (7) Next first three: remeasure contracts; replay HUD/move/privacy; inventory all text writers. (8) Auto-memory none.
**Closing chat:** remaining Sessions 1–4 one line each/done marks; plain-English Audrey explanation without jargon/paths/migration numbers.

### Session 3 — Tags, relationships and workspace notes

**Model: Opus 5.5 for build, design and both review rounds. Stop if different.**

**Goal:** complete company/personal typed tags and labelled relationships in Moth, notes and Rabbit. Shared workspace notes bridge projects with private content protected and existing save-and-merge behaviour.

**Audrey's acceptance/walkthrough checklist — proposed:**

1. Personal typed tag undiscoverable by second account.
2. Duplicate warning/company-match nudge.
3. Nominate/approve as admin/rename/merge; visible uses update together.
4. #/[[ in notes and Rabbit descriptions; relationships/backlinks both ways.
5. Hidden destination is safe plain text with no hint.
6. Shared note bridges two projects; each reader sees only eligible connections.
7. Note delete/undo/restore and D.O.G. decoding; plainly described save-time merge, no live co-typing promise.

**In scope:** brief 5–6.3; note/tag parts 2–4.3/8; checklist 1–2/6–8/13–16; sharing/move effects. Existing snapshot convergence.
**Out of scope:** boards/sticky UI, live long-note transport, gateway previews, text-storage redesign, legacy Legal/Finance semantics/general role broadening.

**Measure first:** prior hand-offs/all category readers/all persisted text writers; O.T.T.E.R. tiers/nominations; note codecs/decoder callers/schema; established tests/projects. Stop on contradiction.
**Files — MEASURED:** E1–E7/E10/E14–E15/E21; application files src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx description/notes writers; views/ProjectAssetsView.jsx handleUpdateAsset; views/ScenesView.jsx scene/shot writers. **Proposed:** shared picker and tag/note UI.

**Ordered build — proposed:**

1. Inventory persisted project/phase/asset/task/scene/shot/level/experience/bin/file descriptions/notes, create/table/detail.
2. Typed autocomplete/normalization/near duplicate/company nudge; preserve category distinction.
3. Nomination consent/admin-only decisions; do not copy O.T.T.E.R. manager approval.
4. Transactional promotion/merge of exact normalized/type-compatible matches without exposing private targets; no fuzzy semantic merges. Canonical identities make rename/merge global.
5. Labelled manual links/inline occurrences/backlinks. Removing mention removes derived edge, not independent manual link.
6. Actual writers/picker/renderers; shared noteEditorExtensions and noteTextFromState updated together.
7. Personal/shared/company-standard notes, safe share preview, bridges/private overlays; existing Dashboard personal privacy retained.
8. Snapshot version/conflict merge; clear “changes merge when saved” limitation; no live long-note transport. Trash/undo/authorized invalidation; two cold Opus reviews.

**Database:** remeasure; allocated 112–117/21_notes/entity/settings/channel suites; live-admin/no personal bypass; explicit captures/trash allowlist with callers. House rehearsal/order/full replay/collected equals planned/authorized apply.

**Tests/controls:** personal tag leakage via Files/shared bodies/search/positions/nominations/events; manager approval rejection; concurrent merge/normalization; both endpoints/backlink source; removed mention/rename/private project in shared note; decoder; saved snapshot convergence. Removing endpoint guard, persisting private title, missing actual writer or bypassing version check fails named test. Visible link/shared-edit positives succeed.

**Docs:** Handbook/CHANGELOG/RELEASE_TESTING/two-browser session walkthrough/long-note limitation; OUTSTANDING last. Live co-typing listed as post-release enhancement, not broken release feature.
**Hand-off ≤200 lines:** (1) Where. (2) State: schema/environments/functions/tests/CI/bytes before-after. (3) Done/proof. (4) In flight. (5) Traps. (6) Waiting. (7) Next first three: remeasure board/file/lease; replay tag/note privacy/decoder; verify storage/channels. (8) Auto-memory none.
**Closing chat:** Sessions 1–4 one line/done marks; jargon-free Audrey explanation without paths/migration numbers.

### Session 4 — Boards, live editing and release verification

**Model: Opus 5.5 for build, design and both review rounds. Stop if different.**

**Goal:** complete file-backed board toolkit and authorized live collaboration. Finish release acceptance across storage modes, approved project replays and measured message costs.

**Audrey's acceptance/walkthrough checklist — proposed:**

1. Three panel sizes, button/Escape back, pull-away small frame.
2. Corners resize; edges only close via pull-away.
3. Full shapes/connectors/frames/pen/text/stickies; connected lines follow shapes.
4. Dropped media appears in Files; reference embed adds no copy.
5. Moved/deleted source yields stop-sign tile without private filename.
6. Two-browser independent edits/cursors/sticky contention/disconnect recovery.
7. Desktop-only board is solo, without channels/cursors.
8. Full walkthrough, both approved projects, verified current plan/cap enabled/remaining usage and measured messages.

**In scope:** brief 7–7.5, board parts 1–4/8–9, 12a.1/11; checklist 9–16; complete matrix verification.
**Out of scope:** gateway previews, live long-note transport, NAS watcher, waves, people/unrelated remediation/settled design changes.

**Measure first:** all hand-offs/file identity/providers/constraints/publication paths/realtime policies/settings. Audrey says Claude knows plan type: locate known configured context, verify plan name/remaining usage/spend cap; do not ask her to identify it again. Benchmark graph/both projects before board deps. Stop/report contradictions.
**Files — MEASURED:** E1–E4/E8/E11–E23/shared publication/previews/page-dialog tests. **Proposed:** board renderer/tools/frame/presence/cursors/sticky editor.

**Ordered build — proposed:**

1. Proposed Konva, lazy on board open; independent shapes/transforms/pointers, not whole-scene persistence. [Konva](https://konvajs.org/docs/), [pointer events](https://konvajs.org/docs/events/Pointer_Events.html).
2. Shapes: rectangle/rounded rectangle/circle/oval/triangle/diamond/star/hexagon/single and double arrow/speech bubble; flowchart process/decision/document/database/terminator/input-output/predefined process/connector circle.
3. Fill/outline colours, solid/dashed/dotted, thickness, rotate/resize/internal text; named frames/free pen/text/stickies/snapping/alignment/stacking.
4. Straight/curved/elbow connectors, dash choices, thickness slider, independent ends none/filled arrow/open arrow/dot/diamond, line labels; element IDs/anchors.
5. Per-element records; settled drags/bounded intermediate updates; never whole board per frame. Version-aware merges/conflict-safe undo.
6. Markdown stickies/dropped media via shared file paths into folder. External embeds references with source-location expectations. Placement deletion never deletes file body; explicit file delete has separate confirmation/trash.
7. One expanding panel: framed, viewport, whole-tool. Restore graph camera/selection. Confirms sibling to transforms. Edge pull shrinks/collapses small frame; corners resize. Topmost picker/editor/drag consumes Escape before close.
8. Separate ephemeral cursor/presence from database-origin durable events; reject spoofed saves. Subscribe only open; clean close/page/sign-out/workspace.
9. Lease/name/glow/renew/blur release/crash expiry/fencing in every body publication path. Local boards solo/no network lease.
10. Adaptive pointers/degraded quota states/project replays/storage matrix/two cold Opus reviews and acceptance evidence.

**Database:** remeasure numbers; board/element/lease/body/channel suites. Database broadcasts, never postgres_changes. Current parent/private channels; audience generation changes on permission change. Whole suite/rehearsal/allowlist/order/authorized deployment.

**MEASURED external constraint:** Supabase channel permissions are cached until rejoin/token refresh; source RLS change alone does not instantly revoke connected clients. Test already-connected revocation and rotate audience generation. [Authorization](https://supabase.com/docs/guides/realtime/authorization).

**Proposed cost rules:** maximum about ten moving cursor sends/second, no still sends, receiver smoothing, self-echo off, no server subscriber just to publish; count tabs/spectators/all receivers. Presence/durable/reconnect budget separately. Truthful quota failure, no false save. Keep current plan/spend cap enabled; no upgrade/disabled cap authorized. Record plan name/remaining messages/connections/cap before acceptance.

**MEASURED published terms at planning:** broadcast counts one send plus delivery to each receiver. Free 2 million messages/200 peak connections; Pro 5 million/500; Pro overage $2.50 per million-message package. Actual WILSON plan/usage not measured in planning; Claude knows context and must verify. [Messages](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages), [connections](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections). Recheck terms during build.

**INFERRED calculated estimate, not observed:**

| Scenario | Cursor messages |
|---|---:|
| Two continuously moving people for hour | 72,000 per person-hour; 144,000 board-hour |
| Five continuously moving people for hour | 180,000 per person-hour; 900,000 board-hour |
| Five people moving 25% of hour | 45,000 per person-hour; 225,000 board-hour |

**INFERRED:** five-person continuous movement consumes 5 million in roughly 5.6 board-hours before other usage. Settle with actual two-browser/multi-client measurement and dashboard deltas/background duty cycle; demonstrate fit within verified remaining allowance/cap enabled.

**Tests/controls:** mounted sizes/focus/Escape/edge-vs-corner; complete shape/connector persistence; same-board endpoints; independent edits/stale undo; actual sticky body publication via board and Files; expiry/stale holder; unauthorized join/send; already-connected audience transitions/revocation; spoofed saves; still sends/cleanup; missing/hidden embed/admin money denial. Remove lease fence/audience generation/throttle/file check/placement-only deletion protection: named test fails. Replay both approved projects, actual counts, no unsupported production claim.

**Docs:** Handbook/CHANGELOG/RELEASE_TESTING/final session walkthrough/cost and frame records/runbook inventory; OUTSTANDING last. Preserve AI deadline; map completion to evidence.
**Hand-off ≤200 lines:** (1) Where, exact checked release candidate/merge state. (2) State, environments/functions/tests/CI, initial/graph/board/total before-after bytes, project/messages/plan/cap/usage evidence. (3) Done/proof mapped to matrix. (4) In flight. (5) Traps. (6) Waiting on Audrey/human testing. (7) Next first three: verify hash/CI; collect acceptance; release procedure only on her go. (8) Auto-memory none.
**Closing chat:** Sessions 1–4 one line/done marks; plain-English what works/what she tests. No automatic next session/production deploy/main merge/tag.

## 6. Coverage matrix

**Proposed owners:** S1 foundations; S2 graph/HUD; S3 tags/notes; S4 boards/live. Section 9 is settled decisions, not blockers.

### Every brief section

| Section | Owner/disposition |
|---|---|
| 0 Planning | This plan; S1 release docs |
| 1 Purpose/feel/editing | S2/S4 |
| 1.1 Light/translucency | S2; S4 preserves |
| 2 One engine/views/scale/layout | S1 schema/S2; people later |
| 3 Viewport/HUD | S2 |
| 3.1 Settings/views/history/focus/search | S2; settled baseline metadata |
| 3.2 List/breadcrumb | S2 |
| 3.3 Cards/recent | S1 preferences/S2 |
| 4 Interactions | S2/S4 |
| 4.1 Hover | S2 |
| 4.2 Glow/grow/Escape | S2 |
| 4.3 Shared writes | S1/all |
| 5 Tags | S1/S3 |
| 5.1 Tiers | S3 |
| 5.2 Types/cleanliness/promotion | S3 |
| 5.3 Tag dots/legacy | S2/S3 |
| 6 Relationships | S1/S3 |
| 6.1 Labels/separate tags | S3/S2 gesture |
| 6.2 Inline/backlinks/visibility | S3 |
| 6.3 Notes | S3 save-and-merge; live transport after release |
| 7 Boards | S1/S4 |
| 7.1 Folder/files/embed/missing/colour | S1/S4 |
| 7.2 Toolkit | S4 |
| 7.3 Per-element | S1/S4 |
| 7.4 Live/cost | S4, current plan/cap/usage measured |
| 7.5 Panel | S4 |
| 8 Security | S1/all |
| 9 Storage/previews | S1 metadata/S2-S4 UI; gateway after release |
| 10 Checklist | Every row below |
| 11 Few sessions/hand-off | Four, Opus all, two reviews, continuation |
| 12 Release rulings | S1/all |
| 12a More rulings | Individual rows below |
| 13 House rules | All; Opus exception settled |

### Every additional ruling in 12a

| Ruling | Owner |
|---|---|
| 1 Desktop-only | S1/S2/S4 solo |
| 2 Last view | S2 |
| 3 First/new question and quick starts | S2 |
| 4 Confirm tool jumps | S2/S3 note receiver |
| 5 Delete/undo/trash | S1/S2/S3/S4 |
| 6 Low power | S2/S4 |
| 7 Personal space | S1 |
| 8 Move to | S2 through S1 |
| 9 Owner Moth/admin Files | S1/all regress |
| 10 Company/no body move | S1/S4 |
| 11 Adaptive pen/touch/mouse | S2/S4 |

### Every checklist line in brief section 10

| Line | Coverage |
|---|---|
| 1 Model/free numbers | S1; settings instead of persisted pins; remeasure all |
| 2 RLS/private/money | S1/S3 endpoints/S4 embeds-channels |
| 3 Engine/performance/bundle/lazy | S2/S4 |
| 4 HUD | S2 |
| 5 Interactions | S2 through S1 |
| 6 Tag lifecycle/0085 | S3 |
| 7 Inline/backlinks | S3 |
| 8 Note tiers | S3 |
| 9 Boards | S4 |
| 10 Live/auth/cost | S4 |
| 11 Panel | S4 |
| 12 Host/storage | S1/S2/S4 |
| 13 Lockstep/ready/GatedAction | All; matching SQL/matrix if changed |
| 14 Mounts/pgTAP/controls/replay | All; approved debug/local projects S2/S4 |
| 15 Docs/walkthroughs | All |
| 16 Production caller | All |
| 17 Post-release | Section 10 |

## 7. Must-not-miss checklist

**Proposed explicit session requirements:**

| Requirement | Session |
|---|---|
| Whole-project centred glow/no folder jump/Settings colour/smooth shadow/calm retains light | S2 |
| Toolbar Help/Settings/right appearance Drawer/HUD viewing only | S2 |
| Translucent kit corners/borders/type/colours/composited contrast | S2 |
| Breadcrumb list/five cards/minimal recent icon | S2 |
| Bloom/glow-link/grow-move/cursor word/Escape/Move to | S2 |
| Typed tiers/autocomplete/duplicates/nudge/nominations/admin merge-rename/no personal travel | S3 |
| #/[[ in notes/Rabbit/backlinks/visibility | S3 |
| Workspace-note bridges | S3 |
| Personal owner-only Moth/admin Files/company storage | S1 |
| Full shapes/connectors/per-element/files/stickies/embeds/stop-sign/board colour | S4 |
| Live cursor/presence/authorized channels/sticky lease/cost measurement | S4 |
| Three sizes/Escape-back/pull-away/corners | S4 |
| Money/Legal excluded for all, no counts/embeds | S1/all regress |
| Desktop-only no live features | S1/S2/S4 |
| Last view/first-new question/two starts | S2 |
| Confirm jumps/delete/undo/trash | S1/S2/S3/S4 |
| Low power/adaptive pen-touch-mouse | S2/S4 |
| Lazy/before-after bytes | All |
| NAS preview sentence/gateway after release | S2/S4/section 10 |
| 90-day baseline metadata/gaps/no bodies | S1/S2 |
| Long-note save merge/plain limit/live later | S3 |
| Existing plan/cap on/usage; selected debug/local projects | S2/S4 |

## 8. Risks, unknowns and contradictions

### Risks and reduction

| Evidence | Risk/reduction |
|---|---|
| MEASURED E19 | Prefix-based authority makes naïve moves unsafe. S1 updates storage/signers/reservations/thumb/GC/teardown together; old-container deletion control. |
| MEASURED E12, OUTSTANDING A-R1-04 | Workspace leaks private rows. S1 explicit repair, narrow channels; company membership never sufficient. |
| MEASURED Supabase authorization docs | Connected permissions cached. Audience generations plus already-connected revocation tests. |
| MEASURED E18 | NAS catalogue absent; metadata now. Open/Refresh/last checked handles freshness honestly; no gateway bytes. |
| MEASURED E4/E6/E8 | Permanent deletion paths. Reversible shared operations first. |
| INFERRED | Rendering may miss targets. Settle with approved projects/raw-visible counts/frame-memory measurements; disclose dataset limits, cluster/fallback. |
| INFERRED | Config/mentions leak private IDs despite hidden UI. Raw responses/endpoints tested; private overlays. |
| INFERRED | Sticky UI-only lock bypassed in Files. Both real publication paths/fencing tested. |
| INFERRED | S1 long; continue named session, no invented leftovers/bypasses. |
| MEASURED E23 | Historic bundle stale; fresh build-session numbers and lazy chunk accounting. |

### Document/code differences

| MEASURED difference | Consequence |
|---|---|
| Open 7d00376f versus controller/context 91d696b0 | Pin measurement; builds remeasure integration |
| Context 13 actions versus 15 | Actual matrix authority |
| Context main 5,000,463 versus newer 5,013,763 | Historical evidence then fresh session measurement |
| Fixed tags with security semantics | Add typed catalogue alongside |
| Notes already workspace/project-independent | Missing sharing/tiers/graph, not project FK removal |
| Yjs snapshot merge, not live co-typing | Audrey settled existing save merge; live later |
| Files lack undo/local delete permanent | Prerequisite shared changes |
| No safe cross-project move | New checked association/body operation |
| NAS catalogue missing, not only preview | Metadata now/open-Refresh, gateway later |
| Private media local, personal must company | Explicit personal-space routing |
| Admin reads private projects/files | Moth-specific owner projection/metadata; Files retains admin. RLS cannot identify originating page from same user |
| Locked folder names visible today | Remove folders/count contributions in Moth |
| Bin files not universal files identities | Resolve true matches only |
| Existing sends lack cursor broadcast | Explicit scoped policies/spoof tests |
| Partial/role-restricted history | New 90-day baseline metadata/gaps/no bodies |
| Existing view keys exclude Moth | Reuse pattern, not unchanged RPC |
| Older hand-off setup differs from latest rules | Current integration/hash/source evidence; eight headings retained |
| Default Fable versus recent Opus exception | Audrey settled Opus all |
| Brief production replay versus later dataset answer | Audrey's explicit debug/local selection supersedes |

**MEASURED planning limit:** runtime performance, deployed migration state, plan name/remaining usage/cap were not verified in this read-only pass. Build sessions measure them. Audrey says Claude knows plan type and requires cap enabled.

## 9. Questions for Audrey — answered decisions

**MEASURED — answers in this planning chat, 2026-11-01:** all six settled. Preserve words below; do not re-ask or treat as blockers. New material code contradictions still require measured stop/report.

### Q1 Models — settled

> Opus for all sessions

Required: Opus 5.5 for builds, designs, both cold reviews; stop if wrong; no Fable wait.

### Q2 History — settled

> Show graph structure and metadata from Moth’s first recorded baseline onward, retain 90 days, and label periods with no recorded history; file bodies are not historical copies.

Required: baseline metadata, 90 days, labelled gaps, current/original authorization; no historical bodies; local observations honest.

### Q3 NAS — settled

> Refresh metadata when a project is opened on desktop and through a clear Refresh action; show when it was last checked. (Recommended)

Required: open/manual Refresh and last checked, no continuous watcher this release. Gateway preview deferral unchanged.

### Q4 Long notes — settled

> Use the existing save-and-merge behaviour for long notes in this release, state that limit plainly, and add live co-typing after release.

Required: Yjs versioned saved-snapshot merge, limitation in Help/UI; live transport post-release. Sticky locks/live boards still required now.

### Q5 Plan/cap — settled

> Keep the current plan with the spend cap enabled; record its name and remaining usage before live-board acceptance. - note: claude will know the type of plan

Required: existing plan/cap enabled. Claude locates known context/verifies plan, usage/cap. No upgrade/disabled cap authorized.

### Q6 Performance projects — settled

> use the sample project the debug mode has. also the local saved version of the wilson tool locally and use the saved test project. claude will know this project

Required: debug-mode sample plus saved local WILSON test project. Claude identifies established projects. These replace earlier production-data request; no new production-project request. Record actual hardware/host/storage/counts/results and demonstrated limits.

## 10. After the release

**MEASURED — brief section 9 and Audrey Q4:** NAS gateway previews and long-note live co-typing are post-release.

**Proposed list:**

1. Gateway thumbnails/ordinary preview files, signed-ticket/vetted-path/codec/containment/outside-access design. Current state: “Preview available on the desktop app”.
2. Authorized live Yjs transport for long notes, preserving privacy/version merge; enhancement, not unfinished release defect.
3. Waves 2–4 against finished Moth; new free migration/suite measurements, identities preserved.
4. People graph nodes, explicitly later.
5. Historical bodies or retention beyond 90 days only by later decision.
6. Continuous NAS watcher only if separately requested; release uses open/Refresh/last checked.

**Close-out:** all three input documents read in full, code measured read-only. This standalone file is created outside the repository at Audrey's later request for delivery to Claude. No repository files, branches, databases or remotes were changed. No implementation code is included.
