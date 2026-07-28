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
