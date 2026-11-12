// StylePanel.jsx — MO4 boards: the style of what is selected, at the board's top right. Plain React, no Konva.
//
// It offers only what every selected kind can carry (shapes.js styleKeysFor, the server's keys for that kind) and
// shows a value when the selection shares it, blank when it does not. A change is a patch of style keys
// (onStyle); a null value puts that key back to the kind's default. The shape itself changes through onShape, the
// drawing order through onStack ('forward', 'backward', 'front', 'back'), and Delete removes the selection.
// "Frame selection" (onFrame) is offered when something selected is not a line tied at an end, and "Remove the frame only"
// (onFrameOnly) when every selected thing is a frame.
import { ArrowDown, ArrowUp, BringToFront, SendToBack, Trash2, AlignLeft, AlignCenter, AlignRight, Frame, Ungroup } from 'lucide-react'
import { IconButton, Select } from '../../../ui'
import { SHAPES, SHAPE_LABELS, styleKeysFor, resolveStyle } from './shapes.js'
import { isTied } from './frames.js'

export const SWATCHES = [
  { value: '#FFFFFF', label: 'White' },
  { value: '#E4E8ED', label: 'Light grey' },
  { value: '#2B3440', label: 'Charcoal' },
  { value: '#FFE58A', label: 'Yellow' },
  { value: '#FFC48A', label: 'Orange' },
  { value: '#F28B82', label: 'Red' },
  { value: '#F6AEDA', label: 'Pink' },
  { value: '#C7B3F5', label: 'Purple' },
  { value: '#9CC3FF', label: 'Blue' },
  { value: '#8EDBD3', label: 'Teal' },
  { value: '#B6E3A8', label: 'Green' },
]
const NONE = { value: 'none', label: 'No colour' }

const WIDTHS = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24]
const FONT_SIZES = [12, 14, 16, 20, 24, 32, 48, 64, 96]
const DASH_OPTIONS = [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]
const ROUTE_OPTIONS = [{ value: 'straight', label: 'Straight' }, { value: 'curved', label: 'Curved' }, { value: 'elbow', label: 'Square turns' }]
const HEAD_OPTIONS = [
  { value: 'none', label: 'None' }, { value: 'arrow', label: 'Arrow' }, { value: 'open_arrow', label: 'Open arrow' },
  { value: 'dot', label: 'Dot' }, { value: 'diamond', label: 'Diamond' },
]
const ALIGN_BUTTONS = [
  { value: 'left', label: 'Words to the left', Icon: AlignLeft },
  { value: 'center', label: 'Words in the middle', Icon: AlignCenter },
  { value: 'right', label: 'Words to the right', Icon: AlignRight },
]

/** The keys every selected element can carry. */
export function sharedKeys(elements) {
  let keys = null
  for (const el of elements) {
    const k = new Set(styleKeysFor(el.kind))
    keys = keys === null ? k : new Set([...keys].filter((x) => k.has(x)))
  }
  return keys ?? new Set()
}

// The value the selection shares for a key, as drawn (defaults filled in); undefined when they differ.
const RESOLVED = {
  fill: 'fill', stroke: 'stroke', width: 'width', dash: 'dash', text_colour: 'textColour', font_size: 'fontSize',
  align: 'align', opacity: 'opacity', corner: 'corner', route: 'route', start_head: 'startHead', end_head: 'endHead',
}
export function sharedValue(elements, key) {
  let out
  let first = true
  for (const el of elements) {
    const r = resolveStyle(el.kind, el.style)
    let v = r[RESOLVED[key]]
    if ((key === 'fill' || key === 'stroke' || key === 'text_colour') && v === null) v = 'none'
    if (first) { out = v; first = false } else if (out !== v) return undefined
  }
  return out
}

