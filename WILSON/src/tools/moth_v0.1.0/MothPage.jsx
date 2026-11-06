// MothPage.jsx — MO1 (MOTH_DESIGN §1.10): M.O.T.H.'s page for Session 1. A lazy chunk: App.jsx reaches it only
// through lazy(import()), and nothing outside this folder imports from it (mothChunk.test.js).
//
// It reads only through the adapter's Moth methods, which have already removed money and Legal on the server, and
// each row passes mothFileHidden as a second look. So the list, the search, a selection and the trash cannot show
// them. Every control is gated by the same question as the server's, and the server asks again.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Files } from 'lucide-react'
import { Banner, Button, Dialog, EmptyState } from '../../ui'
import GatedAction from '../../permissions/GatedAction'
import { usePermissions } from '../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../permissions/projectRoleMatrix'
import { useRabbit } from '../rabbit_v0.1.0/state/RabbitProvider'
import { desktopFileOps } from '../rabbit_v0.1.0/storage/desktopFileOps.js'
import { createNetworkShareCatalogue } from '../rabbit_v0.1.0/state/networkShareCatalogue.js'
import { visibleDialogCount } from '../rabbit_v0.1.0/views/bins/binUi'
import { fetchWorkspaceStorage } from '../../cloud/workspaceStorage'
import { mothFileHidden } from './state/mothEligibility.js'
import { createMothHistory } from './state/mothHistory.js'
import { createMothFileOps } from './state/mothFileOps.js'
import MothIslands from './components/MothIslands.jsx'
import MothMoveTo from './components/MothMoveTo.jsx'
import MothPersonalPanel from './components/MothPersonalPanel.jsx'
import MothTrashView from './components/MothTrashView.jsx'
import './moth.css'

const PAGE = 500

