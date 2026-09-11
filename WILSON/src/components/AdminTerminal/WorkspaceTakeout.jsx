// =============================================================================
// WorkspaceTakeout — Session 14, Block B: the full-workspace export.
//
// One CSV per table, zipped, built ENTIRELY on RLS-scoped reads through the
// admin's own supabase client — never a DEFINER sweep (locked #20
// discipline), so the archive can only ever contain what the requesting
// admin can already read. Admin-only by placement: this card lives in the
// Admin Terminal, and the takeout tier itself is admin-only (Audrey,
// 2026-07-30 — the brief's three APP tiers).
//
// DELIBERATE EXCLUSIONS, stated in the UI and in the archive's manifest:
//   - O.T.T.E.R. content (locked #20): personal courses are private even
//     from admins (0022) — a company takeout that swept them in would be
//     an admin backdoor. The per-user /api/export-all stays for one's own.
//   - Notes (S8): owner-only personal content with NO admin bypass.
//   - storage_gc_queue: service-role plumbing, not company data.
//
// UX laws applied (≥5): Goal-Gradient (per-table progress with counts),
// Doherty (immediate per-step feedback), Peak-End (green summary with the
// numbers), Cognitive Load (one button, no options), Jakob's Law (Company-
// section card grammar, verbatim), Postel (empty tables still produce a
// well-formed archive + manifest).
// =============================================================================

import { useRef, useState } from 'react'
import { Archive, Loader2, Check } from 'lucide-react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { toCsv, downloadBlob, exportDateStamp } from '../../lib/csvExport'
import { LIGHT_INK } from '../lightSurface' // §B — light page

// Every cloud table an admin's RLS lets them read, in dependency-ish order.
// otter_* and notes are EXCLUDED — see header.
const TAKEOUT_TABLES = [
  'workspaces', 'workspace_members', 'project_members',
  'projects', 'phases', 'assets', 'tasks',
  // phase_dependencies joins its sibling here (0061). A takeout that exports
  // task edges but not phase edges would look complete and quietly lose half
  // the dependency graph.
  'task_dependencies', 'phase_dependencies', 'task_links',
  'files', 'file_events', 'asset_versions', 'comments',
  'rate_cards', 'rate_card_entries',
  'ingestion_runs', 'ingestion_chunks',
  'edit_history', 'app_events',
]

const PAGE = 1000
const MAX_ROWS_PER_TABLE = 200000 // backstop; overflow is recorded in the manifest

// Deterministic pagination order per table. Most tables have an `id` pk;
// the two membership tables have composite pks and NO id column — ordering
// by 'id' there is a PostgREST 42703 that would abort the whole takeout
// (adversarial review, S14).
const ORDER_KEYS = {
  workspace_members: ['workspace_id', 'user_id'],
  project_members:   ['project_id', 'user_id'],
}

const cardStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.12)',
  border: '1px solid rgba(120, 70, 30, 0.3)',
}

export default function WorkspaceTakeout({ workspaceId, slug }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null) // { table, done, total }
  const [result, setResult] = useState(null)     // { tables, rows, truncated }
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  async function fetchAll(table) {
    const rows = []
    let truncated = false
    const orderKeys = ORDER_KEYS[table] || ['id']
    for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE) {
      let q = supabase.from(table).select('*')
      for (const k of orderKeys) q = q.order(k, { ascending: true })
      const { data, error: err } = await q.range(from, from + PAGE - 1)
      if (err) {
        // 🚨 A table this build knows about may not exist on this database
        // yet: the web app auto-deploys on every push while migrations are
        // applied BY HAND (phase_dependencies / 0061 is the current example).
        // fetchAll throwing would abort runTakeout's single try/catch, so the
        // admin would get NO archive at all — every table already paged
        // discarded, every table after it never attempted — because one table
        // was missing. Absorb exactly "relation does not exist" and record it
        // in the manifest; anything else still throws, because an RLS refusal
        // must never look like an empty table.
        if (err.code === '42P01' || err.code === 'PGRST205') {
          return { rows, truncated, missing: true }
        }
        throw new Error(`${table}: ${err.message}`)
      }
      rows.push(...(data || []))
      if (!data || data.length < PAGE) return { rows, truncated }
    }
    truncated = true // hit the backstop — say so, never pretend completeness
    return { rows, truncated }
  }

  async function runTakeout() {
    if (running) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const manifest = {
        exported_at: new Date().toISOString(),
        workspace_id: workspaceId,
        scope: 'Everything the requesting admin can read under RLS. No service-role access was used.',
        excluded: [
          'otter_* (locked #20: personal courses are private even from admins)',
          'notes (owner-only personal content, no admin bypass)',
          'storage_gc_queue (service plumbing)',
          'file blobs (metadata only — blobs live in the company storage provider)',
        ],
        tables: {},
      }
      let totalRows = 0
      const truncatedTables = []
      for (let i = 0; i < TAKEOUT_TABLES.length; i++) {
        const table = TAKEOUT_TABLES[i]
        setProgress({ table, done: i, total: TAKEOUT_TABLES.length })
        const { rows, truncated, missing } = await fetchAll(table)
        // A table that does not exist on this database is recorded rather than
        // skipped in silence — an archive that quietly omits a table looks
        // exactly like an archive of a workspace that had no such rows.
        if (missing) {
          manifest.tables[table] = {
            rows: 0,
            truncated: false,
            missing: true,
            note: 'table not present on this database — its migration has not been applied here',
          }
          continue
        }
        zip.file(`${table}.csv`, toCsv(rows))
        manifest.tables[table] = { rows: rows.length, truncated }
        totalRows += rows.length
        if (truncated) truncatedTables.push(table)
      }
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(`wilson-takeout-${slug || 'workspace'}-${exportDateStamp()}.zip`, blob)
      setResult({ tables: TAKEOUT_TABLES.length, rows: totalRows, truncated: truncatedTables })
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <div className="p-4 rounded-sm" style={cardStyle}>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
        Workspace takeout
      </h2>
      <p className="text-xs text-stone-950 mb-1 leading-relaxed">
        Download everything this workspace holds in the cloud as one CSV per
        table, zipped, with a manifest. Built from your own reads — it can
        only contain what your role can already see.
      </p>
      <p className="text-[10px] mb-4" style={{ color: LIGHT_INK }}>
        Excluded by design: O.T.T.E.R. courses (personal content is private
        even from admins) and Notes. File rows are metadata — the blobs stay
        in your storage provider.
      </p>

      {error && (
        <div className="mb-3 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="mb-3 flex items-start gap-2 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(21, 128, 61, 0.1)', color: '#15803d' }}>
          <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Exported {result.rows.toLocaleString()} rows across {result.tables} tables.
            {result.truncated.length > 0 && (
              <> Truncated at {MAX_ROWS_PER_TABLE.toLocaleString()} rows: {result.truncated.join(', ')} (see manifest.json).</>
            )}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={runTakeout}
        disabled={running || !workspaceId}
        className="at-disable-40 flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
        style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
        {running
          ? (progress ? `Exporting ${progress.table} (${progress.done + 1}/${progress.total})…` : 'Preparing…')
          : 'Download takeout (.zip)'}
      </button>
    </div>
  )
}
