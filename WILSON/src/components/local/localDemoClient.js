// =============================================================================
// localDemoClient — the renderer side of the local demo folder (demo sprint,
// 2026-09-10). The main process owns the folder (electron/localDemoRoot.cjs);
// this module is the ONE place the renderer talks to it, from the Settings →
// Storage card.
//
// 🚨 THE SIGN-IN GATE STAYS. Audrey, 2026-09-10: "remove the work locally
// button at login. user still needs to login no matter what." The folder is
// chosen AFTER sign-in, from Settings → Storage; nothing here is reachable
// from the sign-in screen and nothing here opens the shell.
//
// Everything here is feature-detected off the preload bridge: on the web
// `localDemoBridge()` is null and the card degrades to an informational row.
//
// 🚨 ENTERING OR LEAVING A FOLDER RELOADS THE WINDOW. RabbitProvider boots
// once against whatever root the local server had at that moment; the
// project list, the open bundle and the undo history all belong to that
// root. WorkspaceSwitcher resorts to window.location.reload() for the same
// reason, and this follows it rather than inventing a partial re-init.
// Before the reload the machine's R.A.B.B.I.T. backend switch is pinned to
// Local Server so a folder opened after a cloud session does not come back
// in Supabase mode showing an empty list.
// =============================================================================

import { loadOtterSettings, saveOtterSettings } from '../../lib/localData'

export function localDemoBridge() {
  if (typeof window === 'undefined') return null
  return window.electronAPI?.localDemo ?? null
}

/** The last path segment, for "in <name>" copy. */
export function folderLeaf(p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || s
}

/**
 * What a surface should say for a bridge state. Pure so it is tested.
 *   { mode: 'active', folder, name }   — a folder is open
 *   { mode: 'missing', folder, name }  — the remembered folder is not on disk
 *   { mode: 'none', recent }           — app data; recent folders to reopen
 */
export function describeLocalState(state) {
  if (!state || typeof state !== 'object') return { mode: 'none', recent: [] }
  if (state.active) return { mode: 'active', folder: state.active, name: folderLeaf(state.active), recent: state.recent || [] }
  if (state.missing) return { mode: 'missing', folder: state.missing, name: folderLeaf(state.missing), recent: state.recent || [] }
  return { mode: 'none', recent: Array.isArray(state.recent) ? state.recent : [] }
}

/**
 * Pin the machine's R.A.B.B.I.T. backend to Local Server, written the way
 * RabbitProvider's saveRabbitSettings writes it (otter-settings.rabbit).
 * activeProjectId is cleared: it named a project in the previous root.
 */
export async function pinLocalServerMode() {
  let data = {}
  try { data = await loadOtterSettings() } catch { data = {} }
  const base = data && typeof data === 'object' ? data : {}
  await saveOtterSettings({
    ...base,
    rabbit: { ...(base.rabbit || {}), adapterMode: 'local_server', activeProjectId: null },
  })
}

const FAILED = 'the folder could not be opened'

/**
 * The pick flow: OS dialog → (a folder holding other files asks first) →
 * pin Local Server mode. Returns { done, canceled, error }.
 * The caller reloads on `done` — see the header.
 *
 * `confirmForeign(result)` is the card's own question ("this folder already
 * holds 12 items — use it anyway?"); it resolves true to proceed.
 */
export async function pickLocalFolder(bridge, { confirmForeign } = {}) {
  const r = await bridge.pick()
  if (!r || r.canceled) return { done: false, canceled: true }
  if (r.needsConfirm) {
    const yes = confirmForeign ? await confirmForeign(r) : false
    if (!yes) return { done: false, canceled: true }
    const r2 = await bridge.open({ folder: r.folder, allowForeign: true })
    if (!r2?.ok) return { done: false, error: r2?.error || FAILED }
    await pinLocalServerMode()
    return { done: true, result: r2 }
  }
  if (!r.ok) return { done: false, error: r.error || FAILED }
  await pinLocalServerMode()
  return { done: true, result: r }
}

