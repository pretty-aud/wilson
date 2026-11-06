// networkShareCatalogue.js — MO1 (MOTH_DESIGN §1.9, NS-D5, NS-D7, NS-D12): the renderer's half of a company's
// office server. It carries a desktop walk to the catalogue, and carries out the renames each operation owes.
// A walk records metadata only; the cloud never sees a body.
//
// What 0117's measurements ask of it: at most about 1,000 entries a call, because a first listing of 5,000
// takes about 10 s against an 8 s limit. A directory over one call goes in parts marked not complete, then
// whole, so nothing in it is called missing until all of it has been seen. The same call goes again while
// the server says more_missing. The walk's first call says so (p_first), so a walk left unfinished does not
// run on into this one.
import { desktopFileOps } from '../storage/desktopFileOps.js'

export const ENTRIES_PER_CALL = 1000
const MAX_WALKS = 30
const MAX_REPEATS = 20
const OPEN_EVERY_MS = 10 * 60 * 1000
const OVER_ONE_READ = 5000

export const CANNOT_READ_WHOLE = 'A folder here holds more than 5,000 files, so WILSON cannot tell when one has gone from it.'

// A space's folder under the drive (NS-D2), or null for a project that is not listed there.
export function spaceFolderOf(project, root) {
  if (!project) return null
  if (project.personal_owner_id) return `_WILSON_PERSONAL/${project.personal_owner_id}`
  const raw = project.folder_root
  if (!raw || !root) return null
  const clean = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const base = clean(root)
  const full = clean(raw)
  if (!full.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return null
  return full.slice(base.length + 1)
}

// The calls one walk's answer becomes.
export function splitDirs(dirs, cap = ENTRIES_PER_CALL) {
  const calls = []
  let current = []
  let size = 0
  const flush = () => {
    if (current.length) calls.push(current)
    current = []
    size = 0
  }
  for (const dir of dirs) {
    const count = dir.files.length
    if (count > cap) {
      flush()
      for (let at = 0; at < count; at += cap) {
        calls.push([{ d: dir.d, complete: false, subdirs: dir.subdirs, files: dir.files.slice(at, at + cap) }])
      }
      calls.push([dir])
    } else {
      if (size + count > cap) flush()
      current.push(dir)
      size += count
    }
  }
  flush()
  return calls
}

export function createNetworkShareCatalogue({ adapter, ops = desktopFileOps, now = () => Date.now() }) {
  // Each operation answers for itself, because each settles for itself. A rename whose file was already
  // gone settles done for a delete, or its row could never leave (0117's owed).
  async function runNasOp(list, { kind = null } = {}) {
    const operations = (list || []).filter((op) => op?.op_id && op.from && op.to)
    if (operations.length === 0) return { done: [], notMoved: [] }
    const { results } = await ops.rename(operations.map((op) => ({ from: op.from, to: op.to })))
    const done = []
    const notMoved = []
    operations.forEach((op, i) => {
      const outcome = results[i] || {}
      const isDelete = (op.op || kind) === 'trash'
      if (outcome.ok || (isDelete && outcome.code === 'not_there')) done.push(op)
      else notMoved.push({ ...op, code: outcome.code ?? 'failed' })
    })
    if (done.length) await adapter.settleNetworkShareOps(done.map((op) => op.op_id), 'done')
    if (notMoved.length) await adapter.settleNetworkShareOps(notMoved.map((op) => op.op_id), 'not_moved')
    return { done, notMoved }
  }

  // At sign-in, and what the Moth page offers. What is pending is read from the server first: a laptop
  // that was away may hold an operation someone has since called off, and renaming for that one would
  // leave the row at the origin and the file at the destination (0118's owed).
  async function settlePending() {
    if (!ops.available()) return { done: [], notMoved: [] }
    const pending = await adapter.networkSharePending()
    return runNasOp(pending)
  }

  async function refreshNow(project, { root, folder = spaceFolderOf(project, root) } = {}) {
    if (!folder) throw new Error('This project has no folder on the office server.')
    const summary = { added: 0, updated: 0, renamed: 0, found_again: 0, newly_missing: 0, checked_at: null, complete: true, tooBig: false }
    const purge = []
    const back = []
    const stale = []
    const check = await adapter.getNetworkShareCheck(project.id)
    let start = check?.next_start ?? null
    let first = true
    for (let walk = 0; walk < MAX_WALKS; walk += 1) {
      const found = await ops.walkFolder(folder, start)
      if (found.dirs.some((d) => !d.complete && d.files.length >= OVER_ONE_READ)) summary.tooBig = true
      if (found.dirs.some((d) => !d.complete) || found.stopped_at) summary.complete = false
      const calls = splitDirs(found.dirs)
      if (calls.length === 0) calls.push([])
      for (let i = 0; i < calls.length; i += 1) {
        const last = i === calls.length - 1
        const final = last && !found.stopped_at
        for (let repeat = 0; repeat < MAX_REPEATS; repeat += 1) {
          const answer = await adapter.refreshNetworkShare({
            projectId: project.id,
            root,
            folder,
            dirs: calls[i],
            bin: first ? found.bin : [],
            final,
            stoppedAt: last ? found.stopped_at : null,
            first,
          })
          first = false
          for (const key of ['added', 'updated', 'renamed', 'found_again', 'newly_missing']) summary[key] += answer[key] || 0
          summary.checked_at = answer.checked_at ?? summary.checked_at
          purge.push(...(answer.purge_ok || []))
          back.push(...(answer.restore_back || []))
          stale.push(...(answer.stale || []))
          if (!answer.more_missing) break
        }
      }
      if (!found.stopped_at) break
      start = found.stopped_at
    }
    // What the apply found for the desktop: a bin entry certified as purged goes for good; a live row
    // whose file is in the bin comes back; and an operation left over a day ago is finished here.
    if (purge.length) await ops.purgeBin(purge.map((id) => `${folder}/.wilson-bin/${id}`))
    if (back.length) {
      await ops.rename(back.map(({ id, to }) => ({ from: `${folder}/.wilson-bin/${id}/${to.split('/').pop()}`, to })))
    }
    if (stale.length) await runNasOp(stale)
    return summary
  }

  // Opening a project: at most every ten minutes, quietly. Only the desktop can look, and a failed look
  // leaves the banner's own 'last checked' to say how old the list is.
  async function refreshOnOpen(project, { root } = {}) {
    if (!ops.available()) return { skipped: 'browser' }
    try {
      const check = await adapter.getNetworkShareCheck(project.id)
      const last = check?.last_checked_at ? Date.parse(check.last_checked_at) : 0
      if (now() - last < OPEN_EVERY_MS) return { skipped: 'recent' }
      return await refreshNow(project, { root })
    } catch (err) {
      return { skipped: 'failed', error: err?.message ?? String(err) }
    }
  }

  return { runNasOp, settlePending, refreshNow, refreshOnOpen }
}
