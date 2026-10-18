// ============================================================
// RABBIT v0.1 — adapter selector + RabbitAdapter interface
// ============================================================
//
// All persistence in RABBIT goes through one of three concrete
// adapters. They all implement the same `RabbitAdapter` shape so
// the rest of the app (RabbitProvider, the agent tool surface,
// the intake pipeline, the Projects module) can swap the active
// backend with a single config change.
//
//   supabase     → full read/write/realtime against Supabase Postgres
//   local_server → full read/write against the in-app Express server
//   google_drive → READ-ONLY in v0.1 (write path is a v0.2 deferred item)
//
// New adapters added in future versions only need to satisfy this
// interface — no callers need to change.

import { supabaseAdapter }    from './supabaseAdapter';
import { localServerAdapter } from './localServerAdapter';
import { googleDriveAdapter } from './googleDriveAdapter';
import { devFixtures } from '../../../dev/devFixtures';

/**
 * @typedef {Object} ProjectIndexEntry
 * @property {string} id
 * @property {string} title
 * @property {string} status
 * @property {string} updated_at
 */

/**
 * @typedef {Object} FullProjectBundle
 * @property {object}   project
 * @property {object[]} phases
 * @property {object[]} assets
 * @property {object[]} tasks
 * @property {object[]} dependencies
 * @property {object[]} taskLinks      a task's URL links (0000)
 * @property {object[]} taskItems      a task's items: the assets, scenes,
 *   shots, levels and experiences it is about (FX2, 0096)
 * @property {object[]} tableViews     the project's saved views of its six
 *   tables (VW1c, 0098), by table_key, position, created_at, id
 * @property {object[]} itemGroupings  the project's saved groupings (VW1c,
 *   0098), by table_key, kind, created_at, id
 * @property {object[]} files
 * @property {object[]} assetVersions
 * @property {object[]} comments
 * @property {object[]} ingestionRuns
 */

/**
 * What a view's update or delete answers (VW1c, 0098; design §4.4): the
 * write landed (`saved` with the stored row, or `removed`), or nothing was
 * written and the row was read once — `deleted` (it is gone), `changed`
 * (another revision or name: a teammate's save; `row` is the stored one) or
 * `filtered` (the same: the cloud's access rules dropped the write without a
 * word, so the person may no longer change views; never answered by the
 * signed-out desktop or the dev fixtures, which have no roles).
 * @typedef {Object} TableViewWrite
 * @property {'saved'|'removed'|'deleted'|'changed'|'filtered'} status
 * @property {object=} row
 */

/**
 * @typedef {Object} AdapterStatus
 * @property {boolean}   online
 * @property {Date|null} lastSyncAt
 * @property {string|null} error
 */

/**
 * @typedef {Object} UploadScope
 * @property {string=} phaseId
 * @property {string=} assetId
 * @property {string=} taskId
 * @property {('source'|'reference'|'deliverable'|'export'|'other')=} kind
 * @property {boolean=} isCoreDefiner
 * @property {boolean=} financial  An invoice or receipt: the INVOICES locked
 *   folder, files.is_financial, and the body pinned to Supabase (0038/0050).
 * @property {boolean=} legal  Post-overhaul S4b: a Legal file — the LEGAL
 *   locked folder and the legal tag, written together at upload and never
 *   changed after; seen by the Legal gate's audience — workspace admins, the
 *   project's managers and, since 0092 (S4d), workspace managers without a
 *   seat (0088 / 0092). Never combined with `financial`: a Legal file is
 *   never an invoice (files_legal_not_financial_chk).
 */

