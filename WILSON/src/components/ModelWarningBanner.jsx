// =============================================================================
// ModelWarningBanner — Session 19, decision D6.
//
// When a configured AI model is dead or malformed, `resolveModel()` substitutes
// a working one so the generation still succeeds. That substitution must be
// visible. The whole reason S19 exists is that a model died and the failure
// reached users as a generic "try again" — nobody had anywhere to look.
//
// So this is deliberately not a toast: it does not time out, and it names the
// function and the bad model. It sits below the title bar rather than over the
// content, because it reports a degraded state, not an event — the work is
// still running, just not on the model someone chose.
//
// Dismissal is per-warning. Dismissing does not fix the setting, and the
// banner returns on the next call that resolves the same bad value.
// =============================================================================

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { subscribeModelWarnings, dismissModelWarning } from '../lib/activeModel'

export default function ModelWarningBanner() {
  const [warnings, setWarnings] = useState([])

  useEffect(() => subscribeModelWarnings(setWarnings), [])

  if (warnings.length === 0) return null

  return (
    <div style={{ position: 'relative', zIndex: 40 }}>
      {warnings.map((w) => (
        <div
          key={w.key}
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 14px',
            backgroundColor: 'rgba(180, 83, 9, 0.14)',
            borderBottom: '1px solid rgba(180, 83, 9, 0.35)',
            color: '#b45309',
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ flex: 1 }}>{w.text}</span>
          <button
            type="button"
            onClick={() => dismissModelWarning(w.key)}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              opacity: 0.7,
              padding: 2,
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