function Swatches({ label, value, allowNone, onPick, size }) {
  const options = allowNone ? [...SWATCHES, NONE] : SWATCHES
  return (
    <div role="group" aria-label={label} data-style-group={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={String(value).toLowerCase() === o.value.toLowerCase()}
          onClick={() => onPick(o.value)}
          style={{
            width: size, height: size, borderRadius: '50%', padding: 0, cursor: 'pointer',
            border: String(value).toLowerCase() === o.value.toLowerCase() ? '2px solid var(--color-accent, #3B82F6)' : '1px solid var(--color-rule, rgba(0,0,0,0.2))',
            background: o.value === 'none'
              ? 'linear-gradient(135deg, transparent 45%, #C62828 45%, #C62828 55%, transparent 55%), var(--color-paper, #fff)'
              : o.value,
          }}
        />
      ))}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--text-dense)', color: 'var(--color-ink-2, #555)' }}>{label}</span>
      {children}
    </div>
  )
}

export default function StylePanel({ elements = [], canWrite = false, inputMode = 'mouse', onStyle, onShape, onStack, onRemove, onFrame, onFrameOnly }) {
  if (!canWrite || !elements.length) return null
  // Frame selection needs something that is not a line tied at an end (a free line is framed as any thing);
  // "Remove the frame only" needs every one a frame.
  const canFrame = elements.some((el) => !isTied(el))
  const allFrames = elements.every((el) => el.kind === 'frame')
  const touch = inputMode === 'touch'
  const swatch = touch ? 30 : 20
  const size = touch ? 'md' : 'sm'
  const keys = sharedKeys(elements)
  const has = (k) => keys.has(k)
  const allShapes = elements.every((el) => el.kind === 'shape')
  const kinds = new Set(elements.map((el) => el.kind))
  const v = (k) => sharedValue(elements, k)
  const set = (k, value) => onStyle?.({ [k]: value })
  const fillNone = !kinds.has('sticky')
  const lineNone = !kinds.has('pen') && !kinds.has('connector')
  const opacity = v('opacity')
  const corner = v('corner')

  return (
    <aside
      className="moth-board-style"
      data-moth-board-style
      data-input={inputMode}
      aria-label="Style"
      style={{
        position: 'absolute', top: 12, right: 12, zIndex: 3, width: touch ? 260 : 220, maxHeight: 'calc(100% - 24px)',
        overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: touch ? 14 : 10, padding: touch ? 14 : 10,
        borderRadius: 10, border: '1px solid var(--color-rule, rgba(0,0,0,0.12))', background: 'var(--color-paper-raised, #fff)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)', color: 'var(--color-ink, #1F2933)',
      }}
    >
      {/* First, so what acts on the selection (its order, a frame around it, Delete) is in view however long the
          rows of style below grow: on a small board the panel scrolls, and these were under its fold. */}
      <Row label="Arrange">
        <div style={{ display: 'flex', gap: 2 }}>
          <IconButton size={size} Icon={ArrowUp} title="Bring forward" onClick={() => onStack?.('forward')} />
          <IconButton size={size} Icon={ArrowDown} title="Send backward" onClick={() => onStack?.('backward')} />
          <IconButton size={size} Icon={BringToFront} title="Bring to front" onClick={() => onStack?.('front')} />
          <IconButton size={size} Icon={SendToBack} title="Send to back" onClick={() => onStack?.('back')} />
          {canFrame && (
            <IconButton size={size} Icon={Frame} title="Frame selection (Ctrl+G)" data-action="frame-selection" onClick={() => onFrame?.()} />
          )}
          {allFrames && (
            <IconButton size={size} Icon={Ungroup} title="Remove the frame only (Ctrl+Shift+G)" data-action="frame-only" onClick={() => onFrameOnly?.()} />
          )}
          <span style={{ flex: 1 }} />
          <IconButton size={size} Icon={Trash2} title="Delete" danger onClick={() => onRemove?.()} />
        </div>
      </Row>
      {allShapes && (
        <Row label="Shape">
          <Select
            aria-label="Shape"
            size={size}
            value={elements.every((el) => el.shape === elements[0].shape) ? elements[0].shape : ''}
            placeholder={elements.every((el) => el.shape === elements[0].shape) ? null : 'Mixed'}
            options={SHAPES.map((s) => ({ value: s, label: SHAPE_LABELS[s] }))}
            onChange={(s) => { if (s) onShape?.(s) }}
          />
        </Row>
      )}
      {has('fill') && <Row label="Fill"><Swatches label="Fill" value={v('fill')} allowNone={fillNone} size={swatch} onPick={(c) => set('fill', c)} /></Row>}
      {has('stroke') && <Row label="Line"><Swatches label="Line" value={v('stroke')} allowNone={lineNone} size={swatch} onPick={(c) => set('stroke', c)} /></Row>}
      {(has('width') || has('dash')) && (
        <div style={{ display: 'flex', gap: 8 }}>
          {has('width') && (
            <Row label="Line width">
              <Select
                aria-label="Line width"
                size={size}
                value={v('width') === undefined ? '' : String(v('width'))}
                placeholder={v('width') === undefined ? 'Mixed' : null}
                options={WIDTHS.map((w) => ({ value: String(w), label: w === 0 ? 'No line' : String(w) }))}
                onChange={(w) => { if (w != null) set('width', Number(w)) }}
              />
            </Row>
          )}
          {has('dash') && (
            <Row label="Line style">
              <Select aria-label="Line style" size={size} value={v('dash') ?? ''} placeholder={v('dash') === undefined ? 'Mixed' : null} options={DASH_OPTIONS} onChange={(d) => { if (d) set('dash', d) }} />
            </Row>
          )}
        </div>
      )}
      {has('route') && (
        <Row label="Path">
          <Select aria-label="Path" size={size} value={v('route') ?? ''} placeholder={v('route') === undefined ? 'Mixed' : null} options={ROUTE_OPTIONS} onChange={(r) => { if (r) set('route', r) }} />
        </Row>
      )}
      {(has('start_head') || has('end_head')) && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Row label="Start">
            <Select aria-label="Start" size={size} value={v('start_head') ?? ''} placeholder={v('start_head') === undefined ? 'Mixed' : null} options={HEAD_OPTIONS} onChange={(h) => { if (h) set('start_head', h) }} />
          </Row>
          <Row label="End">
            <Select aria-label="End" size={size} value={v('end_head') ?? ''} placeholder={v('end_head') === undefined ? 'Mixed' : null} options={HEAD_OPTIONS} onChange={(h) => { if (h) set('end_head', h) }} />
          </Row>
        </div>
      )}
      {has('text_colour') && <Row label="Words"><Swatches label="Words" value={v('text_colour')} allowNone={false} size={swatch} onPick={(c) => set('text_colour', c)} /></Row>}
      {(has('font_size') || has('align')) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {has('font_size') && (
            <Row label="Size of words">
              <Select
                aria-label="Size of words"
                size={size}
                value={v('font_size') === undefined ? '' : String(v('font_size'))}
                placeholder={v('font_size') === undefined ? 'Mixed' : null}
                options={[...new Set([...FONT_SIZES, ...(v('font_size') === undefined ? [] : [v('font_size')])])].sort((a, b) => a - b).map((f) => ({ value: String(f), label: String(f) }))}
                onChange={(f) => { if (f != null) set('font_size', Number(f)) }}
              />
            </Row>
          )}
          {has('align') && (
            <div role="group" aria-label="Line up the words" style={{ display: 'flex', gap: 2 }}>
              {ALIGN_BUTTONS.map((a) => (
                <IconButton key={a.value} size={size} Icon={a.Icon} title={a.label} active={v('align') === a.value} onClick={() => set('align', a.value)} />
              ))}
            </div>
          )}
        </div>
      )}
      {has('opacity') && (
        <Row label="Opacity">
          <input
            type="range"
            aria-label="Opacity"
            min="0"
            max="100"
            step="5"
            value={Math.round((opacity ?? 1) * 100)}
            onChange={(e) => set('opacity', Number(e.target.value) / 100)}
          />
        </Row>
      )}
      {has('corner') && (
        <Row label="Corners">
          <input type="range" aria-label="Corners" min="0" max="64" step="1" value={Math.min(64, corner ?? 0)} onChange={(e) => set('corner', Number(e.target.value))} />
        </Row>
      )}
    </aside>
  )
}
