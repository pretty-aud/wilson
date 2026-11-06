// networkShareCatalogue.js — MO1 (MOTH_DESIGN §1.9, NS-D5, NS-D7, NS-D12): the renderer's half of a company's
// office server. It carries a desktop walk to the catalogue, and carries out the renames each operation owes.
// A walk records metadata only; the cloud never sees a body.
//
// What 0117's and 0119's measurements ask of it: at most about 500 entries a call, because a first listing of
// 1,000 with its history is most of the 8 s limit, and half that again when the database runs out of time. A
// directory over one call goes in parts marked not complete, then whole, so nothing in it is called missing
// until all of it has been seen. The same call goes again while the server says more_missing. The walk's first
// call says so (p_first), so a walk left unfinished does not run on into this one. The server takes 60 calls in
// ten minutes, so a long walk stops short of that, and its last call is final and says where it stopped: only a
// final call records where the next one starts.
import { desktopFileOps } from '../storage/desktopFileOps.js'

export const ENTRIES_PER_CALL = 500
const SMALLEST_CALL = 50
const MAX_WALKS = 30
const MAX_CALLS = 50
const MAX_REPEATS = 20
const OPEN_EVERY_MS = 10 * 60 * 1000
const OVER_ONE_READ = 5000
// The route's limit on one request, and the server's on one settle.
const OPS_PER_CALL = 500
// Nobody can say whether these happened, so they stay pending and are looked at again.
const UNKNOWN_OUTCOME = new Set(['failed', 'not_verified', 'unreachable'])

export const CANNOT_READ_WHOLE = 'A folder here holds more than 5,000 files, so WILSON cannot tell when one has gone from it.'
const CHANGED_TOO_MUCH = 'This folder changed too much at once for WILSON to list it. Try again in a few minutes.'

const outOfTime = (err) => /statement timeout/i.test(String(err?.message ?? ''))
const entriesOf = (dirs) => dirs.reduce((n, d) => n + d.files.length, 0)

