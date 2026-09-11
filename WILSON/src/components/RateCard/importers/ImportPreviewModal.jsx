// ============================================================
// ImportPreviewModal — review parsed rows before committing
// ============================================================
//
// Used by every Rate Card importer (CSV, XLSX, PDF, GSheets).
// Shows the parsed rows in a scrollable table, surfaces any
// header-mapping warnings or per-row errors, and offers a
// single Confirm button that calls `onConfirm(rows)`.
//
// The host page is responsible for actually pushing the rows
// into the rate card via `bulkUpsertEntries(rows)`.
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// Nobody reviewed this file: the critic named it as a coverage gap — "another
// table" inside a four-overlay file — and the plan pulled it into this bundle
// on that basis. It therefore has no measured findings of its own and takes
// the generic contracts.
//
// It was a hand-rolled overlay: its own backdrop, its own Escape listener, a
// `#fef3e8` near-white sheet with a 2px `#7c2d12` frame (C9), an `#f4a261`
// header band, a `#fee2e2` pink error panel, a `#fed7aa` warning strip, a
// `#fff7ed` footer, a 10px mono header row and 12px mono cells, and
// `hover:bg-orange-50` — a hover LIGHTER than the page, which reads as a hole
// rather than a highlight.
//
// It is `Dialog` + `Table` now, so it inherits the modal stack, the busy lock
// and topmost-only Escape (Q17) instead of its own partial copy of one, and
// the preview grid is the same object as the table it is previewing INTO —
// which is the point: you are looking at rows that are about to become those
// rows. Same eight columns, same confirm, same cancel, same counts, same
// errors, same ignored-column warning.
//
// `workbench` (960): eight columns of which three are money. `reading` (720)
// clipped the region and size columns at 1280.
// ============================================================

import { CheckCircle2, AlertTriangle, FileWarning } from 'lucide-react'
import { Banner, Button, Card, Dialog, EmptyState, Row, Table, Td, Th } from '../../../ui'
import '../../Resources/resources.css'

function fmtCurrency(value, currency) {
  if (value === null || value === undefined || value === '') return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return String(value)
  }
}

// 🚨 Sums to exactly 100: 22 + 16 + 10 + 12 + 12 + 12 + 8 + 8.
const COL = {
  role: '22%', slug: '16%', currency: '10%',
  day: '12%', week: '12%', month: '12%',
  region: '8%', size: '8%',
}

export default function ImportPreviewModal({
  open,
  source,         // 'CSV' | 'XLSX' | 'PDF' | 'Google Sheet'
  fileName,
  result,         // { rows, columns, unmapped, totalRows, errors, sheetName? }
  busy,
  onClose,
  onConfirm,
}) {
  if (!open || !result) return null

  const { rows = [], unmapped = [], totalRows = 0, errors = [], sheetName } = result
  const canConfirm = rows.length > 0 && !busy

  return (
    <Dialog
      width="workbench"
      title={`Import ${source} preview`}
      subtitle={fileName ? (
        <span className="rc-preview-file"><bdi>{fileName}{sheetName ? ` › ${sheetName}` : ''}</bdi></span>
      ) : null}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm(rows)} disabled={!canConfirm}>
            {busy ? 'Importing…' : `Add ${rows.length} row${rows.length === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    >
      <div className="rc-preview">
        {/* ── Status strip ── */}
        <div className="rc-preview-status">
          <span>
            <CheckCircle2 aria-hidden="true" />
            <span className="rc-preview-count">{rows.length}</span>
            {' '}row{rows.length === 1 ? '' : 's'} ready of <span className="rc-preview-count">{totalRows}</span> parsed
          </span>
          {unmapped.length > 0 && (
            <span data-tone="warning">
              <AlertTriangle aria-hidden="true" />
              <span className="rc-preview-count">{unmapped.length}</span>
              {' '}column{unmapped.length === 1 ? '' : 's'} ignored
            </span>
          )}
          {errors.length > 0 && (
            <span data-tone="danger">
              <FileWarning aria-hidden="true" />
              <span className="rc-preview-count">{errors.length}</span>
              {' '}error{errors.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {errors.length > 0 && (
          <Banner tone="danger" Icon={FileWarning}>
            <ul className="rc-errors">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </Banner>
        )}

        {unmapped.length > 0 && (
          <Banner tone="warning" Icon={AlertTriangle}>
            Ignored columns: {unmapped.map(u => u.header).filter(Boolean).join(', ') || '(blank headers)'}
          </Banner>
        )}

        {/* ── Preview table ──
            The same component the rows are about to land in, which is what
            makes this a preview rather than a second rendering of the same
            data in a different language. */}
        {rows.length === 0 ? (
          <EmptyState
            Icon={FileWarning}
            title="Nothing to import"
            body="No rows could be parsed from this file."
          />
        ) : (
          <Card pad={false} className="rc-preview-card">
            <Table
              dense
              aria-label={`${source} import preview`}
              head={(
                <Row>
                  <Th width={COL.role}>Role</Th>
                  <Th width={COL.slug}>Slug</Th>
                  <Th width={COL.currency}>Currency</Th>
                  <Th width={COL.day} numeric>Day</Th>
                  <Th width={COL.week} numeric>Week</Th>
                  <Th width={COL.month} numeric>Month</Th>
                  <Th width={COL.region}>Region</Th>
                  <Th width={COL.size}>Size</Th>
                </Row>
              )}
            >
              {rows.map((r, i) => (
                <Row key={i}>
                  <Td>{r.role_label}</Td>
                  <Td>{r.role_slug}</Td>
                  <Td>{r.currency || 'USD'}</Td>
                  <Td numeric>{fmtCurrency(r.day_rate, r.currency)}</Td>
                  <Td numeric>{fmtCurrency(r.week_rate, r.currency)}</Td>
                  <Td numeric>{fmtCurrency(r.month_rate, r.currency)}</Td>
                  <Td>{r.region || '—'}</Td>
                  <Td>{r.project_size || '—'}</Td>
                </Row>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </Dialog>
  )
}
