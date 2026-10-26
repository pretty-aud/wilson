// =============================================================================
// AIFileStoreCard — FX12 (post-overhaul, 2026-10-25, OUTSTANDING DG1-03): the
// workspace admin's face of what D.O.G. sent to the AI provider's file store.
//
// D.O.G. uploads PDFs, pictures and long texts to the store and references
// them by id. Since FX12 it deletes them when they leave D.O.G., when WILSON
// closes, and at sign-out, and every new upload asks the store to delete it
// by itself after a day; what is left (an upload from before, a window killed
// mid-close, an older WILSON) is what this card shows and sweeps.
//
// What it can show is decided by ai-files, not here: this workspace's files
// only, ids, times and sizes, never a filename, never another company's or
// another environment's (the one platform key's store holds all of them).
//
// Beside StorageCleanupCard and built the same way, for the same reason
// (storage-gc's precedent): admin-invoked, never a cron; the in-flow stated
// confirm is TS-1.5's second factor (its own note argues why not a Dialog);
// the counts certified by the function are shown after (Peak-End); one
// ledger row lands in Logs.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { listAIFiles, sweepAIFiles } from '../../cloud/aiFiles'
import { formatBytes } from '../../cloud/workspaceStorage'
import Card from '../../ui/Card'
import Button from '../../ui/Button'
import Banner from '../../ui/Banner'
import Stat from '../../ui/Stat'

const ERROR_MAP = {
  unauthorized: 'Session expired — sign in again.',
  forbidden: 'Only an active workspace admin can run this.',
  mfa_required: 'This needs a fresh sign-in with your authenticator code.',
  mfa_check_failed: 'Could not check your two-factor sign-in — try again in a moment.',
  sweep_failed: 'The clean-up stopped part-way — see Logs for WIL-6002.',
  list_failed: 'The AI’s file store could not be read just now — try again.',
  rate_limited: 'Too many requests at once — try again in a minute.',
  ai_not_configured: 'AI is not configured for this workspace.',
}

const messageOf = (err) => ERROR_MAP[err?.code] || err?.message || String(err)

/** "3 hours ago", "2 days ago": the oldest file's age, rounded down. */
export function ageOf(iso, nowMs = Date.now()) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return '—'
  const h = Math.max(0, Math.floor((nowMs - t) / 3600000))
  if (h < 1) return 'under an hour'
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`
  const d = Math.floor(h / 24)
  return `${d} days`
}

export default function AIFileStoreCard() {
  const [list, setList] = useState(null)       // the GET's answer
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState('idle')   // idle | confirm | running | done
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)
  const mounted = useRef(true)
  const inflight = useRef(null)

  const load = useCallback(async () => {
    inflight.current?.abort()
    const c = new AbortController()
    inflight.current = c
    setLoading(true)
    try {
      const answer = await listAIFiles({ signal: c.signal })
      if (!mounted.current || c.signal.aborted) return
      setList(answer)
      setError(null)
    } catch (err) {
      if (!mounted.current || c.signal.aborted || err?.name === 'AbortError') return
      setError(messageOf(err))
    } finally {
      if (mounted.current && inflight.current === c) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false; inflight.current?.abort() }
  }, [load])

  async function run() {
    setStage('running')
    setError(null)
    try {
      const answer = await sweepAIFiles()
      if (!mounted.current) return
      setCounts(answer.counts || null)
      if (answer.after) setList(l => ({ ...(l || {}), ...answer.after }))
      setStage('done')
    } catch (err) {
      if (!mounted.current) return
      setError(messageOf(err))
      setStage('idle')
    }
  }

  const hours = list?.older_than_hours ?? 24
  const sweepable = list?.sweepable ?? 0

  return (
    <Card title="The AI’s file store">
      <p className="at-card-desc">
        PDFs, pictures and long texts D.O.G. sent to the AI provider to read,
        still stored there for this company. D.O.G. deletes them when they
        leave the deck, when WILSON closes and at sign-out, and new ones delete
        themselves after a day.
      </p>

      {error && <Banner tone="danger" Icon={AlertTriangle}>{error}</Banner>}

      {list && (
        <div className="at-stat-row at-stat-row-spaced">
          <Stat label="Files" value={list.count ?? 0} />
          <Stat label="Total size" value={formatBytes(list.total_bytes ?? 0)} />
          <Stat label="Oldest" value={list.count ? ageOf(list.oldest) : '—'} />
          <Stat label={`Older than ${hours} h`} value={sweepable} />
        </div>
      )}
      {list?.unreachable > 0 && (
        <p className="at-note">
          {list.unreachable} file{list.unreachable === 1 ? '' : 's'} could not be checked: this
          company’s own AI key could not be read.
        </p>
      )}

      {stage === 'done' && counts && (
        <Banner tone="success" Icon={Check}>
          <span>
            Deleted {counts.deleted} file{counts.deleted === 1 ? '' : 's'}.
            {counts.gone > 0 && <> {counts.gone} {counts.gone === 1 ? 'was' : 'were'} already gone.</>}
            {counts.failed > 0 && <> {counts.failed} FAILED (see Logs, WIL-6002).</>}
            {counts.skipped_recent > 0 && <> Kept {counts.skipped_recent} younger than {hours} hours.</>}
            {counts.certify_failed > 0 && <> {counts.certify_failed} ledger write(s) FAILED — the counts above are still accurate.</>}
            {counts.truncated && <> More are waiting: run it again.</>}
          </span>
        </Banner>
      )}

      {stage === 'confirm' ? (
        <div className="at-confirm-strip">
          <span className="at-confirm-question">
            Permanently delete {sweepable} file{sweepable === 1 ? '' : 's'} older than {hours} hours?
          </span>
          <Button variant="danger" Icon={Trash2} onClick={run}>Yes, delete</Button>
          <Button onClick={() => setStage('idle')}>Cancel</Button>
        </div>
      ) : (
        <div className="at-confirm-strip">
          <Button
            Icon={Trash2}
            onClick={() => setStage('confirm')}
            disabled={stage === 'running' || loading || sweepable === 0}
            loading={stage === 'running'}
            loadingLabel="Deleting…"
          >
            Delete files older than {hours} hours
          </Button>
          <Button Icon={RefreshCw} onClick={load} disabled={loading || stage === 'running'} loading={loading} loadingLabel="Checking…">
            Check again
          </Button>
        </div>
      )}
      <p className="at-note">
        This company’s files only, never another’s. File names are never shown
        or recorded. Each deletion is recorded in Logs (WIL-6001, ai-files).
      </p>
    </Card>
  )
}
