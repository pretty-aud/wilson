// ============================================================
// RateCardPage — workspace-level rate card editor
// ============================================================
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │  $ Rate Card   [ General ] [ Internal ]          Loading    │
//   ├─────────────────────────────────────────────────────────────┤
//   │  Error banner (if any)                                      │
//   ├─────────────┬───────────────────────────────────────────────┤
//   │  Import     │                                               │
//   │  (or Team   │  RateCardTable                                │
//   │   stats on  │  (grouped by department)                      │
//   │   Internal) │                                               │
//   └─────────────┴───────────────────────────────────────────────┘
//
// Two tabs:
//   General  — company standard day rates per role (importable)
//   Internal — per-team-member rates, auto-populated from team DB
//
// Both tabs share the same underlying RateCardTable component.
// The table adapts its columns and behavior based on cardType.

import { useRef, useState, useMemo } from 'react'
import { DollarSign, Upload, AlertCircle, Loader2, Users, AlertTriangle, Lock, Download } from 'lucide-react'
import { downloadCsv, exportDateStamp } from '../../lib/csvExport'
import { useRateCard } from './useRateCard'
import { useRosterMembers } from '../TeamMembers/useRosterMembers'
import { useRateCardAccess } from './useRateCardAccess'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import RateCardTable from './RateCardTable'
import ImportPreviewModal from './importers/ImportPreviewModal'
import GoogleSheetUrlPrompt from './importers/GoogleSheetUrlPrompt'
import { importCsv } from './importers/csvImporter'
import { LIGHT_INK, LIGHT_RULE, LIGHT_WELL } from '../lightSurface'
import { importXlsx } from './importers/xlsxImporter'
import { importPdf } from './importers/pdfImporter'
import { importGoogleSheet } from './importers/googleSheetImporter'

