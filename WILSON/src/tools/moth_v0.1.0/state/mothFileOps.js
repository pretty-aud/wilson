// mothFileOps.js — MO1 (MOTH_DESIGN §1.10): what Move to, Delete, Undo and Restore do. Each writes through the
// adapter's Moth methods and pushes one step to the history, and tells Files what changed so the two agree.
//
// A cloud move: the plan says what each file needs. A rehome or a copy-up into company storage is copied first,
// and that copy is removed if the commit refuses, so the file is never without a body. A commit whose answer is
// lost is not a refusal: the row may name that copy already, so it stays. A move on the office server is asked
// whether the server is there, committed, and then renamed: the row and its journal are the server's, a rename
// that fails settles not_moved and puts the row back (NS-D12), and one nobody can say happened stays pending and
// finishes later. A copy-up to the office server is the same, with a copy for a rename. A browser cannot do
// either, and says so from the plan, before anything is written.
//
// A desktop-only project has no server to ask: its own routes hold the journal (fileMoves.cjs).
import { DESKTOP_ACTION_SENTENCE } from '../../rabbit_v0.1.0/storage/desktopFileOps.js'

const NETWORK_SHARE = 'network_share'
const LOCAL_SERVER = 'local_server'

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function createMothFileOps({ adapter, catalogue, ops, history, onChanged = () => {}, onNote = () => {} }) {
  const isLocal = typeof adapter.moveFilesBetweenProjects === 'function' && typeof adapter.planFileMove !== 'function'
  const onDesktop = () => ops.available()
  const told = (...projects) => onChanged([...new Set(projects.filter(Boolean))])

  // The move itself said what stayed behind and what did not return, and a person should not find out later.
  const sayLeftBehind = (result) => {
    if (result?.links_cleared > 0) onNote(`${count(result.links_cleared, 'file\'s links', 'files\' links')} to this project's tasks, shots or assets stayed behind.`)
  }
  const sayNotBack = (result) => {
    const links = result?.links_not_restored ?? 0
    const pictures = result?.pictures_not_restored ?? 0
    if (links === 0 && pictures === 0) return
    const parts = [links ? count(links, 'link', 'links') : null, pictures ? count(pictures, 'picture', 'pictures') : null].filter(Boolean)
    onNote(`Moved back. ${parts.join(' and ')} could not come back, because what they named has gone since.`)
  }

  // An operation with no source is a copy-up's: the copy comes from this computer's media key.
  async function carryOut(result, files) {
    const list = result?.ops ?? []
    const sized = (op) => {
      const size = files.find((f) => f.id === op.id)?.size_bytes
      return Number.isFinite(size) ? { ...op, size } : op
    }
    const renames = list.filter((op) => op.from).map(sized)
    const copies = list.filter((op) => !op.from)
    const outcome = renames.length ? await catalogue.runNasOp(renames) : { done: [], notMoved: [], left: [] }
    outcome.left = outcome.left ?? []
    for (const op of copies) {
      const file = files.find((f) => f.id === op.id)
      const copied = await catalogue.runCopyUp(op, file?.storage_path)
      if (copied?.ok) outcome.done.push(op)
      else if (copied?.left) outcome.left.push(op)
      else outcome.notMoved.push({ ...op, code: copied?.code ?? 'failed' })
    }
    return outcome
  }

  // Some of it, none of it, or all of it but not yet: each said as what it is.
  function outcomeError(outcome, total, verb = 'Moved') {
    const { notMoved = [], left = [] } = outcome
    const later = left.length > 0
    const stayed = notMoved.some((op) => op.code === 'name_taken')
      ? 'A file with this name is already in that folder on the office server, so it stayed where it was.'
      : 'The office server would not move this file, so it stayed where it was.'
    const sentence = later
      ? 'The office server stopped answering part way. WILSON will finish this when it can reach it again.'
      : stayed
    const happened = total - notMoved.length - left.length
    const err = new Error(happened > 0 && total > 1 ? `${verb} ${happened} of ${total}. ${sentence}` : sentence)
    err.notMoved = notMoved
    err.later = later
    err.partial = happened > 0
    return err
  }

  async function moveCloud(files, destProject, destFolder, fromProject) {
    const ids = files.map((f) => f.id)
    const plan = await adapter.planFileMove(ids, destProject, destFolder)
    const items = plan?.items ?? []
    const needsHands = items.some((i) => i.how === 'share_move' || (i.how === 'copy_up' && i.to_provider === NETWORK_SHARE))
    if (needsHands && !onDesktop()) throw new Error(DESKTOP_ACTION_SENTENCE)
    if (needsHands) await ops.reachable()

    const copying = items.filter((i) => (i.how === 'rehome' || i.how === 'copy_up') && i.to_provider !== NETWORK_SHARE)
    const made = []
    const bodies = []
    const removeCopies = async () => { for (const item of made) await adapter.removeMoveCopy?.(item) }
    try {
      for (const item of copying) {
        const file = files.find((f) => f.id === item.id)
        bodies.push(await adapter.copyBodyForMove(file, item))
        made.push(item)
      }
    } catch (err) {
      await removeCopies()
      throw err
    }
    let result
    try {
      result = await adapter.moveFiles(ids, destProject, destFolder, bodies.length ? bodies : null)
    } catch (err) {
      if (err?.code) {
        await removeCopies()
        throw err
      }
      // No answer is no refusal. The row may already name the copy, and it is the only one left to read.
      told(fromProject, destProject)
      const unknown = new Error('WILSON could not tell whether this moved. Look in the project before trying again.')
      unknown.stale = true
      throw unknown
    }
    const outcome = await carryOut(result, files)
    // A copy-up has landed, so the computer that held the file keeps its copy for 30 days.
    for (const item of items.filter((i) => i.how === 'copy_up')) {
      const file = files.find((f) => f.id === item.id)
      const stayed = [...outcome.notMoved, ...outcome.left].some((op) => op.id === item.id)
      if (file?.storage_provider === LOCAL_SERVER && !stayed && onDesktop()) {
        await ops.retireLocalMedia(file.storage_path, result.move_id).catch(() => {})
      }
    }
    if (outcome.notMoved.length || outcome.left.length) {
      // The server would refuse this move's undo now that part of it went back, so it offers no step.
      if (outcome.left.length || outcome.done.length) told(fromProject, destProject)
      throw outcomeError(outcome, files.length)
    }
    sayLeftBehind(result)
    return result
  }

  async function undoCloud(moveId, files) {
    const plan = await adapter.planUndoFileMove(moveId)
    const needsHands = (plan?.items ?? []).some((i) => i.how === 'share_move')
    if (needsHands && !onDesktop()) throw new Error(DESKTOP_ACTION_SENTENCE)
    if (needsHands) await ops.reachable()
    const result = await adapter.undoFileMove(moveId)
    const outcome = await carryOut(result, files)
    if (outcome.notMoved.length || outcome.left.length) throw outcomeError(outcome, files.length, 'Moved back')
    sayNotBack(result)
    return result
  }

  const label = (verb, files) => (files.length === 1 ? `${verb} "${files[0].name}"` : `${verb} ${files.length} files`)

  // The step that undoes a move, and undoing it gives the step that does it again.
  function cloudSteps(moveId, files, fromProject, destProject) {
    return {
      label: label('Moved', files),
      async run() {
        const undone = await undoCloud(moveId, files)
        told(fromProject, destProject)
        return {
          label: label('Moved back', files),
          async run() {
            const redone = await undoCloud(undone.move_id, files)
            told(fromProject, destProject)
            return cloudSteps(redone.move_id, files, fromProject, destProject)
          },
        }
      },
    }
  }

  function localSteps(ids, files, fromProject, destProject, destFolder, fromFolders, before) {
    return {
      label: label('Moved', files),
      async run() {
        if (fromProject === destProject) {
          for (const [folder, inFolder] of fromFolders) await adapter.moveFilesInProject(inFolder, fromProject, folder)
        } else {
          sayNotBack(await adapter.moveFilesBetweenProjects(ids, destProject, fromProject, null, { back: before }))
        }
        told(fromProject, destProject)
        return {
          label: label('Moved back', files),
          async run() {
            const again = await moveLocal(ids, fromProject, destProject, destFolder)
            told(fromProject, destProject)
            return localSteps(ids, files, fromProject, destProject, destFolder, fromFolders, again?.before ?? before)
          },
        }
      },
    }
  }

  const moveLocal = (ids, fromProject, destProject, destFolder) => (fromProject === destProject
    ? adapter.moveFilesInProject(ids, fromProject, destFolder)
    : adapter.moveFilesBetweenProjects(ids, fromProject, destProject, destFolder))

  async function moveFiles(files, fromProject, destProject, destFolder = null) {
    if (isLocal) {
      const ids = files.map((f) => f.id)
      const fromFolders = new Map()
      for (const f of files) fromFolders.set(f.folder_id ?? null, [...(fromFolders.get(f.folder_id ?? null) ?? []), f.id])
      const result = await moveLocal(ids, fromProject, destProject, destFolder)
      sayLeftBehind(result)
      history.push(localSteps(ids, files, fromProject, destProject, destFolder, fromFolders, result?.before ?? null))
      told(fromProject, destProject)
      return result
    }
    const result = await moveCloud(files, destProject, destFolder, fromProject)
    if (result?.move_id) history.push(cloudSteps(result.move_id, files, fromProject, destProject))
    told(fromProject, destProject)
    return result
  }

  const onShare = (files) => files.some((f) => f.storage_provider === NETWORK_SHARE || f.needs_desktop)
  async function readyForShare(files) {
    if (!onShare(files)) return
    if (!onDesktop()) throw new Error(DESKTOP_ACTION_SENTENCE)
    await ops.reachable()
  }

  async function restoreOnly(files, projectId) {
    await readyForShare(files)
    const answer = await adapter.restoreFiles(files.map((f) => f.id), projectId)
    const outcome = answer?.ops?.length ? await catalogue.runNasOp(answer.ops, { kind: 'restore' }) : { notMoved: [], left: [] }
    if (outcome.notMoved?.length || outcome.left?.length) {
      told(projectId)
      throw outcomeError(outcome, files.length, 'Restored')
    }
    told(projectId)
    return answer
  }

  async function trashOnly(files, projectId) {
    await readyForShare(files)
    const answer = await adapter.trashFiles(files.map((f) => f.id), projectId)
    const outcome = answer?.ops?.length ? await catalogue.runNasOp(answer.ops, { kind: 'trash' }) : { notMoved: [], left: [] }
    if (outcome.notMoved?.length || outcome.left?.length) {
      told(projectId)
      const stayed = new Set((outcome.notMoved ?? []).map((op) => op.id))
      const err = outcomeError(outcome, files.length, 'Deleted')
      err.went = files.filter((f) => !stayed.has(f.id))
      throw err
    }
    told(projectId)
    return answer
  }

  function trashSteps(files, projectId) {
    return {
      label: label('Deleted', files),
      async run() {
        await restoreOnly(files, projectId)
        return {
          label: label('Restored', files),
          async run() {
            await trashOnly(files, projectId)
            return trashSteps(files, projectId)
          },
        }
      },
    }
  }

  async function trashFiles(files, projectId) {
    try {
      const answer = await trashOnly(files, projectId)
      history.push(trashSteps(files, projectId))
      return answer
    } catch (err) {
      // What did go can come back, one step as ever.
      if (err.went?.length) history.push(trashSteps(err.went, projectId))
      throw err
    }
  }

  async function restoreFiles(files, projectId) {
    const answer = await restoreOnly(files, projectId)
    history.push({
      label: label('Restored', files),
      async run() {
        await trashOnly(files, projectId)
        return trashSteps(files, projectId)
      },
    })
    return answer
  }

  return { moveFiles, trashFiles, restoreFiles }
}
