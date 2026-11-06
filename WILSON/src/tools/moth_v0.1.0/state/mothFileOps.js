// mothFileOps.js — MO1 (MOTH_DESIGN §1.10): what Move to, Delete, Undo and Restore do. Each writes through the
// adapter's Moth methods and pushes one step to the history, and tells Files what changed so the two agree.
//
// A cloud move: the plan says what each file needs. A rehome or a copy-up into company storage is copied first,
// and that copy is removed if the commit refuses, so the file is never without a body. A move on the office
// server is committed first and then renamed: the row and its journal are the server's, and a rename that
// fails settles not_moved and puts the row back (NS-D12). A copy-up to the office server is the same, with a
// copy for a rename. A browser cannot do either, and says so from the plan, before anything is written.
//
// A desktop-only project has no server to ask: its own routes hold the journal (fileMoves.cjs).
import { DESKTOP_ACTION_SENTENCE } from '../../rabbit_v0.1.0/storage/desktopFileOps.js'

const NETWORK_SHARE = 'network_share'
const LOCAL_SERVER = 'local_server'

export function createMothFileOps({ adapter, catalogue, ops, history, onChanged = () => {} }) {
  const isLocal = typeof adapter.moveFilesBetweenProjects === 'function' && typeof adapter.planFileMove !== 'function'
  const onDesktop = () => ops.available()
  const told = (...projects) => onChanged([...new Set(projects.filter(Boolean))])

  // An operation with no source is a copy-up's: the copy comes from this computer's media key.
  async function carryOut(result, files) {
    const list = result?.ops ?? []
    const renames = list.filter((op) => op.from)
    const copies = list.filter((op) => !op.from)
    const outcome = renames.length ? await catalogue.runNasOp(renames) : { done: [], notMoved: [] }
    for (const op of copies) {
      const file = files.find((f) => f.id === op.id)
      try {
        await ops.put(op.to, { media_key: file?.storage_path })
        await adapter.settleNetworkShareOps([op.op_id], 'done')
        outcome.done.push(op)
      } catch (err) {
        await adapter.settleNetworkShareOps([op.op_id], 'not_moved')
        outcome.notMoved.push({ ...op, code: err?.code ?? 'failed' })
      }
    }
    return outcome
  }

  const notMovedError = (notMoved) => {
    const err = new Error(notMoved.some((op) => op.code === 'name_taken')
      ? 'A file with this name is already in that folder on the office server, so it stayed where it was.'
      : 'The office server would not move this file, so it stayed where it was.')
    err.notMoved = notMoved
    return err
  }

  async function moveCloud(files, destProject, destFolder) {
    const ids = files.map((f) => f.id)
    const plan = await adapter.planFileMove(ids, destProject, destFolder)
    const items = plan?.items ?? []
    const needsHands = items.some((i) => i.how === 'share_move' || (i.how === 'copy_up' && i.to_provider === NETWORK_SHARE))
    if (needsHands && !onDesktop()) throw new Error(DESKTOP_ACTION_SENTENCE)

    const copying = items.filter((i) => (i.how === 'rehome' || i.how === 'copy_up') && i.to_provider !== NETWORK_SHARE)
    const made = []
    const bodies = []
    try {
      for (const item of copying) {
        const file = files.find((f) => f.id === item.id)
        bodies.push(await adapter.copyBodyForMove(file, item))
        made.push(item)
      }
      const result = await adapter.moveFiles(ids, destProject, destFolder, bodies.length ? bodies : null)
      const outcome = await carryOut(result, files)
      // A copy-up has landed, so the computer that held the file keeps its copy for 30 days.
      for (const item of items.filter((i) => i.how === 'copy_up')) {
        const file = files.find((f) => f.id === item.id)
        if (file?.storage_provider === LOCAL_SERVER && !outcome.notMoved.some((op) => op.id === item.id) && onDesktop()) {
          await ops.retireLocalMedia(file.storage_path, result.move_id).catch(() => {})
        }
      }
      if (outcome.notMoved.length) throw notMovedError(outcome.notMoved)
      return result
    } catch (err) {
      if (!err.notMoved) for (const item of made) await adapter.removeMoveCopy?.(item)
      throw err
    }
  }

  async function undoCloud(moveId, files) {
    const plan = await adapter.planUndoFileMove(moveId)
    if ((plan?.items ?? []).some((i) => i.how === 'share_move') && !onDesktop()) throw new Error(DESKTOP_ACTION_SENTENCE)
    const result = await adapter.undoFileMove(moveId)
    const outcome = await carryOut(result, files)
    if (outcome.notMoved.length) throw notMovedError(outcome.notMoved)
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

  function localSteps(ids, files, fromProject, destProject, destFolder, fromFolders) {
    return {
      label: label('Moved', files),
      async run() {
        if (fromProject === destProject) {
          for (const [folder, inFolder] of fromFolders) await adapter.moveFilesInProject(inFolder, fromProject, folder)
        } else {
          await adapter.moveFilesBetweenProjects(ids, destProject, fromProject, null)
        }
        told(fromProject, destProject)
        return {
          label: label('Moved back', files),
          async run() {
            await moveLocal(ids, fromProject, destProject, destFolder)
            told(fromProject, destProject)
            return localSteps(ids, files, fromProject, destProject, destFolder, fromFolders)
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
      history.push(localSteps(ids, files, fromProject, destProject, destFolder, fromFolders))
      told(fromProject, destProject)
      return result
    }
    const result = await moveCloud(files, destProject, destFolder)
    if (result?.move_id) history.push(cloudSteps(result.move_id, files, fromProject, destProject))
    told(fromProject, destProject)
    return result
  }

  const refuseOffDesktop = (files) => {
    if (files.some((f) => f.storage_provider === NETWORK_SHARE || f.needs_desktop) && !onDesktop()) throw new Error(DESKTOP_ACTION_SENTENCE)
  }

  async function restoreOnly(files, projectId) {
    refuseOffDesktop(files)
    const answer = await adapter.restoreFiles(files.map((f) => f.id), projectId)
    const outcome = answer?.ops?.length ? await catalogue.runNasOp(answer.ops, { kind: 'restore' }) : { notMoved: [] }
    if (outcome.notMoved.length) throw notMovedError(outcome.notMoved)
    told(projectId)
    return answer
  }

  async function trashOnly(files, projectId) {
    refuseOffDesktop(files)
    const answer = await adapter.trashFiles(files.map((f) => f.id), projectId)
    const outcome = answer?.ops?.length ? await catalogue.runNasOp(answer.ops, { kind: 'trash' }) : { notMoved: [] }
    if (outcome.notMoved.length) throw notMovedError(outcome.notMoved)
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
    const answer = await trashOnly(files, projectId)
    history.push(trashSteps(files, projectId))
    return answer
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
