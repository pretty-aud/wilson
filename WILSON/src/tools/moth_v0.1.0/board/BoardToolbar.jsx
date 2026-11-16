// BoardToolbar.jsx — MO4 boards: the tools down the board's left side, and the view's buttons along its foot (undo,
// redo, zoom). Plain React, no Konva; reached only through BoardCanvas, so it rides in the board's own chunk.
//
// A board this person may only read offers Select and Move around, nothing that makes or changes. The shape picker
// is a small grid of the nineteen shapes drawn from the same paths the canvas draws; while it is open it takes
// Escape first (the panel's Escape stack). Larger targets the moment a finger or a pen touches (inputMode).
//
// Below the tools, two that act at once rather than wait for a press on the board: "Picture or file" opens the file
// chooser (what is chosen is uploaded into the board's own folder and placed), and "Embed a file" opens the list of
// the project's files to show one where it is.
//
// At the end of the foot bar, "Background" opens a small list of the board's three backgrounds, each drawn as a
// swatch beside its name, the current one pressed. It closes on a choice, on Escape (first, as the shape picker) and
// on a press elsewhere. Offered only to those who may change the board, where the server knows backgrounds.
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, FileSymlink, Frame, Grid3x3, Hand, ImagePlus, MousePointer2, Pencil, Redo2, Scan, Shapes, Spline,
  StickyNote, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import { Button, IconButton } from '../../../ui'
import { SHAPES, SHAPE_LABELS, shapePath } from './shapes.js'
import { BACKGROUNDS, BACKGROUND_LABELS, DOT_COLOUR } from './background.js'

export const TOOLS = [
  { id: 'select', label: 'Select', key: 'v', Icon: MousePointer2, writes: false },
  { id: 'hand', label: 'Move around', key: 'h', Icon: Hand, writes: false },
  { id: 'shape', label: 'Shape', key: 's', Icon: Shapes, writes: true },
  { id: 'text', label: 'Text', key: 't', Icon: Type, writes: true },
  { id: 'sticky', label: 'Sticky note', key: 'n', Icon: StickyNote, writes: true },
  { id: 'frame', label: 'Frame', key: 'f', Icon: Frame, writes: true },
  { id: 'connector', label: 'Connector', key: 'l', Icon: Spline, writes: true },
  { id: 'pen', label: 'Pen', key: 'p', Icon: Pencil, writes: true },
]

// They add to the board, so a board this person may only read offers neither.
export const FILE_ACTIONS = [
  { id: 'media', label: 'Picture or file', key: 'i', Icon: ImagePlus },
  { id: 'embed', label: 'Embed a file', key: 'e', Icon: FileSymlink },
]

/** The tool a single key picks (no modifier), or null; a read-only board picks only the tools that do not write. */
export function toolForKey(key, canWrite) {
  const k = String(key || '').toLowerCase()
  const t = TOOLS.find((x) => x.key === k)
  if (!t) return null
  if (t.writes && !canWrite) return null
  return t.id
}

/** The file action a single key starts (no modifier), or null; none on a board this person may only read. */
export function actionForKey(key, canWrite) {
  if (!canWrite) return null
  const k = String(key || '').toLowerCase()
  return FILE_ACTIONS.find((x) => x.key === k)?.id ?? null
}

