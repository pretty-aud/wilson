// ============================================================
// RateCardPage — workspace-level rate card editor
// ============================================================
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │  [ General ] [ Internal ]                     Export CSV    │
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
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// Every control, both tabs, every importer and every empty-state message is
// the one that was here. What changed:
//
//  · THE TAB INK RAN BACKWARDS. `tabStyle` painted the ACTIVE tab `#7c2d12`
//    (4.54:1) and the INACTIVE one `#451a03` (about 7:1), so the tab you were
//    not on had the stronger text and the selection was carried by a fill
//    fighting its own ink (F-R22). It is the kit `Tabs` now: one ink, weight
//    600 and a 2px signal underline for the active one — which also retires
//    the `marginBottom: -2px` hack that existed to hide the tab's own bottom
//    border against a 2px header rule that is itself gone (F-R25).
//
//  · THE TITLE IS PRINTED ONCE. "Rate Card" at 14px bold uppercase tracked
//    sat 150px under the orange bar's own 20px "Rate card" (F-R06).
//
//  · FOUR EMPTY STATES BECAME ONE COMPONENT. A Lock notice, a Users block
//    with two sub-lines, a bare centred string and an italic `<td>` — and the
//    copy in them is the best on the surface, because it says WHICH of three
//    reasons applies rather than rendering a blank grid. The words are kept
//    verbatim; only the four different shells are gone (F-R13).
//
//  · THE ERROR BANNER WAS A NEAR-WHITE PINK BAND. `#fee2e2` with `#991b1b`
//    mono, on the orange page (F-R14, C9).
//
//  · THE IMPORTER CARDS DREW 2px BORDERS in a surface where everything else
//    is 1px, at 12px mono uppercase (F-R25, F-R36).
//
// The left panel keeps both jobs, both branches and every message.
// ============================================================

import { useRef, useState, useMemo } from 'react'
import { AlertCircle, Upload, Users, AlertTriangle, Lock, Download } from 'lucide-react'
import { downloadCsv, exportDateStamp } from '../../lib/csvExport'
import { useRateCard } from './useRateCard'
import { useRosterMembers } from '../TeamMembers/useRosterMembers'
import { useRateCardAccess } from './useRateCardAccess'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import RateCardTable from './RateCardTable'
import ImportPreviewModal from './importers/ImportPreviewModal'
import GoogleSheetUrlPrompt from './importers/GoogleSheetUrlPrompt'
import { importCsv } from './importers/csvImporter'
import {
  Banner, Button, EmptyState, Loading, Tabs, Toolbar,
} from '../../ui'
import { importXlsx } from './importers/xlsxImporter'
import { importPdf } from './importers/pdfImporter'
import { importGoogleSheet } from './importers/googleSheetImporter'
import '../Resources/resources.css'

