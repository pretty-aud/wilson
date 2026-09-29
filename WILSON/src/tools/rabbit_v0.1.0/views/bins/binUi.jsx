// ============================================================
// RABBIT — Bins: the kit, under the names the Bins files import
// ============================================================
//
// This file was the seed of the app-wide kit: F1 promoted its thirteen
// primitives into src/ui/ (Button, IconButton, Chip, Kbd, Menu, Dialog,
// Field, Input, TextArea, Select, EmptyState, Spinner, Switch). Audrey ruled
// that Bins keep its own copies until its own session; that session is B6
// (UI overhaul, 2026-09-23), and the copies are gone. What is left:
//
//   1. Re-exports of the kit under the Bins names, so no Bins file — and
//      nothing in ScenesView, which renders four Bins components — changed
//      an import.
//   2. Thin adapters where the Bins prop contract differs from the kit's.
//      Every difference is written beside its adapter and in the B6 hand-off.
//   3. Four Bins-specific DATA components the kit has no counterpart for:
//      MediaTag (a media type's own colour), ColorDot and ColorPicker (a
//      label colour), FlagMark (the review marks).
//
// 🚨 `overlayOpen` is the KIT's (src/ui/overlay.js). The kit's Dialog and
// Menu register there, so the inspector's Space handler — the one Bins
// consumer — stands down while any kit dialog or menu is up, the Bins ones
// included. binsDialogs.test.jsx pins the identity and the counters.

import { useEffect, useRef } from 'react'
import { Check, Ban, Circle } from 'lucide-react'
import { MEDIA_TYPE_META, COLOR_HEX, COLORS } from '../../bins/binMedia'
import {
  Button, IconButton, Chip as KitChip, Kbd, Menu as KitMenu, Dialog, Field, Input, TextArea,
  Select as KitSelect, EmptyState, Spinner, Loading, Switch, Banner, StatusBadge, overlayOpen,
  modalDepth, PAPER, PAPER_RAISED, PAPER_RECESSED, INK_2, INK_3, RULE, SIGNAL, SUCCESS, DANGER, WARNING,
} from '../../../../ui'
// The Bins surface's own state (tree, table, tiles, pick lists, posters …).
import './bins.css'

// Bins' colour names, onto the kit's ladder (B04; F1's map: stone-300/400 →
// ink-2, stone-500/600 → ink-3). Five inks were three screens of stone plus a
// near-white, and two of them failed: #57534e at 2.29:1 and #78716c at 3.64:1
// on the paper. The two QUIET inks are custom properties with the token as the
// fallback, because ink-3 and the signal fail on the hover and selection
// grounds (3.75–4.33:1) and a hovered or selected row lifts them one step —
// see "the lift" in bins.css. And every ink is a property for "the dim" (review
// round 1): an offline, locked or missing row takes the disabled ink through
// them instead of an opacity that took its text to 2.35–3.47:1. A var() is a
// string like any colour here, except that nothing may append an alpha to it;
// binsCss.test.js holds that line.
const INK_PROP = 'var(--bn-ink, var(--color-ink))'
const INK_2_PROP = 'var(--bn-ink-2, var(--color-ink-2))'
const INK_3_PROP = 'var(--bn-ink-3, var(--color-ink-3))'
const SIGNAL_INK_PROP = 'var(--bn-signal-ink, var(--color-signal))'
export const C = {
  bg: PAPER, panel: PAPER_RAISED, deep: PAPER_RECESSED, line: RULE, faint: RULE,
  text: INK_2_PROP, bright: INK_PROP, muted: INK_2_PROP, dim: INK_3_PROP, dimmer: INK_3_PROP,
  accent: SIGNAL, accentBorder: SIGNAL, accentText: SIGNAL_INK_PROP,
  green: SUCCESS, red: DANGER, amber: WARNING,
}

// ── The kit, under the Bins names (identical contracts) ────────────────────
// Btn → Button: `primary` / `danger` / `small` are Button's own aliases.
//   Difference: an unsized Btn is the kit's md (36px, Body 14), where Bins'
//   was ~28px at 13px; toolbars pass `small` (28px, Dense 13).
// Toggle → Switch: `checked`, `onChange`, `label` unchanged. Difference: the
//   track is a real <button role="switch"> (focusable, Space / Enter), 36x20.
export { Kbd, Field, TextArea, EmptyState, Spinner, Loading, Banner, StatusBadge, overlayOpen }
// visibleOverlayOpen (below) is what the Bins keys and the preview's Space ask.
export { Button as Btn, Switch as Toggle }

// ── Adapters ───────────────────────────────────────────────────────────────