/**
 * The contract every concrete adapter must implement. The Supabase
 * and Local Server adapters implement every method; the Google Drive
 * adapter implements the read-only subset and throws on writes.
 *
 * @typedef {Object} RabbitAdapter
 * @property {string} mode
 * @property {() => Promise<AdapterStatus>}                         status
 *
 * @property {() => Promise<ProjectIndexEntry[]>}                   listProjects
 * @property {(id: string) => Promise<FullProjectBundle>}           loadProject
 * @property {(project: object) => Promise<object>}                 createProject
 * @property {(id: string, patch: object) => Promise<object>}       updateProject
 * @property {(id: string) => Promise<void>}                        deleteProject
 *
 * @property {(projectId: string) => Promise<object[]>}             listPhases
 * @property {(phase: object) => Promise<object>}                   upsertPhase
 * @property {(id: string) => Promise<void>}                        deletePhase
 *
 * @property {(projectId: string) => Promise<object[]>}             listAssets
 * @property {(asset: object) => Promise<object>}                   upsertAsset
 * @property {(id: string) => Promise<void>}                        deleteAsset
 *
 * @property {(projectId: string) => Promise<object[]>}             listTasks
 * @property {(task: object) => Promise<object>}                    upsertTask
 * @property {(id: string) => Promise<void>}                        deleteTask
 *
 * Dependencies. `dep.kind` ('task' | 'phase', absent means 'task') selects the
 * backing table on the Supabase adapter — migration 0061 split phase→phase
 * edges into public.phase_dependencies so that public.task_dependencies could
 * keep its foreign keys to tasks(id). The returned row carries `kind` back, so
 * callers never have to re-derive it.
 *
 * 🚨 deleteDependency's signature is (id, projectId, kind) and BOTH trailing
 * arguments are load-bearing on one adapter each. This typedef used to say
 * `(id: string)`, which was simply wrong: localServerAdapter has always read
 * argument two to build `/projects/${projectId}/dependencies/${id}`. A cleanup
 * that "conformed the implementations to the contract" would have posted to
 * /projects/undefined/ and broken every desktop dependency delete — silently,
 * because there is no test on this path and the caller swallowed rejections
 * until Phase 2. The contract was the thing that was wrong; it is fixed here.
 *
 * @property {(dep: object) => Promise<object>}                     upsertDependency
 * @property {(id: string, projectId?: string, kind?: 'task'|'phase') => Promise<void>} deleteDependency
 *
 * @property {(link: object) => Promise<object>}                    upsertTaskLink
 * @property {(id: string) => Promise<void>}                        deleteTaskLink
 *
 * @property {() => boolean}                                        taskItemsAvailable
 * @property {(projectId: string) => Promise<object[]>}             listTaskItems
 * @property {(item: object) => Promise<object>}                    addTaskItem
 * @property {(id: string, projectId?: string) => Promise<void>}    deleteTaskItem
 *   A task's items (FX2, migration 0096; VW1m, 0097): the assets, scenes,
 *   shots, levels and experiences it is about, one row each `{ id, task_id,
 *   project_id, entity_type, entity_id, position, created_at, … }` — NOT the
 *   URL links above. A task's items are its items: no item of a kind counts
 *   for more than another, and the stored order (position, created_at, id)
 *   only says when each was added. Every backend keeps the task's single
 *   fields (asset_id, scene_id, shot_id on the cloud; the five on the
 *   desktop's rows) as the OLDER APPS' COPY only, each kind's first item in
 *   the stored order: this app never reads or sends them where items are
 *   kept, and an older app's write of one ADDS that item, never removing
 *   another (0097 §3; the desktop's and the fixtures' twins).
 *   - taskItemsAvailable(): whether this backend keeps items. False on a
 *     cloud without 0096 (loadProject's read is the probe) and on a Drive
 *     bundle exported before FX2; the provider then reads each task's own
 *     single field as its one item.
 *   - addTaskItem adds one, or answers the stored row when the task already
 *     names it (ON CONFLICT DO NOTHING, then a read); deleteTaskItem removes
 *     one by id (projectId is the Local Server's URL; the cloud ignores it).
 *     A cloud without 0096 refuses both with code `task_items_unavailable`
 *     before any request.
 *   - No reorder (her Q-N1: the task window sorts; it has no Move buttons).
 *     The cloud's reorder_task_items and the Local Server's /reorder route
 *     stay for the older apps that call them.
 *   - google_drive: listTaskItems and the bundle's taskItems answer what the
 *     export holds; the two writes throw readOnly().
 *
 * @property {() => boolean}                                        tableViewsAvailable
 * @property {() => (string|null)}                                  tableViewsLoadError
 * @property {(projectId: string) => Promise<object[]>}             listTableViews
 * @property {(row: object) => Promise<object>}                     addTableView
 * @property {(id: string, patch: object, opts: object) => Promise<TableViewWrite>} updateTableView
 * @property {(id: string, opts: object) => Promise<TableViewWrite>} deleteTableView
 * @property {(projectId: string, tableKey: string, ids: string[]) => Promise<object[]>} reorderTableViews
 * @property {(projectId: string) => Promise<object[]>}             listItemGroupings
 * @property {(row: object) => Promise<object>}                     addItemGrouping
 * @property {(id: string, projectId?: string) => Promise<{removed: boolean, status?: string}>} removeItemGrouping
 * @property {() => Promise<{available: boolean, map: object}>}     getTableViewLast
 * @property {(key: string, view: string) => Promise<object>}       setTableViewLast
 *   Custom table views and groupings (VW1c, migration 0098; design §5;
 *   the rules in state/tableViewsModel.js). A VIEW `{ id, project_id,
 *   table_key, name, position, revision, revised_by, config, created_at,
 *   created_by, updated_at, updated_by }`; a GROUPING `{ id, project_id,
 *   table_key, kind, entity_ids, created_at, created_by, updated_at,
 *   updated_by }`. loadProject
 *   returns both (bundle keys tableViews, itemGroupings).
 *   - tableViewsAvailable(): whether this backend keeps views and groupings.
 *     False on a cloud without 0098 (loadProject's reads are the probe:
 *     42P01 / PGRST205 → both empty) and on Google Drive; every write then
 *     refuses with code `table_views_unavailable` before any request.
 *     tableViewsLoadError(): the last load's read error in words when it was
 *     anything but the probe's answer (both empty, never a failed load), else
 *     null.
 *   - addTableView(row `{ id?, project_id, table_key, name, position, config
 *     }`): an INSERT, never an upsert (the cloud's column grants refuse one);
 *     answers the stored row, its revision and stamps the backend's.
 *   - updateTableView(id, patch `{ name?, position?, config? }`, opts `{
 *     projectId, expectRevision?, expectName? }`) and deleteTableView(id,
 *     opts `{ projectId, expectRevision? }`) answer a TableViewWrite: `{
 *     status: 'saved', row }` (an update) or `{ status: 'removed' }` (a
 *     delete), or, when the expectation did not hold and nothing was written, the row
 *     read once: `{ status: 'deleted' }` (no row), `{ status: 'changed', row
 *     }` (another revision or name: changed meanwhile), `{ status:
 *     'filtered', row }` (the same: the cloud's access rules filtered the
 *     write out without a word — the person may no longer change views; the
 *     signed-out desktop never answers this). Only a change of config makes
 *     a new revision.
 *   - reorderTableViews(projectId, tableKey, ids): reorder_table_views'
 *     rule; answers the rows it moved.
 *   - addItemGrouping(row `{ id?, project_id, table_key, kind, entity_ids
 *     }`): an INSERT; a set already stored for that table and kind answers
 *     the stored row (the cloud's unique key, then a read).
 *     removeItemGrouping(id, projectId) answers `{ removed: true }`, or `{
 *     removed: false, status }` read once: `deleted` (gone) or `filtered` (the
 *     cloud's policies dropped the delete; the row stays on screen) — review
 *     round 1, R1-3.
 *   - getTableViewLast(): the person's last used view of each table, `{
 *     available, map }` (the cloud's user_settings.table_view_last, read by
 *     its own request — 42703 / PGRST204 answer `{ available: false, map: {}
 *     }`; the desktop's machine file; the fixtures' memory; Drive
 *     unavailable). setTableViewLast(key, view) merges one key
 *     (`<project id>:<table key>`, a view id or "all") with the backend's
 *     clock, keeps the 300 newest, and answers the map.
 *
 * @property {(projectId: string, scope: UploadScope, file: File) => Promise<object>} uploadFile
 * @property {(projectId: string) => Promise<object[]>}             listFiles
 * @property {(file: object) => Promise<Blob>}                      downloadFile
 * @property {(id: string, patch: object) => Promise<object>}       updateFile
 * @property {(id: string) => Promise<void>}                        deleteFile
 *
 * @property {(version: object) => Promise<object>}                 upsertAssetVersion
 * @property {(assetId: string) => Promise<object[]>}               listAssetVersions
 *
 * @property {(comment: object) => Promise<object>}                 createComment
 * @property {(entityType: string, entityId: string) => Promise<object[]>} listComments
 * @property {(id: string) => Promise<void>}                        deleteComment
 *
 * @property {(entityType: string, entityId: string) => Promise<object[]>} listEditHistory
 *   Supabase-only (DB-trigger capture, migration 0012); local_server and
 *   google_drive resolve to [] so the drawer can render an empty state.
 *
 * @property {(fileId: string, projectId?: string) => Promise<object[]>} listFileEvents
 *   File lifecycle stream (Session 14): supabase reads the trigger-fed
 *   file_events table (0027); local_server reads bundle.fileEvents. Both
 *   share the event vocabulary uploaded/moved/relinked/trashed/restored/
 *   purged, but locally only uploaded/relinked/purged occur — local
 *   deletes are permanent, and no local code path emits 'moved' (the
 *   generic PATCH strips storage_path; path changes go through relink).
 *   google_drive: not implemented, feature-detect.
 *
 * @property {(projectId: string, folderPath?: string|null) => Promise<object>} relinkScan
 * @property {(projectId: string, baseDir: string, mappings: object[]) => Promise<object>} relinkApply
 *   Storage relink (Session 14, Block A) — local_server ONLY, the provider
 *   where folders actually move. Matching is the pure client module
 *   components/relinkMatcher.js, so a future google_drive relink reuses it
 *   with Drive-listed candidates. Feature-detect both.
 *
 * @property {(id: string) => Promise<void>}                        restoreProject
 * @property {(id: string) => Promise<void>}                        restorePhase
 * @property {(id: string) => Promise<void>}                        restoreAsset
 * @property {(id: string) => Promise<void>}                        restoreTask
 * @property {(id: string) => Promise<void>}                        restoreFile
 * @property {(id: string) => Promise<void>}                        restoreComment
 * @property {(id: string) => Promise<void>}                        restoreRateCard
 *   Supabase-only (soft delete, migration 0014): delete* on the 7
 *   user-facing tables sets deleted_at and restore* clears it (deleted_by
 *   is stamped/cleared by a DB trigger). local_server keeps hard deletes
 *   and does NOT implement restore* — callers feature-detect with
 *   `typeof adapter.restoreX === 'function'`.
 *
 * @property {(projectId: string) => Promise<object[]>}             listProjectMembers
 * @property {(row: object) => Promise<object>}                     upsertProjectMember
 * @property {(projectId: string, userId: string) => Promise<void>} removeProjectMember
 *   Supabase-only (project roster, migration 0013); local_server does not
 *   implement them (feature-detect), google_drive lists []. upsertProjectMember
 *   takes { project_id, user_id, project_role } — never send workspace_id,
 *   a BEFORE INSERT trigger derives it from the project.
 *
 * @property {(run: object) => Promise<object>}                     createIngestionRun
 * @property {(runId: string, patch: object) => Promise<object>}    updateIngestionRun
 * @property {(runId: string) => Promise<object[]>}                 listIngestionChunks
 * @property {(chunk: object) => Promise<object>}                   upsertIngestionChunk
 * @property {(chunk: object) => Promise<void>}                     updateChunk
 *
 * @property {(workspaceId: string) => Promise<object[]>}           listRateCards
 * @property {(card: object) => Promise<object>}                    upsertRateCard
 * @property {(id: string) => Promise<void>}                        deleteRateCard
 * @property {(rateCardId: string) => Promise<object[]>}            listRateCardEntries
 * @property {(entry: object) => Promise<object>}                   upsertRateCardEntry
 * @property {(id: string) => Promise<void>}                        deleteRateCardEntry
 *
 * @property {(projectId: string, callback: (event: object) => void) => () => void} subscribeProjectChanges
 *
 * @property {() => Promise<object[]>}                               listMyTasks
 * @property {(projectIds: string[]) => Promise<object[]>}           listPhasesByProjects
 * @property {(projectIds: string[]) => Promise<object[]>}           listProjectMembersByProjects
 *   Supabase-only (Session 8 Dashboard): listMyTasks returns every task
 *   where the signed-in user is assignee or reviewer, across all visible
 *   projects, with a `project` embed for labels and, since VW1m
 *   (2026-10-16), `items: [{ kind, id, name }]` — every item the caller can
 *   see (an asset in the trash is left out), kinds in the model's ITEM_KINDS
 *   order, each kind in its display order (no `asset` embed: that rode the
 *   older apps' copy, the first asset only). A database without 0096 answers
 *   `items: []`. local_server and google_drive do not implement them
 *   (feature-detect) — the Dashboard shows an empty state outside cloud mode.
 *
 * @property {() => Promise<object[]>}                               listNotes
 * @property {(id: string) => Promise<object|null>}                  getNote
 * @property {(fields: object) => Promise<object>}                   createNote
 * @property {(id: string, patch: object) => Promise<object>}        patchNote
 * @property {(id: string, args: {ydocState: string, bodyPreview: string, expectedVersion: number}) => Promise<object|null>} saveNoteDoc
 * @property {(id: string) => Promise<void>}                         deleteNote
 * @property {() => Promise<object[]>}                               listNoteSubjects
 * @property {(row: {label: string, position?: number}) => Promise<object>} createNoteSubject
 * @property {(id: string, patch: object) => Promise<object>}        patchNoteSubject
 * @property {(id: string) => Promise<void>}                         deleteNoteSubject
 * @property {(oldLabel: string, newLabel: string) => Promise<string[]>} retagNoteSubject
 *   Supabase-only (Session 8 Notes, migration 0017). Owner-only RLS.
 *   saveNoteDoc is the ONLY path that may write ydoc_state/version — it
 *   returns null when the version guard missed (another device saved
 *   first); callers merge the remote snapshot and retry. patchNote is
 *   metadata-only (title/subject/note_date/body_preview).
 *
 * @property {(workspaceId: string, callback: (event: object) => void) => () => void} subscribeWorkspaceChanges
 *   Supabase-only (Session 8, migration 0018): private channel
 *   `rabbit:workspace:{id}` carrying projects / workspace_members /
 *   assigned-task events for index + Dashboard liveness. Same event
 *   shape and opts contract as subscribeProjectChanges.
 *
 * @property {(projectId: string) => Promise<object[]>}             listShotLists
 * @property {(list: object) => Promise<object>}                    upsertShotList
 * @property {(projectId: string) => Promise<object[]>}             listShotListItems
 * @property {(projectId: string, listId: string, items: Array<{id?: string, scene_id?: string|null, shot_id?: string|null, position?: number}>) => Promise<object[]>} replaceShotListItems
 * @property {(projectId: string, listId: string, items: Array<{id?: string, scene_id?: string|null, shot_id?: string|null, position?: number}>) => Promise<object[]>} upsertShotListItems
 * @property {(projectId: string, listId: string, items: Array<{id: string, position: number}>) => Promise<object[]>} repositionShotListItems
 * @property {(projectId: string, listId: string, itemIds: string[]) => Promise<{deleted: string[]}>} deleteShotListItems
 * @property {(projectId: string) => Promise<object[]>}             listEdits
 * @property {(edit: object, opts?: {expectSavedAt: string|null}) => Promise<object>} upsertEdit
 * @property {(projectId: string, listId: string|null) => Promise<string|null>} setActiveShotList
 * @property {(projectId: string, listId: string, archived?: boolean) => Promise<object>} archiveShotList
 * @property {(projectId: string, editId: string, archived?: boolean) => Promise<object>} archiveEdit
 *   Shot lists, their membership and edits (migration 0084, post-overhaul
 *   S3a; the rulings are D1–D22 in docs/design/POST_OVERHAUL_PLAN.md §0.1).
 *   Same names, signatures and row shapes on supabase, local_server and the
 *   dev fixtures; google_drive answers the three reads from its exported
 *   bundle ([] when it has none) and throws readOnly() on the nine writes.
 *   loadProject carries the same three collections as `shotLists` /
 *   `shotListItems` / `edits` — lists and edits ordered created_at, id;
 *   items position, id.
 *   - A list is MEMBERSHIP (D1 + D3): scene and shot rows are shared by
 *     every list; only item rows and their positions are per list. Scene
 *     items order a list's scenes; shot items order shots within their
 *     scene (restarting at 0 per scene and for the unlinked bucket).
 *   - upsertEdit(edit, { expectSavedAt }) (post-overhaul FX4 review round 1,
 *     R1-03) writes an EXISTING edit only while its stored snapshot's
 *     saved_at is the one named (null: none); another is refused with code
 *     `edit_saved_since` (shotListModel's EDIT_SAVED_SINCE), status 409.
 *     The cloud filters its UPDATE on it; the Local Server and the fixtures
 *     check and write in one step.
 *   - upsertShotList / upsertEdit need `project_id` on the row and return
 *     the stored row (the cloud sends neither the audit columns nor
 *     archived_at / archived_by — the database stamps the first four and
 *     only the archive RPCs change the last two).
 *   - Membership is written as DELTAS (S3a review round 1): items are not
 *     broadcast, so a whole-list write from one client's view would delete
 *     what a collaborator added since it loaded.
 *     upsertShotListItems writes ONLY the named rows ([{ id?, scene_id |
 *     shot_id, position? }], a missing position = its index): new ids are
 *     inserted, ids of THIS list updated, an id of ANOTHER list skipped;
 *     nothing is deleted; it returns the rows written.
 *     repositionShotListItems (S3a review round 2) is the REORDER and its
 *     undo / redo: [{ id, position }], it sets `position` on rows that EXIST
 *     in THIS list and changes nothing else — an id that names no row (one
 *     a collaborator removed since this client loaded) or another list's
 *     row is skipped, NEVER inserted; it returns the rows updated. Refused
 *     (code invalid): not an array, an item without an id, a position that
 *     is not a whole number ≥ 0, an id named twice. deleteShotListItems
 *     deletes exactly the named ids of THIS list (others are ignored) and
 *     returns { deleted: [ids actually deleted] }; when a named row is still
 *     in the list afterwards the caller lacked the right to change it
 *     (supabase: 42501 "you cannot change this shot list" — RLS filters a
 *     DELETE instead of refusing it). replaceShotListItems replaces the
 *     WHOLE membership of that one list — for tooling and bulk restores —
 *     and returns that list's rows, ordered.
 *   - An ARCHIVED list's membership is NOT frozen (round 2 reverted round
 *     1's freeze): every item write is allowed on it, so the undo of a scene
 *     delete can put the scene back in archived lists too. The provider
 *     refuses UI verbs on an archived list. Deleting a scene or shot removes
 *     its items from every list, archived ones included.
 *   - setActiveShotList(projectId, null) clears the pointer; it returns the
 *     new active id. archive* with archived = false restores; they return
 *     the row. Lists and edits are archived, never deleted (D4 / D18): no
 *     adapter has a delete for either.
 *   - Set-active and archive are workspace-admin / PROJECT-manager decisions
 *     (D8), enforced by the SECURITY DEFINER RPCs on supabase; the Local
 *     Server has no roles, so there they are labels.
 *   - Refusals carry `code`: supabase keeps the Postgres / PostgREST code
 *     (42501, P0001, P0002, 23505, …) on the thrown Error; local_server and
 *     the fixtures answer invalid / conflict / forbidden / not_found. The
 *     collision rules read the same everywhere: supabase words a 23505 on
 *     the one-root / one-child chain indexes, the two "Title · vN" keys and
 *     the two once-per-list item keys as the contract's sentences (the two
 *     title ones without the title: "There is already a shot list with this
 *     title and version." / "This shot list already has an edit with this
 *     title and version."). A supabase database without 0084 answers [] to
 *     the reads and code `shot_lists_unavailable` to every write.
 */