// A copy-up this computer is making now: its operation is pending, and looking at its target would say
// it never happened.
const copying = new Set()

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
  // One refusal in a batch refuses all of it, so a batch that fails is asked again one at a time. What the
  // server still will not take stays pending, and is returned.
  async function settle(list, outcome) {
    if (list.length === 0) return []
    try {
      await adapter.settleNetworkShareOps(list.map((op) => op.op_id), outcome)
      return []
    } catch {
      if (list.length === 1) return list
      const stuck = []
      for (const op of list) stuck.push(...await settle([op], outcome))
      return stuck
    }
  }

  // Each operation answers for itself, because each settles for itself. A rename whose file was already
  // gone settles done for a delete, or its row could never leave (0117's owed). Where nobody can say what
  // happened, it stays pending: not_moved would put the row back with the file perhaps at the far end.
  async function runNasOp(list, { kind = null } = {}) {
    const operations = (list || []).filter((op) => op?.op_id && op.from && op.to)
    const done = []
    const notMoved = []
    const left = []
    for (let at = 0; at < operations.length; at += OPS_PER_CALL) {
      const batch = operations.slice(at, at + OPS_PER_CALL)
      let results
      try {
        ({ results } = await ops.rename(batch.map((op) => ({
          from: op.from, to: op.to, ...(Number.isFinite(op.size) ? { size: op.size } : {}),
        }))))
      } catch (err) {
        left.push(...batch.map((op) => ({ ...op, code: err?.code ?? 'failed' })))
        continue
      }
      const landed = []
      const refused = []
      batch.forEach((op, i) => {
        const outcome = results[i] || {}
        const isDelete = (op.op || kind) === 'trash'
        if (outcome.ok || (isDelete && outcome.code === 'not_there')) landed.push(op)
        else if (UNKNOWN_OUTCOME.has(outcome.code ?? 'failed')) left.push({ ...op, code: outcome.code ?? 'failed' })
        else refused.push({ ...op, code: outcome.code })
      })
      const stuckDone = await settle(landed, 'done')
      const stuckBack = await settle(refused, 'not_moved')
      done.push(...landed.filter((op) => !stuckDone.includes(op)))
      notMoved.push(...refused.filter((op) => !stuckBack.includes(op)))
      left.push(...stuckDone, ...stuckBack)
    }
    return { done, notMoved, left }
  }

  // A copy-up, whose operation has no source to rename. The real settle asks what the copy found on the
  // server. A copy that failed kept nothing, so the row goes back; one whose settle failed stays pending.
  async function runCopyUp(op, mediaKey) {
    copying.add(op.op_id)
    try {
      let put
      try {
        put = await ops.put(op.to, { media_key: mediaKey })
      } catch (err) {
        if (err?.status == null) return { ok: false, code: 'left', left: true }
        await settle([op], 'not_moved')
        return { ok: false, code: err.code ?? 'failed' }
      }
      try {
        await adapter.settleNetworkShareOps([op.op_id], 'done', { [op.op_id]: { s: String(put.size_bytes), m: put.modified_at } })
      } catch {
        return { ok: false, code: 'left', left: true }
      }
      return { ok: true }
    } finally {
      copying.delete(op.op_id)
    }
  }

  // A copy-up left over from a crash. Its copy lands whole or not at all, so a file there is it, unless it
  // is the empty reservation. Asked of the server, because the row is already there saying so.
  async function settleLeftCopy(op, outcome) {
    if (copying.has(op.op_id)) return
    let there
    try {
      there = await ops.statFile(op.to)
    } catch {
      outcome.left.push(op)
      return
    }
    try {
      if (there && there.size > 0) {
        await adapter.settleNetworkShareOps([op.op_id], 'done', { [op.op_id]: { s: String(there.size), m: there.modified_at } })
        outcome.done.push(op)
      } else {
        await adapter.settleNetworkShareOps([op.op_id], 'not_moved')
        outcome.notMoved.push(op)
      }
    } catch {
      outcome.left.push(op)
    }
  }

  // At sign-in, on opening M.O.T.H. and before a check. What is pending is read from the server first: a
  // laptop that was away may hold an operation someone has since called off, and renaming for that one
  // would leave the row at the origin and the file at the destination (0118's owed).
  async function settlePending() {
    if (!ops.available()) return { done: [], notMoved: [], left: [] }
    const pending = (await adapter.networkSharePending()) || []
    const outcome = await runNasOp(pending)
    for (const op of pending) {
      if (op?.op_id && !op.from && op.to) await settleLeftCopy(op, outcome)
    }
    return outcome
  }

  async function refreshNow(project, { root, folder = spaceFolderOf(project, root) } = {}) {
    if (!folder) throw new Error('This project has no folder on the office server.')
    // An operation left unfinished holds its files out of the walk, so it goes first when it can.
    await Promise.resolve().then(settlePending).catch(() => {})
    const summary = { added: 0, updated: 0, renamed: 0, found_again: 0, newly_missing: 0, checked_at: null, complete: true, tooBig: false }
    const purge = new Set()
    const back = new Map()
    const stale = new Map()
    const check = await adapter.getNetworkShareCheck(project.id)
    let start = check?.next_start ?? null
    let first = true
    let used = 0
    let cap = ENTRIES_PER_CALL
    for (let walk = 0; walk < MAX_WALKS; walk += 1) {
      const found = await ops.walkFolder(folder, start)
      if (found.dirs.some((d) => !d.complete && d.files.length >= OVER_ONE_READ)) summary.tooBig = true
      if (found.dirs.some((d) => !d.complete) || found.stopped_at) summary.complete = false
      const queue = splitDirs(found.dirs, cap)
      if (queue.length === 0) queue.push([])
      // What fits under the server's limit, and the next directory is where to carry on. The last call that
      // fits is final, so what it says about that is kept.
      let stoppedAt = found.stopped_at
      if (queue.length > Math.max(1, MAX_CALLS - used)) {
        const room = Math.max(1, MAX_CALLS - used)
        stoppedAt = queue[room][0].d
        queue.length = room
        summary.complete = false
      }
      const stopping = Boolean(stoppedAt) && (walk === MAX_WALKS - 1 || used + queue.length >= MAX_CALLS)
      const ending = !stoppedAt || stopping
      while (queue.length > 0) {
        const dirs = queue.shift()
        const last = queue.length === 0
        for (let repeat = 0; repeat < MAX_REPEATS; repeat += 1) {
          let answer
          try {
            answer = await adapter.refreshNetworkShare({
              projectId: project.id,
              root,
              folder,
              dirs,
              bin: first ? found.bin : [],
              final: last && ending,
              stoppedAt: last ? stoppedAt : null,
              first,
            })
          } catch (err) {
            if (!outOfTime(err)) throw err
            if (entriesOf(dirs) <= SMALLEST_CALL || cap <= SMALLEST_CALL) throw new Error(CHANGED_TOO_MUCH)
            cap = Math.max(SMALLEST_CALL, Math.floor(Math.min(cap, entriesOf(dirs)) / 2))
            queue.unshift(...splitDirs(dirs, cap))
            break
          }
          first = false
          used += 1
          for (const key of ['added', 'updated', 'renamed', 'found_again', 'newly_missing']) summary[key] += answer[key] || 0
          summary.checked_at = answer.checked_at ?? summary.checked_at
          for (const id of answer.purge_ok || []) purge.add(id)
          for (const row of answer.restore_back || []) back.set(row.id, row)
          for (const op of answer.stale || []) stale.set(op.op_id, op)
          if (!answer.more_missing) break
        }
      }
      if (ending) break
      start = found.stopped_at
    }
    // What the apply found for the desktop: a bin entry certified as purged goes for good; a live row
    // whose file is in the bin comes back; and an operation left over a day ago is finished here.
    const purgeIds = [...purge]
    for (let at = 0; at < purgeIds.length; at += OPS_PER_CALL) {
      await ops.purgeBin(purgeIds.slice(at, at + OPS_PER_CALL).map((id) => `${folder}/.wilson-bin/${id}`))
    }
    const backRows = [...back.values()]
    for (let at = 0; at < backRows.length; at += OPS_PER_CALL) {
      await ops.rename(backRows.slice(at, at + OPS_PER_CALL).map(({ id, to }) => ({ from: `${folder}/.wilson-bin/${id}/${to.split('/').pop()}`, to })))
    }
    if (stale.size > 0) await runNasOp([...stale.values()])
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

  return { runNasOp, runCopyUp, settlePending, refreshNow, refreshOnOpen }
}