/** IconBtn → IconButton. Difference: Bins' default was the SMALL control
 *  (`size` 3.5 Tailwind units, 28px); the kit's default is md (36px), so an
 *  unsized IconBtn stays small here. A numeric size (3, 3.5) is 'sm'. */
export function IconBtn({ size = 'sm', ...props }) {
  return <IconButton size={typeof size === 'number' ? 'sm' : size} {...props} />
}

/** TextInput → Input, Select → Select. Difference: the kit's default field is
 *  md (36px); every Bins field sits in a dense rail, a dialog grid row or a
 *  toolbar and was ~26px, so they default to sm (28px) here. Every other prop
 *  — Escape reverts the edit, Enter commits through blur, `onCommit` — is the
 *  kit's, which was promoted from this file. */
export function TextInput({ size = 'sm', ...props }) {
  return <Input size={size} {...props} />
}
export function Select({ size = 'sm', ...props }) {
  return <KitSelect size={size} {...props} />
}

/** Chip → Chip. Difference (B05): a Bins chip carries a DATA colour (a media
 *  type's, a mark's). The kit fills an active chip with that colour under
 *  near-white 11px text — 1.9:1 on the selects green, which fails §3.2. Here
 *  the colour becomes the kit's own active treatment instead: a 16% tint of
 *  it with a full-strength 1px edge, the ink unchanged. The tint is a
 *  color-mix, so it works for ANY colour string (round 2: a var() slipped in
 *  used to pass through untinted and fill the chip solid, 3.15:1). */
const chipEdge = (c) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c) ? c.slice(0, 7) : c)
export function Chip({ color = null, style, ...props }) {
  const vars = color ? { '--chip-color': `color-mix(in srgb, ${chipEdge(color)} 16%, transparent)`, '--chip-edge': chipEdge(color) } : null
  return <KitChip style={vars || style ? { ...vars, ...style } : undefined} {...props} />
}

/** Menu → Menu. Difference: Bins items may carry `ColorDot: <colour name>`;
 *  the kit's Menu takes any leading node, so that field becomes a ColorDot. */
export function Menu({ items, ...props }) {
  const mapped = (items || []).map(it => (it && it.ColorDot
    ? { ...it, leading: <ColorDot color={it.ColorDot} size={9} /> }
    : it))
  return <KitMenu items={mapped} {...props} />
}

/** Modal → Dialog. Differences: the backdrop click Bins always had is kept
 *  (the kit's default is off — Q17); the width is one of the kit's four named
 *  widths (confirm 400 / form 560 / reading 720 / workbench 960), and Bins'
 *  own 520 / 640 / 820 / 860 moved onto them in B6; the kit adds focus
 *  management (initial focus, a Tab trap on the topmost dialog — F3) that the
 *  Bins modal never had.
 *
 *  🚨 C1, WHERE FOCUS ENDS AFTER A CLOSE (review round 1). The kit hands focus
 *  back to the control that opened the dialog. The Bins keys stand down for a
 *  focused button (a control's own Space and Enter are the control's), so
 *  after "click the offline count → Relink → Cancel", Space re-opened Relink
 *  instead of playing the preview, and Enter re-opened it instead of renaming.
 *  The Bins modal never moved focus: closed from INSIDE (a click, Enter on a
 *  footer button) focus fell to the page; closed with Escape it had never left
 *  the opener. This keeps exactly that: unless the last thing pressed was
 *  Escape, or another dialog is still open (a question stacked over the add
 *  dialog hands focus back inside it), the returned focus is let go. */