// --- bins ---
//
// The bin system (demo 2026-09-11, docs/BINS_DESIGN.md §4). LOCAL SERVER
// ONLY, and feature-detected: the provider checks `typeof adapter.listBins ===
// 'function'` and exposes `supportsBins`; the Supabase and Drive adapters
// define none of these, and the Bins tab shows an honest empty state there.
// Bin files are REFERENCES to paths on this machine (never copied); the OS
// dialogs open in the main process; the bytes and posters are served by the
// loopback server. Every method takes projectId first.
//
//   listBins(projectId)                          → { bins, binFiles (with `online`), binRoots, shotTakes, orphanTakes, ffmpeg }
//   createBin(projectId, bin) / updateBin(projectId, id, patch)
//   deleteBin(projectId, id, { mode: 'move'|'remove', target })
//                                                → { removedBins, movedFiles, removedFiles }
//   reorderBins(projectId, [{ id, parent_bin_id, sort_order }])
//   pickBinFiles(projectId) → { paths, canceled } ; pickBinFolder(projectId, title) → { path, canceled }
//   prepareBinFiles(projectId, paths)            → { items, folders, truncated, roots } (the add dialog's plan)
//   addBinFiles(projectId, binId, items, createSubBins, roots) → { created, bins, results }
//   updateBinFile(projectId, id, patch) ; bulkUpdateBinFiles(projectId, ids, patch) → { updated }
//   moveBinFiles / copyBinFiles(projectId, ids, binId) ; removeBinFiles(projectId, ids) → { removed }
//   restoreBinFiles(projectId, rows) → { restored, skipped: [{ id, reason }], affectedShotIds, shotTakes, orphanTakes }
//   probeBinFile(projectId, id)                  → the row with its technical columns filled
//   binFileThumbnailUrl(projectId, id, rev) / binFileStreamUrl(projectId, id, { probe })  (URLs, not fetches)
//   postBinFileThumbnail(projectId, id, base64)  (the renderer decoded a frame; no ffmpeg)
//   binRelinkScan(projectId, folderPath?) → { offline, candidates, truncated } ; binRelinkApply(projectId, mappings)
//   removeBinRoot(projectId, id)                 (roots are recorded by the pick and add routes)
//
// Every failure throws an Error carrying `status` and, where the route sends
// one, `code` (offline, cross_origin, unauthorized_folder, bad_ids, …) —
// branch on those, never on the sentence.
//
// Shot takes (milestone 2): bin files assigned to shots, many-to-many, ordered,
// with a role (primary | part | alt) and notes; `bundle.shotTakes`. Every
// mutation answers { affectedShotIds, shotTakes, orphanTakes } — the full row
// set of the shots it touched — because siblings are re-roled and renumbered.
// The rows arrive with listBins: `shotTakes` are the LIVE rows (shot and file
// both exist) presented with positions 0..n-1 and exactly one primary per
// shot; `orphanTakes` are the rows whose shot or file is gone, verbatim, so
// state keeps them for the undo that brings the shot or file back.
//   assignShotTakes(projectId, [{ shot_id, bin_file_id, role?, notes? }]) → { created, skipped, … }
//   updateShotTake(projectId, id, { role?, notes?, position? }) → { take, … }
//   removeShotTakes(projectId, ids)                → { removed, … }
//   reorderShotTakes(projectId, shotId, ids)
//   replaceShotTakes(projectId, shotIds, rows)     (the undo primitive: those shots' rows become exactly `rows`)

