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
 * @property {object[]} taskLinks
 * @property {object[]} files
 * @property {object[]} assetVersions
 * @property {object[]} comments
 * @property {object[]} ingestionRuns
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
 * @property {(dep: object) => Promise<object>}                     upsertDependency
 * @property {(id: string) => Promise<void>}                        deleteDependency
 *
 * @property {(link: object) => Promise<object>}                    upsertTaskLink
 * @property {(id: string) => Promise<void>}                        deleteTaskLink
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
 *   projects, with project/asset embeds for labels. local_server and
 *   google_drive do not implement them (feature-detect) — the Dashboard
 *   shows an empty state outside cloud mode.
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
 */

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
  return mode === 'supabase' || mode === 'local_server';
}
