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
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto" style={{ backgroundColor: '#1c1917' }}>
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: '#fb923c' }}>
          Step 3 · Pick core definers
        </h2>
        <p className="text-[11px] font-mono mt-1" style={{ color: '#a8a29e' }}>
          Mark which files actually drive the breakdown. The pipeline only
          reads the starred files; everything else stays attached for
          reference but is skipped during chunking.
        </p>
      </div>

      <div className="flex-1 overflow-auto rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ backgroundColor: '#44403c', borderBottom: '1px solid #57534e' }}>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#fb923c' }}>
                Core
              </th>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#fb923c' }}>
                File
              </th>
              <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#fb923c' }}>
                Kind
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map(f => {
              const Icon = f.is_core_definer ? Star : StarOff
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid #1c1917' }}>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleCore(f.id)}
                      className="p-1 rounded-sm hover:bg-stone-700"
                      title={f.is_core_definer ? 'Mark as supporting' : 'Mark as core'}
                    >
                      <Icon
                        className="w-4 h-4"
                        style={{ color: f.is_core_definer ? '#ea580c' : '#78716c' }}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#78716c' }} />
                      <span className="text-xs font-mono truncate" style={{ color: '#d6d3d1' }}>{f.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
                      {f.document_kind || '—'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-sm p-3" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: '#fb923c' }}>
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
                  color: on ? '#fff7ed' : '#a8a29e',
                  backgroundColor: on ? '#ea580c' : 'transparent',
                  border: `1px solid ${on ? '#c2410c' : '#44403c'}`,
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] font-mono mt-2" style={{ color: '#78716c' }}>
          Each enabled persona biases the LLM's reading of every chunk.
          All three are on by default.
        </p>
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: 'transparent' }}
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>
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
              border: '1px solid #c2410c',
            }}
          >
            Run intake →
          </button>
        </div>
      </div>
    </div>
  )
}