export function ShapeIcon({ shape, size = 20 }) {
  const w = size
  const h = shape === 'arrow' || shape === 'double_arrow' ? size * 0.6 : (shape === 'circle' || shape === 'connector_circle' ? size : size * 0.75)
  return (
    <svg width={size + 4} height={size + 4} viewBox={`-2 -2 ${size + 4} ${size + 4}`} aria-hidden="true" focusable="false">
      <path d={shapePath(shape, w, h)} transform={`translate(0 ${(size - h) / 2})`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/** A background drawn small: the board's page colour with its dots, its lines, or nothing. */
export function BackgroundSwatch({ kind, size = 20 }) {
  const marks = [size / 4, size / 2, (size * 3) / 4]
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" data-swatch={kind}>
      <rect x="0.5" y="0.5" width={size - 1} height={size - 1} rx="3" fill="#F7F8FA" stroke="var(--color-rule, rgba(0,0,0,0.15))" />
      {kind === 'dots' && marks.flatMap((x) => marks.map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill={DOT_COLOUR} />))}
      {kind === 'lines' && marks.map((p) => (
        <g key={p}>
          <line x1={p} y1="1" x2={p} y2={size - 1} stroke={DOT_COLOUR} strokeWidth="1" />
          <line x1="1" y1={p} x2={size - 1} y2={p} stroke={DOT_COLOUR} strokeWidth="1" />
        </g>
      ))}
    </svg>
  )
}

const bar = (touch) => ({
  position: 'absolute',
  display: 'flex',
  gap: touch ? 8 : 4,
  padding: touch ? 8 : 4,
  borderRadius: 10,
  border: '1px solid var(--color-rule, rgba(0,0,0,0.12))',
  background: 'var(--color-paper-raised, #fff)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  zIndex: 3,
  transition: 'gap 200ms var(--ease-response, ease-out), padding 200ms var(--ease-response, ease-out)',
})

export default function BoardToolbar({
  tool = 'select', shape = 'rectangle', onTool, onShape, canWrite = false, inputMode = 'mouse',
  canUndo = false, canRedo = false, onUndo, onRedo, zoom = 1, onZoomIn, onZoomOut, onFit, escape,
  onPickFiles, onEmbed, embedOpen = false, background = 'dots', canSetBackground = false, onBackground,
}) {
  const touch = inputMode === 'touch'
  const size = touch ? 'md' : 'sm'
  const [picking, setPicking] = useState(false)
  const pickerRef = useRef(null)
  const [choosingBg, setChoosingBg] = useState(false)
  const bgRef = useRef(null)
  const bgOpen = choosingBg && canWrite && canSetBackground

  // The background list takes Escape first while it is open, and closes on a press outside it and its button.
  useEffect(() => {
    if (!bgOpen || !escape?.push) return undefined
    const pop = escape.push(() => { setChoosingBg(false); return true })
    return () => { if (typeof pop === 'function') pop() }
  }, [bgOpen, escape])
  useEffect(() => {
    if (!bgOpen) return undefined
    const away = (e) => { if (bgRef.current && !bgRef.current.contains(e.target)) setChoosingBg(false) }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [bgOpen])
  // No longer offered (the board turned read-only): closed, so it does not come back open.
  useEffect(() => { if (!(canWrite && canSetBackground)) setChoosingBg(false) }, [canWrite, canSetBackground])

  // The picker takes Escape first while it is open.
  useEffect(() => {
    if (!picking || !escape?.push) return undefined
    const pop = escape.push(() => { setPicking(false); return true })
    return () => { if (typeof pop === 'function') pop() }
  }, [picking, escape])

  useEffect(() => {
    if (!picking) return undefined
    const away = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPicking(false) }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [picking])

  // A board turned read-only while a writing tool was in hand goes back to Select.
  useEffect(() => {
    if (!canWrite && TOOLS.find((t) => t.id === tool)?.writes) onTool?.('select')
  }, [canWrite, tool, onTool])

  const tools = TOOLS.filter((t) => canWrite || !t.writes)
  return (
    <>
      <div className="moth-board-tools" data-moth-board-tools data-input={inputMode} style={{ ...bar(touch), top: 12, left: 12, flexDirection: 'column' }}>
        {tools.map((t) => (
          <div key={t.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <IconButton
              size={size}
              Icon={t.id === 'shape' ? undefined : t.Icon}
              title={`${t.label} (${t.key.toUpperCase()})`}
              active={tool === t.id}
              onClick={() => onTool?.(t.id)}
              data-tool={t.id}
            >
              {t.id === 'shape' ? <ShapeIcon shape={shape} size={touch ? 20 : 16} /> : null}
            </IconButton>
            {t.id === 'shape' && (
              <IconButton
                size="sm"
                Icon={ChevronDown}
                title="Choose a shape"
                aria-expanded={picking}
                onClick={() => setPicking((v) => !v)}
                data-shape-picker-toggle
                style={{ width: touch ? 28 : 16, minWidth: 0 }}
              />
            )}
            {t.id === 'shape' && picking && (
              <div
                ref={pickerRef}
                role="group"
                aria-label="Shapes"
                data-shape-picker
                style={{
                  ...bar(touch), position: 'absolute', left: '100%', top: 0, marginLeft: 8, display: 'grid',
                  gridTemplateColumns: 'repeat(5, auto)', width: 'max-content',
                }}
              >
                {SHAPES.map((s) => (
                  <IconButton
                    key={s}
                    size={size}
                    title={SHAPE_LABELS[s]}
                    active={s === shape}
                    data-shape={s}
                    onClick={() => { onShape?.(s); onTool?.('shape'); setPicking(false) }}
                  >
                    <ShapeIcon shape={s} size={touch ? 22 : 18} />
                  </IconButton>
                ))}
              </div>
            )}
          </div>
        ))}
        {canWrite && (
          <div
            role="group"
            aria-label="Add a file"
            data-moth-board-file-actions
            style={{ display: 'flex', flexDirection: 'column', gap: touch ? 8 : 4, paddingTop: touch ? 8 : 4, borderTop: '1px solid var(--color-rule, rgba(0,0,0,0.12))' }}
          >
            {FILE_ACTIONS.map((a) => (
              <IconButton
                key={a.id}
                size={size}
                Icon={a.Icon}
                title={`${a.label} (${a.key.toUpperCase()})`}
                active={a.id === 'embed' && embedOpen}
                aria-expanded={a.id === 'embed' ? embedOpen : undefined}
                onClick={() => (a.id === 'media' ? onPickFiles?.() : onEmbed?.())}
                data-action={a.id}
                data-board-embed-toggle={a.id === 'embed' ? '' : undefined}
              />
            ))}
          </div>
        )}
      </div>
      <div className="moth-board-view" data-moth-board-view style={{ ...bar(touch), left: 12, bottom: 12, alignItems: 'center' }}>
        {canWrite && <IconButton size={size} Icon={Undo2} title="Undo" disabled={!canUndo} onClick={() => onUndo?.()} />}
        {canWrite && <IconButton size={size} Icon={Redo2} title="Redo" disabled={!canRedo} onClick={() => onRedo?.()} />}
        <IconButton size={size} Icon={ZoomOut} title="Zoom out" onClick={() => onZoomOut?.()} />
        <span aria-live="polite" data-zoom style={{ minWidth: 44, textAlign: 'center', fontSize: 'var(--text-dense)', color: 'var(--color-ink-2, #555)' }}>
          {`${Math.round((zoom || 1) * 100)}%`}
        </span>
        <IconButton size={size} Icon={ZoomIn} title="Zoom in" onClick={() => onZoomIn?.()} />
        <IconButton size={size} Icon={Scan} title="Show the whole board" onClick={() => onFit?.()} />
        {canWrite && canSetBackground && (
          <div ref={bgRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <IconButton
              size={size}
              Icon={Grid3x3}
              title="Background"
              active={bgOpen}
              aria-expanded={bgOpen}
              onClick={() => setChoosingBg((v) => !v)}
              data-board-background-toggle
            />
            {bgOpen && (
              <div
                role="group"
                aria-label="Board background"
                data-board-background-picker
                style={{
                  ...bar(touch), position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, flexDirection: 'column',
                  alignItems: 'stretch', width: 'max-content',
                }}
              >
                {/* The current one in the kit's one active treatment (IconButton's): the signal as a tint and an edge. */}
                {BACKGROUNDS.map((kind) => (
                  <Button
                    key={kind}
                    variant="ghost"
                    size={size}
                    aria-pressed={kind === background ? 'true' : 'false'}
                    data-background={kind}
                    onClick={() => { setChoosingBg(false); if (kind !== background) onBackground?.(kind) }}
                    style={{
                      justifyContent: 'flex-start', gap: 8,
                      ...(kind === background ? { background: 'var(--color-signal-tint)', borderColor: 'var(--color-signal)' } : {}),
                    }}
                  >
                    <BackgroundSwatch kind={kind} size={touch ? 24 : 20} />
                    {BACKGROUND_LABELS[kind]}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
