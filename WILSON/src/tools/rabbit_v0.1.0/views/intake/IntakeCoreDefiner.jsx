// ============================================================
// IntakeCoreDefiner — step 3 of the intake wizard
// ============================================================
//
// Lets the user mark which uploaded files are "core definers"
// (drive the actual breakdown — the script, the brief, the
// treatment) versus "supporting" (just attached for reference,
// e.g. a moodboard or a sample reel transcript).
//
// pipeline.runIngestion() filters down to the core files
// before extraction, so this step is the gate that decides
// what the LLM actually reads.
//
// Also lives the persona toggles for executive / creative /
// technical, since they're closely tied to the run config.

import { Star, StarOff, FileText } from 'lucide-react'
import { PERSONA_LIST } from '../../intake/personas'

export default function IntakeCoreDefiner({
  files, onChange,
  enabledPersonas, onPersonasChange,
  onBack, onRun,
}) {
  const coreCount = (files || []).filter(f => f.is_core_definer).length

  function toggleCore(id) {
    onChange(files.map(f => f.id === id ? { ...f, is_core_definer: !f.is_core_definer } : f))
  }

  function togglePersona(id) {
    if (enabledPersonas.includes(id)) {
      onPersonasChange(enabledPersonas.filter(p => p !== id))
    } else {
      onPersonasChange([...enabledPersonas, id])
    }
  }

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
          Step 3 · Pick core definers
        </h2>
        <p className="text-[11px] font-mono mt-1" style={{ color: '#7c2d12' }}>
          Mark which files actually drive the breakdown. The pipeline only
          reads the starred files; everything else stays attached for
          reference but is skipped during chunking.
        </p>
      </div>

      <div className="flex-1 overflow-auto rounded-sm" style={{ border: '2px solid #f4a261' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ backgroundColor: '#f4a261', borderBottom: '2px solid #7c2d12' }}>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#1c1917' }}>
                Core
              </th>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#1c1917' }}>
                File
              </th>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#1c1917' }}>
                Kind
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map(f => {
              const Icon = f.is_core_definer ? Star : StarOff
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid #fed7aa' }}>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleCore(f.id)}
                      className="p-1 rounded-sm hover:bg-orange-100"
                      title={f.is_core_definer ? 'Mark as supporting' : 'Mark as core'}
                    >
                      <Icon
                        className="w-4 h-4"
                        style={{ color: f.is_core_definer ? '#ea580c' : '#7c2d12' }}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#7c2d12' }} />
                      <span className="text-xs font-mono truncate" style={{ color: '#1c1917' }}>{f.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#7c2d12' }}>
                      {f.document_kind || '—'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-sm p-3" style={{ backgroundColor: '#fff7ed', border: '2px solid #f4a261' }}>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: '#7c2d12' }}>
          Producer personas
        </div>
        <div className="flex flex-wrap gap-2">
          {PERSONA_LIST.map(p => {
            const on = enabledPersonas.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePersona(p.id)}
                className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors"
                style={{
                  color: on ? '#fff7ed' : '#7c2d12',
                  backgroundColor: on ? '#ea580c' : 'transparent',
                  border: '2px solid #7c2d12',
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] font-mono mt-2" style={{ color: '#7c2d12' }}>
          Each enabled persona biases the LLM's reading of every chunk.
          All three are on by default.
        </p>
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono" style={{ color: '#7c2d12' }}>
            {coreCount} core file{coreCount === 1 ? '' : 's'} ·{' '}
            {enabledPersonas.length} persona{enabledPersonas.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={onRun}
            disabled={coreCount === 0 || enabledPersonas.length === 0}
            className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
            style={{
              color: '#fff7ed',
              backgroundColor: '#ea580c',
              border: '2px solid #7c2d12',
            }}
          >
            Run intake →
          </button>
        </div>
      </div>
    </div>
  )
}
