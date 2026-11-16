// ============================================================
// IntakePrepare — consolidated step 1 of the intake wizard
// ============================================================
//
// UI overhaul, Wave 1 bundle T2 (2026-09-22): this screen carried 84 of the
// app's 191 inline type declarations — more than any other file by a factor of
// four — and every one of them is now a scale step from `@theme`. The steps
// were not chosen here: `scripts/ui-inline-type.mjs` reconstructs the evidence
// `classifySite` expects and asks T0's map, so `node scripts/ui-inline-type.mjs
// IntakePrepare` re-derives every decision on this screen from the source.
//
// The warm orange palette (#fb923c, #ea580c) stays; §3.2's ink and signal
// ladder is lane B's, not Wave 1's.

import { useCallback, useRef, useState } from 'react'
import { Upload, AlertCircle, AlertTriangle, Layers, Boxes, ListChecks, Film, FileText, Plus } from 'lucide-react'
import ProjectFilesTable, { detectDocumentKind } from '../../components/ProjectFilesTable'
import { PERSONA_LIST } from '../../intake/personas'
import '../../rabbitShell.css'
import { Chip } from '../../../../ui/Chip'
import { Button } from '../../../../ui/Button'

/* ── constants ─────────────────────────────────────────────── */

const ACCEPTED_EXTS = new Set(['txt', 'md', 'markdown', 'fountain', 'docx', 'pdf', 'pptx'])
const ACCEPT_ATTR = '.txt,.md,.markdown,.fountain,.docx,.pdf,.pptx'

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/* ── generation options ────────────────────────────────────── */

export const DEFAULT_GENERATION_OPTIONS = {
  generate_timeline: true,
  generate_assets: true,
  generate_tasks: true,
  generate_scenes: false,
}

const GENERATION_ITEMS = [
  { key: 'generate_timeline', label: 'Timeline & Phases', icon: Layers, desc: 'Phase schedule with dependencies' },
  { key: 'generate_assets', label: 'Asset Breakdown', icon: Boxes, desc: 'Deliverables grouped by phase' },
  { key: 'generate_tasks', label: 'Task Breakdown', icon: ListChecks, desc: 'Tasks with roles, days, priorities' },
  { key: 'generate_scenes', label: 'Scene Breakdown', icon: Film, desc: 'Scene-by-scene analysis' },
]

/* ── typography ─────────────────────────────────────────────── */

// UI overhaul F1 (2026-09-11) replaced the private Century Gothic → Futura
// stack with `SANS = 'var(--font-sans)'` and left `DATA` — a fourth hard-coded
// mono stack — for Wave 1. T2 (2026-09-22) removes BOTH consts rather than
// re-pointing them:
//
//   · SANS was applied 23 times and `html { font-family: var(--font-sans) }`
//     in index.css already says the same thing. 23 declarations that restate
//     the default are 23 places a future edit can disagree with it.
//   · DATA was applied twice. One of those two sites is data by T0's mono map
//     (`{coreCount} core · {n} reference` — a count) and now says so with
//     `font-mono`; the other is the drop zone's accepted-extension hint, which
//     is inside a <button>, and §3.1 gives every control to the sans.
//
// So there is no type constant on this screen any more. The class is the
// declaration.

/* ── main component ────────────────────────────────────────── */