/** @type {Record<string, () => RabbitAdapter>} */
const ADAPTERS = {
  supabase:     supabaseAdapter,
  local_server: localServerAdapter,
  google_drive: googleDriveAdapter,
};

/**
 * Return the singleton adapter instance for the requested mode.
 * Each concrete adapter file exports a factory function so the
 * adapter can lazily build its own client (Supabase JS client,
 * fetch wrapper, OAuth client) on first use.
 *
 * @param {('supabase'|'local_server'|'google_drive')} mode
 * @returns {RabbitAdapter}
 */
export function selectAdapter(mode) {
  // Dev fixtures (2026-09-11, dev builds only): with VITE_DEV_FIXTURES=1 the
  // cloud slot is served by the in-memory fixtures adapter (src/dev/fixtures),
  // so `adapterMode` stays 'supabase' and every `=== 'supabase'` gate in the
  // provider, the Dashboard, the Projects page and the drawers opens onto
  // fake data. `import.meta.env.DEV` is a build-time constant: `vite build`
  // has no such branch (src/dev/devFixtures.test.js pins the shape).
  const fx = import.meta.env.DEV && mode === 'supabase' ? devFixtures() : null;
  if (fx?.rabbitAdapter) return fx.rabbitAdapter();
  const factory = ADAPTERS[mode];
  if (!factory) {
    throw new Error(
      `[rabbit] unknown adapter mode "${mode}". ` +
      `Expected one of: ${Object.keys(ADAPTERS).join(', ')}`,
    );
  }
  return factory();
}

/** Convenience: list of every supported adapter mode. */
export const ADAPTER_MODES = Object.keys(ADAPTERS);

/**
 * Returns true when the requested mode supports write operations.
 * Used by the Projects module + agent tool surface to disable
 * mutator UI when running against a read-only backend.
 */
export function adapterSupportsWrites(mode) {
  return mode === 'supabase' || mode === 'local_server'
    || (import.meta.env.DEV && mode === 'fixtures'); // the dev fixtures adapter reports mode 'fixtures'
}
