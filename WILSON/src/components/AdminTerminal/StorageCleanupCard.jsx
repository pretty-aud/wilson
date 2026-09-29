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
import { Trash2, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '../../cloud/auth/supabaseClient'
import Card from '../../ui/Card'
import Button from '../../ui/Button'
import Banner from '../../ui/Banner'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// 🚨 TRACK C OWNS THIS FILE'S LOGIC. C3b changes tokens and components here
// and NOTHING else — the staged `stage` gate is untouched, in place, and
// still the only path to a destructive run. W9 does not apply: this is an
// in-flow multi-step confirm, not a `window.confirm`, and the review calls it
// good interaction design. Converting it to a `Dialog` would be a behaviour
// change under C1.
//
// The third and fourth private `darkBtnClass` / `darkBtnStyle` pair (AT-02)
// leaves with this edit; every button here is the kit `Button`, and the
// destructive one takes the `danger` variant instead of a hand-written red
// that appeared in three different values across the surface.

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
    <Card title="Storage cleanup">
      <p className="at-card-desc">
        Deletes cloud file blobs whose records were purged from the 30-day
        trash, plus orphaned objects older than 24 hours and replaced-avatar
        leftovers — this workspace only.
      </p>
      <p className="at-note">
        Files still in the trash are never touched — restore keeps working
        for the full 30 days. Each run's counts land in Logs as WIL-3003
        (WIL-3004 if it fails part-way); per-blob records go to the
        disposal ledger.
      </p>

      {error && <Banner tone="danger" Icon={AlertTriangle}>{error}</Banner>}

      {stage === 'done' && counts && (
        <Banner tone="success" Icon={Check}>
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
        </Banner>
      )}

      {stage === 'confirm' ? (
        <div className="at-confirm-strip">
          <span className="at-confirm-question">
            Permanently delete unreferenced blobs?
          </span>
          <Button variant="danger" Icon={Trash2} onClick={run}>Yes, clean up</Button>
          <Button onClick={() => setStage('idle')}>Cancel</Button>
        </div>
      ) : (
        <Button
          Icon={Trash2}
          onClick={() => setStage('confirm')}
          disabled={stage === 'running'}
          loading={stage === 'running'}
          loadingLabel="Cleaning up…"
        >
          Run storage cleanup
        </Button>
      )}
    </Card>
  )
}
