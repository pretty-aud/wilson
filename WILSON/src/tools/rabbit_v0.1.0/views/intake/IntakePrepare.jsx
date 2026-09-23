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
          name: f.name, size: f.size, mimeType: f.type, dataUrl, ext,
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
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>

      <div className="flex-1 overflow-auto">
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 36px 28px' }}>

          {/* ── Title row ──────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            {/* An `uppercase` heading TAG is a heading, at h1/h2/h3 by its own
                px — not a label at the 11px floor. 20px clears the map's cliff
                at 18, so: text-h1, sentence case, +0.01em from the token. */}
            <h2 className="text-h1" style={{ color: '#fb923c', margin: 0 }}>
              Prepare Intake
            </h2>
            {onNewProject && (
              <button type="button" onClick={onNewProject}
                className="flex items-center gap-1.5 rounded-control transition-colors text-dense font-semibold"
                style={{
                  padding: '7px 16px',
                  color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c',
                  cursor: 'pointer',
                }}>
                <Plus size={13} />
                New Project
              </button>
            )}
          </div>
          <p className="text-dense" style={{ color: '#78716c', margin: '0 0 24px', lineHeight: 1.6 }}>
            Upload source documents, classify them, and configure what the system should generate.
          </p>

          {/* ── Upload zone ──────────────────────────────────── */}
          {!hasFiles ? (
            <button type="button" onClick={() => inputRef.current?.click()} {...dropProps}
              style={{
                width: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12,
                padding: '48px 24px', borderRadius: 6, cursor: 'pointer',
                backgroundColor: dragging ? '#292524' : 'transparent',
                border: `2px dashed ${dragging ? '#ea580c' : '#3a3733'}`,
                transition: 'all 0.15s ease',
              }}>
              <Upload size={30} style={{ color: dragging ? '#fb923c' : '#57534e', strokeWidth: 1.5 }} />
              {/* 🚨 A CONTROL IS A CONTROL EVEN WHEN ITS COPY IS IN A CHILD.
                  T0's rule 0 keys on the element's own tag, which is right for
                  the 241 uppercase sites that sit ON a <button>. This drop zone
                  IS the button and puts its copy in spans, so the tag rule saw
                  <span>, the uppercase rule fired, and the primary call to
                  action on the screen would have gone to the 11px floor while
                  the same copy on any other button in the app goes to 13 or 14.
                  §3.1's Label list — table headers, field labels, eyebrows,
                  Kbd, status badges — has no control on it. */}
              <span className="text-body" style={{ color: '#a8a29e' }}>
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
              <span className="text-caption" style={{ color: '#44403c' }}>
                {[...ACCEPTED_EXTS].join('  ·  ')}
              </span>
            </button>
          ) : (
            <button type="button" onClick={() => inputRef.current?.click()} {...dropProps}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 4, cursor: 'pointer',
                backgroundColor: dragging ? '#292524' : 'transparent',
                border: `1px dashed ${dragging ? '#ea580c' : '#3a3733'}`,
                marginBottom: 16, transition: 'all 0.15s ease',
              }}>
              <Upload size={14} style={{ color: '#57534e' }} />
              <span className="text-dense" style={{ color: '#57534e' }}>
                Add more files
              </span>
            </button>
          )}

          <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR}
            onChange={e => { ingest(e.target.files); e.target.value = '' }}
            style={{ display: 'none' }} />

          {error && (
            <div className="flex items-start gap-2 text-dense" style={{ padding: '8px 0', color: '#fca5a5' }}>
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
                  <span className="text-label uppercase" style={{ color: '#fb923c' }}>
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
                  <span className="text-caption" style={{ color: '#57534e' }}>
                    {coreCount} core · {files.length - coreCount} reference
                  </span>
                </div>
                <ProjectFilesTable
                  files={files}
                  onUpdate={updateFile}
                  onDelete={removeFile}
                  maxHeight={280}
                />
                <p className="text-dense" style={{ color: '#57534e', margin: '10px 0 0', lineHeight: 1.6 }}>
                  The system analyzes all <span style={{ color: '#fb923c' }}>core files</span> to generate the project estimation.
                  Uncheck core to keep a file as reference only.
                </p>
              </>
            ) : (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '28px 16px', borderRadius: 5, border: '1px solid #292524',
              }}>
                <FileText size={22} style={{ color: '#3a3733', marginBottom: 10 }} />
                <span className="text-dense" style={{ color: '#44403c' }}>
                  No files uploaded yet
                </span>
              </div>
            )}
          </div>

          {/* ── Configuration ────────────────────────────────── */}
          <div style={{ marginTop: 32 }}>

            {/* Divider with label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ flex: 1, height: 1, backgroundColor: '#3a3733' }} />
              <span className="text-label uppercase" style={{ color: '#57534e' }}>
                Configuration
              </span>
              <div style={{ flex: 1, height: 1, backgroundColor: '#3a3733' }} />
            </div>

            {/* ── Personas ───────────────────────────────────── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
                <span className="text-label uppercase" style={{ color: '#78716c', width: 84, flexShrink: 0 }}>
                  Personas
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PERSONA_LIST.map(p => {
                    const on = enabledPersonas.includes(p.id)
                    /* The weight is the SELECTED state, so it stays a
                       conditional — as a class, not as a declaration. Reading
                       the 600 arm as evidence about the element would decide
                       the unselected chip on the selected chip's evidence,
                       which is T0's trap 6. */
                    return (
                      <button key={p.id} type="button" onClick={() => togglePersona(p.id)}
                        className={`text-dense ${on ? 'font-semibold' : ''}`}
                        style={{
                          padding: '7px 16px',
                          borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s ease',
                          color: on ? '#fff7ed' : '#78716c',
                          backgroundColor: on ? '#ea580c' : 'transparent',
                          border: `1px solid ${on ? '#c2410c' : '#3a3733'}`,
                        }}>
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <p className="text-dense" style={{ color: '#44403c', margin: 0, paddingLeft: 100, lineHeight: 1.5 }}>
                Each enabled persona biases the system's analysis of your documents.
              </p>
            </div>

            {/* ── Generation options ─────────────────────────── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
                <span className="text-label uppercase" style={{ color: '#78716c', width: 84, flexShrink: 0 }}>
                  Generate
                </span>
                <p className="text-dense" style={{ color: '#44403c', margin: 0, lineHeight: 1.5 }}>
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
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '11px 16px', borderRadius: 5,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.3 : 1,
                        backgroundColor: checked && !disabled ? '#292524' : 'transparent',
                        border: `1px solid ${checked && !disabled ? '#44403c' : '#3a3733'}`,
                        transition: 'all 0.15s ease',
                      }}>
                      <input type="checkbox" checked={checked} disabled={disabled}
                        onChange={() => !disabled && toggleGen(item.key)}
                        className="accent-orange-500" style={{ width: 15, height: 15, marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <Icon size={14} style={{ color: checked && !disabled ? '#fb923c' : '#57534e', strokeWidth: 1.8 }} />
                          <span className="text-dense font-semibold" style={{ color: checked && !disabled ? '#d6d3d1' : '#78716c' }}>
                            {item.label}
                          </span>
                        </div>
                        <span className="text-caption" style={{ color: '#57534e', marginTop: 3, display: 'block' }}>
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
            <div style={{ marginTop: 28, padding: '16px 20px', borderRadius: 5, backgroundColor: '#292524', borderLeft: '3px solid #f97316' }}>
              <div className="flex items-start gap-3">
                <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" style={{ color: '#f97316' }} />
                <div className="flex-1">
                  <p className="text-dense" style={{ color: '#a8a29e', lineHeight: 1.7, margin: 0 }}>
                    This project already has{' '}
                    <span style={{ color: '#d6d3d1' }}>
                      {[
                        existingDataCounts.phases > 0 && `${existingDataCounts.phases} phase${existingDataCounts.phases !== 1 ? 's' : ''}`,
                        existingDataCounts.assets > 0 && `${existingDataCounts.assets} asset${existingDataCounts.assets !== 1 ? 's' : ''}`,
                        existingDataCounts.tasks > 0 && `${existingDataCounts.tasks} task${existingDataCounts.tasks !== 1 ? 's' : ''}`,
                      ].filter(Boolean).join(', ')}
                    </span>.
                    Running intake will <span className="font-semibold" style={{ color: '#fca5a5' }}>permanently rewrite</span> all existing phases, assets, and tasks.
                  </p>
                  <label className="flex items-center gap-2.5 mt-3 cursor-pointer">
                    <input type="checkbox" checked={overwriteConfirmed}
                      onChange={e => onOverwriteConfirmedChange(e.target.checked)}
                      className="accent-orange-500" style={{ width: 15, height: 15 }} />
                    <span className="text-dense font-semibold" style={{ color: '#d6d3d1' }}>
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
        padding: '14px 36px', borderTop: '1px solid #292524', backgroundColor: '#1c1917',
      }}>
        <span className="text-caption" style={{ color: '#57534e' }}>
          {hasFiles
            ? `${coreCount} core file${coreCount === 1 ? '' : 's'} · ${enabledPersonas.length} persona${enabledPersonas.length === 1 ? '' : 's'}`
            : 'Upload files to begin'}
        </span>
        <button type="button" onClick={onRun} disabled={!canRun}
          className="text-body font-semibold"
          style={{
            padding: '10px 24px',
            borderRadius: 4, cursor: canRun ? 'pointer' : 'default',
            color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c',
            opacity: canRun ? 1 : 0.25, transition: 'opacity 0.15s ease',
          }}>
          Run Intake →
        </button>
      </div>
    </div>
  )
}
