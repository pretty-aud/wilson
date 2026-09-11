// ============================================================
// RABBIT — Bins: shared UI primitives (demo 2026-09-11)
// ============================================================
//
// UI overhaul F1 (2026-09-11): this file was the seed of the app-wide kit.
// Btn, IconBtn, Chip, Kbd, Menu, Modal, Field, TextInput, TextArea, Select,
// EmptyState, Spinner and Toggle now live in src/ui/ under their kit names
// and are re-exported here under the names the Bins files import, with every
// prop name they had. Nothing in views/bins/ changed its imports; the
// binsDialogs test renders each dialog once to prove it. B6 (plan §5)
// re-points the Bins files at src/ui directly and deletes the aliases.
//
// What stays here is Bins-specific: the local `C` colour object (read by
// every Bins file for its own inline colours until B6 moves them onto the
// tokens), MediaTag, ColorDot, ColorPicker and FlagMark, which draw the
// media-type and label-colour data from binMedia.
//
// 🚨 Behaviour is unchanged (C1): the kit's Dialog carries the modal stack,
// topmost-only Escape, busy lock and the onBeforeClose guard the Bins
// dialogs always had (Q17, ruled 2026-09-11: those three, nothing more).

import { Check, Ban, Circle } from 'lucide-react'
import { MEDIA_TYPE_META, COLOR_HEX, COLORS } from '../../bins/binMedia'
import {
  Button, IconButton, Chip, Kbd, Menu as UiMenu, Dialog, Field, Input, TextArea, Select,
  EmptyState, Spinner, Switch, overlayOpen,
} from '../../../../ui'

export const C = {
  bg: '#1c1917', panel: '#292524', deep: '#0c0a09', line: '#44403c', faint: '#292524',
  text: '#d6d3d1', bright: '#fff7ed', muted: '#a8a29e', dim: '#78716c', dimmer: '#57534e',
  accent: '#ea580c', accentBorder: '#c2410c', accentText: '#fb923c',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
}

// ── The kit, under the Bins names ─────────────────────────────────────────
export { Chip, Kbd, Field, TextArea, Select, EmptyState, Spinner, overlayOpen }
export { Button as Btn, IconButton as IconBtn, Input as TextInput, Switch as Toggle }

/** A Bins context menu. Items may carry `ColorDot: <colour name>`; the kit's
 *  Menu takes any leading node, so that field becomes a ColorDot here. */
export function Menu({ items, ...props }) {
  const mapped = (items || []).map(it => (it && it.ColorDot
    ? { ...it, leading: <ColorDot color={it.ColorDot} size={9} /> }
    : it))
  return <UiMenu items={mapped} {...props} />
}

/** The Bins modal: the kit's Dialog with the 640px default Bins' callers
 *  were written against (B6 moves them onto the named widths). */
export function Modal({ width = 640, ...props }) {
  return <Dialog width={width} {...props} />
}

// ── Bins-specific ──────────────────────────────────────────────────────────
export function MediaTag({ type, small = false, onClick, title }) {
  const meta = MEDIA_TYPE_META[type] || MEDIA_TYPE_META.other
  return (
    <span
      onClick={onClick}
      title={title || meta.label}
      className={`inline-flex items-center rounded-sm font-mono uppercase tracking-wider ${small ? 'px-1 text-[8.5px] leading-[14px]' : 'px-1.5 text-[9.5px] leading-[18px]'} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ color: meta.color, backgroundColor: meta.bg, border: `1px solid ${meta.color}33` }}
    >
      {small ? meta.short : meta.label}
    </span>
  )
}

export function ColorDot({ color, size = 10, onClick, title, hollow = false }) {
  const hex = color ? COLOR_HEX[color] : null
  return (
    <span
      onClick={onClick}
      title={title || (color ? color : 'no colour')}
      className={`inline-block rounded-full flex-shrink-0 ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        width: size, height: size,
        backgroundColor: hex && !hollow ? hex : 'transparent',
        border: hex ? `1.5px solid ${hex}` : `1px dashed ${C.dimmer}`,
      }}
    />
  )
}

export function ColorPicker({ value, onChange, size = 12 }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <ColorDot color={null} size={size} onClick={() => onChange(null)} title="No colour" />
      {COLORS.map(c => (
        <span key={c} onClick={() => onChange(c)} title={c}
          className="inline-flex items-center justify-center rounded-full cursor-pointer"
          style={{ width: size + 6, height: size + 6, border: value === c ? `1px solid ${C.bright}` : '1px solid transparent' }}>
          <ColorDot color={c} size={size} />
        </span>
      ))}
    </div>
  )
}

/** The review marks: ✓ select (green), ⊘ reject (red), ○ circled (orange). */
export function FlagMark({ flag, circled, size = 12, muted = false }) {
  const s = { width: size, height: size }
  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
      {flag === 'select' && <Check style={{ ...s, color: muted ? C.dim : C.green }} />}
      {flag === 'reject' && <Ban style={{ ...s, color: muted ? C.dim : C.red }} />}
      {circled && <Circle style={{ ...s, color: muted ? C.dim : C.accentText }} strokeWidth={2.5} />}
    </span>
  )
}
