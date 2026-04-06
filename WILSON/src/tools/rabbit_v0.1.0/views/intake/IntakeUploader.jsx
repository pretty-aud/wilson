// ============================================================
// IntakeUploader — step 1 of the intake wizard
// ============================================================
//
// Drag-and-drop file picker. Accepts the file types the
// pipeline.js extractor knows about. Each accepted file is
// wrapped into the intake-file shape used downstream:
//
//   {
//     id, name, size, mimeType, dataUrl,
//     document_kind: null,        // filled by classifier step
//     is_core_definer: true,      // filled by core-definer step
//     ext,
//   }
//
// We read the file as a data URL up front so the rest of the
// wizard does not need to keep a live File reference around
// (which would be invalidated if the user navigated away).

import { useCallback, useRef, useState } from 'react'
import { Upload, FileText, X, AlertCircle } from 'lucide-react'

const ACCEPTED_EXTS = ['txt', 'md', 'markdown', 'fountain', 'docx', 'pdf', 'pptx']
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

function fmtBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function IntakeUploader({ files, onChange, onNext }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)

  const ingest = useCallback(async (fileList) => {
    setError(null)
    const arr = Array.from(fileList || [])
    if (arr.length === 0) return
    const accepted = []
    const rejected = []
    for (const f of arr) {
      const ext = extOf(f.name)
      if (!ACCEPTED_EXTS.includes(ext)) {
        rejected.push(f.name)
        continue
      }
      try {
        const dataUrl = await readDataUrl(f)
        accepted.push({
          id: `intake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: f.name,
          size: f.size,
          mimeType: f.type,
          dataUrl,
          ext,
          document_kind: null,
          is_core_definer: true,
        })
      } catch (err) {
        rejected.push(`${f.name} (${err.message || 'read error'})`)
      }
    }
    if (accepted.length > 0) onChange([...(files || []), ...accepted])
    if (rejected.length > 0) {
      setError(`Skipped: ${rejected.join(', ')}. Supported: ${ACCEPTED_EXTS.join(', ')}.`)
    }
  }, [files, onChange])

  function removeFile(id) {
    onChange((files || []).filter(f => f.id !== id))
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    ingest(e.dataTransfer.files)
  }

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
          Step 1 · Upload source documents
        </h2>
        <p className="text-[11px] font-mono mt-1" style={{ color: '#7c2d12' }}>
          Drop the briefs, treatments, scripts, decks, or notes that describe
          the project. The wizard will classify and chunk them in the next steps.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-2 p-8 rounded-sm transition-colors cursor-pointer"
        style={{
          backgroundColor: dragging ? '#fed7aa' : '#fff7ed',
          border: `2px dashed ${dragging ? '#ea580c' : '#7c2d12'}`,
          color: '#7c2d12',
        }}
      >
        <Upload className="w-8 h-8" />
        <span className="text-xs font-mono uppercase tracking-wider">
          {dragging ? 'Drop to add files' : 'Click or drop files here'}
        </span>
        <span className="text-[10px] font-mono">
          {ACCEPTED_EXTS.join(' · ')}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        onChange={(e) => { ingest(e.target.files); e.target.value = '' }}
        style={{ display: 'none' }}
      />

      {error && (
        <div
          className="flex items-start gap-2 p-2 rounded-sm text-[11px] font-mono"
          style={{ backgroundColor: '#fee2e2', border: '1px solid #991b1b', color: '#991b1b' }}
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* File list */}
      {(files || []).length > 0 && (
        <div className="flex-1 flex flex-col rounded-sm overflow-hidden" style={{ border: '2px solid #f4a261' }}>
          <div
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest"
            style={{ color: '#7c2d12', backgroundColor: '#f4a261', borderBottom: '1px solid #7c2d12' }}
          >
            {files.length} file{files.length === 1 ? '' : 's'} queued
          </div>
          <div className="flex-1 overflow-auto" style={{ backgroundColor: '#fff7ed' }}>
            {files.map(f => (
              <div
                key={f.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-orange-50"
                style={{ borderBottom: '1px solid #fed7aa' }}
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#7c2d12' }} />
                <span className="flex-1 text-xs font-mono truncate" style={{ color: '#1c1917' }}>{f.name}</span>
                <span className="text-[10px] font-mono" style={{ color: '#7c2d12' }}>{fmtBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="p-1 rounded-sm hover:bg-orange-200"
                  style={{ color: '#7c2d12' }}
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={(files || []).length === 0}
          className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
          style={{
            color: '#fff7ed',
            backgroundColor: '#ea580c',
            border: '2px solid #7c2d12',
          }}
        >
          Next: classify →
        </button>
      </div>
    </div>
  )
}