const TABLE_PANEL_ID = 'rc-table-panel'

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

  // ─── Who belongs on the INTERNAL card ───
  // Audrey, 2026-08-11: "the internal fulltime members are the only ones that
  // should populate the internal rate card … for some projects a company may
  // hire freelancers, for them the external rate card uses industry standard
  // rates. the internal rate card is based on the salaries of the internal
  // team members."
  //
  // So this is not a display filter — the two cards hold different KINDS of
  // number, and a freelancer on the internal card would invite someone to
  // enter a day rate where a salary-derived wage belongs.
  const internalMembers = useMemo(
    () => (teamMembers || []).filter(m => m.is_full_time),
    [teamMembers],
  )

  // ─── Team stats for internal tab ───
  // Counts the internal population, not the whole roster: the "unrated" badge
  // exists to say "someone on this card still has no wage", and freelancers
  // are not on this card at all.
  const teamStats = useMemo(() => {
    if (!internalMembers.length) return { total: 0, rated: 0, unrated: 0 }
    const entryMemberIds = new Set(
      entries.filter(e => e.member_id && e.wage != null).map(e => e.member_id)
    )
    const rated = internalMembers.filter(m => entryMemberIds.has(m.id)).length
    return { total: internalMembers.length, rated, unrated: internalMembers.length - rated }
  }, [internalMembers, entries])

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

  function handleExport() {
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
  }

  // 🚨 The INTERNAL tab is `disabled` when its card does not exist, and that
  // is load-bearing: it used to be `onClick={() => internalCard && …}`, so
  // when the INSERT had been refused the click did NOTHING with no
  // explanation. Audrey: "when i press internal i am not seeing the internal
  // one." `disabled` plus the title makes the dead state visible before it is
  // clicked; the kit's Tabs carries both.
  const tabItems = [
    { id: 'general', label: 'General' },
    {
      id: 'internal',
      label: 'Internal',
      disabled: !internalCard,
      // F3 closed C1's kit request 2: `Tabs` items take a `title` now, so the
      // explanation is back on the tab itself. The Banner below stays — it is
      // visible before the click rather than after a hover, which is the
      // better half of the answer; this is the half a keyboard user and a
      // hover both get.
      title: internalCard ? undefined : 'No internal rate card on this workspace yet',
      //
      // entries are RLS-empty when restricted — the badge would falsely flag
      // every member as unrated
      count: !rateCardRestricted && teamStats.unrated > 0 ? teamStats.unrated : undefined,
    },
  ]

  const missingInternal = !internalCard && !rateCardRestricted && !loading

  function pickTab(id) {
    if (id === 'general' && generalCard) setActiveRateCardId(generalCard.id)
    if (id === 'internal' && internalCard) setActiveRateCardId(internalCard.id)
  }

  return (
    <div className="rs-page">
      <Toolbar
        right={(
          <>
            {(loading || teamLoading) && <Loading label="Loading" />}
            {/* Export (Session 14, Block B) — gated exactly like the page: in
                cloud mode the entries are RLS-scoped and the button only
                renders for users the 0020 matrix/grants let VIEW the card.
                No entries → no button (the empty state explains). */}
            {!rateCardRestricted && entries.length > 0 && (
              <Button size="sm" onClick={handleExport}>
                <Download aria-hidden="true" /> Export CSV
              </Button>
            )}
          </>
        )}
      >
        <Tabs
          label="Rate card"
          panelId={TABLE_PANEL_ID}
          items={tabItems}
          value={activeType}
          onChange={pickTab}
        />
      </Toolbar>

      {/* The guard matches its children exactly. A looser one rendered an
          empty 16px band on first paint — `internalCard` is undefined while
          `loading` is still true — which then vanished and shifted the table
          under the reader. */}
      {(error || importError || missingInternal) && (
        <div className="rs-body rs-body-flush">
          {(error || importError) && (
            <Banner tone="danger" Icon={AlertCircle}>{importError || error}</Banner>
          )}
          {missingInternal && (
            <Banner tone="warning" Icon={AlertTriangle}>
              The internal rate card could not be created, so the Internal tab is
              unavailable.
            </Banner>
          )}
        </div>
      )}

      {rateCardRestricted ? (
        // The tabs carry `aria-controls={TABLE_PANEL_ID}` unconditionally, so
        // the panel they name has to exist in every branch or they point at
        // nothing.
        <div className="rs-body" id={TABLE_PANEL_ID} role="tabpanel" aria-label="Rate cards are restricted">
          <EmptyState
            Icon={Lock}
            title="Rate cards are restricted"
            body="Rate cards are visible to admins and managers."
          />
        </div>
      ) : (
        <div className="rc-body" id={TABLE_PANEL_ID} role="tabpanel" aria-label={`${activeType} rate card`}>
          {/* ── Left panel ── */}
          <div className="rc-side">
            <div className="rc-side-head">{activeType === 'internal' ? 'Team' : 'Import'}</div>
            <div className="rc-side-body">
              {activeType === 'internal' ? (
                <>
                  <div className="rc-stats">
                    <div className="rc-stats-head">
                      <Users className="rs-toolbar-glyph" aria-hidden="true" />
                      Team members
                    </div>
                    <div className="rc-stat-row">
                      <span>Total</span>
                      <span className="rc-stat-value">{teamStats.total}</span>
                    </div>
                    <div className="rc-stat-row">
                      <span>With rates</span>
                      <span className="rc-stat-value" data-tone="ok">{teamStats.rated}</span>
                    </div>
                    {teamStats.unrated > 0 && (
                      <div className="rc-stat-row">
                        <span>
                          <AlertTriangle className="rs-toolbar-glyph" aria-hidden="true" data-tone="warn" />
                          {' '}Without rates
                        </span>
                        <span className="rc-stat-value" data-tone="warn">{teamStats.unrated}</span>
                      </div>
                    )}
                  </div>

                  <p className="rc-note">
                    The internal rate card is filled from the team roster. Set each
                    person's wage, burden and overhead; anyone still without a rate
                    is flagged in their row.
                  </p>

                  {/* Import for internal card (hidden on view-only grants) */}
                  {!rateReadOnly && (
                    <>
                      <div className="rc-side-eyebrow">Import rates</div>
                      <ImporterCard
                        label="CSV or XLSX"
                        note="Bulk-set member rates"
                        onClick={() => { setImportError(null); sheetInputRef.current?.click() }}
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                  {rateReadOnly ? (
                    <p className="rc-note">
                      View-only access — rate edits and imports are limited to
                      admins and edit-granted members.
                    </p>
                  ) : (
                    <>
                      <ImporterCard
                        label="CSV or XLSX"
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

                  <p className="rc-note">
                    The general rate card holds standard day rates per role, for
                    estimating before specific people are assigned. Roles are
                    grouped by department, each with a default burden and overhead.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* ── Right: table ── */}
          <div className="rc-main">
            {/* An internal card with nobody on it used to render as a blank grid
                that explained nothing — the same "silently does nothing" shape as
                the dead INTERNAL tab. There are three different reasons it can be
                empty and the user can only act on two of them, so say which. */}
            {activeRateCardId && activeType === 'internal' && internalMembers.length === 0 ? (
              teamLoading ? (
                <div className="rs-body"><Loading rows={8} columns={6} label="Loading the team roster" /></div>
              ) : (
                <EmptyState
                  Icon={Users}
                  title={teamMembers.length === 0 ? 'Nobody to rate' : 'No full-time members yet'}
                  body={teamMembers.length === 0
                    ? `The team roster is empty here, so there is nobody to rate. Roster source: ${rosterMode || 'unknown'}. If that is not “supabase” the page is reading the wrong backend.`
                    : `${teamMembers.length} on the roster, none marked full-time. Tick Full-time in Resources → Team members. The internal card is salary-based, so only staff belong on it.`}
                />
              )
            ) : activeRateCardId ? (
              <RateCardTable
                entries={entries}
                deptDefaults={deptDefaults}
                cardType={activeType}
                // Internal = salaried staff only. The general card never merges
                // the roster, so passing the full list there is inert.
                teamMembers={activeType === 'internal' ? internalMembers : teamMembers}
                loading={loading}
                addEntry={addEntry}
                updateEntry={updateEntry}
                deleteEntry={deleteEntry}
                updateDeptDefault={rateReadOnly ? undefined : updateDeptDefault}
                makeSlug={makeSlug}
                readOnly={rateReadOnly}
              />
            ) : loading ? (
              <div className="rs-body"><Loading rows={8} columns={6} label="Loading rate cards" /></div>
            ) : (
              <EmptyState
                Icon={AlertCircle}
                title="No rate card available"
                body="This workspace has no rate card yet."
              />
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
// One hairline instead of a 2px `#f4a261` frame, and a sentence-case H3 label
// instead of 12px mono uppercase tracked (F-R25, F-R36). Unused `disabled`
// prop kept: the internal branch passes none, the general branch may.
function ImporterCard({ label, note, onClick, disabled }) {
  return (
    <button
      type="button"
      className="rc-importer"
      onClick={onClick}
      disabled={disabled}
    >
      <Upload aria-hidden="true" />
      <span>
        <span className="rc-importer-label">{label}</span>
        <span className="rc-importer-note">{note}</span>
      </span>
    </button>
  )
}
