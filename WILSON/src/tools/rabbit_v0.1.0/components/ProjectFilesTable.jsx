// ============================================================
// ProjectFilesTable — shared project files table
// ============================================================
//
// Consistent table view for project files used across all views:
// intake, project summary dashboard, control panel, project detail.
//
// Columns: Core, Name, Kind, Type, Size, Description, Created, [Delete]
//
// Supports two visual variants:
//   'dark'  (default) — dark bg, for RABBIT / dark pages
//   'warm'  — warm brown palette, for Projects / light pages

import { useState, useEffect } from 'react'
import { FileText, Trash2, Image as ImageIcon, FileClock } from 'lucide-react'

export const DOCUMENT_KINDS = [
  'script', 'treatment', 'gdd', 'brief', 'pitch_bible',
  'lookbook', 'deck', 'outline', 'notes', 'other',
]

const ACCEPTED_EXTS = new Set(['txt', 'md', 'markdown', 'fountain', 'docx', 'pdf', 'pptx'])

/* ── auto-detection heuristics ─────────────────────────────── */

const EXT_HINTS = { fountain: 'script', pptx: 'deck', txt: 'notes', md: 'notes', markdown: 'notes' }

export function detectDocumentKind(name) {
  const lower = (name || '').toLowerCase()
  if (/script|screenplay|teleplay|fountain/.test(lower)) return 'script'
  if (/treatment/.test(lower)) return 'treatment'
  if (/gdd|game.?design/.test(lower)) return 'gdd'
  if (/brief|creative.?brief/.test(lower)) return 'brief'
  if (/pitch|bible|series.?bible/.test(lower)) return 'pitch_bible'
  if (/look.?book|mood.?board/.test(lower)) return 'lookbook'
  if (/deck|presentation/.test(lower)) return 'deck'
  if (/outline/.test(lower)) return 'outline'
  const ext = lower.split('.').pop()
  if (EXT_HINTS[ext]) return EXT_HINTS[ext]
  return null
}

/* ── helpers ───────────────────────────────────────────────── */

function fmtBytes(b) {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}

function getExt(f) {
  if (f.ext) return f.ext.toUpperCase()
  const dot = (f.name || '').lastIndexOf('.')
  if (dot > 0) return f.name.slice(dot + 1).toUpperCase()
  const mime = f.mimeType || f.type
  if (mime) {
    const p = mime.split('/').pop()
    if (p === 'vnd.openxmlformats-officedocument.wordprocessingml.document') return 'DOCX'
    if (p === 'vnd.openxmlformats-officedocument.presentationml.presentation') return 'PPTX'
    return p.toUpperCase()
  }
  return '—'
}

function isMediaFile(f) {
  if (f.is_image) return true
  const mime = f.type || f.mimeType || ''
  return mime.startsWith('image/') || mime.startsWith('video/')
}

/* ── main component ────────────────────────────────────────── */

