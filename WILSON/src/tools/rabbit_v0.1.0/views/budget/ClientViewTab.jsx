// ============================================================
// ClientViewTab — Client-facing budget topsheet
// ============================================================
//
// Maps to TOPSHEET - CLIENT in the Excel template.
// Clean read-only view showing only department estimates.
// NO subtotals visible to client.
// NO contingency percentage visible — contingency shown as a flat line item.
// Includes print/export functionality.
//
// UI overhaul B5 (2026-09-26), R3-27 / R3-39 / C9:
//   · The on-screen preview is a document frame on the paper — the kit Table
//     (its total in the table's <tfoot>), the Label step over Dense values —
//     not a near-white card (C9: no white surface on screen).
//   · The PRINTED estimate, the one document that leaves the building, is
//     white paper and is set in the app's face at the app's scale. It was a
//     second stylesheet in Courier New with 9px headers. `estimateDocument`
//     builds it from the kit's own tokens resolved to literal values (the
//     print window is about:blank, so no custom property reaches it), carries
//     the app's own @font-face rules for Geist (`appFontFaces`), and prints
//     once the face has loaded. It is exported so a test renders it.
//   · The preview and the print are built from ONE list of rows, so the
//     preview is what prints: the same lines, the same order, the same
//     figures (formatMoney, one locale).

import { useMemo, useRef } from 'react'
import { Eye, Printer } from 'lucide-react'
import { Table, Th, Td, Row } from '../../../../ui/Table'
import { Button } from '../../../../ui/Button'
import { FONT_SANS, FONT_MONO, TYPE, LEADING, TRACKING, WEIGHT, INK_LIGHT, RULE_LIGHT } from '../../../../ui/tokens.js'
import CurrencyDisplay, { formatMoney } from '../../components/CurrencyDisplay'
import '../rabbitBudget.css'

/** Text into HTML: a line's label and the project's title are the user's own
    words, and the print window parses what it is given. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * The app's own @font-face rules for its two faces, read from the page that
 * prints, each url() made absolute against the sheet that holds it. The print
 * window has none of the app's stylesheets, so it gets the same rules — the
 * same files, weights and unicode ranges — rather than a copy that could
 * drift from index.css. (The window shares its opener's origin, so the files
 * load; a sheet the page cannot read is skipped.)
 */
export function appFontFaces(doc = document) {
  const out = []
  const visit = (rules, base) => {
    for (const rule of rules) {
      if (rule.cssRules) { visit(rule.cssRules, base); continue }
      if (!/^@font-face/i.test(rule.cssText || '')) continue
      if (!/Geist/.test(rule.style?.getPropertyValue('font-family') || '')) continue
      out.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, url) => `url(${new URL(url, base).href})`))
    }
  }
  for (const sheet of doc.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    visit(rules, sheet.href || doc.baseURI)
  }
  return out.join('\n        ')
}

/**
 * The printed client estimate, as one HTML document.
 *   rows:     [{ label, amount }] — the same list the preview draws
 *   faces:    the @font-face rules the window loads (appFontFaces())
 */
