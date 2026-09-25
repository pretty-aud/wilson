// ============================================================
// ProjectFilesTable — the shared project files table
// ============================================================
//
// Drawn by four surfaces (plan §5 item 5: this file is lane B4's across all
// of them): Intake (`IntakePrepare`), Summary twice (its read-only card and
// the Control Panel's `ProjectFilesSection`) and the Projects page's detail
// panel (`ProjectDetailPanel`). All four draw THIS table, so the four look
// the same by construction.
//
// Columns: Core, Name, Kind, Type, Size, Description, Created,
// [File activity], [Delete].
//
// ── B4 (2026-09-25): one language, on the kit ────────────────────────────
// It was a CSS grid carrying two complete designs behind `variant ===
// 'warm'` (review R4-31) — two header sizes, two paddings, zebra on one arm,
// six colour pairs — and its dark arm drew every muted cell in `#78716c` on
// `#1c1917`, 3.65:1, which was every contrast failure the walk reported on
// Summary, on the Control Panel, and under Settings and Help. The warm arm
// had no caller left (lane C1 put the Projects page on `paper`). Now:
//
//   · the kit `Table`, `dense` (a real <table>, 32px rows, the Label-step
//     header, hairlines, no zebra) — the same table and the same row as the
//     Files page's and the Tasks table's, not a lookalike;
//   · every cell on the ink ladder (`rabbitFiles.css`), nothing under 4.5:1;
//   · Kind is the kit `CellSelect` (B2's cell select, promoted: a kit
//     request B2 filed and B4 filled), Size is a `numeric` cell — right
//     aligned, tabular, the mono — and Type and Created are figures in the
//     mono;
//   · every icon button is the kit `IconButton` and is NAMED for its file
//     ("Delete brief.pdf"): the Control Panel had 32 unnamed trash buttons;
//   · radii come from the kit, so none is off the scale.
//
// SIZE READS ONE FIELD, `size_bytes` — the `files` column, and what
// FileManager and the Files page read. The table used to read `size`, so
// Summary mapped `size_bytes` → `size` at both its call sites
// (`withDisplaySize`) and the Projects page mapped it again for its cloud
// rows. The rows that are not `files` rows now carry `size_bytes` where they
// are made (Intake's picked files; the Projects page's legacy local rows),
// and both mappers are gone.
//
// 📌 KIND shows "—" for every cloud row: this column is `document_kind`, the
// intake's taxonomy, and a cloud upload's own `kind` is another one. That is
// a data gap (B1's hand-off, dev-fixtures #11), recorded and NOT aliased.

import { useState, useEffect } from 'react'
import { FileText, Trash2, Image as ImageIcon, FileClock } from 'lucide-react'
import { Table, Row, Th, Td, CellSelect, IconButton, EmptyState } from '../../../ui'
import '../views/rabbitFiles.css'

export const DOCUMENT_KINDS = [
  'script', 'treatment', 'gdd', 'brief', 'pitch_bible',
  'lookbook', 'deck', 'outline', 'notes', 'other',
]

/* Sentence case (Q2); GDD is an initialism. The stored value is unchanged. */
const KIND_LABELS = {
  script: 'Script', treatment: 'Treatment', gdd: 'GDD', brief: 'Brief',
  pitch_bible: 'Pitch bible', lookbook: 'Lookbook', deck: 'Deck',
  outline: 'Outline', notes: 'Notes', other: 'Other',
}
const kindLabel = (k) => KIND_LABELS[k] || String(k).replace(/_/g, ' ')
const KIND_OPTIONS = DOCUMENT_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))

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