export default function RateCardPage() {
  const {
    rateCards,
    activeRateCardId,
    setActiveRateCardId,
    entries,
    deptDefaults,
    loading,
    error,
    addEntry,
    updateEntry,
    deleteEntry,
    updateDeptDefault,
    bulkUpsertEntries,
    makeSlug,
  } = useRateCard()

  // Session 6 identity seam: the roster hook resolves members per adapter
  // mode — in cloud mode ids are auth user_ids, so internal-card entries
  // written by the Team Members page (member_id = user_id) resolve here
  // instead of orphaning.
  const { members: teamMembers, mode: rosterMode, loading: teamLoading } = useRosterMembers()
  const rabbit = useRabbit()

  // 0020 matrix parity: role matrix OR per-user grants (view/edit), live off
  // the workspace channel. Show a notice instead of letting the RLS-empty
  // table masquerade as "no data"; a view-only grant renders read-only.
  const access = useRateCardAccess(rabbit?.subscribeWorkspaceEvents)
  const rateCardRestricted = rosterMode === 'supabase' && access.ready && !access.canView
  const rateReadOnly = rosterMode === 'supabase' && access.ready && !access.canEdit

  // ─── Derive active card type ───
  const generalCard = rateCards.find(c => c.type === 'general') || null
  const internalCard = rateCards.find(c => c.type === 'internal') || null
  const activeCard = rateCards.find(c => c.id === activeRateCardId) || null
  const activeType = activeCard?.type || 'general'

  // ─── Team stats for internal tab ───
  const teamStats = useMemo(() => {
    if (!teamMembers?.length) return { total: 0, rated: 0, unrated: 0 }
    const entryMemberIds = new Set(
      entries.filter(e => e.member_id && e.wage != null).map(e => e.member_id)
    )
    const rated = teamMembers.filter(m => entryMemberIds.has(m.id)).length
    return { total: teamMembers.length, rated, unrated: teamMembers.length - rated }
  }, [teamMembers, entries])

  // ─── Importer state ───
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSource, setPreviewSource] = useState(null)
  const [previewFileName, setPreviewFileName] = useState('')
  const [previewResult, setPreviewResult] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState(null)

  const sheetInputRef = useRef(null)
  const pdfInputRef = useRef(null)
  const [gSheetPromptOpen, setGSheetPromptOpen] = useState(false)
  const [gSheetFetching, setGSheetFetching] = useState(false)

  // ─── Importer handlers ───
  async function handleGoogleSheetSubmit(url) {
    setGSheetFetching(true)
    try {
      const result = await importGoogleSheet(url)
      setPreviewSource('Google Sheet')
      setPreviewFileName(url)
      setPreviewResult(result)
      setGSheetPromptOpen(false)
      setPreviewOpen(true)
    } catch (err) {
      setImportError(err.message || String(err))
    } finally {
      setGSheetFetching(false)
    }
  }

  async function handleSheetSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const lower = file.name.toLowerCase()
    try {
      let result, source
      if (lower.endsWith('.csv')) {
        result = await importCsv(file)
        source = 'CSV'
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        result = await importXlsx(file)
        source = 'XLSX'
      } else {
        setImportError(`Unsupported file type: ${file.name}`)
        return
      }
      setPreviewSource(source)
      setPreviewFileName(file.name)
      setPreviewResult(result)
      setPreviewOpen(true)
    } catch (err) {
      setImportError(err.message || String(err))
    }
  }

  async function handlePdfSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setImportError(`Expected a .pdf file, got: ${file.name}`)
      return
    }
    try {
      const result = await importPdf(file)
      setPreviewSource('PDF')
      setPreviewFileName(file.name)
      setPreviewResult(result)
      setPreviewOpen(true)
    } catch (err) {
      setImportError(err.message || String(err))
    }
  }

  async function handleConfirmImport(rows) {
    setImportBusy(true)
    try {
      await bulkUpsertEntries(rows)
      setPreviewOpen(false)
      setPreviewResult(null)
    } catch (err) {
      setImportError(err.message || String(err))
    } finally {
      setImportBusy(false)
    }
  }

  function closePreview() {
    if (importBusy) return
    setPreviewOpen(false)
    setPreviewResult(null)
  }

  // ─── Tab style helper ───
  function tabStyle(type) {
    const isActive = activeType === type
    return {
      // Selected tab is the warm well, not a white pill. Unselected is bare
      // page — the selection reads by fill + rule, not by a lighter ink.
      backgroundColor: isActive ? LIGHT_WELL : 'transparent',
      color: isActive ? '#7c2d12' : '#451a03',
      border: isActive ? '1px solid #7c2d12' : '1px solid transparent',
      borderBottom: isActive ? `1px solid ${LIGHT_WELL}` : '1px solid transparent',
      marginBottom: '-2px',
    }
  }

  return (
    // Was #fef3e8 — a near-white sheet over the whole orange page. The page IS
    // the surface; panels group with wells and rules, not with a card.
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: 'transparent' }}>
      {/* ── Page header with tabs ── */}
      <div
        className="flex items-center justify-between px-6 py-3"
        style={{ borderBottom: '2px solid #7c2d12', backgroundColor: '#f4a261' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" style={{ color: '#1c1917' }} />
            <span
              className="font-bold text-sm tracking-widest uppercase"
              style={{ color: '#1c1917' }}
            >
              Rate Card
            </span>
          </div>

          {/* ── General | Internal tabs ── */}
          <div className="flex items-center gap-1 ml-2">
            <button
              type="button"
              onClick={() => generalCard && setActiveRateCardId(generalCard.id)}
              className="px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider rounded-t-sm transition-colors"
              style={tabStyle('general')}
            >
              General
            </button>
            {/* 🚨 This was `onClick={() => internalCard && setActive…}` — when
                the internal card does not exist the click did NOTHING, with no
                explanation. Audrey: "when i press internal i am not seeing the
                internal one." The card is missing because its INSERT was
                refused (see the softError banner above), so the honest
                behaviour is to say so, not to swallow the click. `disabled`
                also makes the dead state visible before it is clicked. */}
            <button
              type="button"
              disabled={!internalCard}
              title={internalCard ? undefined : 'The internal rate card could not be created — see the error above.'}
              onClick={() => { if (internalCard) setActiveRateCardId(internalCard.id) }}
              className="px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider rounded-t-sm transition-colors flex items-center gap-1.5"
              style={{ ...tabStyle('internal'), cursor: internalCard ? 'pointer' : 'not-allowed', opacity: internalCard ? 1 : 0.55 }}
            >
              Internal
              {/* entries are RLS-empty when restricted — the badge would
                  falsely flag every member as unrated */}
              {!rateCardRestricted && teamStats.unrated > 0 && (
                <span
                  className="px-1.5 py-0.5 text-[9px] rounded-full font-bold"
                  style={{ backgroundColor: '#fbbf24', color: '#7c2d12' }}
                >
                  {teamStats.unrated}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(loading || teamLoading) && (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#7c2d12' }} />
          )}
          {/* Export (Session 14, Block B) — gated exactly like the page:
              in cloud mode the entries themselves are RLS-scoped, and the
              button only renders for users the 0020 matrix/grants let VIEW
              the card. No entries → no button (the empty state explains). */}
          {!rateCardRestricted && entries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const memberName = (id) => {
                  const m = (teamMembers || []).find(tm => tm.id === id)
                  return m ? (m.display_name || m.name || m.username || '') : ''
                }
                const cols = [
                  { key: 'role_label', header: 'Role' },
                  { key: 'role_slug',  header: 'Slug' },
                  { key: 'department', header: 'Department' },
                  { key: 'wage',       header: 'Wage', map: (e) => e.wage ?? e.day_rate ?? '' },
                ]
                if (activeType === 'internal') {
                  cols.unshift({ key: 'member', header: 'Member', map: (e) => memberName(e.member_id) })
                }
                downloadCsv(`rate-card-${activeType}-${exportDateStamp()}.csv`, entries, cols)
              }}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider rounded-sm transition-colors hover:brightness-110"
              style={{ backgroundColor: LIGHT_INK, color: '#ffffff' }}
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {(error || importError) && (
        <div
          className="flex items-start gap-2 px-6 py-2"
          style={{ backgroundColor: '#fee2e2', borderBottom: '1px solid #991b1b' }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#991b1b' }} />
          <span className="text-xs font-mono" style={{ color: '#991b1b' }}>
            {importError || error}
          </span>
        </div>
      )}

      {/* ── Two-column body (or the permission notice) ── */}
      {rateCardRestricted ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Lock className="w-6 h-6" style={{ color: '#f4a261' }} />
          <span className="text-xs font-mono" style={{ color: '#7c2d12' }}>
            Rate cards are visible to admins and managers.
          </span>
        </div>
      ) : (
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left panel ── */}
        <div
          className="flex flex-col w-72 flex-shrink-0"
          style={{ borderRight: `1px solid ${LIGHT_RULE}`, backgroundColor: LIGHT_WELL }}
        >
          <div
            className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest"
            style={{ color: '#7c2d12', borderBottom: '1px solid #f4a261' }}
          >
            {activeType === 'internal' ? 'Team' : 'Import'}
          </div>

          <div className="flex-1 p-4 space-y-3 overflow-auto">
            {activeType === 'internal' ? (
              <>
                {/* ── Team stats panel ── */}
                <div
                  className="p-3 rounded-sm"
                  style={{ backgroundColor: 'transparent', border: `1px solid ${LIGHT_RULE}` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4" style={{ color: '#7c2d12' }} />
                    <span className="text-xs font-mono font-bold uppercase" style={{ color: '#7c2d12' }}>
                      Team Members
                    </span>
                  </div>
                  <div className="space-y-1 text-[11px] font-mono" style={{ color: '#7c2d12' }}>
                    <div className="flex justify-between">
                      <span>Total</span>
                      <span className="font-bold">{teamStats.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>With rates</span>
                      <span className="font-bold" style={{ color: '#166534' }}>{teamStats.rated}</span>
                    </div>
                    {teamStats.unrated > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" style={{ color: '#d97706' }} />
                          Without rates
                        </span>
                        <span className="font-bold" style={{ color: '#d97706' }}>{teamStats.unrated}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="p-3 rounded-sm text-[11px] font-mono leading-relaxed"
                  style={{ backgroundColor: 'transparent', border: `1px dashed ${LIGHT_INK}`, color: LIGHT_INK }}
                >
                  Internal rate card is auto-populated from team
                  members. Set individual wage, burden, and overhead
                  per person. Members without rates are highlighted
                  with a warning indicator.
                </div>

                {/* Import for internal card (hidden on view-only grants) */}
                {!rateReadOnly && (
                  <div className="pt-2 border-t" style={{ borderColor: '#f4a261' }}>
                    <div
                      className="text-[10px] font-mono uppercase tracking-widest mb-2"
                      style={{ color: '#7c2d12' }}
                    >
                      Import rates
                    </div>
                    <ImporterCard
                      label="CSV / XLSX"
                      note="Bulk-set member rates"
                      onClick={() => { setImportError(null); sheetInputRef.current?.click() }}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                {/* ── Import options for general card (hidden on view-only) ── */}
                {rateReadOnly ? (
                  <div
                    className="p-3 rounded-sm text-[11px] font-mono leading-relaxed"
                    style={{ backgroundColor: 'transparent', border: `1px dashed ${LIGHT_INK}`, color: LIGHT_INK }}
                  >
                    View-only access — rate edits and imports are
                    limited to admins and edit-granted members.
                  </div>
                ) : (
                <>
                <ImporterCard
                  label="CSV / XLSX"
                  note="Click to pick a spreadsheet"
                  onClick={() => { setImportError(null); sheetInputRef.current?.click() }}
                />
                <ImporterCard
                  label="PDF"
                  note="Heuristic text extraction"
                  onClick={() => { setImportError(null); pdfInputRef.current?.click() }}
                />
                <ImporterCard
                  label="Google Sheet"
                  note="Paste a public sheet URL"
                  onClick={() => { setImportError(null); setGSheetPromptOpen(true) }}
                />
                </>
                )}

                <div
                  className="mt-4 p-3 rounded-sm text-[11px] font-mono leading-relaxed"
                  style={{ backgroundColor: 'transparent', border: `1px dashed ${LIGHT_INK}`, color: LIGHT_INK }}
                >
                  General rate card defines standard day rates
                  per role. Used for estimating before specific
                  people are assigned. Roles are grouped by
                  department with default burden &amp; overhead.
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Right: table ── */}
        <div className="flex-1 overflow-hidden">
          {activeRateCardId ? (
            <RateCardTable
              entries={entries}
              deptDefaults={deptDefaults}
              cardType={activeType}
              teamMembers={teamMembers}
              loading={loading}
              addEntry={addEntry}
              updateEntry={updateEntry}
              deleteEntry={deleteEntry}
              updateDeptDefault={rateReadOnly ? undefined : updateDeptDefault}
              makeSlug={makeSlug}
              readOnly={rateReadOnly}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <span className="text-xs font-mono" style={{ color: '#7c2d12' }}>
                {loading ? 'Loading rate cards...' : 'No rate card available.'}
              </span>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Hidden file inputs ── */}
      <input
        ref={sheetInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={handleSheetSelected}
        style={{ display: 'none' }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handlePdfSelected}
        style={{ display: 'none' }}
      />

      {/* ── Import preview modal ── */}
      <ImportPreviewModal
        open={previewOpen}
        source={previewSource}
        fileName={previewFileName}
        result={previewResult}
        busy={importBusy}
        onClose={closePreview}
        onConfirm={handleConfirmImport}
      />

      {/* ── Google Sheet URL prompt ── */}
      <GoogleSheetUrlPrompt
        open={gSheetPromptOpen}
        busy={gSheetFetching}
        onClose={() => !gSheetFetching && setGSheetPromptOpen(false)}
        onSubmit={handleGoogleSheetSubmit}
      />
    </div>
  )
}

// ─── Importer card ───
function ImporterCard({ label, note, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-start gap-2 p-3 rounded-sm text-left transition-colors disabled:cursor-not-allowed hover:bg-orange-100"
      style={{
        backgroundColor: 'transparent',
        border: '2px solid #f4a261',
        color: '#7c2d12',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Upload className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-xs font-mono font-bold uppercase tracking-wider">{label}</div>
        <div className="text-[10px] font-mono mt-0.5">{note}</div>
      </div>
    </button>
  )
}
