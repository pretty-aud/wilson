// MothPage.jsx — MO1 (MOTH_DESIGN §1.10): M.O.T.H.'s page for Session 1. A lazy chunk: App.jsx reaches it only
// through lazy(import()), and nothing outside this folder imports from it (mothChunk.test.js).
//
// It reads only through the adapter's Moth methods, which have already removed money and Legal on the server, and
// each row passes mothFileHidden as a second look. So the list, the search, a selection and the trash cannot show
// them. Every control is gated by the same question as the server's, and the server asks again.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Files } from 'lucide-react'
import { Banner, Button, EmptyState } from '../../ui'
import GatedAction from '../../permissions/GatedAction'
import { usePermissions } from '../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../permissions/projectRoleMatrix'
import { useRabbit } from '../rabbit_v0.1.0/state/RabbitProvider'
import { desktopFileOps } from '../rabbit_v0.1.0/storage/desktopFileOps.js'
import { createNetworkShareCatalogue } from '../rabbit_v0.1.0/state/networkShareCatalogue.js'
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

export default function MothPage({ isActive = true }) {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const adapter = rabbit?.getAdapter?.() ?? null
  const localOnly = rabbit?.adapterMode === 'local_server'
  const onDesktop = desktopFileOps.available()

  const [islands, setIslands] = useState(null)
  const [islandsFailed, setIslandsFailed] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [view, setView] = useState('files')
  const [files, setFiles] = useState([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState('')
  const [storage, setStorage] = useState(null)
  const [changeKey, setChangeKey] = useState(0)

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
  }) : null), [adapter, catalogue, history, notify])

  // First entry: this person's space exists from here on (acceptance 1: exactly one, the same on a second
  // entry), and a database or a build without it still shows the projects.
  useEffect(() => {
    if (!adapter) return undefined
    let live = true
    setIslandsFailed(false)
    ;(async () => {
      await Promise.resolve().then(() => adapter.ensurePersonalSpace?.()).catch(() => {})
      const rows = await adapter.listMothIslands()
      if (live) setIslands(rows || [])
    })().catch(() => { if (live) { setIslands([]); setIslandsFailed(true) } })
    return () => { live = false }
  }, [adapter])

  useEffect(() => {
    if (localOnly) return undefined
    let live = true
    Promise.resolve().then(() => fetchWorkspaceStorage())
      .then((row) => { if (live) setStorage(row) })
      .catch(() => {})
    return () => { live = false }
  }, [localOnly])
  const officeRoot = storage?.mode === 'byos' && storage?.provider === 'network' && storage?.root_kind === 'unc' ? storage.root_path : null

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
    const rows = await adapter.listMothFiles(projectId, after, PAGE)
    return { rows: (rows || []).filter((row) => !mothFileHidden(row)), full: (rows || []).length === PAGE, last: rows?.[rows.length - 1]?.id ?? null }
  }, [adapter])

  const afterRef = useRef(null)
  useEffect(() => {
    if (!adapter || !openId) { setFiles([]); setMore(false); return undefined }
    let live = true
    setLoading(true)
    setError('')
    readPage(openId, null)
      .then(({ rows, full, last }) => {
        if (!live) return
        afterRef.current = last
        setFiles(rows)
        setMore(full)
      })
      .catch((err) => { if (live) setError(err?.message || String(err)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [adapter, openId, readPage, changeKey])

  const loadMore = async () => {
    try {
      const { rows, full, last } = await readPage(openId, afterRef.current)
      afterRef.current = last
      setFiles((was) => [...was, ...rows])
      setMore(full)
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  const openIsland = (id) => {
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
  const toggle = (id) => setPicked((was) => {
    const next = new Set(was)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const act = useCallback(async (fn) => {
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err?.message || String(err))
    }
  }, [])

  const remove = () => act(async () => {
    const list = pickedFiles
    await fileOps.trashFiles(list, openId)
    setPicked(new Set())
    rabbit?.showUndoToast?.(list.length === 1 ? `Deleted "${list[0].name}"` : `Deleted ${list.length} files`, () => act(() => history.undo()))
  })

  const move = async (list, from, dest, folder) => {
    await fileOps.moveFiles(list, from, dest, folder)
    setPicked(new Set())
    rabbit?.showUndoToast?.(list.length === 1 ? `Moved "${list[0].name}"` : `Moved ${list.length} files`, () => act(() => history.undo()))
  }

  const addFiles = async (island, list) => {
    if (officeRoot) {
      const accessToken = await adapter.getAccessToken()
      const folder = `_WILSON_PERSONAL/${perms.userId}`
      for (const file of list) {
        const put = await desktopFileOps.addToPersonalSpace({ root: officeRoot, folder, file, accessToken })
        await adapter.networkShareRecordAdded({
          projectId: island.id,
          root: officeRoot,
          entries: [{ n: put.name, s: String(put.sizeBytes), m: put.modifiedAt, t: file.type || undefined }],
        })
      }
    } else {
      for (const file of list) await adapter.uploadFile(island.id, {}, file, {})
    }
    setChangeKey((k) => k + 1)
    notify?.([island.id])
  }

  // Ctrl+Z and Ctrl+Y, only while on this page and not typing.
  useEffect(() => {
    if (!isActive) return undefined
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '')) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); act(() => history.undo()) }
      if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); act(() => history.redo()) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, act, history])

  if (!adapter || !fileOps) return <p className="moth-quiet moth-page">Opening M.O.T.H.…</p>

  return (
    <div className="moth-page" data-moth-page>
      <aside className="moth-side">
        {islandsFailed && <Banner tone="danger">Could not read your projects just now.</Banner>}
        {islands && <MothIslands islands={islands} openId={openId} localOnly={localOnly} onOpen={openIsland} />}
        <button type="button" className={`moth-island${view === 'trash' ? ' is-open' : ''}`} onClick={() => { setOpenId(null); setView('trash') }} data-moth-trash-open>Trash</button>
      </aside>
      <section className="moth-main">
        <div className="moth-toolbar">
          <Button variant="ghost" onClick={() => act(() => history.undo())} disabled={!canUndo} data-moth-undo>Undo</Button>
          <Button variant="ghost" onClick={() => act(() => history.redo())} disabled={!canRedo} data-moth-redo>Redo</Button>
        </div>
        {error && <Banner tone="danger" data-moth-error>{error}</Banner>}
        {view === 'trash' && islands && <MothTrashView adapter={adapter} fileOps={fileOps} islands={islands} access={access} refreshKey={changeKey} />}
        {view === 'files' && !open && <EmptyState Icon={Files} title="Choose a project" body="Pick a project to see its files." />}
        {view === 'files' && open && (
          <>
            {open.is_mine && (
              <MothPersonalPanel island={open} gate={gate} onDesktop={onDesktop} onOfficeServer={Boolean(officeRoot)} onAdd={addFiles} />
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
              <GatedAction allowed={gate.allowed} reason={gate.reason}>
                <Button onClick={() => setMoving(true)} disabled={!gate.allowed || picked.size === 0} data-moth-move>Move to…</Button>
              </GatedAction>
              <GatedAction allowed={gate.allowed} reason={gate.reason}>
                <Button variant="danger" onClick={remove} disabled={!gate.allowed || picked.size === 0} data-moth-delete>Delete</Button>
              </GatedAction>
            </div>
            {loading && <p className="moth-quiet">Looking…</p>}
            {!loading && shown.length === 0 && <EmptyState Icon={Files} title="Nothing here" body={search ? 'No loaded file has that name.' : 'This project has no files you can see here.'} />}
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
            {more && <Button variant="ghost" onClick={loadMore} data-moth-more>Show more</Button>}
          </>
        )}
      </section>
      {moving && (
        <MothMoveTo adapter={adapter} islands={islands || []} files={pickedFiles} fromProject={openId} onMove={move} onClose={() => setMoving(false)} />
      )}
    </div>
  )
}
