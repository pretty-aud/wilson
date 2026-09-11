// =============================================================================
// DevFixturesBadge — the "DEV · fixtures" pill (dev builds only).
//
// Mounted once in App.jsx behind `import.meta.env.DEV &&`, so `vite build`
// drops both the element and this import. It renders only when a dev build was
// started with VITE_DEV_FIXTURES=1, and shows the state of the localStorage
// half of the switch: ON (with the fake project's name) and a button that
// turns it off for this browser profile, or OFF with a button that turns it
// back on. Either click reloads the page, so every seam re-decides at boot.
//
// It is also where refused writes surface: devWriteRefused() dispatches an
// event, this component pushes it as a toast on the app's one toast stack.
//
// Fixed at the top-left, under the Electron title bar (--titlebar-offset), out
// of the way of the hamburger on the right. It is the debug switch itself, so
// it is the one control the overhaul's C1 allows a session to add; it uses
// only @theme tokens.
// =============================================================================

import { useEffect, useState } from 'react'
import { useToast } from '../ui'
import {
  devFixturesConfigured, devFixturesActive, setDevFixturesActive, devFixtures, onDevWriteRefused,
} from './devFixtures'

const pill = {
  position: 'fixed',
  top: 'calc(var(--titlebar-offset, 0px) + 8px)',
  left: '12px',
  zIndex: 200,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  height: '24px',
  padding: '0 6px 0 10px',
  borderRadius: 'var(--radius-control)',
  background: 'var(--color-paper-raised)',
  color: 'var(--color-ink)',
  border: '1px solid var(--color-rule)',
  boxShadow: 'var(--shadow-float)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-label)',
  lineHeight: 'var(--text-label--line-height)',
  letterSpacing: 'var(--text-label--letter-spacing)',
  fontWeight: 'var(--text-label--font-weight)',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  WebkitAppRegion: 'no-drag',
}

const button = {
  height: '18px',
  padding: '0 6px',
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--color-rule)',
  background: 'transparent',
  color: 'var(--color-ink)',
  font: 'inherit',
  letterSpacing: 'inherit',
  textTransform: 'inherit',
  cursor: 'pointer',
}

export default function DevFixturesBadge() {
  const toast = useToast()
  const [active, setActive] = useState(() => devFixturesActive())

  useEffect(() => onDevWriteRefused((message) => {
    toast.push({ tone: 'warning', title: 'Dev fixtures', body: message, duration: 6000 })
  }), [toast])

  if (!devFixturesConfigured()) return null

  const label = devFixtures()?.label
  const flip = () => {
    setDevFixturesActive(!active)
    setActive(!active)
    window.location.reload()
  }

  return (
    <div
      style={pill}
      data-surface="dark"
      data-testid="dev-fixtures-badge"
      data-state={active ? 'on' : 'off'}
      title={active
        ? `Dev fixtures are ON: every table shows the fake project "${label ?? '…'}" from src/dev/fixtures. Nothing reaches Supabase. Click OFF to review the real (empty) tables.`
        : 'Dev fixtures are OFF for this browser profile (VITE_DEV_FIXTURES=1 is set). Click ON to load the fake project.'}
    >
      <span style={{ color: 'var(--color-signal)' }}>DEV</span>
      <span style={{ color: 'var(--color-ink-3)' }}>·</span>
      <span>fixtures {active ? 'on' : 'off'}</span>
      {active && label ? <span style={{ color: 'var(--color-ink-2)', textTransform: 'none', letterSpacing: 0 }}>{label}</span> : null}
      <button type="button" style={button} onClick={flip} aria-label={active ? 'Turn dev fixtures off' : 'Turn dev fixtures on'}>
        {active ? 'off' : 'on'}
      </button>
    </div>
  )
}
