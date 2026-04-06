// ============================================================
// RateCardPage — workspace-level rate card editor
// ============================================================
//
// Two-column shell:
//
//   ┌──────────────────────┬──────────────────────────────────┐
//   │ Importer (left)      │ Editable entries table (right)   │
//   │  • CSV/XLSX (C3)     │                                  │
//   │  • PDF heuristic(C4) │  ← RateCardTable                 │
//   │  • Google Sheets(C5) │                                  │
//   └──────────────────────┴──────────────────────────────────┘
//
// The Rate Card is workspace-scoped, not project-scoped, so this
// page consumes a dedicated `useRateCard()` hook that talks to
// the active adapter directly. Commit 1 ships the shell + table.
// Commit 3 wires the CSV/XLSX importer; PDF and Google Sheets
// land in Commits 4 and 5.

import { useRef, useState } from 'react'
import { DollarSign, Upload, AlertCircle, Loader2 } from 'lucide-react'
import { useRateCard } from './useRateCard'
import RateCardTable from './RateCardTable'
import ImportPreviewModal from './importers/ImportPreviewModal'
import GoogleSheetUrlPrompt from './importers/GoogleSheetUrlPrompt'
import { importCsv } from './importers/csvImporter'
import { importXlsx } from './importers/xlsxImporter'
import { importPdf } from './importers/pdfImporter'
import { importGoogleSheet } from './importers/googleSheetImporter'

export default function RateCardPage() {
  const {
    rateCards,
    activeRateCardId,
    setActiveRateCardId,
    entries,
    loading,
    error,
    addEntry,
    updateEntry,
    deleteEntry,
    bulkUpsertEntries,
    makeSlug,
  } = useRateCard()

  const activeCard = rateCards.find(c => c.id === activeRateCardId) || null

  // ─── Importer state ───
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSource, setPreviewSource] = useState(null)   // 'CSV' | 'XLSX' | …
  const [previewFileName, setPreviewFileName] = useState('')
  const [previewResult, setPreviewResult] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState(null)

  const sheetInputRef = useRef(null)
  const pdfInputRef = useRef(null)
  const [gSheetPromptOpen, setGSheetPromptOpen] = useState(false)
  const [gSheetFetching, setGSheetFetching] = useState(false)

  function openSheetPicker() {
    setImportError(null)
    sheetInputRef.current?.click()
  }

  function openPdfPicker() {
    setImportError(null)
    pdfInputRef.current?.click()
  }

  function openGoogleSheetPrompt() {
    setImportError(null)
    setGSheetPromptOpen(true)
  }

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
    e.target.value = ''  // allow re-picking the same file
    if (!file) return
    const lower = file.name.toLowerCase()
    try {
      let result
      let source
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

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: '#fef3e8' }}>
      {/* ── Page header ── */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '2px solid #7c2d12', backgroundColor: '#f4a261' }}
      >
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5" style={{ color: '#1c1917' }} />
          <span
            className="font-bold text-sm tracking-widest uppercase"
            style={{ color: '#1c1917' }}
          >
            Rate Card
          </span>
          {activeCard && (
            <span
              className="text-xs font-mono px-2 py-0.5 rounded-sm"
              style={{ backgroundColor: '#fef3e8', color: '#7c2d12', border: '1px solid #7c2d12' }}
            >
              {activeCard.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {rateCards.length > 1 && (
            <select
              value={activeRateCardId || ''}
              onChange={(e) => setActiveRateCardId(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
              style={{
                backgroundColor: '#fef3e8',
                color: '#1c1917',
                border: '2px solid #7c2d12',
              }}
            >
              {rateCards.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {loading && (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#7c2d12' }} />
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
          <span className="text-xs font-mono" style={{ color: '#991b1b' }}>{importError || error}</span>
        </div>
      )}

      {/* ── Two-column body ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: importer column */}
        <div
          className="flex flex-col w-80 flex-shrink-0"
          style={{ borderRight: '2px solid #7c2d12', backgroundColor: '#fff7ed' }}
        >
          <div
            className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest"
            style={{ color: '#7c2d12', borderBottom: '1px solid #f4a261' }}
          >
            Import
          </div>

          <div className="flex-1 p-4 space-y-3 overflow-auto">
            {/* CSV / XLSX importer */}
            <ImporterCard
              label="CSV / XLSX"
              note="Click to pick a spreadsheet"
              onClick={openSheetPicker}
            />

            {/* PDF importer (heuristic) */}
            <ImporterCard
              label="PDF"
              note="Heuristic text extraction"
              onClick={openPdfPicker}
            />
            <ImporterCard
              label="Google Sheet"
              note="Paste a public sheet URL"
              onClick={openGoogleSheetPrompt}
            />

            <div
              className="mt-4 p-3 rounded-sm text-[11px] font-mono leading-relaxed"
              style={{ backgroundColor: '#fef3e8', border: '1px dashed #7c2d12', color: '#7c2d12' }}
            >
              Rate cards live at the workspace level and are reused
              across every RABBIT project for budget rollups.
            </div>
          </div>
        </div>

        {/* Right: editable table */}
        <div className="flex-1 overflow-hidden">
          {activeRateCardId ? (
            <RateCardTable
              entries={entries}
              loading={loading}
              addEntry={addEntry}
              updateEntry={updateEntry}
              deleteEntry={deleteEntry}
              makeSlug={makeSlug}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <span className="text-xs font-mono" style={{ color: '#7c2d12' }}>
                {loading ? 'Loading rate cards…' : 'No rate card available.'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file inputs */}
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

      {/* Import preview modal */}
      <ImportPreviewModal
        open={previewOpen}
        source={previewSource}
        fileName={previewFileName}
        result={previewResult}
        busy={importBusy}
        onClose={closePreview}
        onConfirm={handleConfirmImport}
      />

      {/* Google Sheet URL prompt */}
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
        backgroundColor: '#fef3e8',
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
