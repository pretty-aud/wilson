// MothTrashView.jsx — MO1 (MOTH_DESIGN §1.10): what can come back, and how long for. 'Could not look' is kept
// apart from 'Nothing here': an empty list must not read as a safe one when it was never read.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banner, Button, EmptyState } from '../../../ui'
import { Trash2 } from 'lucide-react'
import GatedAction from '../../../permissions/GatedAction'
import { createNetworkShareCatalogue } from '../../rabbit_v0.1.0/state/networkShareCatalogue.js'
import { desktopFileOps } from '../../rabbit_v0.1.0/storage/desktopFileOps.js'

const DAY = 24 * 60 * 60 * 1000
// The server's page runs on to the end of a batch deleted together, so a page this long may have more behind it.
const PAGE = 200

export function daysLeft(purgesAt, now = Date.now()) {
  const left = Date.parse(purgesAt) - now
  if (!Number.isFinite(left)) return null
  return Math.max(0, Math.ceil(left / DAY))
}

export const CHECK_FIRST_SENTENCE = 'WILSON cannot look on the office server from a browser. Check the file is still in the first place shown before you call a move off.'

// 0118's owed: a move left over a day ago, that only its own computer could say had happened. Whoever may check
// both ends can call it off, which puts the row back at the start. The desktop looks first, and a browser asks.
function StaleMoves({ adapter }) {
  const catalogue = useMemo(() => createNetworkShareCatalogue({ adapter }), [adapter])
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const load = useCallback(() => {
    if (typeof adapter.networkShareStaleMoves !== 'function') return
    Promise.resolve(adapter.networkShareStaleMoves()).then((list) => setRows(list || [])).catch(() => setRows([]))
  }, [adapter])
  useEffect(() => { load() }, [load])
  if (rows.length === 0) return null
  const callOff = async (row) => {
    setError('')
    try {
      await catalogue.callOff(row)
      load()
    } catch (err) {
      setError(err?.message || String(err))
    }
  }
  return (
    <div data-moth-stale>
      <p className="moth-quiet">These moves on the office server did not finish on the computer that started them.</p>
      {!desktopFileOps.available() && <p className="moth-quiet" data-moth-check-first>{CHECK_FIRST_SENTENCE}</p>}
      {error && <Banner tone="danger">{error}</Banner>}
      <ul className="moth-rows">
        {rows.map((row) => (
          <li key={row.op_id} className="moth-row">
            <span className="moth-row-name">{row.name || row.to || row.op_id}</span>
            {!desktopFileOps.available() && row.from && <span className="moth-quiet">{row.from} to {row.to}</span>}
            <Button variant="ghost" onClick={() => callOff(row)}>Call it off</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// MO4 (0131): the server's one refusal for a folder that is gone or not the caller's to change, in words.
export function folderWords(err) {
  const m = String(err?.message ?? '')
  if (err?.code === '42501' && (!m || /not found|not writable/i.test(m))) {
    return 'This cannot come back: it may have gone for good, or you may not change its project.'
  }
  return m || 'It could not be brought back just now.'
}
export const FOLDERS_FAILED_SENTENCE = 'Could not look for deleted folders and boards just now.'

// MO4 (0131): the folders and boards in the trash, each batch by the folder it went from, with Bring back. Asked
// apart from the files, so one that cannot be read does not hide the other; on this computer alone there are none.
function TrashedFolders({ adapter, islands, access, refreshKey, onRestored, onLoaded, reloadFiles }) {
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [more, setMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const page = await adapter.listTrashedFolders({ limit: PAGE })
      const list = Array.isArray(page) ? page : []
      setRows(list)
      setMore(list.length >= PAGE)
      onLoaded?.(list.length)
    } catch (err) {
      // A database without folder trash yet has none to show.
      if (err?.code === 'boards_absent' || err?.code === 'moth_absent') { setRows([]); onLoaded?.(0); return }
      setRows(null)
      setFailed(true)
      onLoaded?.(null)
    }
    // onLoaded is the parent's setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter])
  useEffect(() => { load() }, [load, refreshKey])

  const showOlder = async () => {
    if (loadingOlder || !rows?.length) return
    setLoadingOlder(true)
    setError('')
    try {
      const last = rows[rows.length - 1]
      const page = await adapter.listTrashedFolders({ limit: PAGE, before: last.deleted_at ?? null, beforeId: last.id ?? null })
      const known = new Set(rows.map((row) => row.id))
      const fresh = (Array.isArray(page) ? page : []).filter((row) => !known.has(row.id))
      setRows([...rows, ...fresh])
      setMore(fresh.length > 0 && page.length >= PAGE)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoadingOlder(false)
    }
  }

  const bringBack = async (row) => {
    setBusy(row.id)
    setError('')
    try {
      await adapter.restoreFolders([row.id])
      await Promise.all([load(), reloadFiles?.()])
      onRestored?.([row.project_id])
    } catch (err) {
      setError(folderWords(err))
    } finally {
      setBusy(null)
    }
  }

  if (failed) {
    return (
      <Banner tone="danger" data-moth-trash-folders-failed>
        {FOLDERS_FAILED_SENTENCE}{' '}
        <Button variant="ghost" size="sm" onClick={load}>Try again</Button>
      </Banner>
    )
  }
  if (rows === null) return <p className="moth-quiet">Looking for folders and boards…</p>
  if (rows.length === 0) return null
  return (
    <section className="moth-trash-folders" aria-label="Folders and boards" data-moth-trash-folders>
      <p className="moth-label">Folders and boards</p>
      {error && <Banner tone="danger" data-moth-trash-folder-error>{error}</Banner>}
      <ul className="moth-rows">
        {rows.map((row) => {
          const island = islands.find((i) => i.id === row.project_id)
          const gate = island ? access(island) : { allowed: true, reason: null }
          const allowed = gate.allowed && row.can_restore !== false
          const days = daysLeft(row.purges_at)
          const files = Number(row.files) || 0
          const what = [
            row.project_title || island?.title || '',
            files === 1 ? 'with 1 file' : files > 1 ? `with ${files} files` : '',
            row.deleted_by_label ? `deleted by ${row.deleted_by_label}` : '',
            days === null ? '' : `goes in ${days} ${days === 1 ? 'day' : 'days'}`,
          ].filter(Boolean).join(' · ')
          return (
            <li key={row.id} className="moth-row" data-moth-trash-folder={row.is_board ? 'board' : 'folder'}>
              <span className="moth-row-name"><span className="moth-quiet">{row.is_board ? 'Board' : 'Folder'}</span> {row.name || '(no name)'}</span>
              <span className="moth-quiet">{what}</span>
              <GatedAction allowed={allowed} reason={gate.reason || (row.can_restore === false ? 'You may not change this project, so this cannot come back.' : null)}>
                <Button variant="ghost" onClick={() => bringBack(row)} loading={busy === row.id} loadingLabel="Bringing back…" disabled={!allowed}>
                  Bring back
                </Button>
              </GatedAction>
            </li>
          )
        })}
      </ul>
      {more && <Button variant="ghost" onClick={showOlder} loading={loadingOlder} loadingLabel="Looking…" data-moth-trash-folders-older>Show older folders</Button>}
    </section>
  )
}

export default function MothTrashView({ adapter, fileOps, islands, access, refreshKey = 0, localOnly = false, onRestored }) {
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [more, setMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // MO4: how many folders and boards the trash holds (null: not known, or could not look). Boards need the cloud.
  const foldersOffered = !localOnly && typeof adapter.listTrashedFolders === 'function'
  const [folderCount, setFolderCount] = useState(null)

  const load = useCallback(async () => {
    setFailed(false)
    // This computer's trash has no server to empty it. What is past its 30 days goes when the trash opens
    // (§1.14), for someone who works here and never opens the project in R.A.B.B.I.T.
    if (typeof adapter.purgeExpiredTrash === 'function') {
      await Promise.all(islands.map((row) => Promise.resolve().then(() => adapter.purgeExpiredTrash(row.id)).catch(() => null)))
    }
    try {
      const page = await adapter.listTrashedFiles({ projectIds: islands.map((row) => row.id), limit: PAGE })
      setRows(page)
      setMore(page.length >= PAGE)
    } catch {
      setRows(null)
      setFailed(true)
    }
  }, [adapter, islands])

  useEffect(() => { load() }, [load, refreshKey])

  // Older than the last row shown. An adapter with no paging (this computer's) answers what it answered, and
  // nothing new is the end.
  const showOlder = async () => {
    if (loadingOlder) return
    setLoadingOlder(true)
    setError('')
    try {
      const page = await adapter.listTrashedFiles({ projectIds: islands.map((row) => row.id), limit: PAGE, before: rows[rows.length - 1]?.deleted_at ?? null })
      const known = new Set(rows.map((row) => row.id))
      const fresh = page.filter((row) => !known.has(row.id))
      setRows([...rows, ...fresh])
      setMore(fresh.length > 0 && page.length >= PAGE)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoadingOlder(false)
    }
  }

  const restore = async (row) => {
    setBusy(row.id)
    setError('')
    try {
      await fileOps.restoreFiles([row], row.project_id)
      await load()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  const folders = foldersOffered ? (
    <TrashedFolders adapter={adapter} islands={islands} access={access} refreshKey={refreshKey}
      onRestored={onRestored} onLoaded={setFolderCount} reloadFiles={load} />
  ) : null

  if (failed) {
    return (
      <>
        <Banner tone="danger" data-moth-trash-failed>
          Could not look in the trash just now.{' '}
          <Button variant="ghost" size="sm" onClick={load}>Try again</Button>
        </Banner>
        {folders}
      </>
    )
  }
  if (rows === null) return <><p className="moth-quiet">Looking…</p>{folders}</>
  if (rows.length === 0) {
    return (
      <>
        <StaleMoves adapter={adapter} />
        {(!foldersOffered || folderCount === 0) && (
          <EmptyState Icon={Trash2} title="Nothing here"
            body={foldersOffered ? 'Files, folders and boards you delete stay here for 30 days.' : 'Files you delete stay here for 30 days.'} />
        )}
        {folders}
      </>
    )
  }

  return (
    <>
      <StaleMoves adapter={adapter} />
      {error && <Banner tone="danger">{error}</Banner>}
      <ul className="moth-rows" data-moth-trash>
        {rows.map((row) => {
          const island = islands.find((i) => i.id === row.project_id)
          const gate = access(island)
          const days = daysLeft(row.purges_at)
          return (
            <li key={row.id} className="moth-row">
              <span className="moth-row-name">{row.name}</span>
              <span className="moth-quiet">
                {row.project_title || island?.title || ''}
                {days === null ? '' : ` · goes in ${days} ${days === 1 ? 'day' : 'days'}`}
              </span>
              <GatedAction allowed={gate.allowed && row.can_restore !== false} reason={gate.reason}>
                <Button
                  variant="ghost"
                  onClick={() => restore(row)}
                  loading={busy === row.id}
                  loadingLabel="Restoring…"
                  disabled={!gate.allowed || row.can_restore === false}
                >
                  Restore
                </Button>
              </GatedAction>
            </li>
          )
        })}
      </ul>
      {more && <Button variant="ghost" onClick={showOlder} loading={loadingOlder} loadingLabel="Looking…" data-moth-trash-older>Show older</Button>}
      {folders}
    </>
  )
}