const fileName = (f) => f.name || f.file_name || f.original_name || 'Untitled'

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
}) {
  if (files.length === 0) {
    return <EmptyState compact Icon={FileText} title="No files attached" />
  }
  const canEdit = !readOnly && !!onUpdate

  return (
    <div
      className="rb-files-frame"
      data-scroll={maxHeight ? 'true' : undefined}
      data-audit={onAudit ? 'true' : undefined}
      data-delete={onDelete ? 'true' : undefined}
      style={{ '--rb-files-max': maxHeight ? `${maxHeight}px` : undefined }}
    >
      <Table
        dense
        className="rb-files-table"
        scrollClassName="rb-files-scroll"
        head={
          <Row>
            <Th width="var(--rb-files-core)">Core</Th>
            <Th>Name</Th>
            <Th width="var(--rb-files-kind)">Kind</Th>
            <Th width="var(--rb-files-type)">Type</Th>
            <Th width="var(--rb-files-size)" numeric>Size</Th>
            <Th>Description</Th>
            <Th width="var(--rb-files-date)">Created</Th>
            {onAudit && <Th width="var(--rb-files-icon)"><span className="sr-only">File activity</span></Th>}
            {onDelete && <Th width="var(--rb-files-icon)"><span className="sr-only">Delete</span></Th>}
          </Row>
        }
      >
        {files.map((f) => {
          const name = fileName(f)
          const created = fmtDate(f.created_at || f.uploaded_at)
          return (
            <Row key={f.id}>
              <Td align="center">
                <input type="checkbox" className="rb-files-core"
                  checked={!!f.is_core_definer}
                  onChange={canEdit ? e => onUpdate(f.id, { is_core_definer: e.target.checked }) : undefined}
                  disabled={!canEdit}
                  aria-label={`Core file: ${name}`} />
              </Td>

              <Td>
                <span className="rb-files-name">
                  {isMediaFile(f)
                    ? <ImageIcon aria-hidden="true" className="rb-files-glyph" />
                    : <FileText aria-hidden="true" className="rb-files-glyph" />}
                  <span className="rb-files-name-text" title={name}>{name}</span>
                </span>
              </Td>

              <Td>
                {canEdit ? (
                  <CellSelect
                    value={f.document_kind || null}
                    onChange={v => onUpdate(f.id, { document_kind: v })}
                    placeholder="—"
                    options={KIND_OPTIONS}
                    aria-label={`Kind for ${name}`} />
                ) : (
                  <span className="rb-files-quiet" data-empty={f.document_kind ? undefined : 'true'}>
                    {f.document_kind ? kindLabel(f.document_kind) : '—'}
                  </span>
                )}
              </Td>

              <Td className="rb-files-mono">{getExt(f)}</Td>

              <Td numeric className="rb-files-size" data-empty={f.size_bytes ? undefined : 'true'}>
                {fmtBytes(f.size_bytes)}
              </Td>

              <Td className="rb-files-desc">
                {canEdit ? (
                  <DescCell value={f.description || ''} name={name}
                    onChange={v => onUpdate(f.id, { description: v })} />
                ) : (
                  <span className="rb-files-quiet" data-empty={f.description ? undefined : 'true'}
                    title={f.description || undefined}>
                    {f.description || '—'}
                  </span>
                )}
              </Td>

              <Td className="rb-files-mono" title={created}>{created}</Td>

              {onAudit && (
                <Td align="center" className="rb-files-icon-cell">
                  {f.storage_path ? (
                    <IconButton Icon={FileClock} size="sm" title={`File activity for ${name}`}
                      onClick={() => onAudit(f)} />
                  ) : null}
                </Td>
              )}

              {onDelete && (
                <Td align="center" className="rb-files-icon-cell">
                  <IconButton Icon={Trash2} size="sm" danger title={`Delete ${name}`}
                    onClick={() => onDelete(f.id)} />
                </Td>
              )}
            </Row>
          )
        })}
      </Table>
    </div>
  )
}

/* ── description cell with local state + commit on blur ──── */

// A native field, not the kit `Input`: the kit's blurs on Enter, and the
// window's Enter handler then finds nothing focused and toggles the
// companion (B3d-KR-2). Commit on blur, exactly as before.
function DescCell({ value, onChange, name }) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <input type="text" value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local) }}
      placeholder="—"
      aria-label={`Description for ${name}`}
      className="rb-files-cell-input" />
  )
}