export default function IntakePrepare({
  files,
  onChange,
  enabledPersonas,
  onPersonasChange,
  generationOptions,
  onGenerationOptionsChange,
  existingDataCounts,
  overwriteConfirmed,
  onOverwriteConfirmedChange,
  scenesEnabled,
  onRun,
  onNewProject,
}) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)

  const coreCount = (files || []).filter(f => f.is_core_definer).length
  const hasFiles = (files || []).length > 0
  const hasExistingData = existingDataCounts &&
    (existingDataCounts.phases > 0 || existingDataCounts.assets > 0 || existingDataCounts.tasks > 0)
  const canRun = coreCount > 0 && enabledPersonas.length > 0 &&
    (!hasExistingData || overwriteConfirmed)

  /* ── handlers ────────────────────────────────────────────── */

  const ingest = useCallback(async (fileList) => {
    setError(null)
    const arr = Array.from(fileList || [])
    if (arr.length === 0) return
    const accepted = []
    const rejected = []
    for (const f of arr) {
      const ext = extOf(f.name)
      if (!ACCEPTED_EXTS.has(ext)) { rejected.push(f.name); continue }
      try {
        const dataUrl = await readDataUrl(f)
        accepted.push({
          id: `intake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          // `size_bytes`, the `files` column's name: ProjectFilesTable reads
          // one field for all four of its callers (B4). Nothing else reads it.
          name: f.name, size_bytes: f.size, mimeType: f.type, dataUrl, ext,
          document_kind: detectDocumentKind(f.name),
          is_core_definer: true, description: '',
          created_at: new Date().toISOString(),
        })
      } catch (err) {
        rejected.push(`${f.name} (${err.message || 'read error'})`)
      }
    }
    if (accepted.length > 0) onChange([...(files || []), ...accepted])
    if (rejected.length > 0) setError(`Skipped: ${rejected.join(', ')}`)
  }, [files, onChange])

  function handleDrop(e) { e.preventDefault(); setDragging(false); ingest(e.dataTransfer.files) }
  function updateFile(id, patch) { onChange((files || []).map(f => f.id === id ? { ...f, ...patch } : f)) }
  function removeFile(id) { onChange((files || []).filter(f => f.id !== id)) }

  function togglePersona(id) {
    onPersonasChange(enabledPersonas.includes(id)
      ? enabledPersonas.filter(p => p !== id)
      : [...enabledPersonas, id])
  }
  function toggleGen(key) {
    onGenerationOptionsChange({ ...generationOptions, [key]: !generationOptions[key] })
  }

  const dropProps = {
    onDragOver: e => { e.preventDefault(); setDragging(true) },
    onDragLeave: () => setDragging(false),
    onDrop: handleDrop,
  }

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-paper)' }}>

      <div className="flex-1 overflow-auto">
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 36px 28px' }}>

          {/* ── Title row ──────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            {/* An `uppercase` heading TAG is a heading, at h1/h2/h3 by its own
                px — not a label at the 11px floor. 20px clears the map's cliff
                at 18, so: text-h1, sentence case, +0.01em from the token. */}
            <h2 className="text-h1" style={{ color: 'var(--color-ink)', margin: 0 }}>
              Prepare intake
            </h2>
            {onNewProject && (
              <Button variant="primary" size="sm" Icon={Plus} onClick={onNewProject}>
                New project
              </Button>
            )}
          </div>
          <p className="text-dense" style={{ color: 'var(--color-ink-3)', margin: '0 0 24px' }}>
            Upload source documents, classify them, and configure what the system should generate.
          </p>

          {/* ── Upload zone ──────────────────────────────────── */}
          {!hasFiles ? (
            <button type="button" onClick={() => inputRef.current?.click()} {...dropProps}
              className="rb-dropzone" data-dragging={dragging ? 'true' : undefined}
              style={{
                width: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12,
                padding: '48px 24px', borderRadius: 'var(--radius-control)', cursor: 'pointer',
              }}>
              <Upload size={30} className="rb-dropzone-icon" style={{ strokeWidth: 1.5 }} />
              {/* 🚨 A CONTROL IS A CONTROL EVEN WHEN ITS COPY IS IN A CHILD.
                  T0's rule 0 keys on the element's own tag, which is right for
                  the 241 uppercase sites that sit ON a <button>. This drop zone
                  IS the button and puts its copy in spans, so the tag rule saw
                  <span>, the uppercase rule fired, and the primary call to
                  action on the screen would have gone to the 11px floor while
                  the same copy on any other button in the app goes to 13 or 14.
                  §3.1's Label list — table headers, field labels, eyebrows,
                  Kbd, status badges — has no control on it. */}
              <span className="text-body" style={{ color: 'var(--color-ink-2)' }}>
                {dragging ? 'Drop to add' : 'Drop files or click to browse'}
              </span>
              {/* 🚨 CAPTION, AND THE REASON IS THE PAIR RATHER THAN THE INK.
                  The map put this on Dense, which left the drop zone's call to
                  action at 14px directly over its hint at 13 — one step apart,
                  same family, separated by nothing but a very dim pair of
                  greys. Caption restores the two-step gap the pair had before.

                  An earlier draft argued it from the INK: below 12.5px the map
                  promotes to Caption on a muted ink, `META_INK` lists the three
                  the F1 ladder replaces (`#78716c`, `#8d8986`, `#57534e`), and
                  this is `#44403c` — not an ink at all, but the old border
                  grey, which the ladder has not reached. True, and it does not
                  stop here: a reviewer found three sibling `#44403c` sites in
                  this same file. Two of them are `<p>` (`:343`, `:354`) and are
                  Dense by a rule that OUTRANKS the ink — T0's `DENSE_TAGS`
                  fires before `META_INK`, because a prose tag says what the
                  content IS. The third (`:294`, "No files uploaded yet") is an
                  empty state, not a hint, and §3.1 gives Caption "metadata,
                  hints, counts, timestamps".
                  So the ink observation is real but it is not the argument.
                  The argument is that a CTA and its own hint may not be one
                  step apart, and that does not generalise past this pair. */}
              <span className="text-caption" style={{ color: 'var(--color-ink-3)' }}>
                {[...ACCEPTED_EXTS].join('  ·  ')}
              </span>
            </button>
          ) : (
            <button type="button" onClick={() => inputRef.current?.click()} {...dropProps}
              className="rb-dropzone" data-size="compact" data-dragging={dragging ? 'true' : undefined}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 'var(--radius-control)', cursor: 'pointer',
                marginBottom: 16,
              }}>
              <Upload size={14} style={{ color: 'var(--color-ink-3)' }} />
              <span className="text-dense" style={{ color: 'var(--color-ink-3)' }}>
                Add more files
              </span>
            </button>
          )}

          <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR}
            onChange={e => { ingest(e.target.files); e.target.value = '' }}
            style={{ display: 'none' }} />

          {error && (
            <div className="flex items-start gap-2 text-dense" style={{ padding: '8px 0', color: 'var(--color-danger)' }}>
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* ── Files table ──────────────────────────────────── */}
          <div style={{ marginTop: hasFiles ? 0 : 24 }}>
            {hasFiles ? (
              <>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 10,
                }}>
                  <span className="text-label uppercase" style={{ color: 'var(--color-ink)' }}>
                    {files.length} file{files.length !== 1 ? 's' : ''}
                  </span>
                  {/* 🚨 SANS, AGAINST `classifyMono`, AND THE REASON IS ITS
                      OWN TWIN. The map returns KEEP here — `coreCount` and
                      `.length` are figures — and it returns KEEP for the
                      sticky footer's `{coreCount} core file(s) · {n}
                      persona(s)` too, which is the same kind of string at the
                      same Caption step, visible on the same screen at the same
                      time. That one was never asked, because the inventory
                      asks `classifyMono` only of sites that ALREADY carry
                      mono, and it was written in the sans.
                      So the mechanical answer was one of two identical
                      sentences in Geist Mono and the other in Geist. §3.1's
                      mono list says "numeric table cells"; neither of these is
                      a cell — both are a count set in a sentence — and T0's
                      own default is DROP, with keeping to be earned. Neither
                      earns it, so neither gets it. */}
                  <span className="text-caption" style={{ color: 'var(--color-ink-3)' }}>
                    {coreCount} core · {files.length - coreCount} reference
                  </span>
                </div>
                <ProjectFilesTable
                  files={files}
                  onUpdate={updateFile}
                  onDelete={removeFile}
                  maxHeight={280}
                />
                <p className="text-dense" style={{ color: 'var(--color-ink-3)', margin: '10px 0 0' }}>
                  The system analyzes all <span style={{ color: 'var(--color-ink)' }}>core files</span> to generate the project estimation.
                  Uncheck core to keep a file as reference only.
                </p>
              </>
            ) : (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '28px 16px', borderRadius: 'var(--radius-control)', border: '1px solid var(--color-rule)',
              }}>
                <FileText size={22} style={{ color: 'var(--color-ink-3)', marginBottom: 10 }} />
                <span className="text-dense" style={{ color: 'var(--color-ink-3)' }}>
                  No files uploaded yet
                </span>
              </div>
            )}
          </div>

          {/* ── Configuration ────────────────────────────────── */}
          <div style={{ marginTop: 32 }}>

            {/* Divider with label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-rule)' }} />
              <span className="text-label uppercase" style={{ color: 'var(--color-ink-3)' }}>
                Configuration
              </span>
              <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-rule)' }} />
            </div>

            {/* ── Personas ───────────────────────────────────── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
                <span className="text-label uppercase" style={{ color: 'var(--color-ink-3)', width: 84, flexShrink: 0 }}>
                  Personas
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PERSONA_LIST.map(p => {
                    const on = enabledPersonas.includes(p.id)
                    /* The kit's Chip (B1): a persona is a toggle filter,
                       and the Chip's one active treatment replaces the
                       orange fill under 13px text (C6: the walk counted all
                       three enabled personas). Same click, same toggle. */
                    return (
                      <Chip key={p.id} active={on} onClick={() => togglePersona(p.id)}>
                        {p.label}
                      </Chip>
                    )
                  })}
                </div>
              </div>
              <p className="text-dense" style={{ color: 'var(--color-ink-3)', margin: 0, paddingLeft: 100 }}>
                Each enabled persona biases the system's analysis of your documents.
              </p>
            </div>

            {/* ── Generation options ─────────────────────────── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
                <span className="text-label uppercase" style={{ color: 'var(--color-ink-3)', width: 84, flexShrink: 0 }}>
                  Generate
                </span>
                <p className="text-dense" style={{ color: 'var(--color-ink-3)', margin: 0 }}>
                  Select what the system should produce from the uploaded documents.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingLeft: 100 }}>
                {GENERATION_ITEMS.map(item => {
                  const Icon = item.icon
                  const checked = !!generationOptions[item.key]
                  const disabled = item.key === 'generate_scenes' && !scenesEnabled
                  return (
                    <label key={item.key}
                      className="rb-gen"
                      data-state={disabled ? 'disabled' : checked ? 'on' : 'off'}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '11px 16px', borderRadius: 'var(--radius-control)',
                      }}>
                      <input type="checkbox" checked={checked} disabled={disabled}
                        onChange={() => !disabled && toggleGen(item.key)}
                        className="accent-signal" style={{ width: 15, height: 15, marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <Icon size={14} className="rb-gen-icon" style={{ strokeWidth: 1.8 }} />
                          <span className="rb-gen-label text-dense font-semibold">
                            {item.label}
                          </span>
                        </div>
                        <span className="text-caption" style={{ color: 'var(--color-ink-3)', marginTop: 3, display: 'block' }}>
                          {disabled ? 'Enable scenes in project settings' : item.desc}
                        </span>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

          </div>

          {/* ── Overwrite warning ────────────────────────────── */}
          {hasExistingData && (
            <div style={{ marginTop: 28, padding: '16px 20px', borderRadius: 'var(--radius-control)', backgroundColor: 'var(--color-paper-raised)', border: '1px solid var(--color-rule)' }}>
              <div className="flex items-start gap-3">
                <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-ink)' }} />
                <div className="flex-1">
                  <p className="text-dense" style={{ color: 'var(--color-ink-2)', margin: 0 }}>
                    This project already has{' '}
                    <span style={{ color: 'var(--color-ink)' }}>
                      {[
                        existingDataCounts.phases > 0 && `${existingDataCounts.phases} phase${existingDataCounts.phases !== 1 ? 's' : ''}`,
                        existingDataCounts.assets > 0 && `${existingDataCounts.assets} asset${existingDataCounts.assets !== 1 ? 's' : ''}`,
                        existingDataCounts.tasks > 0 && `${existingDataCounts.tasks} task${existingDataCounts.tasks !== 1 ? 's' : ''}`,
                      ].filter(Boolean).join(', ')}
                    </span>.
                    Running intake will <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>permanently rewrite</span> all existing phases, assets, and tasks.
                  </p>
                  <label className="flex items-center gap-2.5 mt-3 cursor-pointer">
                    <input type="checkbox" checked={overwriteConfirmed}
                      onChange={e => onOverwriteConfirmedChange(e.target.checked)}
                      className="accent-signal" style={{ width: 15, height: 15 }} />
                    <span className="text-dense font-semibold" style={{ color: 'var(--color-ink)' }}>
                      I understand and want to proceed
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Sticky footer ──────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 36px', borderTop: '1px solid var(--color-rule)', backgroundColor: 'var(--color-paper)',
      }}>
        <span className="text-caption" style={{ color: 'var(--color-ink-3)' }}>
          {hasFiles
            ? `${coreCount} core file${coreCount === 1 ? '' : 's'} · ${enabledPersonas.length} persona${enabledPersonas.length === 1 ? '' : 's'}`
            : 'Upload files to begin'}
        </span>
        {/* The kit's primary Button: signal-fill with white, 5.18:1 at any
            size (C6). The "→" was one of the glyphs Geist's Latin subset does
            not draw (V1-01), and the button says what it does without it. */}
        <Button variant="primary" onClick={onRun} disabled={!canRun}>
          Run intake
        </Button>
      </div>
    </div>
  )
}
