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
     §6.5) — it is rendered by Intake, Summary, ProjectFilesSection AND the
     Files page, and B4 converges it with the other three file tables onto
     `Table`. Wave 1's job here is the TYPE and nothing else: not a column
     width, not a radius, not an ink. Nothing below is structural.

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

     The family splits, and T0's mono map is what splits it. The headers
     render seven literal words and keep no data evidence, so they are sans.
     The cells are the row, and a row is mostly figures: of the seven columns,
     Name (`f.name || f.file_name || f.original_name`), Type (`getExt`), Size
     (`fmtBytes`) and Created (`fmtDate`) are data and only Kind and
     Description are prose — the count is 4 to 2, which is exactly the rule
     round one wrote after the Breakdown table went sans on its name column.
     So the cells keep the mono, and it is now `--font-mono` from `@theme`
     rather than a fourth private stack. */
  const hdrClass = 'text-label uppercase'
  const hdr = {
    color: w ? '#3a1e08' : '#fb923c',
    padding: w ? '10px 14px' : '7px 8px',
    whiteSpace: 'nowrap',
  }
  const cellClass = 'text-dense font-mono'
  const cell = {
    color: w ? '#3c2010' : '#d6d3d1',
    padding: w ? '10px 14px' : '6px 8px',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }
  const cols = w
    ? `48px minmax(180px,1fr) 100px 60px 76px minmax(140px,1fr) 96px${onAudit ? ' 40px' : ''}${onDelete ? ' 40px' : ''}`
    : `44px minmax(140px,1fr) 90px 52px 64px minmax(100px,1fr) 80px${onAudit ? ' 32px' : ''}${onDelete ? ' 32px' : ''}`

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
          <div className={cellClass} style={cell}>
            {canEdit ? (
              <select value={f.document_kind || ''}
                onChange={e => onUpdate(f.id, { document_kind: e.target.value || null })}
                className="text-dense"
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
          <div className={cellClass} style={cell}>
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
      className="text-dense"
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
