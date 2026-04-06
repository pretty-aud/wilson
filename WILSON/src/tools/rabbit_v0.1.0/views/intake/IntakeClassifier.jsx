// ============================================================
// IntakeClassifier — step 2 of the intake wizard
// ============================================================
//
// For each uploaded file, show the detected document_kind with
// a dropdown override. Detection runs the same hint table that
// pipeline.detectDocumentKind uses (extension → kind), and a
// few cheap text heuristics. The actual Haiku classifier only
// fires inside the pipeline run; here we keep it deterministic
// so the wizard never blocks on a network call.

import { useEffect } from 'react'
import { FileText, ChevronRight } from 'lucide-react'

export const DOCUMENT_KINDS = [
  'script', 'treatment', 'gdd', 'brief', 'pitch_bible',
  'lookbook', 'deck', 'outline', 'notes', 'other',
]

const EXTENSION_HINTS = {
  txt:      'notes',
  md:       'notes',
  markdown: 'notes',
  fountain: 'script',
  docx:     'treatment',
  pdf:      'treatment',
  pptx:     'deck',
}

function classifyByName(name) {
  const lower = String(name || '').toLowerCase()
  if (/script|screenplay|fountain/.test(lower)) return 'script'
  if (/treatment/.test(lower)) return 'treatment'
  if (/gdd|game.?design.?doc/.test(lower)) return 'gdd'
  if (/brief|rfp/.test(lower)) return 'brief'
  if (/pitch.?bible|world.?bible/.test(lower)) return 'pitch_bible'
  if (/lookbook|moodboard|references?/.test(lower)) return 'lookbook'
  if (/deck|slides|presentation/.test(lower)) return 'deck'
  if (/outline/.test(lower)) return 'outline'
  if (/notes/.test(lower)) return 'notes'
  return null
}

function detectKind(file) {
  // Honor an explicit override if the user already picked one.
  if (file.document_kind) return file.document_kind
  // Filename heuristic beats extension when it's strong.
  const byName = classifyByName(file.name)
  if (byName) return byName
  return EXTENSION_HINTS[file.ext] || 'notes'
}

export default function IntakeClassifier({ files, onChange, onBack, onNext }) {
  // First time we hit this step, fill in detected kinds for any
  // file that doesn't have one yet so the dropdowns aren't blank.
  useEffect(() => {
    if (!Array.isArray(files) || files.length === 0) return
    const needsDetection = files.some(f => !f.document_kind)
    if (!needsDetection) return
    onChange(files.map(f => ({
      ...f,
      document_kind: f.document_kind || detectKind(f),
    })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patch(id, kind) {
    onChange(files.map(f => f.id === id ? { ...f, document_kind: kind } : f))
  }

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
          Step 2 · Confirm document kinds
        </h2>
        <p className="text-[11px] font-mono mt-1" style={{ color: '#7c2d12' }}>
          The wizard guesses each document's kind from its name and
          extension. Adjust if a document was misclassified — the kind
          drives which chunker the pipeline uses.
        </p>
      </div>

      <div className="flex-1 overflow-auto rounded-sm" style={{ border: '2px solid #f4a261' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ backgroundColor: '#f4a261', borderBottom: '2px solid #7c2d12' }}>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#1c1917' }}>
                File
              </th>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#1c1917' }}>
                Kind
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map(f => (
              <tr key={f.id} style={{ borderBottom: '1px solid #fed7aa' }}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#7c2d12' }} />
                    <span className="text-xs font-mono truncate" style={{ color: '#1c1917' }}>{f.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={f.document_kind || detectKind(f)}
                    onChange={(e) => patch(f.id, e.target.value)}
                    className="px-2 py-1 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-700"
                    style={{
                      backgroundColor: '#fff',
                      color: '#1c1917',
                      border: '1px solid #7c2d12',
                    }}
                  >
                    {DOCUMENT_KINDS.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex items-center gap-1 px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{
            color: '#fff7ed',
            backgroundColor: '#ea580c',
            border: '2px solid #7c2d12',
          }}
        >
          Next: pick core definers
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