export function estimateDocument({ title, code, date, rows, total, currency, faces = '' }) {
  // The light ink at the plan's 72% screen, for quiet text on the white page
  // (6.9:1 over white).
  const quiet = `color-mix(in srgb, ${INK_LIGHT} 72%, transparent)`
  const label = `font-size: ${TYPE.label}px; line-height: ${LEADING.label}; font-weight: ${WEIGHT.label}; letter-spacing: ${TRACKING.label}; text-transform: uppercase; color: ${quiet};`
  const lines = rows
    .map((r) => `<tr><td>${esc(r.label)}</td><td class="money">${esc(formatMoney(r.amount, currency))}</td></tr>`)
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title || 'Budget')} - Client estimate</title>
      <style>
        ${faces}
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: ${FONT_SANS}; font-size: ${TYPE.dense}px; line-height: ${LEADING.dense}; color: ${INK_LIGHT}; padding: 40px; }
        h1 { font-size: ${TYPE.h1}px; line-height: ${LEADING.h1}; font-weight: ${WEIGHT.h1}; letter-spacing: ${TRACKING.h1}; margin-bottom: 4px; }
        .sub { color: ${quiet}; margin-bottom: 20px; }
        .meta { display: flex; gap: 40px; margin-bottom: 24px; }
        .meta label { display: block; ${label} }
        .figure { font-family: ${FONT_MONO}; font-variant-numeric: tabular-nums; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th { text-align: left; padding: 8px 12px; border-bottom: 1px solid ${RULE_LIGHT}; ${label} }
        td { padding: 8px 12px; border-bottom: 1px solid ${RULE_LIGHT}; }
        th:last-child, td:last-child { text-align: right; }
        td.money { font-family: ${FONT_MONO}; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .total td { border-top: 1px solid ${INK_LIGHT}; border-bottom: 0; font-size: ${TYPE.h3}px; line-height: ${LEADING.h3}; font-weight: ${WEIGHT.h3}; padding-top: 12px; }
        .note { color: ${quiet}; margin-top: 32px; }
        .signature { margin-top: 48px; }
        .signature div + div { margin-top: 16px; }
        .signature .line { border-bottom: 1px solid ${INK_LIGHT}; width: 200px; height: 20px; display: inline-block; margin-left: 8px; }
      </style></head><body>
        <h1>${esc(title || 'Project')}</h1>
        <p class="sub">Estimated budget</p>
        <div class="meta">
          <div><label>Project code</label><span class="figure">${esc(code || '--')}</span></div>
          <div><label>Date</label><span class="figure">${esc(date)}</span></div>
        </div>
        <table>
          <thead><tr><th>Item</th><th>Estimate</th></tr></thead>
          <tbody>
            ${lines}
            <tr class="total"><td>Total</td><td class="money">${esc(formatMoney(total, currency))}</td></tr>
          </tbody>
        </table>
        <p class="note">Note:</p>
        <div class="signature">
          <div>Estimate approved by: <span class="line"></span></div>
          <div>Approver signature: <span class="line"></span></div>
          <div>Date signed: <span class="line"></span></div>
        </div>
      </body></html>`
}

export default function ClientViewTab({ budget, budgetHook, project, tasks, roleRates, expensesHook, currency }) {
  const printRef = useRef(null)

  const markupPct      = Number(project?.budget_margin_pct ?? 0)
  const contingencyPct = Number(project?.budget_contingency_pct ?? 0)

  // Build department-level estimates from tasks + rate card (crew/team costs)
  const crewByDept = useMemo(() => {
    const map = {}
    for (const t of (tasks || [])) {
      const slug = t.assigned_role_slug
      if (!slug) continue
      const rate = Number(roleRates?.[slug] || 0)
      const days = Number(t.bid_days || 0)
      if (rate <= 0 || days <= 0) continue

      // Use assigned_position or slug as a department proxy
      const dept = t.assigned_position || slug
      if (!map[dept]) map[dept] = { department: dept, estimate: 0 }
      map[dept].estimate += rate * days
    }
    return map
  }, [tasks, roleRates])

  // Build expense estimates from expenses system
  const expenseTotal = useMemo(() => {
    const expenses = expensesHook?.expenses || []
    return expenses.reduce((s, e) => s + Number(e.estimated_cost || 0), 0)
  }, [expensesHook?.expenses])

  // Build budget-line estimates from talent lines (budgetHook)
  const talentTotal = useMemo(() => {
    if (!budgetHook?.lines || !budgetHook?.lineComputations) return 0
    return budgetHook.lines
      .filter(l => l.sheet === 'talent' && !l.is_section_header)
      .reduce((s, l) => s + (budgetHook.lineComputations[l.id]?.bidTotal || 0), 0)
  }, [budgetHook?.lines, budgetHook?.lineComputations])

  // Combine into clean client-facing line items
  const clientLineItems = useMemo(() => {
    const items = []

    // Add crew/team departments
    for (const row of Object.values(crewByDept)) {
      if (row.estimate > 0) {
        items.push({ label: row.department, estimate: row.estimate })
      }
    }

    // Add talent as a single line
    if (talentTotal > 0) {
      items.push({ label: 'Talent', estimate: talentTotal })
    }

    // Add expenses as a single line
    if (expenseTotal > 0) {
      items.push({ label: 'Expenses / travel', estimate: expenseTotal })
    }

    // Sort by estimate descending
    items.sort((a, b) => b.estimate - a.estimate)

    return items
  }, [crewByDept, talentTotal, expenseTotal])

  // Calculate totals — contingency is a FLAT line item, not shown as %
  const subtotalBeforeExtras = clientLineItems.reduce((s, r) => s + r.estimate, 0)
  const contingencyAmt = subtotalBeforeExtras * (contingencyPct / 100)
  const markupAmt      = subtotalBeforeExtras * (markupPct / 100)
  const grandTotal     = subtotalBeforeExtras + contingencyAmt + markupAmt

  // ONE list for the preview and the print: the line items, then contingency
  // as a flat dollar line and the markup as "Production fee" — NO percentage
  // shown on either — each only when it is more than zero.
  const estimateRows = [
    ...clientLineItems.map(r => ({ label: r.label, amount: r.estimate })),
    ...(contingencyAmt > 0 ? [{ label: 'Contingency', amount: contingencyAmt }] : []),
    ...(markupAmt > 0 ? [{ label: 'Production fee', amount: markupAmt }] : []),
  ]
  const today = new Date().toLocaleDateString()

  function handlePrint() {
    const el = printRef.current
    if (!el) return
    const printWin = window.open('', '_blank', 'width=800,height=1100')
    if (!printWin) return

    // Session 25: the title and code below were project.name / project.code.
    // NEITHER has ever been a column. The project title is 'title', and the
    // code the app actually writes is 'project_code'
    // (ProjectSummaryView.jsx:605) — so this printed "Project" and "--" on
    // every cloud project, on the one document that leaves the building.
    printWin.document.write(estimateDocument({
      title: project?.title,
      code: project?.project_code,
      date: today,
      rows: estimateRows,
      total: grandTotal,
      currency,
      faces: appFontFaces(),
    }))
    printWin.document.close()
    printWin.focus()
    // The face is a web font now: once the page has laid out (the same 250ms
    // as before) wait for it to load, so the print is never set in a fallback.
    setTimeout(() => {
      const ready = printWin.document.fonts?.ready || Promise.resolve()
      ready.then(() => { printWin.print(); printWin.close() })
    }, 250)
  }

  return (
    <div className="rb-client-tab">
      {/* Header + Print */}
      <div className="rb-client-head">
        <div className="rb-client-heading">
          <Eye className="rb-client-glyph" aria-hidden="true" />
          <span className="rb-client-eyebrow">Client view</span>
          <span className="rb-client-lede">Clean estimate for client presentation</span>
        </div>
        <Button variant="secondary" size="sm" Icon={Printer} onClick={handlePrint}>
          Print / export
        </Button>
      </div>

      {/* Preview — the document, on the paper */}
      <div ref={printRef} className="rb-client-sheet">
        <h2 className="rb-client-project">{project?.title || 'Project'}</h2>
        <p className="rb-client-sub">Estimated budget</p>

        <div className="rb-client-meta">
          <div>
            <span className="rb-client-meta-label">Project code</span>
            <span className="rb-client-meta-value">{project?.project_code || '--'}</span>
          </div>
          <div>
            <span className="rb-client-meta-label">Date</span>
            <span className="rb-client-meta-value">{today}</span>
          </div>
        </div>

        {/* Line items — NO subtotals, NO contingency % */}
        <Table
          head={<Row><Th>Item</Th><Th numeric width="var(--rb-client-amount)">Estimate</Th></Row>}
          foot={<Row><Td>Total</Td><Td numeric><CurrencyDisplay value={grandTotal} currency={currency} /></Td></Row>}
        >
          {estimateRows.map(row => (
            <Row key={row.label}>
              <Td>{row.label}</Td>
              <Td numeric><CurrencyDisplay value={row.amount} currency={currency} /></Td>
            </Row>
          ))}
        </Table>

        {/* Note + Signature area */}
        <div className="rb-client-notes">
          <p className="rb-client-note-label">Note:</p>
          <div className="rb-client-note-box" />

          <div className="rb-client-sign">
            <div className="rb-client-sign-row">
              <span>Estimate approved by:</span>
              <span className="rb-client-sign-line" />
            </div>
            <div className="rb-client-sign-row">
              <span>Approver signature:</span>
              <span className="rb-client-sign-line" />
            </div>
            <div className="rb-client-sign-row">
              <span>Date signed:</span>
              <span className="rb-client-sign-line" data-short="true" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
