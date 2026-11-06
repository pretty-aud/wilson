// MothTrashView.jsx — MO1 (MOTH_DESIGN §1.10): what can come back, and how long for. 'Could not look' is kept
// apart from 'Nothing here': an empty list must not read as a safe one when it was never read.
import { useCallback, useEffect, useState } from 'react'
import { Banner, Button, EmptyState } from '../../../ui'
import { Trash2 } from 'lucide-react'
import GatedAction from '../../../permissions/GatedAction'

const DAY = 24 * 60 * 60 * 1000

export function daysLeft(purgesAt, now = Date.now()) {
  const left = Date.parse(purgesAt) - now
  if (!Number.isFinite(left)) return null
  return Math.max(0, Math.ceil(left / DAY))
}

// 0118's owed: a move left over a day ago, that only its own computer could say had happened. Whoever may check
// both ends can call it off, which puts the row back where the file still is.
function StaleMoves({ adapter }) {
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
      await adapter.settleNetworkShareOps([row.op_id], 'not_moved')
      load()
    } catch (err) {
      setError(err?.message || String(err))
    }
  }
  return (
    <div data-moth-stale>
      <p className="moth-quiet">These moves on the office server did not finish on the computer that started them.</p>
      {error && <Banner tone="danger">{error}</Banner>}
      <ul className="moth-rows">
        {rows.map((row) => (
          <li key={row.op_id} className="moth-row">
            <span className="moth-row-name">{row.name || row.to || row.op_id}</span>
            <Button variant="ghost" onClick={() => callOff(row)}>Call it off</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function MothTrashView({ adapter, fileOps, islands, access, refreshKey = 0 }) {
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await adapter.listTrashedFiles({ projectIds: islands.map((row) => row.id) }))
    } catch {
      setRows(null)
      setFailed(true)
    }
  }, [adapter, islands])

  useEffect(() => { load() }, [load, refreshKey])

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

  if (failed) return <Banner tone="danger" data-moth-trash-failed>Could not look in the trash just now. Try again in a moment.</Banner>
  if (rows === null) return <p className="moth-quiet">Looking…</p>
  if (rows.length === 0) {
    return (
      <>
        <StaleMoves adapter={adapter} />
        <EmptyState Icon={Trash2} title="Nothing here" body="Files you delete stay here for 30 days." />
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
    </>
  )
}