//  🚨 AND THE CAUSE IS TAKEN WHEN THE KIT CLOSES IT (review round 2). The first
//  version asked "was the LAST KEY Escape?" at unmount — so an Escape the
//  busy lock ignored during a long add, followed by the add finishing and the
//  view closing the dialog in code, kept focus on "Add files…", and Space
//  re-opened the picker. Now "closed by Escape" is recorded only at the moment
//  the kit calls `onClose` with Escape the last key; a dialog that unmounts any
//  other way — a footer button, a finished job, a parent's state — lets go.
//
//  🚨 AND AN ESCAPE KEEPS THE OPENER ONLY IF FOCUS NEVER ENTERED THE DIALOG
//  (review round 2, measured in the app). The old modal never took focus, so
//  whether Escape left focus on the opener depended on where focus WAS: on the
//  opener if nothing inside had it; on the page if a field inside had it — the
//  assign dialog and the take picker autofocus their search, so Escape there
//  dropped focus to the page and Space played the preview. The kit always lands
//  focus inside; its default landing is the header's close button. So focus
//  counts as having entered when a child took it at open (an `autoFocus`) or
//  when anything inside took it after (Tab, a click on a field).
export function Modal({ width = 'form', onClose, ...props }) {
  const openerRef = useRef(undefined)
  if (openerRef.current === undefined) openerRef.current = typeof document === 'undefined' ? null : document.activeElement
  const lastInputRef = useRef(null)
  const closedByEscapeRef = useRef(false)
  const enteredRef = useRef(false)
  useEffect(() => {
    const onKey = (e) => { lastInputRef.current = e.key }
    const onPointer = () => { lastInputRef.current = 'pointer' }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    // The kit's effect (a child's) has run: focus is inside, on the header's
    // close button unless a child asked for it first.
    const active = document.activeElement
    const surface = active?.closest?.('[role="dialog"]') || null
    enteredRef.current = !!(surface && !active.matches('.ui-dialog-head > button'))
    const onFocusIn = () => { enteredRef.current = true }
    surface?.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      surface?.removeEventListener('focusin', onFocusIn)
      const opener = openerRef.current
      const keepOnOpener = closedByEscapeRef.current && !enteredRef.current
      // After every cleanup of this commit — the kit's focus return included.
      setTimeout(() => {
        if (keepOnOpener || visibleOverlayOpen({ dialogsOnly: true })) return
        if (opener && opener !== document.body && document.activeElement === opener) opener.blur()
      }, 0)
    }
  }, [])
  const close = () => {
    closedByEscapeRef.current = lastInputRef.current === 'Escape'
    onClose?.()
  }
  return <Dialog width={width} dismissOnBackdrop onClose={close} {...props} />
}

/** Is a kit dialog (or menu) actually ON SCREEN? The kit's stack counts every
 *  open one — including one left open on a page the web build has hidden: every
 *  page stays mounted under `display: none`, and the browser's back / forward
 *  does not close dialogs. Review round 2 reproduced it: a Settings dialog left
 *  open behind a Forward to /rabbit held every Bins key dead, and the next Escape
 *  closed the invisible dialog. The desktop app cannot reach that state (the
 *  backdrop covers the nav), but the question the Bins keys ask is "is
 *  something in front of me?", and this is that question. */
export function visibleOverlayOpen({ dialogsOnly = false } = {}) {
  if (dialogsOnly ? modalDepth() === 0 : !overlayOpen()) return false
  if (typeof document === 'undefined') return true
  for (const n of document.querySelectorAll(dialogsOnly ? '.ui-dialog-backdrop' : '.ui-dialog-backdrop, .ui-menu')) {
    if (typeof n.checkVisibility !== 'function' || n.checkVisibility()) return true
  }
  return false
}

// ── Bins-specific data components ──────────────────────────────────────────

// binMedia's two grey hues are the retired stone inks (#a8a29e; #78716c, which
// fails at 3.61:1 even on its own tint): they take the ladder's inks. Every
// other hue is the type's own (B33 — Audrey's call; the reviewer's: keep).
const TAG_INK = { document: INK_2, other: INK_3 }

export function MediaTag({ type, small = false, onClick, title }) {
  const key = MEDIA_TYPE_META[type] ? type : 'other'
  const meta = MEDIA_TYPE_META[key]
  return (
    <span
      onClick={onClick}
      title={title || meta.label}
      className={`bn-tag inline-flex items-center rounded-control uppercase ${small ? 'px-1 text-label leading-[14px]' : 'px-1.5 text-label leading-[18px]'} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ '--tag-hue': TAG_INK[key] || meta.color }}
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
      className={`bn-dot inline-block rounded-full flex-shrink-0 ${onClick ? 'cursor-pointer' : ''}`}
      data-hollow={hollow ? 'true' : undefined}
      data-empty={hex ? undefined : 'true'}
      style={{ width: size, height: size, '--dot-color': hex || 'transparent' }}
    />
  )
}

export function ColorPicker({ value, onChange, size = 12 }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <ColorDot color={null} size={size} onClick={() => onChange(null)} title="No colour" />
      {COLORS.map(c => (
        <span key={c} onClick={() => onChange(c)} title={c}
          className="bn-swatch inline-flex items-center justify-center rounded-full cursor-pointer"
          data-selected={value === c ? 'true' : undefined}
          style={{ width: size + 6, height: size + 6 }}>
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
    <span className="bn-flags inline-flex items-center gap-0.5 flex-shrink-0" data-muted={muted ? 'true' : undefined}>
      {flag === 'select' && <Check style={{ ...s, color: C.green }} />}
      {flag === 'reject' && <Ban style={{ ...s, color: C.red }} />}
      {circled && <Circle style={{ ...s, color: C.accent }} strokeWidth={2.5} />}
    </span>
  )
}
