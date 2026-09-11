// ============================================================
// IntakePrepare — consolidated step 1 of the intake wizard
// ============================================================
//
// Midcentury-modern typography:
//   DISPLAY / BODY  → geometric sans-serif (Century Gothic → Futura → system)
//   DATA            → monospace (for file names, sizes, technical info)
//
// The warm orange palette (#fb923c, #ea580c) leans into midcentury
// burnt-copper tones. Wide letter-spacing on labels, generous
// whitespace, and confident type hierarchy.

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

// UI overhaul F1 (2026-09-11): the private Century Gothic → Futura stack is
// gone (review R01 — it was the third face in the app and it actually
// resolved on Windows). SANS is now the app's one sans, read from `@theme`
// in src/index.css, so the inline sites below stay mechanical and keep
// working; DATA follows in Wave 1 (T2), which sweeps inline mono stacks.
const SANS = 'var(--font-sans)'
const DATA = "ui-monospace, 'SF Mono', 'Cascadia Code', monospace"

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
            <h2 style={{
              fontSize: 20, fontFamily: SANS, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.18em', color: '#fb923c',
              margin: 0,
            }}>
              Prepare Intake
            </h2>
            {onNewProject && (
              <button type="button" onClick={onNewProject}
                className="flex items-center gap-1.5 rounded transition-colors"
                style={{
                  padding: '7px 16px', fontSize: 11, fontFamily: SANS,
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em',
                  color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c',
                  cursor: 'pointer',
                }}>
                <Plus size={13} />
                New Project
              </button>
            )}
          </div>
          <p style={{ fontSize: 13, fontFamily: SANS, color: '#78716c', margin: '0 0 24px', lineHeight: 1.6, fontWeight: 400 }}>
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
              <span style={{ fontSize: 14, fontFamily: SANS, color: '#a8a29e', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}>
                {dragging ? 'Drop to add' : 'Drop files or click to browse'}
              </span>
              <span style={{ fontSize: 11, fontFamily: DATA, color: '#44403c', letterSpacing: '0.04em' }}>
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
              <span style={{ fontSize: 12, fontFamily: SANS, color: '#57534e', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>
                Add more files
              </span>
            </button>
          )}

          <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR}
            onChange={e => { ingest(e.target.files); e.target.value = '' }}
            style={{ display: 'none' }} />

          {error && (
            <div className="flex items-start gap-2" style={{ padding: '8px 0', fontSize: 12, fontFamily: SANS, color: '#fca5a5' }}>
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
                  <span style={{ fontSize: 11, fontFamily: SANS, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600 }}>
                    {files.length} file{files.length !== 1 ? 's' : ''}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: DATA, color: '#57534e' }}>
                    {coreCount} core · {files.length - coreCount} reference
                  </span>
                </div>
                <ProjectFilesTable
                  files={files}
                  onUpdate={updateFile}
                  onDelete={removeFile}
                  maxHeight={280}
                />
                <p style={{ fontSize: 11, fontFamily: SANS, color: '#57534e', margin: '10px 0 0', lineHeight: 1.6 }}>
                  The system analyzes all <span style={{ color: '#fb923c', fontWeight: 500 }}>core files</span> to generate the project estimation.
                  Uncheck core to keep a file as reference only.
                </p>
              </>
            ) : (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '28px 16px', borderRadius: 5, border: '1px solid #292524',
              }}>
                <FileText size={22} style={{ color: '#3a3733', marginBottom: 10 }} />
                <span style={{ fontSize: 12, fontFamily: SANS, color: '#44403c', letterSpacing: '0.04em' }}>
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
              <span style={{ fontSize: 11, fontFamily: SANS, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#57534e', fontWeight: 500 }}>
                Configuration
              </span>
              <div style={{ flex: 1, height: 1, backgroundColor: '#3a3733' }} />
            </div>

            {/* ── Personas ───────────────────────────────────── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontFamily: SANS, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#78716c', fontWeight: 600, width: 84, flexShrink: 0 }}>
                  Personas
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PERSONA_LIST.map(p => {
                    const on = enabledPersonas.includes(p.id)
                    return (
                      <button key={p.id} type="button" onClick={() => togglePersona(p.id)}
                        style={{
                          padding: '7px 16px', fontSize: 12, fontFamily: SANS,
                          borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s ease',
                          fontWeight: on ? 600 : 400, letterSpacing: '0.04em',
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
              <p style={{ fontSize: 11, fontFamily: SANS, color: '#44403c', margin: 0, paddingLeft: 100, lineHeight: 1.5 }}>
                Each enabled persona biases the system's analysis of your documents.
              </p>
            </div>

            {/* ── Generation options ─────────────────────────── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontFamily: SANS, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#78716c', fontWeight: 600, width: 84, flexShrink: 0 }}>
                  Generate
                </span>
                <p style={{ fontSize: 11, fontFamily: SANS, color: '#44403c', margin: 0, lineHeight: 1.5 }}>
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
                          <span style={{ fontSize: 13, fontFamily: SANS, fontWeight: 600, color: checked && !disabled ? '#d6d3d1' : '#78716c' }}>
                            {item.label}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, fontFamily: SANS, color: '#57534e', marginTop: 3, display: 'block', lineHeight: 1.4 }}>
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
                  <p style={{ fontSize: 13, fontFamily: SANS, color: '#a8a29e', lineHeight: 1.7, margin: 0 }}>
                    This project already has{' '}
                    <span style={{ color: '#d6d3d1', fontWeight: 500 }}>
                      {[
                        existingDataCounts.phases > 0 && `${existingDataCounts.phases} phase${existingDataCounts.phases !== 1 ? 's' : ''}`,
                        existingDataCounts.assets > 0 && `${existingDataCounts.assets} asset${existingDataCounts.assets !== 1 ? 's' : ''}`,
                        existingDataCounts.tasks > 0 && `${existingDataCounts.tasks} task${existingDataCounts.tasks !== 1 ? 's' : ''}`,
                      ].filter(Boolean).join(', ')}
                    </span>.
                    Running intake will <span style={{ color: '#fca5a5', fontWeight: 600 }}>permanently rewrite</span> all existing phases, assets, and tasks.
                  </p>
                  <label className="flex items-center gap-2.5 mt-3 cursor-pointer">
                    <input type="checkbox" checked={overwriteConfirmed}
                      onChange={e => onOverwriteConfirmedChange(e.target.checked)}
                      className="accent-orange-500" style={{ width: 15, height: 15 }} />
                    <span style={{ fontSize: 13, fontFamily: SANS, color: '#d6d3d1', fontWeight: 600 }}>
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
        <span style={{ fontSize: 12, fontFamily: SANS, color: '#57534e', letterSpacing: '0.02em' }}>
          {hasFiles
            ? `${coreCount} core file${coreCount === 1 ? '' : 's'} · ${enabledPersonas.length} persona${enabledPersonas.length === 1 ? '' : 's'}`
            : 'Upload files to begin'}
        </span>
        <button type="button" onClick={onRun} disabled={!canRun}
          style={{
            padding: '10px 24px', fontSize: 13, fontFamily: SANS,
            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em',
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