/** Reopen a remembered folder (recent list / "continue locally"). */
export async function reopenLocalFolder(bridge, folder) {
  const r = await bridge.open({ folder })
  if (r?.needsConfirm) {
    // A remembered folder whose manifest went missing but whose files are
    // still there: the person already chose it once, so keep going.
    const r2 = await bridge.open({ folder, allowForeign: true })
    if (!r2?.ok) return { done: false, error: r2?.error || FAILED }
    await pinLocalServerMode()
    return { done: true, result: r2 }
  }
  if (!r?.ok) return { done: false, error: r?.error || FAILED }
  await pinLocalServerMode()
  return { done: true, result: r }
}

export function reloadApp() {
  window.location.reload()
}

// ── Demo comfort (brief §3.4): reset, and the seeded demo project ────────────

/** The confirmation the Storage card shows before a reset — names the folder
 *  and exactly what goes. Pure so the sentence is tested. */
export function resetConfirmText(folder) {
  const sep = String(folder).includes('\\') ? '\\' : '/'
  return `Reset the demo folder "${folderLeaf(folder)}"?\n\n`
    + 'This deletes everything under:\n'
    + `  ${folder}${sep}projects\n`
    + `  ${folder}${sep}.wilson${sep}rabbit-data\n\n`
    + 'Every project and file WILSON made in this folder is gone for good. '
    + 'Nothing outside this folder is touched, and the folder stays open.'
}

export const DEMO_PROJECT_TITLE = 'Friday Demo'

/**
 * The rows a person would make by hand for the demo: a project with scenes
 * and shots turned on, two scenes, five shots — the shapes ScenesView writes
 * (handleNewScene / handleNewShot) so its table reads them unchanged. Pure
 * over `newId` so the plan is tested; `seedDemoProject` writes it.
 *
 * ⚠️ Placeholder content until Audrey answers brief §6 question 4 (what the
 * sample should be, which footage folder Friday uses).
 */
export function planDemoProject({ title = DEMO_PROJECT_TITLE, newId } = {}) {
  const projectId = newId()
  const project = {
    id: projectId,
    title,
    description: 'Seeded for the demo. Scenes and shots are on; the Bins tab lands here.',
    status: 'active',
    scenes_enabled: true,
    documents: [],
    visualAssets: [],
  }
  const scenes = [
    { id: newId(), project_id: projectId, name: 'SC01 Exterior, morning', scene_number: 1, status: 'not_started', type: 'interior', sort_order: 0 },
    { id: newId(), project_id: projectId, name: 'SC02 Interview', scene_number: 2, status: 'not_started', type: 'interior', sort_order: 1 },
  ]
  const specs = [
    [0, 'Wide establishing'], [0, 'Medium, walk in'], [0, 'Close-up, hands'],
    [1, 'Two-shot'], [1, 'Insert, notes'],
  ]
  const perScene = new Map()
  const shots = specs.map(([sceneIdx, label], i) => {
    const scene = scenes[sceneIdx]
    const n = (perScene.get(scene.id) || 0) + 1
    perScene.set(scene.id, n)
    return {
      id: newId(), project_id: projectId, scene_id: scene.id,
      name: `${scene.name.slice(0, 4)} SH${String(n).padStart(2, '0')} ${label}`,
      shot_number: n, status: 'not_started', type: 'other', frame_count: 0, sort_order: i,
    }
  })
  return { project, scenes, shots }
}

/**
 * Write the plan through the SAME paths the views use: the provider's
 * createProject (index entry + folder rows) and the adapter's scene / shot
 * upserts (the local routes, so SCENES/ and SHOTS/ folders are made). Only
 * the Local Server adapter has these; the caller gates on adapterMode.
 */
export async function seedDemoProject({ createProject, adapter, title } = {}) {
  if (typeof createProject !== 'function') throw new Error('R.A.B.B.I.T. is not ready')
  if (!adapter?.upsertScene || !adapter?.upsertShot) throw new Error('this storage backend cannot seed a demo project')
  const plan = planDemoProject({ title, newId: () => crypto.randomUUID() })
  const created = await createProject(plan.project)
  const projectId = created?.id || plan.project.id
  for (const s of plan.scenes) await adapter.upsertScene({ ...s, project_id: projectId })
  for (const s of plan.shots) await adapter.upsertShot({ ...s, project_id: projectId })
  return { id: projectId, title: created?.title || plan.project.title, scenes: plan.scenes.length, shots: plan.shots.length }
}