// A key pressed in a box that has its own undo. A ticked row's checkbox has none.
const typingIn = (target) => {
  if (target?.isContentEditable) return true
  if (/^(TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return true
  return target?.tagName === 'INPUT' && !/^(checkbox|radio|button)$/.test(target.type ?? '')
}

export default function MothPage({ isActive = true }) {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const adapter = rabbit?.getAdapter?.() ?? null
  const localOnly = rabbit?.adapterMode === 'local_server'
  const onDesktop = desktopFileOps.available()

  const [islands, setIslands] = useState(null)
  const [islandsFailed, setIslandsFailed] = useState(false)
  const [islandsAsked, setIslandsAsked] = useState(0)
  const [openId, setOpenId] = useState(null)
  const [view, setView] = useState('files')
  const [files, setFiles] = useState([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [moving, setMoving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [storage, setStorage] = useState(null)
  const [changeKey, setChangeKey] = useState(0)
  const [unfinishedMoves, setUnfinishedMoves] = useState(0)

  // One stack per account, workspace and adapter, and it survives everything else.
  const scope = `${perms?.userId ?? ''}|${perms?.workspaceId ?? ''}|${rabbit?.adapterMode ?? ''}`
  const historyRef = useRef(null)
  const scopeRef = useRef(null)
  if (!historyRef.current) historyRef.current = createMothHistory()
  if (scopeRef.current !== scope) {
    if (scopeRef.current !== null) historyRef.current.clear()
    scopeRef.current = scope
  }
  const history = historyRef.current
  const canUndo = useSyncExternalStore(history.subscribe, history.canUndo)
  const canRedo = useSyncExternalStore(history.subscribe, history.canRedo)

  const catalogue = useMemo(() => (adapter ? createNetworkShareCatalogue({ adapter }) : null), [adapter])
  const notify = rabbit?.noteFilesChangedElsewhere
  const fileOps = useMemo(() => (adapter && catalogue ? createMothFileOps({
    adapter,
    catalogue,
    ops: desktopFileOps,
    history,
    onChanged: (projects) => {
      setChangeKey((k) => k + 1)
      notify?.(projects)
    },
    onNote: setNote,
  }) : null), [adapter, catalogue, history, notify])

  // First entry: this person's space exists from here on (acceptance 1: exactly one, the same on a second
  // entry), and a database or a build without it still shows the projects. Coming back reads again, so a project
  // made elsewhere appears and a changed seat counts; a space that could not be made is asked for again then.
  const spaceAsked = useRef(false)
  useEffect(() => { spaceAsked.current = false }, [adapter, scope])
  useEffect(() => {
    if (!adapter || !isActive) return undefined
    let live = true
    setIslandsFailed(false)
    ;(async () => {
      if (!spaceAsked.current) {
        await Promise.resolve().then(() => adapter.ensurePersonalSpace?.()).then(() => { spaceAsked.current = true }).catch(() => {})
      }
      const rows = await adapter.listMothIslands()
      if (live) setIslands(rows || [])
    })().catch(() => {
      if (!live) return
      setIslands((was) => was ?? [])
      setIslandsFailed(true)
    })
    return () => { live = false }
  }, [adapter, isActive, islandsAsked])

  useEffect(() => {
    if (localOnly) return undefined
    let live = true
    Promise.resolve().then(() => fetchWorkspaceStorage())
      .then((row) => { if (live) setStorage(row) })
      .catch(() => {})
    return () => { live = false }
  }, [localOnly])
  const onNetworkStorage = storage?.mode === 'byos' && storage?.provider === 'network'
  const officeRoot = onNetworkStorage && storage?.root_kind === 'unc' ? storage.root_path : null

  // What was left unfinished: an office-server operation, or a move on this computer.
  useEffect(() => {
    if (!isActive || !adapter) return undefined
    let live = true
    if (typeof adapter.networkSharePending === 'function' && desktopFileOps.available()) {
      Promise.resolve().then(() => catalogue.settlePending())
        .then((out) => { if (live && (out?.done?.length || out?.notMoved?.length)) setChangeKey((k) => k + 1) })
        .catch(() => {})
    }
    if (typeof adapter.listPendingMoves === 'function') {
      Promise.resolve().then(() => adapter.listPendingMoves())
        .then((moves) => { if (live) setUnfinishedMoves(moves?.length ?? 0) })
        .catch(() => {})
    }
    return () => { live = false }
  }, [isActive, adapter, catalogue])

  const access = useCallback((row) => {
    if (!row) return { allowed: false, reason: null }
    const ctx = {
      appRole: perms?.role,
      projectRole: row.my_project_role,
      isStaffed: row.is_staffed,
      ready: perms?.ready !== false,
      noRoles: localOnly,
      isPersonal: row.is_personal,
      isPersonalOwner: row.is_mine,
    }
    return { allowed: canOnProject(ctx, 'project.entity.write'), reason: projectActionDeniedReason(ctx, 'project.entity.write') }
  }, [perms?.role, perms?.ready, localOnly])

  const open = islands?.find((row) => row.id === openId) ?? null
  const gate = access(open)

  const readPage = useCallback(async (projectId, after) => {
    // The signed-out desktop has no server to have removed money and Legal, so the second look is the only
    // one, and it is told what a row cannot say. A failure to read that shows nothing, not everything.
    const known = adapter.mothHiddenFacts ? await adapter.mothHiddenFacts(projectId) : {}
    const rows = await adapter.listMothFiles(projectId, after, PAGE)
    return { rows: (rows || []).filter((row) => !mothFileHidden(row, known)), full: (rows || []).length === PAGE, last: rows?.[rows.length - 1]?.id ?? null }
  }, [adapter])

  // Each read has its number, and only the newest may draw: a page that comes back after another project was
  // opened would otherwise land in that project's list, and writes there name its rows.
  const afterRef = useRef(null)
  const readNumber = useRef(0)
  useEffect(() => {
    if (!adapter || !openId) { setFiles([]); setMore(false); return undefined }
    if (!isActive) return undefined
    const asked = ++readNumber.current
    let live = true
    setLoading(true)
    setLoadingMore(false)
    setReadFailed(false)
    setError('')
    readPage(openId, null)
      .then(({ rows, full, last }) => {
        if (!live) return
        afterRef.current = last
        setFiles(rows)
        setMore(full)
      })
      .catch((err) => {
        if (!live || asked !== readNumber.current) return
        setFiles([])
        setMore(false)
        setReadFailed(true)
        setError(err?.message || String(err))
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [adapter, openId, readPage, changeKey, isActive])

  const loadMore = async () => {
    if (loadingMore) return
    const asked = readNumber.current
    setLoadingMore(true)
    try {
      const { rows, full, last } = await readPage(openId, afterRef.current)
      if (asked !== readNumber.current) return
      afterRef.current = last
      setFiles((was) => [...was, ...rows])
      setMore(full)
    } catch (err) {
      if (asked === readNumber.current) setError(err?.message || String(err))
    } finally {
      if (asked === readNumber.current) setLoadingMore(false)
    }
  }

  const openIsland = (id) => {
    if (id !== openId) {
      readNumber.current += 1
      setFiles([])
      setMore(false)
    }
    setOpenId(id)
    setView('files')
    setPicked(new Set())
    setSearch('')
  }

  // Only the rows already loaded, which the server has already stripped.
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    return words ? files.filter((f) => String(f.name ?? '').toLowerCase().includes(words)) : files
  }, [files, search])
  const pickedFiles = files.filter((f) => picked.has(f.id))
  const pickedHidden = pickedFiles.filter((f) => !shown.includes(f)).length
  const toggle = (id) => setPicked((was) => {
    const next = new Set(was)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const act = useCallback(async (fn) => {
    setError('')
    setNote('')
    try {
      await fn()
    } catch (err) {
      setError(err?.message || String(err))
    }
  }, [])

  // A toast's Undo is for its own step, and asks nothing once something else has been done since.
  const toastUndo = () => {
    const own = history.top()
    return () => act(() => history.undoStep(own))
  }

  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    const list = pickedFiles
    await act(async () => {
      await fileOps.trashFiles(list, openId)
      setPicked(new Set())
      rabbit?.showUndoToast?.(list.length === 1 ? `Deleted "${list[0].name}"` : `Deleted ${list.length} files`, toastUndo())
    })
    setDeleting(false)
    setConfirming(false)
  }

  const move = async (list, from, dest, folder) => {
    setNote('')
    await fileOps.moveFiles(list, from, dest, folder)
    setPicked(new Set())
    rabbit?.showUndoToast?.(list.length === 1 ? `Moved "${list[0].name}"` : `Moved ${list.length} files`, toastUndo())
  }

  // The copy goes first and the record after, because the record names what arrived. One the server then refuses
  // comes back out through the bin, or it would sit on the server with no row, and a retry would make a second.
  const addOneToServer = async (island, file, folder, accessToken) => {
    const put = await desktopFileOps.addToPersonalSpace({ root: officeRoot, folder, file, accessToken })
    try {
      await adapter.networkShareRecordAdded({
        projectId: island.id,
        root: officeRoot,
        entries: [{ n: put.name, s: String(put.sizeBytes), m: put.modifiedAt, t: file.type || undefined }],
      })
    } catch (err) {
      const bin = `${folder}/.wilson-bin/${crypto.randomUUID()}`
      await desktopFileOps.rename([{ from: put.locator, to: `${bin}/${put.name}` }])
        .then(() => desktopFileOps.purgeBin([bin]))
        .catch(() => {})
      throw err
    }
  }

  const addFiles = async (island, list) => {
    if (officeRoot) {
      const accessToken = await adapter.getAccessToken()
      const folder = `_WILSON_PERSONAL/${perms.userId}`
      for (const file of list) await addOneToServer(island, file, folder, accessToken)
    } else {
      for (const file of list) await adapter.uploadFile(island.id, {}, file, {})
    }
    setChangeKey((k) => k + 1)
    notify?.([island.id])
  }

  // Ctrl+Z and Ctrl+Y, only while on this page. Taken before any other listener: every page stays mounted, and a
  // hidden page's own undo on the document must not also run. A box with its own undo keeps it; nothing happens
  // behind a dialog; and a held key is one press.
  useEffect(() => {
    if (!isActive) return undefined
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      const undoing = key === 'z' && !event.shiftKey
      const redoing = key === 'y' || (key === 'z' && event.shiftKey)
      if (!undoing && !redoing) return
      event.stopPropagation()
      if (typingIn(event.target)) return
      event.preventDefault()
      if (event.repeat || visibleDialogCount() > 0) return
      act(() => (undoing ? history.undo() : history.redo()))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isActive, act, history])

  if (!adapter || !fileOps) return <p className="moth-quiet moth-page">Opening M.O.T.H.…</p>

  const onServerNow = pickedFiles.some((f) => f.storage_provider === 'network_share')
  const whatDeleting = pickedFiles.length === 1 ? `"${pickedFiles[0].name}"` : `${pickedFiles.length} files`

  return (
    <div className="moth-page" data-moth-page>
      <aside className="moth-side">
        {islandsFailed && (
          <Banner tone="danger">
            Could not read your projects just now.{' '}
            <Button variant="ghost" size="sm" onClick={() => setIslandsAsked((n) => n + 1)}>Try again</Button>
          </Banner>
        )}
        {islands && <MothIslands islands={islands} openId={openId} localOnly={localOnly} onOpen={openIsland} />}
        <button type="button" className={`moth-island${view === 'trash' ? ' is-open' : ''}`} onClick={() => { setOpenId(null); setView('trash') }} data-moth-trash-open>Trash</button>
      </aside>
      <section className="moth-main">
        <div className="moth-toolbar">
          <Button variant="ghost" onClick={() => act(() => history.undo())} disabled={!canUndo} data-moth-undo>Undo</Button>
          <Button variant="ghost" onClick={() => act(() => history.redo())} disabled={!canRedo} data-moth-redo>Redo</Button>
        </div>
        {error && <Banner tone="danger" data-moth-error>{error}</Banner>}
        {note && <Banner tone="info" data-moth-note>{note}</Banner>}
        {unfinishedMoves > 0 && (
          <Banner tone="info" data-moth-unfinished>
            {unfinishedMoves === 1 ? 'A move on this computer did not finish.' : `${unfinishedMoves} moves on this computer did not finish.`}
            {' '}WILSON tries again each time it starts. If a project's folder is on a drive, connect it.
          </Banner>
        )}
        {view === 'trash' && islands && <MothTrashView adapter={adapter} fileOps={fileOps} islands={islands} access={access} refreshKey={changeKey} />}
        {view === 'files' && !open && <EmptyState Icon={Files} title="Choose a project" body="Pick a project to see its files." />}
        {view === 'files' && open && (
          <>
            {open.is_mine && (
              <MothPersonalPanel island={open} gate={gate} onDesktop={onDesktop} onOfficeServer={Boolean(officeRoot)} cannotHoldFiles={onNetworkStorage && !officeRoot} onAdd={addFiles} />
            )}
            <div className="moth-toolbar">
              <input
                className="moth-search"
                type="search"
                placeholder="Search these files"
                aria-label="Search these files"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {pickedFiles.length > 0 && (
                <span className="moth-quiet" data-moth-ticked>
                  {pickedFiles.length} ticked{pickedHidden > 0 ? `, ${pickedHidden} not shown by this search` : ''}
                </span>
              )}
              <GatedAction allowed={gate.allowed} reason={gate.reason}>
                <Button onClick={() => setMoving(true)} disabled={!gate.allowed || pickedFiles.length === 0} data-moth-move>Move to…</Button>
              </GatedAction>
              <GatedAction allowed={gate.allowed} reason={gate.reason}>
                <Button variant="danger" onClick={() => setConfirming(true)} disabled={!gate.allowed || pickedFiles.length === 0} data-moth-delete>Delete</Button>
              </GatedAction>
            </div>
            {loading && <p className="moth-quiet">Looking…</p>}
            {!loading && !readFailed && shown.length === 0 && <EmptyState Icon={Files} title="Nothing here" body={search ? 'No loaded file has that name.' : 'This project has no files you can see here.'} />}
            <ul className="moth-rows" data-moth-files>
              {shown.map((file) => (
                <li key={file.id} className="moth-row">
                  <label className="moth-row-name">
                    <input type="checkbox" checked={picked.has(file.id)} onChange={() => toggle(file.id)} />
                    {' '}{file.name}
                  </label>
                </li>
              ))}
            </ul>
            {more && <Button variant="ghost" onClick={loadMore} loading={loadingMore} loadingLabel="Looking…" data-moth-more>Show more</Button>}
          </>
        )}
      </section>
      {moving && (
        <MothMoveTo adapter={adapter} islands={islands || []} files={pickedFiles} fromProject={openId} onMove={move} onClose={() => setMoving(false)} />
      )}
      {confirming && (
        <Dialog
          width="confirm"
          title={`Delete ${whatDeleting}?`}
          onClose={() => setConfirming(false)}
          busy={deleting}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" onClick={remove} loading={deleting} loadingLabel="Deleting…">Delete</Button>
            </>
          )}
        >
          <p data-moth-delete-question>
            {pickedHidden > 0 ? `${pickedHidden} of them ${pickedHidden === 1 ? 'is' : 'are'} not shown by your search. ` : ''}
            {onServerNow
              ? 'On the office server, they move to the company server\'s bin, so they leave their folders. They stay there for 30 days.'
              : localOnly
                ? 'They stay in this project\'s trash on this computer for 30 days.'
                : 'They stay in the trash for 30 days.'}
          </p>
        </Dialog>
      )}
    </div>
  )
}
