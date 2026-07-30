// =============================================================================
// StorageCleanupCard — Session 14, Block E: the admin face of storage-gc.
//
// One card in Diagnostics that invokes the storage-gc Edge Function:
// drains the blob-disposal queue (rows purged by the 30-day sweep), removes
// orphaned objects older than 24h from rabbit-files, and sweeps replaced-
// avatar leftovers — always scoped to THIS workspace, never touching
// anything a live or trashed files row still references.
//
// The confirm states exactly what will happen before anything runs (the
// S13 approve-dialog pattern), and the result renders the counts the
// function certified (Peak-End). Admin-invoked by design: TPN TS-1.5 wants
// dual authorization on destruction — a stated confirm click is the second
// authorization, and every deletion lands in the disposal ledger
// (storage_gc_queue) + a WIL-3003 log line.
//
// UX laws applied (≥5): Cognitive Bias/Von Restorff (destructive action is
// isolated and needs an explicit staged confirm), Doherty (spinner +
// immediate state), Peak-End (counts summary), Jakob (Diagnostics card
// grammar), Tesler (the function absorbs tenancy/safety rules; the admin
// clicks one button).
// =============================================================================

import { useRef, useState } from 'react'
import { Trash2, Loader2, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '../../cloud/auth/supabaseClient'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const cardStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.12)',
  border: '1px solid rgba(120, 70, 30, 0.3)',
}
const darkBtnClass = 'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-50'
const darkBtnStyle = { backgroundColor: '#1c1917', color: '#f4a261' }

const ERROR_MAP = {
  unauthorized: 'Session expired — sign in again.',
  forbidden: 'Only an active workspace admin can run this.',
  mfa_required: 'This action needs a fresh MFA-verified session.',
  gc_failed: 'The cleanup run failed part-way — see Logs for WIL-3004.',
}

export default function StorageCleanupCard() {
  const [stage, setStage] = useState('idle') // idle | confirm | running | done
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  async function run() {
    setStage('running')
    setError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) throw new Error(ERROR_MAP.unauthorized)
      const res = await fetch(`${SUPABASE_URL}/functions/v1/storage-gc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: SUPABASE_ANON,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(ERROR_MAP[json.error] ?? json.detail ?? `Cleanup failed (${res.status}).`)
      if (!mountedRef.current) return
      setCounts(json.counts || null)
      setStage('done')
    } catch (err) {
      if (!mountedRef.current) return
      setError(err?.message || String(err))
      setStage('idle')
    }
  }

  return (
    <div className="p-4 rounded-sm" style={cardStyle}>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
        Storage cleanup
      </h2>
      <p className="text-xs text-stone-950 mb-1 leading-relaxed">
        Deletes cloud file blobs whose records were purged from the 30-day
        trash, plus orphaned objects older than 24 hours and replaced-avatar
        leftovers — this workspace only.
      </p>
      <p className="text-[10px] mb-4" style={{ color: '#78716c' }}>
        Files still in the trash are never touched — restore keeps working
        for the full 30 days. Each run's counts land in Logs as WIL-3003
        (WIL-3004 if it fails part-way); per-blob records go to the
        disposal ledger.
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {stage === 'done' && counts && (
        <div className="mb-3 flex items-start gap-2 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(21, 128, 61, 0.1)', color: '#15803d' }}>
          <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Removed {counts.queue_deleted + counts.orphans_deleted + counts.avatar_orphans_deleted} blob(s)
            — {counts.queue_deleted} purged-file, {counts.orphans_deleted} orphaned, {counts.avatar_orphans_deleted} avatar.
            {counts.queue_missing > 0 && <> {counts.queue_missing} already gone.</>}
            {counts.queue_failed > 0 && <> {counts.queue_failed} FAILED (see Logs).</>}
            {counts.skipped_recent > 0 && <> Skipped {counts.skipped_recent} recent object(s).</>}
            {counts.skipped_foreign_or_unknown > 0 && <> Left {counts.skipped_foreign_or_unknown} folder(s) that could not be tied to this workspace.</>}
            {counts.certify_failed > 0 && <> {counts.certify_failed} ledger write(s) FAILED — counts above are still accurate.</>}
            {counts.truncated && <> Large bucket — the scan was capped this run.</>}
          </span>
        </div>
      )}

      {stage === 'confirm' ? (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#dc2626' }}>
            Permanently delete unreferenced blobs?
          </span>
          <button type="button" onClick={run} className={darkBtnClass} style={{ backgroundColor: '#dc2626', color: '#fff' }}>
            <Trash2 className="w-3.5 h-3.5" /> Yes, clean up
          </button>
          <button type="button" onClick={() => setStage('idle')} className={darkBtnClass} style={darkBtnStyle}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setStage('confirm')}
          disabled={stage === 'running'}
          className={darkBtnClass}
          style={darkBtnStyle}
        >
          {stage === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          {stage === 'running' ? 'Cleaning up…' : 'Run storage cleanup'}
        </button>
      )}
    </div>
  )
}
