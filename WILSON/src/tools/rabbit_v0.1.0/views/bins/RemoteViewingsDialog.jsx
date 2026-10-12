// ============================================================
// RABBIT — Bins: one clip's viewings from outside the office (GW3, item 5)
// ============================================================
//
// Opened from the inspector's one line ("Viewed from outside 3 times, last
// by Priya on 9 Oct"; GW1 built the line) for a workspace admin: the SAME
// table as App settings, Storage, File gateway, filtered to the clip, a page
// of twenty-five at a time, newest first. Behind `can` and the role in
// BinsView (the line is only handed to an admin), and behind the policy in
// the database (file_events_select answers a live admin and nobody else).

import { useEffect, useState } from 'react'
import { C, Btn, Modal, Loading } from './binUi'
import RemoteViewingsTable from '../../../../components/settings/RemoteViewingsTable'
import { VIEWED_EMPTY } from '../../../../components/settings/gatewayWords'

const PAGE_SIZE = 25

export default function RemoteViewingsDialog({ row, list, onClose }) {
  const [page, setPage] = useState(0)
  const [state, setState] = useState({ rows: null, total: 0, error: null })
  const id = row?.id ?? null
  useEffect(() => {
    let live = true
    setState({ rows: null, total: 0, error: null })
    if (!id || typeof list !== 'function') { setState({ rows: [], total: 0, error: null }); return undefined }
    Promise.resolve(list(id, { page, pageSize: PAGE_SIZE })).then((res) => {
      if (!live) return
      if (!res?.ok) { setState({ rows: [], total: 0, error: res?.friendly || 'The viewings could not be read.' }); return }
      setState({ rows: res.data?.rows || [], total: res.data?.total || 0, error: null })
    }).catch((e) => { if (live) setState({ rows: [], total: 0, error: String(e?.message || e) }) })
    return () => { live = false }
  }, [id, page, list])
  if (!row) return null
  const from = page * PAGE_SIZE
  const name = row.display_name || row.original_name || 'this clip'
  return (
    <Modal title={`Viewed from outside the office: ${name}`} width="workbench" onClose={onClose}
      footer={<>
        {state.total > PAGE_SIZE && (
          <span className="text-caption mr-auto" style={{ color: C.dim }}>{from + 1}–{Math.min(from + PAGE_SIZE, state.total)} of {state.total}</span>
        )}
        {state.total > PAGE_SIZE && <Btn small onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Newer</Btn>}
        {state.total > PAGE_SIZE && <Btn small onClick={() => setPage(p => p + 1)} disabled={from + PAGE_SIZE >= state.total}>Older</Btn>}
        <Btn small onClick={onClose}>Close</Btn>
      </>}>
      <div data-testid="clip-remote-viewings" className="min-w-0">
        <p className="text-dense mb-2" style={{ color: C.dim }}>Every viewing of this clip through the outside door in the last 30 days, newest first: who, when, how much, and from where. Office viewing is not written down.</p>
        {state.error && <p className="text-dense" style={{ color: C.red }} role="alert">{state.error}</p>}
        {!state.error && state.rows === null && <Loading label="reading the viewings" />}
        {!state.error && state.rows && state.rows.length === 0 && <p className="text-dense" style={{ color: C.dimmer }}>{VIEWED_EMPTY}</p>}
        {/* The Settings table on this DARK ground: it takes the dark ground's ink (settings.css, GW3 item 5). */}
        {!state.error && state.rows && state.rows.length > 0 && <RemoteViewingsTable rows={state.rows} testId="clip-viewings-table" surface="dark" />}
      </div>
    </Modal>
  )
}