export default function ProjectFilesTable({
  files = [],
  onUpdate,          // (id, patch) => void — enables editing
  onDelete,          // (id) => void — shows delete button
  onAudit,           // (file) => void — Session 14: opens the file-activity
                     // drawer. Shown only for adapter files rows (they carry
                     // storage_path); managed-file rows have no event stream.
  readOnly = false,
  maxHeight,
  variant = 'dark',  // 'dark' | 'warm'
}) {
  if (files.length === 0) return null
  const canEdit = !readOnly && !!onUpdate
  const w = variant === 'warm'

  /* ── variant-driven tokens ── */
  /* 🚨 UI overhaul, Wave 1 bundle T2 (2026-09-22). THIS FILE IS B4's (plan
     §6.5) — it is drawn by Intake (`IntakePrepare.jsx:277`), by Summary twice
     (`ProjectSummaryView.jsx:482` read-only and `:1163` through
     `ProjectFilesSection`) and by the Projects page's detail panel
     (`ProjectDetailPanel.jsx:335`) — and B4 converges it with the other file
     tables onto `Table`. Wave 1's job here is the TYPE. EIGHT column widths
     below are NOT type and are marked where they are; each is there because
     the type change made the column unable to render its own content, and a
     conversion that leaves a column truncating is not finished.

     The whole table's type came out of these two objects — eight column
     headers and every cell of every row, on both variants — which is why the
     first pass of the inventory saw 4 of this file's 11 declarations and
     reported a plausible smaller number.

     Both `fontSize` ternaries were a variant choosing between two off-scale
     sizes, and the dark arm of each was the worse one:

       headers   11 warm / 9 dark   ->  text-label, 11px, both variants
       cells     13 warm / 10 dark  ->  text-dense, 13px, both variants

     §3.1 gives "table headers" to Label and "table cells" to Dense by name,
     so neither is a judgement call; the 9px and the 10px were simply below
     the floor. The two variants agreeing is the point — a table that changes
     type size depending on which page draws it is two tables.

     🚨 THE FAMILY IS PER COLUMN, NOT PER TABLE, AND THE FIRST DRAFT MADE IT
     PER TABLE. `cellClass` carried `font-mono` for all nine cells on the
     argument that "a row is mostly figures, 4 columns to 2" — which is a hand
     aggregate the map does not compute. `classifyMono` judges ONE element's
     body, and asked about each of the nine sites with its real tag, run and
     body it returns KEEP for seven and DROP for TWO: **Description** ("renders
     a name or a message") and **Kind** ("no data evidence"). Those are the two
     columns that hold words — the widest column in the table, holding
     user-typed prose, and a column whose whole vocabulary is "treatment",
     "lookbook", "pitch bible". The mechanical reading shipped both at 13px in
     Geist Mono, which is the exact complaint §3.1 exists to fix.
     The Breakdown-row precedent round one wrote was about ONE className
     governing six sibling columns; here each column has its own, so each
     answers for itself — and the first correction asked the map about only one
     of the two. */
  const hdrClass = 'text-label uppercase'
  const hdr = {
    color: w ? '#3a1e08' : '#fb923c',
    padding: w ? '10px 14px' : '7px 8px',
    whiteSpace: 'nowrap',
  }
  const cellClass = 'text-dense font-mono'
  /* 🚨 TWO cells the mono map sends the other way, and the first correction
     moved only one of them. Asked about each of the nine cells with its real
     tag, run and body, `classifyMono` returns KEEP for seven and DROP for
     **Kind** ("no data evidence") and **Description** ("renders a name or a
     message"). Kind renders `f.document_kind.replace(/_/g, ' ')` — "pitch
     bible", "treatment", "lookbook". Words.
     Leaving Kind on `cellClass` also split one column between two faces: the
     read-only branch inherited the mono from this wrapper while the editable
     `<select>` below took `font-sans`, so the same string rendered in Geist on
     Intake and in Geist Mono on Summary. */
  const proseCellClass = 'text-dense'
  /* 🚨 AND A FORM CONTROL INHERITS ITS PARENT'S FAMILY. Tailwind's preflight
     gives `select`/`input` `font: inherit`, so the two editable cells were
     rendering in the mono BECAUSE their wrapper says so — `text-dense` carries
     a size and no family, so adding it changed nothing and the comment beside
     them claimed a drop that had not happened. §3.1 and the kit give every
     control the sans, so the control says so itself. */
  const controlClass = 'text-dense font-sans'
  const cell = {
    color: w ? '#3c2010' : '#d6d3d1',
    padding: w ? '10px 14px' : '6px 8px',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }
  /* 🚨 EIGHT NUMBERS HERE ARE T2's AND THEY ARE THE ONLY NON-TYPE BYTES IN
     THIS FILE. Taking the cells from 10px to the Dense step is what made each
     necessary, and the rule is the same every time: a type conversion that
     leaves a column unable to render its own content is not finished.

                    dark            warm
       Kind         90  ->  80      100 ->  92     (it also went SANS — below)
       Type         52  ->  80       60 ->  92
       Size         64  ->  88       76 -> 100
       Created      80  -> 112       96 -> 124

     MEASURED in the browser at the cell's OWN family and 13px, against each
     column's CONTENT box (its width less `cell`'s padding: 16px dark, 28px
     warm), for the widest value the column can actually hold:

       Kind      `pitch bible`   61.8 sans   (85.8 in the mono — see below)
       Type      `MARKDOWN`      62.4 mono   (ACCEPTED_EXTS has markdown, fountain)
       Size      `1023.9 KB`     70.2 mono   (fmtBytes switches to MB above 1024 KB)
       Created   `Sep 19, 2026`  93.6 mono   (en-*; see the locale note below)

     🚨 KIND IS 80 AND NOT 104 BECAUSE THE FAMILY DECIDES THE WIDTH. An
     earlier pass sized it for the mono, at 104, and then moved the column to
     the sans in the same commit — where the same string is 61.8px rather than
     85.8. Sizing a column before settling its family books 24px of nothing.

     🚨 AND IT TOOK THREE PASSES TO GET THE LIST RIGHT, WHICH IS THE LESSON.
     The first pass measured the FIXTURE and found one broken column: of the
     230 cells the Summary tab draws, exactly 32 overflowed and every one was a
     date, `clientWidth` 80 against `scrollWidth` 110. "No other column
     overflowed" was true of the fixture and false of the component — every
     `size` in it is null and renders `—`, no row carries a `pitch_bible` kind,
     and Intake's file list is empty, so three of the four broken columns had
     nothing to draw. A reviewer uploaded a real 54.7 KB file and the Size cell
     reported `scrollWidth 71 > clientWidth 64` at once.
     Type was ALREADY truncating before this session (43.98 against a 36px box
     at 10px) and got worse inside this diff, which is the standing this
     session gave the warm Created column; it is widened on the same reasoning.

     ⚠️ THE LOCALE ARGUMENT FOR `Created` WAS WRONG AND THE NUMBER SURVIVES IT.
     The first pass claimed en-GB, en-AU and en-CA render "Sept 19, 2026" at
     101.4px. They do not — they put the day first, which is NARROWER, and
     en-CA does not abbreviate "Sept" at all. What is true is that `fmtDate`
     passes `undefined` as its locale, so it renders the BROWSER's, and the
     en-* family is widest at 93.6px. 112 clears that with 2.4px to spare.
     📌 Outside en-* it does not: de-DE renders `19. Sept. 2026` at 109.2px,
     ru-RU 123.9 and pt-BR 140.4. Sizing for every locale means a column that
     grows with its content, which is structure and is B4's.

     ⚠️ The WARM columns move too, and the note here once said they were
     "pre-existing, untouched": wrong twice over. The warm cells kept 13px but
     changed FAMILY in this same edit, `'ui-monospace,monospace'` ->
     `var(--font-mono)`, which took "Aug 19, 2026" from 85.8px to 93.6px. The
     truncation got worse inside this diff, so it is this session's.

     VERIFIED at both window sizes on the NARROWEST of the four surfaces —
     Intake, whose wrapper is 686px — with a 1.1 MB `.markdown` file, which is
     the worst Kind, Type, Size and Name the component can draw at once:
     grid `clientWidth` 686 === `scrollWidth` 686, zero cells clipped, no
     document overflow. An earlier draft of these numbers overflowed it by
     14px; that is what sizing a column for the wrong family costs.

     📌 FOR B4: `variant="warm"` has no caller. `ProjectDetailPanel` passes
     `variant="dark"` since lane C1 put that page on `paper`, and the other
     three call sites take the `'dark'` default — so the whole warm arm is
     unreachable in the shipped tree. Kept and corrected rather than deleted,
     because deleting a variant is structure and structure is B4's. */
  const cols = w
    ? `48px minmax(180px,1fr) 92px 92px 100px minmax(140px,1fr) 124px${onAudit ? ' 40px' : ''}${onDelete ? ' 40px' : ''}`
    : `44px minmax(140px,1fr) 80px 80px 88px minmax(100px,1fr) 112px${onAudit ? ' 32px' : ''}${onDelete ? ' 32px' : ''}`

  const mutedColor = w ? '#6b4423' : '#78716c'
  const iconSz = w ? 15 : 13

  return (
    <div style={{
      border: w ? '1px solid rgba(120,70,30,0.3)' : '1px solid #44403c',
      borderRadius: 4, overflowX: 'auto',
      maxHeight, overflowY: maxHeight ? 'auto' : undefined,
    }} className={w ? 'wilson-light-scroll' : undefined}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: cols,
        backgroundColor: w ? 'rgba(120, 70, 30, 0.45)' : '#292524',
        borderBottom: w ? '1px solid rgba(120,70,30,0.3)' : '1px solid #44403c',
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <div className={hdrClass} style={hdr}>Core</div>
        <div className={hdrClass} style={hdr}>Name</div>
        <div className={hdrClass} style={hdr}>Kind</div>
        <div className={hdrClass} style={hdr}>Type</div>
        <div className={hdrClass} style={hdr}>Size</div>
        <div className={hdrClass} style={hdr}>Description</div>
        <div className={hdrClass} style={hdr}>Created</div>
        {onAudit && <div className={hdrClass} style={hdr} />}
        {onDelete && <div className={hdrClass} style={hdr} />}
      </div>

      {/* Rows */}
      {files.map((f, i) => (
        <div key={f.id} style={{
          display: 'grid', gridTemplateColumns: cols,
          borderBottom: w ? '1px solid rgba(120,70,30,0.15)' : '1px solid #3a3733',
          backgroundColor: w
            ? (i % 2 === 0 ? 'rgba(120, 70, 30, 0.12)' : 'rgba(120, 70, 30, 0.22)')
            : '#1c1917',
          alignItems: 'center',
        }}>
          {/* Core */}
          <div className={cellClass} style={{ ...cell, display: 'flex', justifyContent: 'center' }}>
            <input type="checkbox" checked={!!f.is_core_definer}
              onChange={canEdit ? e => onUpdate(f.id, { is_core_definer: e.target.checked }) : undefined}
              disabled={!canEdit}
              className="accent-orange-500"
              style={{ width: w ? 16 : 14, height: w ? 16 : 14, cursor: canEdit ? 'pointer' : 'default' }} />
          </div>

          {/* Name */}
          <div className={cellClass} style={{ ...cell, display: 'flex', alignItems: 'center', gap: 7 }}>
            {isMediaFile(f)
              ? <ImageIcon size={iconSz} style={{ color: w ? '#ea580c' : '#f97316', flexShrink: 0 }} />
              : <FileText size={iconSz} style={{ color: w ? '#9a6438' : '#78716c', flexShrink: 0 }} />
            }
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.name}>
              {f.name || f.file_name || f.original_name || 'Untitled'}
            </span>
          </div>

          {/* Kind */}
          {/* A control is a control: the kit rules `.ui-select` at 13/400 in
              the sans, so both arms of the size ternary below (12 warm, 10
              dark) land on Dense and the private mono stack goes. */}
          <div className={proseCellClass} style={cell}>
            {canEdit ? (
              <select value={f.document_kind || ''}
                onChange={e => onUpdate(f.id, { document_kind: e.target.value || null })}
                className={controlClass}
                style={{
                  width: '100%', padding: w ? '3px 6px' : '2px 4px',
                  backgroundColor: w ? 'rgba(120, 70, 30, 0.5)' : '#292524',
                  color: f.document_kind
                    ? (w ? '#3c2010' : '#f4a261')
                    : (w ? '#7c4f1f' : '#57534e'),
                  border: w ? '1px solid rgba(120,70,30,0.4)' : '1px solid #44403c',
                  borderRadius: 3, outline: 'none',
                }}>
                <option value="">—</option>
                {DOCUMENT_KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
              </select>
            ) : (
              <span style={{ color: w ? '#6b4423' : '#a8a29e' }}>
                {f.document_kind ? f.document_kind.replace(/_/g, ' ') : '—'}
              </span>
            )}
          </div>

          {/* Type */}
          <div className={cellClass} style={{ ...cell, color: mutedColor }}>{getExt(f)}</div>

          {/* Size */}
          <div className={cellClass} style={{ ...cell, color: mutedColor }}>{fmtBytes(f.size)}</div>

          {/* Description */}
          {/* The one column the mono map sends the other way: user prose. */}
          <div className={proseCellClass} style={cell}>
            {canEdit ? (
              <DescCell value={f.description || ''} onChange={v => onUpdate(f.id, { description: v })} warm={w} />
            ) : (
              <span style={{ color: w ? '#6b4423' : '#a8a29e', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f.description || '—'}
              </span>
            )}
          </div>

          {/* Date */}
          <div className={cellClass} style={{ ...cell, color: mutedColor }}>{fmtDate(f.created_at || f.uploaded_at)}</div>

          {/* File activity (Session 14) */}
          {onAudit && (
            <div className={cellClass} style={{ ...cell, display: 'flex', justifyContent: 'center' }}>
              {f.storage_path ? (
                <button onClick={() => onAudit(f)} title="File activity"
                  style={{
                    color: w ? '#9a6438' : '#78716c', padding: 2, borderRadius: 3,
                    border: 'none', background: 'none', cursor: 'pointer',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = w ? '#ea580c' : '#fb923c'}
                  onMouseLeave={e => e.currentTarget.style.color = w ? '#9a6438' : '#78716c'}>
                  <FileClock size={iconSz} />
                </button>
              ) : null}
            </div>
          )}

          {/* Delete */}
          {onDelete && (
            <div className={cellClass} style={{ ...cell, display: 'flex', justifyContent: 'center' }}>
              <button onClick={() => onDelete(f.id)}
                style={{
                  color: w ? '#9a6438' : '#78716c', padding: 2, borderRadius: 3,
                  border: 'none', background: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.color = w ? '#ef4444' : '#fca5a5'}
                onMouseLeave={e => e.currentTarget.style.color = w ? '#9a6438' : '#78716c'}>
                <Trash2 size={iconSz} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── description cell with local state + commit on blur ──── */

function DescCell({ value, onChange, warm }) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <input type="text" value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local) }}
      placeholder={warm ? 'Add description...' : '—'}
      className="text-dense font-sans"
      style={{
        width: '100%',
        padding: warm ? '3px 6px' : '2px 4px',
        backgroundColor: warm ? 'rgba(120, 70, 30, 0.2)' : 'transparent',
        color: warm ? '#5c3415' : '#a8a29e',
        border: warm ? '1px solid rgba(120,70,30,0.2)' : 'none',
        borderRadius: 2, outline: 'none',
      }} />
  )
}
