// BoardCanvas.jsx — MO4 boards: the board itself, drawn with Konva, imperatively, inside one React component (no
// react-konva). Reached ONLY through React.lazy(() => import('./board/BoardCanvas.jsx')) in BoardPanel, so Konva and
// everything under board/ that draws lands in its own chunk, never in the Moth chunk or the main bundle.
//
// What it draws: every kind the server keeps — the nineteen shapes (shapes.js), connectors whose ends follow their
// elements by id and anchor (connectors.js), frames with names, pen strokes, text boxes, stickies (the markdown
// shown as text, edited in a textarea over the board through stickyTurn; on someone else's turn a soft glow and
// their name), pictures, a video's first frame, file tiles, and the stop-sign tile for a file that has gone.
//
// What it does: select (click, shift-click, a dragged rectangle), move (snapping to other elements' edges and
// centres, with guides), resize and rotate (Konva's Transformer), stacking, the style panel, the tools, undo and
// redo, pan and zoom (wheel, the hand, Space, a middle button, one finger on empty board, two-finger pinch). The
// targets grow the moment a finger or a pen touches (inputMode, as state/mothInputMode.js decides it).
//
// How it talks: to the board's state only through boardStore's API (add, update, remove, undo, redo; a drag, a
// resize or a turn is drawn by the canvas itself while the hand is on it and saved once, update(..., { settled: true
// }), when it lets go, never every frame); to the room through boardLive (sendPointer only while the pointer moves,
// sendDrag while something is dragged, cursors() to draw); to sticky turns through stickyTurn (begin, save, end,
// glow, and its events when it offers subscribe). Escape goes through the panel's Escape stack: while there is an
// editor, a gesture, a tool, a selection or the embed list to let go of, the canvas takes it first.
//
// Files: a picture's or a video's address comes from adapter.boardFileUrl (the element names its file, never where
// it is kept). Files dropped on the board, or chosen through "Picture or file", are uploaded into the board's own
// folder and placed where they were dropped (adapter.createMedia); "Embed a file" lists the project's files
// (EmbedPicker) and shows the chosen one where it is (adapter.embedFile).
import Konva from 'konva'
import { useEffect, useMemo, useRef, useState } from 'react'
import BoardToolbar, { actionForKey, toolForKey } from './BoardToolbar.jsx'
import StylePanel from './StylePanel.jsx'
import EmbedPicker from './EmbedPicker.jsx'
import {
  MISSING_WORDS, NEW_STYLE, TILE_WORDS, defaultSize, fileTileKind, keepsRatio, octagonPath, resolveStyle,
  sanitizeStyle, shapePath, textBoxFor,
} from './shapes.js'
import {
  connectorEnds, connectorRecord, connectorsTouching, containsPoint, endAngles, headShape, labelPoint, pickAnchor,
  routeBounds, routePoints, toBoard as localToBoard, trimForHeads,
} from './connectors.js'
import {
  boardToScreen, bottomZ, boundsOf, boxFrom, byStack, contains, fitCamera, grow, intersects, marqueeHits, nextZ,
  normRotation, pickCandidates, pinchCamera, restack, screenToBoard, snapBox, snapPoint, strokeRecord, unionBounds,
  viewRect, zoomAt,
} from './snapping.js'
import { TYPE, FONT_SANS } from '../../../ui/tokens.js'

export const READ_ONLY_WORDS = 'You can look at this board but not change it.'
export const TURN_ENDED_WORDS = 'Your turn on this sticky ended. Your words are still here: copy them before you close.'
export const UNREADABLE_WORDS = 'The words on this sticky could not be read just now.'
export const NO_STICKY_WORDS = 'Stickies need this project in the cloud.'
export const NO_FILES_WORDS = 'Pictures and files on a board need this project in the cloud.'
export const DROP_WORDS = 'Drop to add to the board'
export const writingWords = (label) => `${label || 'Someone'} is writing on this sticky.`
export const addingWords = (n) => (n === 1 ? 'Adding the file to the board…' : `Adding ${n} files to the board…`)

const MEDIA_MAX = { w: 480, h: 360 }
const MEDIA_STEP = 24
const SIZE_WAIT_MS = 2000

/** The size a placed file is drawn at: a picture keeps its own shape (fitted inside 480 by 360), a video is wide. */
export function mediaBox(kind, natural = null) {
  if (kind === 'picture' && natural && natural.w > 0 && natural.h > 0) {
    const s = Math.min(1, MEDIA_MAX.w / natural.w, MEDIA_MAX.h / natural.h)
    return { w: Math.max(40, Math.round(natural.w * s)), h: Math.max(40, Math.round(natural.h * s)) }
  }
  if (kind === 'video') return { w: 320, h: 180 }
  return { w: 240, h: 180 }
}

/** Whether a drag carries files (not words or a link dragged from elsewhere). */
export function dragHasFiles(evt) {
  const types = evt?.dataTransfer?.types
  if (!types) return false
  return typeof types.includes === 'function' ? types.includes('Files') : Array.from(types).includes('Files')
}

// A picture's own size, read from the file before it is uploaded; nothing when it cannot be read soon.
function naturalSize(file) {
  return new Promise((resolve) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Image !== 'function') { resolve(null); return }
    let url = null
    try { url = URL.createObjectURL(file) } catch { resolve(null); return }
    let done = false
    let timer = null
    const end = (v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { URL.revokeObjectURL(url) } catch { /* let go of with the page */ }
      resolve(v)
    }
    timer = setTimeout(() => end(null), SIZE_WAIT_MS)
    const img = new Image()
    img.onload = () => end(img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null)
    img.onerror = () => end(null)
    img.src = url
  })
}

const SELECT_COLOUR = '#3B82F6'
const GUIDE_COLOUR = '#E5487D'
const GLOW_COLOUR = '#F59E0B'
const DOUBLE_MS = 350
const STICKY_SAVE_MS = 1500
const GLOW_POLL_MS = 1000
const MAX_DRAG_SENDS = 20
const EDITABLE = new Set(['shape', 'text', 'frame', 'connector', 'sticky'])

/** The adaptive targets: larger the moment a finger or a pen touches (mothInputMode), back when a mouse moves. */
export function targetSizes(inputMode) {
  const touch = inputMode === 'touch'
  return {
    anchor: touch ? 22 : 10,
    handle: touch ? 14 : 7,
    hit: touch ? 28 : 12,
    snapPx: touch ? 10 : 6,
    slop: touch ? 8 : 4,
  }
}

/** What a Konva node under the pointer belongs to: an element, a connector's end handle, or the transformer. */
export function elementIdOf(node) {
  let n = node
  while (n) {
    if (typeof n.getClassName === 'function' && n.getClassName() === 'Transformer') return { transformer: true }
    const a = n.attrs || {}
    if (a.boardHandle) return { handle: a.boardHandle, connId: a.connId }
    if (a.elementId) return { id: a.elementId }
    n = typeof n.getParent === 'function' ? n.getParent() : null
  }
  return {}
}

const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d)
const round2 = (n) => {
  const v = Math.round(num(n) * 100) / 100
  return Object.is(v, -0) ? 0 : v
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
const wordsOf = (err) => (err && typeof err.message === 'string' && err.message) || 'That did not work just now.'
const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16))
const caf = (h) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(h) : clearTimeout(h))

// The board's words are drawn, measured and edited in the kit's face: FONT_SANS, the face the app's root sets.
const fontFamily = FONT_SANS
// The board's own words on it (whose turn a sticky is, a cursor's name): the Caption step, in that face.
const BOARD_CAPTION = { fontSize: TYPE.caption, fontFamily: FONT_SANS }

// An element's signature: the fields that change what is drawn. Positions 0, 1 and 4 (x, y, rotation) and 16
// (version) alone changing is a move: the group is placed again, its drawing kept.
const sigOf = (el) => [el.x, el.y, el.w, el.h, el.rotation, el.z, el.style, el.body, el.points, el.shape, el.file,
  el.missing, el.from_id, el.from_anchor, el.to_id, el.to_anchor, el.version]
const sameSig = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const MOVE_ONLY = new Set([0, 1, 4, 16])
const moveOnly = (a, b) => a.every((v, i) => MOVE_ONLY.has(i) || v === b[i])

/**
 * Mount the board on a host element. Answers the controller the component drives. `ui` receives what React shows:
 * onSelection(ids), onCamera(cam), onNotice(words), onEdit(editor | null), onBusy(bool), onTool(tool), onChange().
 */
export function mountBoard(host, init) {
  const { store, ui = {} } = init
  let adapter = init.adapter ?? null
  let live = init.live ?? null
  let turns = init.turns ?? null
  let canWrite = !!init.canWrite
  let inputMode = init.inputMode || 'mouse'
  let sizes = targetSizes(inputMode)
  let tool = 'select'
  let shapeKind = 'rectangle'
  let destroyed = false
  const say = (words) => { if (words) ui.onNotice?.(words) }

  const measure = () => ({ w: host.clientWidth || 800, h: host.clientHeight || 600 })
  let view = measure()
  const stage = new Konva.Stage({ container: host, width: view.w, height: view.h })
  const content = new Konva.Layer()
  const overlay = new Konva.Layer()
  stage.add(content)
  stage.add(overlay)
  const guides = new Konva.Group({ listening: false })
  const preview = new Konva.Group({ listening: false })
  const handles = new Konva.Group()
  const cursorsG = new Konva.Group({ listening: false })
  const marquee = new Konva.Rect({
    visible: false, listening: false, stroke: SELECT_COLOUR, strokeWidth: 1, dash: [4, 4], fill: 'rgba(59,130,246,0.08)',
    strokeScaleEnabled: false,
  })
  const tr = new Konva.Transformer({
    rotateEnabled: true, flipEnabled: false, ignoreStroke: true, anchorSize: sizes.anchor, borderStroke: SELECT_COLOUR,
    anchorStroke: SELECT_COLOUR, anchorFill: '#FFFFFF', anchorCornerRadius: 2, padding: 2,
    rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotationSnapTolerance: 4,
    boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 ? oldBox : newBox),
    anchorDragBoundFunc: (oldPos, newPos) => snapAnchor(newPos),
  })
  overlay.add(guides)
  overlay.add(preview)
  overlay.add(marquee)
  overlay.add(tr)
  overlay.add(handles)
  overlay.add(cursorsG)

  let cam = { x: view.w / 2, y: view.h / 2, scale: 1 }
  let fitted = false
  const nodes = new Map() // id -> { group, el, sig, box, ends, labelAt }
  const overrides = new Map() // id -> geometry while a gesture runs
  const selected = new Set()
  const pictures = new Map() // `${kind}:${file id}` -> { state, image }
  const stickyText = new Map() // element id -> { text, state, fileId }
  let glow = new Map()
  let endDrag = null // { id, end, point } while a connector's end is dragged
  let editor = null
  let editingId = null
  let action = null
  let transforming = null
  let lastDown = null
  let spaceHeld = false
  const touches = new Map()
  let pinch = null

  const all = () => store.getElements?.() ?? new Map()
  const boardId = () => store.getBoard?.()?.id ?? null
  function geom(id) {
    const el = nodes.get(id)?.el ?? all().get(id)
    if (!el) return null
    const o = overrides.get(id)
    return o ? { ...el, ...o } : el
  }
  const boxOf = (id) => nodes.get(id)?.box ?? (geom(id) ? boundsOf(geom(id)) : null)

  // ---- the camera -------------------------------------------------------------------------------------------
  function applyCamera(next) {
    cam = { x: num(next.x), y: num(next.y), scale: num(next.scale, 1) }
    stage.position({ x: cam.x, y: cam.y })
    stage.scale({ x: cam.scale, y: cam.scale })
    cull()
    drawHandles()
    drawCursors()
    if (editor) pushEditor()
    ui.onCamera?.({ ...cam })
    content.batchDraw()
    overlay.batchDraw()
  }
  function screenAt(evt) {
    const r = host.getBoundingClientRect()
    return { x: num(evt?.clientX) - r.left, y: num(evt?.clientY) - r.top }
  }
  function boardAt(evt) {
    const s = screenAt(evt)
    return screenToBoard(cam, s.x, s.y)
  }
  function allBounds() {
    return unionBounds([...nodes.keys()].map((id) => boxOf(id)))
  }
  function fit() {
    const b = allBounds()
    applyCamera(b ? fitCamera(b, view) : { x: view.w / 2, y: view.h / 2, scale: 1 })
  }
  function zoomBy(factor) {
    applyCamera(zoomAt(cam, view.w / 2, view.h / 2, factor))
  }

  // ---- painting -----------------------------------------------------------------------------------------------
  const paint = (s, area) => clean({
    fill: s.fill ?? (area ? 'rgba(0,0,0,0)' : undefined),
    fillEnabled: area || !!s.fill,
    stroke: s.stroke ?? undefined,
    strokeEnabled: !!s.stroke && s.width > 0,
    strokeWidth: s.width,
    dash: s.dashArray ?? undefined,
    dashEnabled: !!s.dashArray,
    lineCap: s.lineCap,
    lineJoin: 'round',
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
  })
  const words = (text, box, s, verticalAlign = 'top', extra = {}) => new Konva.Text(clean({
    x: box.x, y: box.y, width: Math.max(1, box.w), height: box.h == null ? undefined : Math.max(1, box.h),
    // board-type: an element's words, at the size the person chose for them
    text: String(text ?? ''), fontSize: s.fontSize, fontFamily, fill: s.textColour, align: s.align, verticalAlign,
    wrap: 'word', ellipsis: box.h != null, listening: false, perfectDrawEnabled: false, ...extra,
  }))

  function build(rec, el = geom(rec.el.id) ?? rec.el) {
    const g = rec.group
    g.destroyChildren()
    rec.dirty = false
    const isLine = el.kind === 'connector'
    g.setAttrs({ x: isLine ? 0 : num(el.x), y: isLine ? 0 : num(el.y), rotation: isLine ? 0 : num(el.rotation), scaleX: 1, scaleY: 1 })
    const s = resolveStyle(el.kind, el.style)
    g.opacity(s.opacity)
    rec.box = null
    switch (el.kind) {
      case 'shape': drawShape(rec, el, s); break
      case 'frame': drawFrame(rec, el, s); break
      case 'text': drawText(rec, el, s); break
      case 'pen': drawPen(rec, el, s); break
      case 'connector': drawConnector(rec, el, s); break
      case 'sticky': drawSticky(rec, el, s); break
      case 'media':
      case 'embed': drawFile(rec, el, s); break
      default: g.add(new Konva.Rect({ width: Math.max(1, num(el.w)), height: Math.max(1, num(el.h)), stroke: '#C9D1DB', dash: [4, 4], strokeWidth: 1 }))
    }
    if (!rec.box) rec.box = boundsOf(el)
  }

  function drawShape(rec, el, s) {
    const w = num(el.w)
    const h = num(el.h)
    rec.group.add(new Konva.Path({
      data: shapePath(el.shape, w, h, { corner: el.style?.corner }), ...paint(s, true), hitStrokeWidth: Math.max(sizes.hit, s.width),
    }))
    if (el.body && editingId !== el.id) rec.group.add(words(el.body, textBoxFor(el.shape, w, h), s, 'middle'))
  }

  function drawFrame(rec, el, s) {
    const w = Math.max(1, num(el.w))
    const h = Math.max(1, num(el.h))
    rec.group.add(new Konva.Rect({ width: w, height: h, cornerRadius: s.corner, ...paint(s, true) }))
    if (editingId === el.id) return
    rec.group.add(new Konva.Text({
      x: 0, y: -(s.fontSize + 8), width: Math.max(40, w), text: el.body && el.body.trim() ? el.body : 'Frame',
      // board-type: a frame's name, at the size the person chose for it
      fontSize: s.fontSize, fontFamily, fill: s.textColour, wrap: 'none', ellipsis: true, name: 'frame-title', perfectDrawEnabled: false,
    }))
  }

  function drawText(rec, el, s) {
    const w = Math.max(1, num(el.w))
    rec.group.add(new Konva.Rect({ width: w, height: Math.max(1, num(el.h), s.fontSize * 1.2), fill: 'rgba(0,0,0,0)' }))
    if (el.body && editingId !== el.id) rec.group.add(words(el.body, { x: 0, y: 0, w, h: null }, s))
  }

  function drawPen(rec, el, s) {
    const pts = Array.isArray(el.points) ? el.points.map((v) => num(v)) : null
    if (!pts || pts.length < 2) {
      // Points left out of a long message (points_omitted): the store fetches them; until then, its box.
      rec.group.add(new Konva.Rect({ width: Math.max(1, num(el.w)), height: Math.max(1, num(el.h)), stroke: '#C9D1DB', dash: [4, 4], strokeWidth: 1, fill: 'rgba(0,0,0,0)' }))
      return
    }
    const line = pts.length === 2 ? [...pts, pts[0] + 0.01, pts[1] + 0.01] : pts
    rec.group.add(new Konva.Line(clean({
      points: line, stroke: s.stroke ?? '#2B3440', strokeWidth: Math.max(0.5, s.width), lineCap: 'round', lineJoin: 'round',
      tension: line.length <= 4000 ? 0.35 : 0, dash: s.dashArray ?? undefined, dashEnabled: !!s.dashArray,
      hitStrokeWidth: Math.max(sizes.hit, s.width + 6), perfectDrawEnabled: false,
    })))
  }

  function drawConnector(rec, el, s) {
    const g = rec.group
    const ends = connectorEnds(el, geom)
    if (endDrag && endDrag.id === el.id) {
      const free = { ...endDrag.point, side: null, nx: 0, ny: 0 }
      if (endDrag.end === 'from') ends.start = free
      else ends.end = free
    }
    const route = routePoints(ends.start, ends.end, s.route, ends.bends)
    const line = trimForHeads(route, s.startHead, s.endHead, s.width)
    const colour = s.stroke ?? '#2B3440'
    g.add(new Konva.Line(clean({
      points: line.points, bezier: line.bezier, tension: line.tension, stroke: colour, strokeWidth: Math.max(0.5, s.width),
      dash: s.dashArray ?? undefined, dashEnabled: !!s.dashArray, lineCap: s.lineCap, lineJoin: 'round',
      hitStrokeWidth: Math.max(sizes.hit, s.width + 8), perfectDrawEnabled: false, name: 'connector-line',
    })))
    const a = endAngles(route)
    for (const [kind, tip, angle] of [[s.startHead, ends.start, a.start], [s.endHead, ends.end, a.end]]) {
      const head = headShape(kind, tip, angle, s.width)
      if (!head) continue
      g.add(new Konva.Path(clean({
        data: head.data, fill: head.filled ? colour : undefined, fillEnabled: head.filled, stroke: colour,
        strokeWidth: Math.max(1, s.width), lineJoin: 'round', lineCap: 'round', perfectDrawEnabled: false,
      })))
    }
    rec.labelAt = labelPoint(route)
    if (el.body && editingId !== el.id) {
      // board-type: a line's label, at the size the person chose for it
      const t = new Konva.Text({ text: el.body, fontSize: s.fontSize, fontFamily, fill: s.textColour, align: 'center', listening: false, perfectDrawEnabled: false })
      if (t.width() > 240) t.setAttrs({ width: 240, wrap: 'word' })
      const tw = t.width()
      const th = t.height()
      t.position({ x: rec.labelAt.x - tw / 2, y: rec.labelAt.y - th / 2 })
      g.add(new Konva.Rect({ x: rec.labelAt.x - tw / 2 - 6, y: rec.labelAt.y - th / 2 - 3, width: tw + 12, height: th + 6, fill: '#FFFFFF', cornerRadius: 4, opacity: 0.92 }))
      g.add(t)
    }
    rec.ends = ends
    rec.route = route
    rec.box = routeBounds(route)
  }

  function glowFor(id) {
    const g = glow.get(id)
    if (!g || g.mine) return null
    if (g.endsAt != null && num(g.endsAt) <= Date.now()) return null
    return g
  }
  const colourOf = (label) => (live?.people?.() ?? []).find((p) => p.label === label)?.colour ?? GLOW_COLOUR

  function drawSticky(rec, el, s) {
    if (el.missing) { drawMissing(rec, el); return }
    const g = rec.group
    const w = Math.max(1, num(el.w))
    const h = Math.max(1, num(el.h))
    const lit = glowFor(el.id)
    const colour = lit ? colourOf(lit.holderLabel) : null
    g.add(new Konva.Rect(clean({
      width: w, height: h, fill: s.fill ?? '#FFE58A', cornerRadius: s.corner,
      shadowColor: colour ?? 'rgba(0,0,0,0.22)', shadowBlur: colour ? 26 : 6, shadowOffsetY: colour ? 0 : 2,
      shadowOpacity: colour ? 0.9 : 1, stroke: colour ?? undefined, strokeWidth: colour ? 2 : 0, strokeEnabled: !!colour,
      perfectDrawEnabled: false, name: lit ? 'sticky-glow' : 'sticky-paper',
    })))
    const pad = Math.min(12, w * 0.08, h * 0.08)
    if (editingId !== el.id && el.file) g.add(words(stickyWords(el), { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad }, s, 'top', { name: 'sticky-words' }))
    if (lit) {
      const label = `${lit.holderLabel || 'Someone'} is writing`
      const t = new Konva.Text({ text: label, ...BOARD_CAPTION, fill: '#FFFFFF', padding: 4, listening: false, name: 'sticky-holder' })
      const tag = new Konva.Group({ x: 0, y: -t.height() - 4, listening: false })
      tag.add(new Konva.Rect({ width: t.width(), height: t.height(), fill: colour, cornerRadius: 4 }))
      tag.add(t)
      g.add(tag)
    }
  }

  function drawMissing(rec, el) {
    const g = rec.group
    const w = Math.max(1, num(el.w))
    const h = Math.max(1, num(el.h))
    g.add(new Konva.Rect({ width: w, height: h, fill: '#FFF4F2', stroke: '#E0B4AE', strokeWidth: 1, cornerRadius: 6, name: 'missing-tile' }))
    const r = Math.max(8, Math.min(60, Math.min(w, h) * 0.18))
    g.add(new Konva.Path({ data: octagonPath(w / 2, Math.min(h * 0.34, r + 12), r), fill: '#C62828', listening: false }))
    g.add(new Konva.Rect({ x: w / 2 - r * 0.55, y: Math.min(h * 0.34, r + 12) - r * 0.12, width: r * 1.1, height: r * 0.24, fill: '#FFFFFF', listening: false }))
    const fs = Math.max(9, Math.min(18, Math.min(w, h) / 11))
    const top = Math.min(h * 0.34, r + 12) + r + 8
    g.add(new Konva.Text({
      // board-type: the gone file's tile, its words grown with the tile
      x: 8, y: top, width: Math.max(1, w - 16), height: Math.max(1, h - top - 6), text: MISSING_WORDS, fontSize: fs, fontFamily,
      fill: '#7A1E1E', align: 'center', wrap: 'word', ellipsis: true, listening: false, name: 'missing-words',
    }))
  }

  function drawTile(rec, el, kind, name, s) {
    const g = rec.group
    const w = Math.max(1, num(el.w))
    const h = Math.max(1, num(el.h))
    g.add(new Konva.Rect({ width: w, height: h, fill: '#F4F6F8', stroke: '#C9D1DB', strokeWidth: 1, cornerRadius: s.corner, name: 'file-tile' }))
    const gs = Math.max(14, Math.min(72, Math.min(w, h) * 0.3))
    const cx = w / 2
    const cy = Math.min(h * 0.4, gs)
    let glyph
    if (kind === 'video') glyph = `M${cx - gs * 0.3} ${cy - gs * 0.4} L${cx + gs * 0.45} ${cy} L${cx - gs * 0.3} ${cy + gs * 0.4} Z`
    else if (kind === 'picture') glyph = `M${cx - gs / 2} ${cy + gs * 0.35} L${cx - gs * 0.15} ${cy - gs * 0.2} L${cx + gs * 0.1} ${cy + gs * 0.1} L${cx + gs * 0.25} ${cy - gs * 0.05} L${cx + gs / 2} ${cy + gs * 0.35} Z`
    else glyph = `M${cx - gs * 0.35} ${cy - gs / 2} H${cx + gs * 0.15} L${cx + gs * 0.35} ${cy - gs * 0.3} V${cy + gs / 2} H${cx - gs * 0.35} Z`
    g.add(new Konva.Path({ data: glyph, fill: '#8A96A3', listening: false }))
    const fs = Math.max(9, Math.min(16, Math.min(w, h) / 9))
    const top = cy + gs * 0.6 + 6
    g.add(new Konva.Text({
      // board-type: a file tile's name, its words grown with the tile
      x: 8, y: top, width: Math.max(1, w - 16), text: name ?`${name}\n${TILE_WORDS[kind]}` : TILE_WORDS[kind], fontSize: fs,
      fontFamily, fill: '#4A5563', align: 'center', wrap: 'char', ellipsis: true, height: Math.max(1, h - top - 4), listening: false,
      name: 'file-words',
    }))
  }

  function drawFile(rec, el, s) {
    if (el.missing) { drawMissing(rec, el); return }
    if (!el.file) { drawTile(rec, el, 'file', '', s); return }
    const kind = fileTileKind(el.file)
    const shows = kind === 'picture' || (kind === 'video' && el.kind === 'media')
    if (shows) {
      const pic = picture(el.file, kind)
      if (pic.state === 'ready' && pic.image) {
        rec.group.add(new Konva.Image({ image: pic.image, width: Math.max(1, num(el.w)), height: Math.max(1, num(el.h)), cornerRadius: s.corner, perfectDrawEnabled: false }))
        if (kind === 'video') {
          const r = Math.max(10, Math.min(28, Math.min(num(el.w), num(el.h)) * 0.12))
          const cx = num(el.w) / 2
          const cy = num(el.h) / 2
          rec.group.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: 'rgba(0,0,0,0.55)', listening: false }))
          rec.group.add(new Konva.Path({ data: `M${cx - r * 0.35} ${cy - r * 0.5} L${cx + r * 0.55} ${cy} L${cx - r * 0.35} ${cy + r * 0.5} Z`, fill: '#FFFFFF', listening: false }))
        }
        return
      }
    }
    drawTile(rec, el, kind, el.file.name, s)
  }

  // ---- files and sticky words -------------------------------------------------------------------------------
  function redrawFile(fileId) {
    if (destroyed) return
    for (const rec of nodes.values()) if (rec.el.file?.id === fileId) build(rec)
    content.batchDraw()
  }
  function picture(file, kind) {
    const key = `${kind}:${file.id}`
    let p = pictures.get(key)
    if (p) return p
    p = { state: 'loading', image: null }
    pictures.set(key, p)
    ;(async () => {
      let url = null
      try {
        // The element names its file and never where it is kept: boardFileUrl reads the row as this person may and
        // signs it. An adapter without it is asked as the file manager asks.
        const sign = typeof adapter?.boardFileUrl === 'function' ? adapter.boardFileUrl
          : typeof adapter?.fileUrl === 'function' ? adapter.fileUrl : null
        url = sign ? await sign.call(adapter, file, { stream: kind === 'video' }) : null
      } catch {
        url = null
      }
      if (destroyed) return
      if (!url || typeof document === 'undefined') { p.state = 'failed'; redrawFile(file.id); return }
      if (kind === 'video') {
        const v = document.createElement('video')
        v.muted = true
        v.playsInline = true
        v.preload = 'auto'
        v.addEventListener('loadeddata', () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2) } catch { /* the first frame stands */ } }, { once: true })
        v.addEventListener('seeked', () => { p.state = 'ready'; p.image = v; redrawFile(file.id) }, { once: true })
        v.addEventListener('error', () => { p.state = 'failed'; redrawFile(file.id) }, { once: true })
        v.src = url
      } else {
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => { p.state = 'ready'; p.image = img; redrawFile(file.id) }
        img.onerror = () => { p.state = 'failed'; redrawFile(file.id) }
        img.src = url
      }
    })()
    return p
  }

  function stickyWords(el) {
    const c = stickyText.get(el.id)
    if (!c || c.fileId !== el.file?.id || c.stale) loadStickyText(el)
    return stickyText.get(el.id)?.text ?? ''
  }
  function loadStickyText(el) {
    const prev = stickyText.get(el.id)
    if (prev?.state === 'loading' && prev.fileId === el.file?.id && !prev.stale) return
    const entry = { text: prev?.text ?? '', state: 'loading', fileId: el.file?.id ?? null, stale: false }
    stickyText.set(el.id, entry)
    if (typeof adapter?.readStickyText !== 'function' || !el.file) { entry.state = 'failed'; return }
    Promise.resolve()
      .then(() => adapter.readStickyText(el.file))
      .then((text) => { entry.text = String(text ?? ''); entry.state = 'ready' })
      .catch(() => { entry.state = 'failed' })
      .finally(() => {
        if (destroyed || stickyText.get(el.id) !== entry) return
        const rec = nodes.get(el.id)
        if (rec) { build(rec); content.batchDraw() }
      })
  }
  function staleSticky(id) {
    const c = stickyText.get(id)
    if (c) c.stale = true
    const rec = nodes.get(id)
    if (rec && rec.el.kind === 'sticky') build(rec)
  }

  // ---- reconciling with the store ---------------------------------------------------------------------------
  function sortLayer() {
    const ordered = [...nodes.values()].sort((a, b) => byStack(a.el, b.el))
    content.removeChildren()
    for (const r of ordered) content.add(r.group)
  }

  let reconRaf = 0
  function scheduleReconcile() {
    if (reconRaf || destroyed) return
    reconRaf = raf(() => { reconRaf = 0; reconcile() })
  }
  function reconcileNow() {
    if (reconRaf) { caf(reconRaf); reconRaf = 0 }
    reconcile()
  }

  function reconcile() {
    if (destroyed) return
    const els = all()
    const changed = new Set()
    let order = false
    let lostSelection = false
    for (const [id, rec] of nodes) {
      if (els.has(id)) continue
      rec.group.destroy()
      nodes.delete(id)
      overrides.delete(id)
      stickyText.delete(id)
      changed.add(id)
      order = true
      if (selected.delete(id)) lostSelection = true
      if (editor && editor.id === id) closeEditorGone()
    }
    for (const [id, el] of els) {
      let rec = nodes.get(id)
      if (!rec) {
        rec = { group: new Konva.Group({ elementId: id, name: 'board-element' }), el, sig: sigOf(el), box: null }
        nodes.set(id, rec)
        content.add(rec.group)
        changed.add(id)
        order = true
        continue
      }
      const sig = sigOf(el)
      if (sameSig(rec.sig, sig)) { rec.el = el; continue }
      if (num(rec.el.z) !== num(el.z)) order = true
      const onlyMoved = moveOnly(rec.sig, sig)
      rec.el = el
      rec.sig = sig
      changed.add(id)
      if (!onlyMoved || el.kind === 'connector') rec.dirty = true
      else if (!overrides.has(id)) {
        rec.group.setAttrs({ x: num(el.x), y: num(el.y), rotation: num(el.rotation) })
        rec.box = boundsOf(el)
      }
    }
    // A gesture in hand keeps drawing what the hand does: what changed under it is drawn when it lets go.
    for (const [id, rec] of nodes) {
      if (rec.el.kind === 'connector' || overrides.has(id)) continue
      if (rec.dirty || !rec.group.hasChildren()) build(rec)
    }
    // Connectors last: their ends read the elements they are tied to.
    for (const [id, rec] of nodes) {
      if (rec.el.kind !== 'connector') continue
      if (rec.dirty || !rec.group.hasChildren() || changed.has(rec.el.from_id) || changed.has(rec.el.to_id)) build(rec)
    }
    if (order) sortLayer()
    if (!fitted && store.getBoard?.()) {
      fitted = true
      if (nodes.size) fit()
    }
    refreshSelection()
    if (lostSelection) ui.onSelection?.([...selected])
    cull()
    ui.onChange?.()
    content.batchDraw()
    overlay.batchDraw()
  }

  function cull() {
    const vr = grow(viewRect(cam, view), 200 / cam.scale)
    for (const [id, rec] of nodes) {
      const vis = selected.has(id) || overrides.has(id) || intersects(vr, rec.box ?? boundsOf(rec.el))
      if (rec.group.visible() !== vis) rec.group.visible(vis)
    }
  }

  // ---- selection --------------------------------------------------------------------------------------------
  function setSelection(ids) {
    selected.clear()
    const els = all()
    for (const id of ids) if (els.has(id)) selected.add(id)
    refreshSelection()
    ui.onSelection?.([...selected])
  }
  function refreshSelection() {
    if (!tr.isTransforming?.()) {
      const trNodes = []
      for (const id of selected) {
        const rec = nodes.get(id)
        if (!rec || rec.el.kind === 'connector') continue
        rec.group.visible(true)
        trNodes.push(rec.group)
      }
      const single = trNodes.length === 1 ? nodes.get(trNodes[0].attrs.elementId)?.el : null
      tr.setAttrs({
        resizeEnabled: canWrite, rotateEnabled: canWrite, anchorSize: sizes.anchor, rotateAnchorOffset: sizes.anchor * 2.5,
        keepRatio: !!(single && single.kind === 'shape' && keepsRatio(single.shape)),
      })
      tr.nodes(trNodes)
      if (trNodes.length) tr.forceUpdate?.()
    }
    drawHandles()
    overlay.batchDraw()
  }
  function drawHandles() {
    handles.destroyChildren()
    for (const id of selected) {
      const rec = nodes.get(id)
      if (!rec || rec.el.kind !== 'connector' || !rec.route) continue
      handles.add(new Konva.Line(clean({
        points: rec.route.points, bezier: rec.route.bezier, tension: rec.route.tension, stroke: SELECT_COLOUR, opacity: 0.35,
        strokeWidth: 6, strokeScaleEnabled: false, listening: false, name: 'connector-highlight',
      })))
      if (!canWrite || selected.size > 10) continue
      for (const [end, p] of [['from', rec.ends.start], ['to', rec.ends.end]]) {
        handles.add(new Konva.Circle({
          x: p.x, y: p.y, radius: sizes.handle / cam.scale, fill: '#FFFFFF', stroke: SELECT_COLOUR, strokeWidth: 2 / cam.scale,
          boardHandle: end, connId: id, name: 'connector-handle',
        }))
      }
    }
  }
  function drawGuides(list) {
    guides.destroyChildren()
    for (const g of list) {
      const points = g.axis === 'x' ? [g.at, g.from, g.at, g.to] : [g.from, g.at, g.to, g.at]
      guides.add(new Konva.Line({ points, stroke: GUIDE_COLOUR, strokeWidth: 1, strokeScaleEnabled: false, listening: false, name: 'guide' }))
    }
  }
  function snapEntries(exclude) {
    const out = []
    for (const [id, rec] of nodes) {
      if (exclude.has(id) || rec.el.kind === 'connector' || !rec.group.visible()) continue
      out.push({ id, box: rec.box ?? boundsOf(rec.el) })
    }
    return out
  }
  function elementAt(p, exclude = new Set()) {
    const kids = content.getChildren()
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const id = kids[i].attrs.elementId
      if (!id || exclude.has(id) || !kids[i].visible()) continue
      const g = geom(id)
      if (!g || g.kind === 'connector') continue
      if (containsPoint(g, p)) return g
    }
    return null
  }

  // ---- gestures ---------------------------------------------------------------------------------------------
  function begin(a, evt) {
    action = { ...a, pointerId: evt?.pointerId ?? null }
    window.addEventListener('pointermove', onWinMove, true)
    window.addEventListener('pointerup', onWinUp, true)
    window.addEventListener('pointercancel', onWinCancel, true)
    ui.onBusy?.(true)
  }
  function finish() {
    window.removeEventListener('pointermove', onWinMove, true)
    window.removeEventListener('pointerup', onWinUp, true)
    window.removeEventListener('pointercancel', onWinCancel, true)
    action = null
    preview.destroyChildren()
    marquee.visible(false)
    drawGuides([])
    ui.onBusy?.(false)
    overlay.batchDraw()
  }
  const samePointer = (evt) => !action || action.pointerId == null || evt?.pointerId == null || evt.pointerId === action.pointerId
  function onWinMove(evt) { if (action && samePointer(evt)) step(evt) }
  function onWinUp(evt) { if (action && samePointer(evt)) end(evt) }
  function onWinCancel(evt) { if (action && samePointer(evt)) cancelAction() }

  function cancelAction() {
    if (!action) return
    const a = action
    if (a.type === 'move') {
      for (const id of a.starts.keys()) overrides.delete(id)
      for (const id of [...a.starts.keys(), ...a.touching]) { const rec = nodes.get(id); if (rec) build(rec) }
      refreshSelection()
    }
    if (a.type === 'end') {
      endDrag = null
      const rec = nodes.get(a.id)
      if (rec) build(rec)
      refreshSelection()
    }
    finish()
    content.batchDraw()
  }

  function onStageDown(e) {
    const evt = e?.evt || {}
    if (pinch || touches.size >= 2 || action) return
    if (evt.button != null && evt.button !== 0 && evt.button !== 1) return
    const hit = elementIdOf(e?.target)
    if (hit.transformer) return
    try { host.parentElement?.focus?.({ preventScroll: true }) } catch { /* focus is a courtesy */ }
    const p = boardAt(evt)
    const screen = { x: num(evt.clientX), y: num(evt.clientY) }
    const touchOnEmpty = evt.pointerType === 'touch' && tool === 'select' && !hit.id && !hit.handle
    if (evt.button === 1 || spaceHeld || tool === 'hand' || touchOnEmpty) {
      begin({ type: 'pan', screen, cam: { ...cam } }, evt)
      return
    }
    if (hit.handle && canWrite) {
      endDrag = { id: hit.connId, end: hit.handle, point: p }
      begin({ type: 'end', id: hit.connId, end: hit.handle }, evt)
      return
    }
    if (tool === 'select') { selectDown(hit.id, p, screen, evt); return }
    if (!canWrite) return
    if (tool === 'shape' || tool === 'frame') { begin({ type: 'draw', kind: tool, start: p, screen }, evt); return }
    if (tool === 'text') { placeText(p); return }
    if (tool === 'sticky') { placeSticky(p); return }
    if (tool === 'pen') { begin({ type: 'pen', pts: [p.x, p.y], last: p }, evt); drawPenPreview(); return }
    if (tool === 'connector') {
      const from = elementAt(p)
      begin({ type: 'connect', from: from?.id ?? null, fromAnchor: from ? pickAnchor(from, p, (sizes.handle * 2) / cam.scale) : null, start: p, screen }, evt)
    }
  }

  function selectDown(id, p, screen, evt) {
    const now = Date.now()
    if (id) {
      const dbl = !!lastDown && lastDown.id === id && now - lastDown.t < DOUBLE_MS
      lastDown = dbl ? null : { id, t: now }
      if (dbl) { beginEdit(id); return }
      let clickSelect = null
      if (evt.shiftKey || evt.metaKey || evt.ctrlKey) {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelection([...next])
        if (!selected.has(id)) return
      } else if (!selected.has(id)) setSelection([id])
      else if (selected.size > 1) clickSelect = id
      if (canWrite) startMove(p, screen, evt, clickSelect)
      return
    }
    lastDown = null
    const add = !!(evt.shiftKey || evt.metaKey || evt.ctrlKey)
    if (!add && selected.size) setSelection([])
    begin({ type: 'marquee', start: p, screen, add, base: [...selected] }, evt)
  }

  const tiedEnds = (el) => (el.from_id && all().has(el.from_id)) || (el.to_id && all().has(el.to_id))
  function startMove(p, screen, evt, clickSelect) {
    const els = all()
    const moving = new Set()
    for (const id of selected) {
      const el = els.get(id)
      if (!el || (el.kind === 'connector' && tiedEnds(el))) continue
      moving.add(id)
    }
    // A frame carries what lies wholly inside it.
    for (const id of [...moving]) {
      const el = els.get(id)
      if (el?.kind !== 'frame') continue
      const fb = boundsOf(el)
      for (const [oid, o] of els) {
        if (oid === id || moving.has(oid) || o.kind === 'connector') continue
        if (contains(fb, boundsOf(o))) moving.add(oid)
      }
    }
    if (!moving.size) return
    const starts = new Map([...moving].map((id) => { const g = geom(id); return [id, { x: num(g.x), y: num(g.y) }] }))
    const box0 = unionBounds([...moving].map((id) => boxOf(id)))
    const candidates = pickCandidates(snapEntries(moving), moving, viewRect(cam, view))
    const touching = [...connectorsTouching(els.values(), moving)].filter((id) => !moving.has(id))
    begin({ type: 'move', start: p, screen, starts, box0, candidates, touching, moved: false, clickSelect }, evt)
  }

  function step(evt) {
    const a = action
    const p = boardAt(evt)
    if (a.type === 'pan') {
      applyCamera({ ...a.cam, x: a.cam.x + (num(evt.clientX) - a.screen.x), y: a.cam.y + (num(evt.clientY) - a.screen.y) })
      return
    }
    if (a.type === 'marquee') {
      const r = boxFrom(a.start, p)
      marquee.setAttrs({ x: r.x, y: r.y, width: r.w, height: r.h, visible: true })
      overlay.batchDraw()
      return
    }
    if (a.type === 'move') { moveStep(a, p, evt); return }
    if (a.type === 'draw') {
      const r = boxFrom(a.start, p)
      preview.destroyChildren()
      const data = a.kind === 'frame' ? shapePath('rectangle', r.w, r.h) : shapePath(shapeKind, r.w, r.h)
      preview.add(new Konva.Path({ x: r.x, y: r.y, data, stroke: SELECT_COLOUR, strokeWidth: 1.5, strokeScaleEnabled: false, dash: [6, 4], fill: 'rgba(59,130,246,0.06)', name: 'draw-preview' }))
      overlay.batchDraw()
      return
    }
    if (a.type === 'pen') {
      if (Math.hypot(p.x - a.last.x, p.y - a.last.y) * cam.scale >= 1.5) {
        a.pts.push(round2(p.x), round2(p.y))
        a.last = p
        drawPenPreview()
      }
      return
    }
    if (a.type === 'connect') { connectPreview(a, p); return }
    if (a.type === 'end') {
      endDrag = { ...endDrag, point: p }
      const rec = nodes.get(a.id)
      if (rec) build(rec)
      drawHandles()
      highlightTarget(elementAt(p, new Set([a.id])))
      content.batchDraw()
      overlay.batchDraw()
    }
  }

  function moveStep(a, p, evt) {
    if (!a.moved && Math.hypot(num(evt.clientX) - a.screen.x, num(evt.clientY) - a.screen.y) < sizes.slop) return
    a.moved = true
    let dx = p.x - a.start.x
    let dy = p.y - a.start.y
    let found = []
    if (!evt.altKey && a.box0) {
      const s = snapBox({ ...a.box0, x: a.box0.x + dx, y: a.box0.y + dy }, a.candidates, sizes.snapPx / cam.scale)
      dx += s.dx
      dy += s.dy
      found = s.guides
    }
    for (const [id, o] of a.starts) {
      const pos = { x: round2(o.x + dx), y: round2(o.y + dy) }
      overrides.set(id, pos)
      const rec = nodes.get(id)
      if (!rec) continue
      if (rec.el.kind === 'connector') build(rec)
      else rec.group.position(pos)
    }
    for (const cid of a.touching) { const rec = nodes.get(cid); if (rec) build(rec) }
    drawGuides(found)
    if (tr.nodes().length) tr.forceUpdate?.()
    drawHandles()
    let sent = 0
    for (const id of a.starts.keys()) {
      if (sent >= MAX_DRAG_SENDS) break
      const o = overrides.get(id)
      live?.sendDrag?.(id, o.x, o.y)
      sent += 1
    }
    content.batchDraw()
    overlay.batchDraw()
  }

  function end(evt) {
    const a = action
    const p = boardAt(evt)
    if (a.type === 'move') {
      if (!a.moved) {
        finish()
        if (a.clickSelect) setSelection([a.clickSelect])
        return
      }
      const done = [...a.starts.keys()].map((id) => [id, overrides.get(id)])
      for (const [id] of done) overrides.delete(id)
      for (const [id, o] of done) if (o) store.update(id, { x: o.x, y: o.y }, { settled: true })
      finish()
      reconcileNow()
      return
    }
    if (a.type === 'marquee') {
      const r = boxFrom(a.start, p)
      finish()
      const entries = [...nodes].filter(([, rec]) => rec.group.visible()).map(([id, rec]) => ({ id, box: rec.box ?? boundsOf(rec.el) }))
      const hits = marqueeHits(entries, r)
      if (hits.length || !a.add) setSelection(a.add ? [...new Set([...a.base, ...hits])] : hits)
      return
    }
    if (a.type === 'draw') {
      finish()
      const small = Math.hypot(num(evt.clientX) - a.screen.x, num(evt.clientY) - a.screen.y) < sizes.slop * 2
      placeBox(a.kind, a.start, p, small)
      return
    }
    if (a.type === 'pen') {
      finish()
      const rec = strokeRecord(a.pts)
      if (!rec) return
      store.add({ kind: 'pen', ...rec, rotation: 0, z: nextZ(all().values()), style: { ...NEW_STYLE.pen } })
      reconcileNow()
      return
    }
    if (a.type === 'connect') {
      finish()
      const moved = Math.hypot(num(evt.clientX) - a.screen.x, num(evt.clientY) - a.screen.y) >= sizes.slop * 2
      if (!moved) return
      const plan = connectPlan(a, p)
      const id = store.add({
        kind: 'connector', ...connectorRecord(plan.ends.start, plan.ends.end), rotation: 0, z: nextZ(all().values()),
        style: { ...NEW_STYLE.connector }, from_id: plan.from_id, from_anchor: plan.from_anchor, to_id: plan.to_id, to_anchor: plan.to_anchor,
      })
      setTool('select')
      reconcileNow()
      setSelection([id])
      return
    }
    if (a.type === 'end') {
      const target = elementAt(p, new Set([a.id]))
      const el = geom(a.id)
      endDrag = null
      finish()
      if (!el) return
      const next = { ...el }
      const anchor = target ? pickAnchor(target, p, (sizes.handle * 2) / cam.scale) : null
      if (a.end === 'from') { next.from_id = target?.id ?? null; next.from_anchor = anchor } else { next.to_id = target?.id ?? null; next.to_anchor = anchor }
      const ends = connectorEnds(next, geom)
      if (!target) { if (a.end === 'from') ends.start = p; else ends.end = p }
      store.update(a.id, {
        ...connectorRecord(ends.start, ends.end, ends.bends), from_id: next.from_id ?? null, from_anchor: next.from_id ? next.from_anchor : null,
        to_id: next.to_id ?? null, to_anchor: next.to_id ? next.to_anchor : null,
      }, { settled: true })
      reconcileNow()
      return
    }
    finish()
  }

  function drawPenPreview() {
    const a = action
    preview.destroyChildren()
    preview.add(new Konva.Line({ points: a.pts.length === 2 ? [...a.pts, a.pts[0] + 0.01, a.pts[1] + 0.01] : a.pts, stroke: NEW_STYLE.pen.stroke, strokeWidth: NEW_STYLE.pen.width, lineCap: 'round', lineJoin: 'round', tension: 0.35, name: 'pen-preview' }))
    overlay.batchDraw()
  }

  function connectPlan(a, p) {
    const target = elementAt(p, new Set(a.from ? [a.from] : []))
    const tmp = {
      kind: 'connector', ...connectorRecord(a.start, p), from_id: a.from, from_anchor: a.from ? a.fromAnchor : null,
      to_id: target?.id ?? null, to_anchor: target ? pickAnchor(target, p, (sizes.handle * 2) / cam.scale) : null,
    }
    return { ...tmp, ends: connectorEnds(tmp, geom), target }
  }
  function connectPreview(a, p) {
    const plan = connectPlan(a, p)
    const route = routePoints(plan.ends.start, plan.ends.end, 'straight')
    preview.destroyChildren()
    preview.add(new Konva.Line({ points: route.points, stroke: SELECT_COLOUR, strokeWidth: 2, strokeScaleEnabled: false, dash: [6, 4], name: 'connect-preview' }))
    highlightTarget(plan.target)
    overlay.batchDraw()
  }
  function highlightTarget(target) {
    preview.find('.target').forEach((n) => n.destroy())
    if (!target) return
    preview.add(new Konva.Rect({
      x: target.x, y: target.y, width: num(target.w), height: num(target.h), rotation: num(target.rotation), stroke: SELECT_COLOUR,
      strokeWidth: 2, strokeScaleEnabled: false, name: 'target', listening: false,
    }))
  }

  function placeBox(kind, start, p, small) {
    const els = [...all().values()]
    let box
    if (small) {
      const d = defaultSize(kind, shapeKind)
      box = { x: round2(start.x - d.w / 2), y: round2(start.y - d.h / 2), w: d.w, h: d.h }
    } else {
      const r = boxFrom(start, p)
      box = { x: round2(r.x), y: round2(r.y), w: round2(Math.max(4, r.w)), h: round2(Math.max(4, r.h)) }
      if (kind === 'shape' && keepsRatio(shapeKind)) { const s = Math.max(box.w, box.h); box.w = s; box.h = s }
    }
    const id = kind === 'frame'
      ? store.add({ kind: 'frame', ...box, rotation: 0, z: bottomZ(els), style: { ...NEW_STYLE.frame }, body: 'Frame' })
      : store.add({ kind: 'shape', shape: shapeKind, ...box, rotation: 0, z: nextZ(els), style: { ...NEW_STYLE.shape } })
    setTool('select')
    reconcileNow()
    setSelection([id])
  }

  function placeText(p) {
    const d = defaultSize('text')
    const id = store.add({ kind: 'text', x: round2(p.x), y: round2(p.y - d.h / 2), w: d.w, h: d.h, rotation: 0, z: nextZ(all().values()), style: { ...NEW_STYLE.text }, body: '' })
    setTool('select')
    reconcileNow()
    beginEdit(id, { fresh: true })
  }

  async function placeSticky(p) {
    setTool('select')
    if (typeof adapter?.createSticky !== 'function') { say(NO_STICKY_WORDS); return }
    const board = store.getBoard?.() ?? null
    const d = defaultSize('sticky')
    const placement = { x: round2(p.x - d.w / 2), y: round2(p.y - d.h / 2), w: d.w, h: d.h, rotation: 0, z: nextZ(all().values()), style: { ...NEW_STYLE.sticky } }
    let res
    try {
      res = await adapter.createSticky(board, '', placement)
    } catch (err) {
      say(wordsOf(err))
      return
    }
    if (destroyed) return
    const id = await adoptSaved(res, board)
    if (!id) return
    reconcileNow()
    stickyText.set(id, { text: '', state: 'ready', fileId: all().get(id)?.file?.id ?? null, stale: false })
    beginEdit(id, { fresh: true })
  }

  // An element the adapter saved already (a sticky, a dropped file, an embed): the store adopts it, drawn and
  // undoable, or hears it as the room would. Answers its id once the board has it, else null.
  async function adoptSaved(res, board) {
    const made = res?.element?.kind ? res.element : (res?.kind ? res : null)
    const id = made?.id ?? res?.id ?? res?.saved?.[0]?.id ?? (Array.isArray(res) ? res[0]?.id : null)
    if (!id) return null
    if (!all().has(id)) {
      let els = made ? [made] : null
      if (!els && typeof adapter?.readBoardElements === 'function') {
        try { els = await adapter.readBoardElements(board?.id ?? boardId(), [id]) } catch { els = null }
      }
      if (destroyed) return null
      if (els?.length && typeof store.adopt === 'function') for (const el of els) store.adopt(el)
      else if (els?.length) store.applyRemote?.({ board: board?.id ?? boardId(), op: 'put', elements: els })
    }
    return destroyed || !all().has(id) ? null : id
  }

  const viewCentre = () => screenToBoard(cam, view.w / 2, view.h / 2)

  // Files dropped on the board or chosen through "Picture or file": each uploaded into the board's own folder and
  // placed at the drop (the middle of the view when chosen), one after another a little down and to the right, so
  // a handful dropped at once can each be seen. One that fails says why; the rest still go.
  async function placeFiles(list, at = null) {
    const files = Array.from(list || []).filter((f) => f && typeof f === 'object' && typeof f.size === 'number')
    if (!files.length) return []
    if (!canWrite) { say(READ_ONLY_WORDS); return [] }
    if (typeof adapter?.createMedia !== 'function') { say(NO_FILES_WORDS); return [] }
    const board = store.getBoard?.() ?? null
    const centre = at ?? viewCentre()
    say(addingWords(files.length))
    const placed = []
    let failed = false
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const kind = fileTileKind({ mime_type: file.type, name: file.name })
      const size = mediaBox(kind, kind === 'picture' ? await naturalSize(file) : null)
      if (destroyed) return placed
      const step = i * MEDIA_STEP
      const placement = {
        x: round2(centre.x - size.w / 2 + step), y: round2(centre.y - size.h / 2 + step), w: size.w, h: size.h, rotation: 0,
        z: nextZ(all().values()),
      }
      let res
      try {
        res = await adapter.createMedia(board, file, placement)
      } catch (err) {
        if (destroyed) return placed
        failed = true
        say(wordsOf(err))
        continue
      }
      if (destroyed) return placed
      const id = await adoptSaved(res, board)
      if (id) placed.push(id)
    }
    if (destroyed) return placed
    if (!failed) ui.onNotice?.(null)
    if (placed.length) { reconcileNow(); setSelection(placed) }
    return placed
  }

  // A file shown where it is: a reference, no copy. Placed in the middle of the view, at the size a placed file has.
  async function placeEmbed(file, at = null) {
    if (!file?.id) return null
    if (!canWrite) { say(READ_ONLY_WORDS); return null }
    if (typeof adapter?.embedFile !== 'function') { say(NO_FILES_WORDS); return null }
    const board = store.getBoard?.() ?? null
    const centre = at ?? viewCentre()
    const size = mediaBox(fileTileKind(file) === 'video' ? 'video' : 'file')
    const placement = { x: round2(centre.x - size.w / 2), y: round2(centre.y - size.h / 2), w: size.w, h: size.h, rotation: 0, z: nextZ(all().values()) }
    let res
    try {
      res = await adapter.embedFile(board, file.id, placement)
    } catch (err) {
      if (!destroyed) say(wordsOf(err))
      return null
    }
    if (destroyed) return null
    const id = await adoptSaved(res, board)
    if (!id) return null
    reconcileNow()
    setSelection([id])
    return id
  }

  // ---- files dragged in from the desktop --------------------------------------------------------------------
  let dropTimer = null
  function dropping(on) {
    clearTimeout(dropTimer)
    dropTimer = null
    ui.onDropping?.(!!on)
    // A drag that leaves the window says nothing: the highlight lets go when the drag stops passing over.
    if (on) dropTimer = setTimeout(() => ui.onDropping?.(false), 400)
  }
  function dragOver(evt) {
    if (!dragHasFiles(evt)) return false
    // Always taken, so a file let go of here is never opened by the window in place of the app.
    evt.preventDefault?.()
    if (evt.dataTransfer) { try { evt.dataTransfer.dropEffect = canWrite ? 'copy' : 'none' } catch { /* read-only in some engines */ } }
    if (canWrite) dropping(true)
    return true
  }
  function dragLeave(evt) {
    if (!dragHasFiles(evt)) return
    const to = evt.relatedTarget
    if (to && typeof host.parentElement?.contains === 'function' && host.parentElement.contains(to)) return
    dropping(false)
  }
  function drop(evt) {
    if (!dragHasFiles(evt)) return false
    evt.preventDefault?.()
    evt.stopPropagation?.()
    dropping(false)
    const files = Array.from(evt.dataTransfer?.files || [])
    if (!files.length) return true
    placeFiles(files, boardAt(evt))
    return true
  }

  // ---- resize and rotate ------------------------------------------------------------------------------------
  function liveGeometry(n, el) {
    const sx = Math.abs(n.scaleX())
    const sy = Math.abs(n.scaleY())
    return {
      x: round2(n.x()), y: round2(n.y()), w: round2(Math.max(1, num(el.w) * sx)), h: round2(Math.max(1, num(el.h) * sy)),
      rotation: normRotation(n.rotation()), sx, sy,
    }
  }
  function snapAnchor(abs) {
    if (!transforming || tr.getActiveAnchor?.() === 'rotater') return abs
    const b = screenToBoard(cam, abs.x, abs.y)
    const s = snapPoint(b, transforming.candidates, sizes.snapPx / cam.scale)
    drawGuides(s.guides)
    const back = boardToScreen(cam, s.x, s.y)
    return { x: back.x, y: back.y }
  }
  tr.on('transformstart', () => {
    const ids = new Set(tr.nodes().map((n) => n.attrs.elementId))
    transforming = { candidates: pickCandidates(snapEntries(ids), ids, viewRect(cam, view)) }
    ui.onBusy?.(true)
  })
  tr.on('transform', () => {
    const ids = new Set()
    for (const n of tr.nodes()) {
      const id = n.attrs.elementId
      const rec = nodes.get(id)
      if (!rec) continue
      const g = liveGeometry(n, rec.el)
      overrides.set(id, { x: g.x, y: g.y, w: g.w, h: g.h, rotation: g.rotation })
      ids.add(id)
    }
    for (const cid of connectorsTouching(all().values(), ids)) { const rec = nodes.get(cid); if (rec) build(rec) }
    drawHandles()
    content.batchDraw()
  })
  tr.on('transformend', () => {
    for (const n of tr.nodes()) {
      const id = n.attrs.elementId
      const rec = nodes.get(id)
      if (!rec) continue
      const el = rec.el
      const g = liveGeometry(n, el)
      overrides.delete(id)
      n.scale({ x: 1, y: 1 })
      const patch = { x: g.x, y: g.y, w: g.w, h: g.h, rotation: g.rotation }
      if (el.kind === 'pen' && Array.isArray(el.points)) patch.points = el.points.map((v, i) => round2(num(v) * (i % 2 ? g.sy : g.sx)))
      if (el.kind === 'text') patch.h = round2(Math.max(g.h, textHeight(el.body, g.w, resolveStyle('text', el.style).fontSize)))
      store.update(id, patch, { settled: true })
      build(rec, { ...el, ...patch })
    }
    transforming = null
    drawGuides([])
    ui.onBusy?.(false)
    reconcileNow()
  })

  function textHeight(text, width, fontSize) {
    const t = new Konva.Text({ text: String(text ?? '') || ' ', width: Math.max(1, width), fontSize, fontFamily, wrap: 'word' })
    const h = t.height()
    t.destroy()
    return h
  }

  // ---- editing words ----------------------------------------------------------------------------------------
  function editorBox(el) {
    if (!el) return null
    const s = resolveStyle(el.kind, el.style)
    let box
    let background = 'transparent'
    let rotation = num(el.rotation)
    let local = true
    if (el.kind === 'shape') box = textBoxFor(el.shape, el.w, el.h)
    else if (el.kind === 'sticky') {
      const pad = Math.min(12, num(el.w) * 0.08, num(el.h) * 0.08)
      box = { x: pad, y: pad, w: num(el.w) - 2 * pad, h: num(el.h) - 2 * pad }
      background = s.fill ?? '#FFE58A'
    } else if (el.kind === 'frame') {
      box = { x: 0, y: -(s.fontSize + 8), w: Math.max(160, num(el.w)), h: s.fontSize * 1.4 }
      background = '#FFFFFF'
    } else if (el.kind === 'text') box = { x: 0, y: 0, w: Math.max(40, num(el.w)), h: Math.max(num(el.h), s.fontSize * 1.4) }
    else {
      const at = nodes.get(el.id)?.labelAt ?? { x: num(el.x), y: num(el.y) }
      box = { x: at.x - 120, y: at.y - s.fontSize * 1.2, w: 240, h: s.fontSize * 2.4 }
      background = '#FFFFFF'
      rotation = 0
      local = false
    }
    const tl = local ? localToBoard(el, box.x, box.y) : { x: box.x, y: box.y }
    const sp = boardToScreen(cam, tl.x, tl.y)
    return {
      left: sp.x, top: sp.y, width: Math.max(1, box.w) * cam.scale, height: Math.max(1, box.h) * cam.scale, rotation,
      // board-type: the editing box, the person's size at this zoom
      fontSize: s.fontSize * cam.scale, colour: s.textColour, align: s.align, background,
    }
  }
  function pushEditor() {
    if (!editor) { ui.onEdit?.(null); return }
    ui.onEdit?.({
      id: editor.id, kind: editor.kind, text: editor.text, status: editor.status, words: editor.words,
      box: editorBox(geom(editor.id)),
    })
  }
  function redrawEditing(id) {
    const rec = nodes.get(id)
    if (rec) { build(rec); content.batchDraw() }
  }

  async function beginEdit(id, { fresh = false } = {}) {
    if (!canWrite) return
    const el = geom(id)
    if (!el || !EDITABLE.has(el.kind)) return
    if (editor) await endEdit()
    if (editor || destroyed) return
    if (el.kind === 'sticky') {
      if (el.missing || !el.file) return
      if (typeof turns?.begin !== 'function') { say(NO_STICKY_WORDS); return }
      let r
      try { r = await turns.begin(id) } catch (err) { say(wordsOf(err)); return }
      if (destroyed) return
      if (!r?.granted) { say(writingWords(r?.holderLabel)); return }
      let text = ''
      const kept = stickyText.get(id)
      if (fresh) text = ''
      else if (kept?.state === 'ready' && !kept.stale && kept.fileId === el.file?.id) text = kept.text
      else {
        try {
          text = String((await adapter?.readStickyText?.(el.file)) ?? '')
        } catch {
          try { turns.end?.(id) } catch { /* the turn lapses on its own */ }
          say(UNREADABLE_WORDS)
          return
        }
      }
      if (destroyed || !all().has(id)) { try { turns.end?.(id) } catch { /* gone */ } return }
      editor = { id, kind: 'sticky', text, saved: text, status: 'editing', words: null, fresh, timer: null, chain: Promise.resolve(true), closing: false }
    } else {
      const text = el.body ?? ''
      editor = { id, kind: el.kind, text, saved: text, status: 'editing', words: null, fresh, closing: false }
    }
    editingId = id
    setSelection([id])
    redrawEditing(id)
    pushEditor()
  }

  function editInput(text) {
    if (!editor || editor.status !== 'editing') return
    editor.text = String(text ?? '').slice(0, 10000)
    if (editor.kind === 'sticky') {
      clearTimeout(editor.timer)
      const ed = editor
      ed.timer = setTimeout(() => { ed.timer = null; saveSticky(ed) }, STICKY_SAVE_MS)
    }
    pushEditor()
  }

  function saveSticky(ed) {
    ed.chain = ed.chain.then(async () => {
      if (ed.status !== 'editing') return false
      if (ed.text === ed.saved) return true
      const text = ed.text
      const el = geom(ed.id)
      if (!el) return false
      let r
      try { r = await turns.save(el, text) } catch (err) { r = { ok: false, words: wordsOf(err) } }
      if (r?.ok) {
        ed.saved = text
        stickyText.set(ed.id, { text, state: 'ready', fileId: el.file?.id ?? null, stale: false })
        return true
      }
      // The turn ended (or the file moved): the words stay in the editor and it says so.
      ed.status = 'ended'
      ed.words = r?.words || TURN_ENDED_WORDS
      if (editor === ed) pushEditor()
      return false
    })
    return ed.chain
  }

  async function endEdit({ discard = false } = {}) {
    const ed = editor
    if (!ed || ed.closing) return
    ed.closing = true
    if (ed.kind === 'sticky') {
      clearTimeout(ed.timer)
      if (ed.status === 'editing' && !discard) {
        const ok = await saveSticky(ed)
        if (!ok && !destroyed) { ed.closing = false; return } // keeps the words in the editor and says so
      }
      if (editor === ed) { editor = null; editingId = null }
      try { turns?.end?.(ed.id) } catch { /* the turn lapses on its own */ }
      pushEditor()
      redrawEditing(ed.id)
      return
    }
    if (editor === ed) { editor = null; editingId = null }
    pushEditor()
    const el = all().get(ed.id)
    if (!el) return
    if (!discard) {
      if (el.kind === 'text' && !ed.text.trim()) {
        store.remove([ed.id])
        reconcileNow()
        return
      }
      if (ed.text !== (el.body ?? '')) {
        const patch = { body: ed.text }
        if (el.kind === 'text') patch.h = round2(Math.max(defaultSize('text').h, textHeight(ed.text, num(el.w), resolveStyle('text', el.style).fontSize)))
        store.update(ed.id, patch, { settled: true })
      }
    }
    redrawEditing(ed.id)
    reconcileNow()
  }

  function closeEditorGone() {
    const ed = editor
    editor = null
    editingId = null
    if (ed?.kind === 'sticky') { clearTimeout(ed.timer); try { turns?.end?.(ed.id) } catch { /* gone */ } }
    pushEditor()
  }

  // ---- what the panel and the keys ask ----------------------------------------------------------------------
  function setTool(next, shape) {
    if (shape) shapeKind = shape
    const t = next || 'select'
    if (t === tool) return
    tool = t
    ui.onTool?.(t)
  }
  function applyStyle(patch) {
    const els = all()
    for (const id of selected) {
      const el = els.get(id)
      if (!el) continue
      const merged = { ...(el.style || {}) }
      for (const [k, v] of Object.entries(patch || {})) { if (v == null) delete merged[k]; else merged[k] = v }
      const style = sanitizeStyle(el.kind, merged)
      if (JSON.stringify(style) !== JSON.stringify(el.style || {})) store.update(id, { style }, { settled: true })
    }
    reconcileNow()
  }
  function applyShape(shape) {
    const els = all()
    for (const id of selected) { const el = els.get(id); if (el?.kind === 'shape' && el.shape !== shape) store.update(id, { shape }, { settled: true }) }
    reconcileNow()
  }
  function stack(dir) {
    if (!canWrite || !selected.size) return
    for (const p of restack([...all().values()], [...selected], dir)) store.update(p.id, { z: p.z }, { settled: true })
    reconcileNow()
  }
  function removeSelection() {
    if (!canWrite || !selected.size) return
    const gone = new Set(selected)
    const els = all()
    // A connector tied to what goes keeps its end where it was drawn (the server frees that end).
    for (const cid of connectorsTouching(els.values(), gone)) {
      if (gone.has(cid)) continue
      const c = els.get(cid)
      const ends = nodes.get(cid)?.ends ?? connectorEnds(c, geom)
      const patch = { ...connectorRecord(ends.start, ends.end, ends.bends) }
      if (gone.has(c.from_id)) { patch.from_id = null; patch.from_anchor = null }
      if (gone.has(c.to_id)) { patch.to_id = null; patch.to_anchor = null }
      store.update(cid, patch, { settled: true })
    }
    if (editor && gone.has(editor.id)) closeEditorGone()
    store.remove([...gone])
    setSelection([])
    reconcileNow()
  }
  function nudge(dx, dy) {
    if (!canWrite) return
    const els = all()
    for (const id of selected) {
      const el = els.get(id)
      if (!el || (el.kind === 'connector' && tiedEnds(el))) continue
      store.update(id, { x: round2(num(el.x) + dx), y: round2(num(el.y) + dy) }, { settled: true })
    }
    reconcileNow()
  }

  function escape() {
    if (editor) { endEdit(); return true }
    if (action) { cancelAction(); return true }
    if (tool !== 'select') { setTool('select'); return true }
    if (selected.size) { setSelection([]); return true }
    return false
  }

  function key(e) {
    const t = e.target
    const tag = t?.tagName
    // Keys typed into a field, or pressed on a button or a link (Space and Enter press it), are theirs.
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || t?.isContentEditable) return false
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (k === ' ') { spaceHeld = true; return true }
    if (mod && (k === 'z' || k === 'Z')) { if (canWrite) { if (e.shiftKey) store.redo(); else store.undo(); reconcileNow() } return true }
    if (mod && (k === 'y' || k === 'Y')) { if (canWrite) { store.redo(); reconcileNow() } return true }
    if (mod && (k === 'a' || k === 'A')) { setSelection([...nodes.keys()]); return true }
    if ((k === 'Delete' || k === 'Backspace') && selected.size) { removeSelection(); return true }
    if (mod && (k === ']' || k === '}')) { stack(e.shiftKey ? 'front' : 'forward'); return true }
    if (mod && (k === '[' || k === '{')) { stack(e.shiftKey ? 'back' : 'backward'); return true }
    if (mod && (k === '=' || k === '+')) { zoomBy(1.25); return true }
    if (mod && k === '-') { zoomBy(0.8); return true }
    if (mod && k === '0') { applyCamera(zoomAt(cam, view.w / 2, view.h / 2, 1 / cam.scale)); return true }
    const step = e.shiftKey ? 10 : 1
    if (selected.size && k.startsWith('Arrow')) {
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k]
      if (d) { nudge(d[0], d[1]); return true }
    }
    if (k === 'Enter' && selected.size === 1) { beginEdit([...selected][0]); return true }
    if (!mod && !e.altKey) {
      const next = toolForKey(k, canWrite)
      if (next) { setTool(next); return true }
      const act = actionForKey(k, canWrite)
      if (act === 'media') { ui.onPickFiles?.(); return true }
      if (act === 'embed') { ui.onEmbed?.(); return true }
    }
    return false
  }
  function keyUp(e) { if (e.key === ' ') spaceHeld = false }

  // ---- the room: cursors and sticky turns -------------------------------------------------------------------
  const cursorNodes = new Map()
  let cursorRaf = 0
  function drawCursors() {
    const list = live?.cursors?.() ?? new Map()
    let changed = false
    for (const [uid, c] of list) {
      let n = cursorNodes.get(uid)
      if (!n) {
        const group = new Konva.Group({ listening: false, name: 'cursor' })
        const arrow = new Konva.Path({ data: 'M0 0 L0 16 L4.5 12 L8 19 L10.5 18 L7 11 L13 11 Z', fill: c.colour || GLOW_COLOUR, stroke: '#FFFFFF', strokeWidth: 1 })
        const text = new Konva.Text({ x: 14, y: 14, text: String(c.label || ''), ...BOARD_CAPTION, fill: '#FFFFFF', padding: 3 })
        const tag = new Konva.Rect({ x: 14, y: 14, width: text.width(), height: text.height(), fill: c.colour || GLOW_COLOUR, cornerRadius: 3 })
        group.add(arrow, tag, text)
        n = { group, arrow, text, tag, label: c.label, colour: c.colour }
        cursorNodes.set(uid, n)
        cursorsG.add(group)
        changed = true
      }
      if (n.label !== c.label || n.colour !== c.colour) {
        n.text.text(String(c.label || ''))
        n.tag.setAttrs({ width: n.text.width(), height: n.text.height(), fill: c.colour || GLOW_COLOUR })
        n.arrow.fill(c.colour || GLOW_COLOUR)
        n.label = c.label
        n.colour = c.colour
        changed = true
      }
      if (n.x !== c.x || n.y !== c.y || n.scale !== cam.scale) {
        n.group.setAttrs({ x: num(c.x), y: num(c.y), scaleX: 1 / cam.scale, scaleY: 1 / cam.scale })
        n.x = c.x
        n.y = c.y
        n.scale = cam.scale
        changed = true
      }
    }
    for (const [uid, n] of cursorNodes) if (!list.has(uid)) { n.group.destroy(); cursorNodes.delete(uid); changed = true }
    return changed
  }
  function cursorLoop() {
    cursorRaf = 0
    if (destroyed) return
    if (drawCursors()) overlay.batchDraw()
    if ((live?.cursors?.()?.size ?? 0) > 0) cursorRaf = raf(cursorLoop)
  }
  function kickCursors() { if (!cursorRaf && !destroyed) cursorRaf = raf(cursorLoop) }

  function refreshGlow() {
    if (destroyed || typeof turns?.glow !== 'function') return
    let next
    try { next = turns.glow() } catch { return }
    if (!(next instanceof Map)) return
    const touched = new Set()
    const now = Date.now()
    const active = (g) => !!g && !g.mine && (g.endsAt == null || num(g.endsAt) > now)
    for (const [id, g] of next) {
      const prev = glow.get(id)
      if (active(g) !== active(prev) || prev?.holderLabel !== g?.holderLabel) touched.add(id)
      // Someone renewed or handed back their turn: their words may have changed.
      if (prev && !prev.mine && prev.endsAt !== g.endsAt) { staleSticky(id); touched.add(id) }
    }
    for (const [id, prev] of glow) if (!next.has(id)) { if (!prev.mine) staleSticky(id); touched.add(id) }
    glow = new Map(next)
    for (const id of touched) { const rec = nodes.get(id); if (rec && rec.el.kind === 'sticky') build(rec) }
    if (touched.size) content.batchDraw()
  }

  // stickyTurn's own events, when it offers them: someone saved a sticky's words (read them again), or this window's
  // turn ended (the words stay in the editor and it says so). Without them, the glow's changes say as much.
  function onTurnEvent(evt) {
    if (destroyed) return
    if (evt?.type === 'body' && evt.elementId && !evt.mine) { staleSticky(evt.elementId); content.batchDraw() }
    if (evt?.type === 'ended' && editor && editor.id === evt.elementId && editor.status === 'editing') {
      clearTimeout(editor.timer)
      editor.status = 'ended'
      editor.words = evt.words || TURN_ENDED_WORDS
      pushEditor()
    }
    refreshGlow()
  }

  let liveOff = null
  let turnsOff = null
  function attachLive(next) {
    if (typeof liveOff === 'function') liveOff()
    liveOff = null
    live = next ?? null
    if (live?.subscribe) liveOff = live.subscribe(() => { kickCursors(); refreshGlow() })
    kickCursors()
  }
  function attachTurns(next) {
    if (typeof turnsOff === 'function') turnsOff()
    turnsOff = null
    turns = next ?? null
    if (typeof turns?.subscribe === 'function') turnsOff = turns.subscribe(onTurnEvent)
    Promise.resolve().then(() => turns?.refresh?.()).catch(() => {}).then(() => refreshGlow())
  }
  const glowTimer = setInterval(refreshGlow, GLOW_POLL_MS)

  // ---- wiring -----------------------------------------------------------------------------------------------
  // The server gave an element another id than the one asked for: what pointed at the old one follows it.
  function renamed(from, to) {
    if (!from || !to || from === to) return
    if (selected.delete(from)) selected.add(to)
    if (overrides.has(from)) { overrides.set(to, overrides.get(from)); overrides.delete(from) }
    if (stickyText.has(from)) { stickyText.set(to, stickyText.get(from)); stickyText.delete(from) }
    if (editor && editor.id === from) { editor.id = to; editingId = to }
    if (endDrag && endDrag.id === from) endDrag = { ...endDrag, id: to }
    reconcileNow()
    ui.onSelection?.([...selected])
    if (editor) pushEditor()
  }

  const storeOff = store.subscribe?.((evt) => {
    if (evt && evt.type === 'notice') { say(evt.words); return }
    if (evt && evt.type === 'renamed') { renamed(evt.from, evt.to); return }
    scheduleReconcile()
  })

  stage.on('pointerdown', onStageDown)

  function onWheel(evt) {
    evt.preventDefault?.()
    const s = screenAt(evt)
    const unit = evt.deltaMode === 1 ? 16 : evt.deltaMode === 2 ? view.h : 1
    if (evt.ctrlKey || evt.metaKey) applyCamera(zoomAt(cam, s.x, s.y, Math.exp(-num(evt.deltaY) * unit * 0.002)))
    else applyCamera({ ...cam, x: cam.x - num(evt.deltaX) * unit, y: cam.y - num(evt.deltaY) * unit })
  }
  function onHostDown(evt) {
    if (evt.pointerType !== 'touch') return
    touches.set(evt.pointerId, screenAt(evt))
    if (touches.size === 2) {
      if (action) cancelAction()
      if (tr.isTransforming?.()) tr.stopTransform?.()
      const [a, b] = [...touches.values()]
      pinch = { cam: { ...cam }, a, b }
    }
  }
  function onHostMove(evt) {
    if (evt.pointerType === 'touch' && touches.has(evt.pointerId)) {
      touches.set(evt.pointerId, screenAt(evt))
      if (pinch && touches.size >= 2) {
        const [a, b] = [...touches.values()]
        applyCamera(pinchCamera(pinch.cam, pinch.a, pinch.b, a, b))
        return
      }
    }
    // The pointer is sent only while it moves; boardLive holds it to ten a second.
    if (!pinch && live?.sendPointer) { const p = boardAt(evt); live.sendPointer(round2(p.x), round2(p.y)) }
  }
  function onHostUp(evt) {
    if (evt.pointerType !== 'touch') return
    touches.delete(evt.pointerId)
    if (touches.size < 2) pinch = null
  }
  host.addEventListener('wheel', onWheel, { passive: false })
  host.addEventListener('pointerdown', onHostDown, true)
  host.addEventListener('pointermove', onHostMove, true)
  host.addEventListener('pointerup', onHostUp, true)
  host.addEventListener('pointercancel', onHostUp, true)

  let ro = null
  const onResize = () => {
    const next = measure()
    if (next.w === view.w && next.h === view.h) return
    view = next
    stage.size({ width: view.w, height: view.h })
    cull()
    content.batchDraw()
    overlay.batchDraw()
  }
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(onResize); ro.observe(host) } else if (typeof window !== 'undefined') window.addEventListener('resize', onResize)

  applyCamera(cam)
  attachLive(live)
  attachTurns(turns)
  reconcile()

  return {
    stage,
    camera: () => ({ ...cam }),
    selection: () => [...selected],
    tool: () => tool,
    setTool,
    setShape(shape) { if (shape) shapeKind = shape },
    setLive: attachLive,
    setTurns: attachTurns,
    setAdapter(next) { adapter = next ?? null },
    setCanWrite(next) {
      canWrite = !!next
      if (!canWrite && editor) endEdit({ discard: editor.kind !== 'sticky' })
      refreshSelection()
    },
    setInputMode(next) {
      inputMode = next || 'mouse'
      sizes = targetSizes(inputMode)
      for (const rec of nodes.values()) if (rec.el.kind === 'pen' || rec.el.kind === 'connector' || rec.el.kind === 'shape') build(rec)
      refreshSelection()
      content.batchDraw()
    },
    zoomBy,
    fit,
    applyStyle,
    applyShape,
    stack,
    removeSelection,
    undo() { if (canWrite) { store.undo(); reconcileNow() } },
    redo() { if (canWrite) { store.redo(); reconcileNow() } },
    beginEdit,
    editInput,
    editBlur() { if (editor && editor.status === 'editing') endEdit() },
    endEdit,
    escape,
    key,
    keyUp,
    reconcile: reconcileNow,
    refreshGlow,
    placeFiles,
    placeEmbed,
    dragOver,
    dragLeave,
    drop,
    destroy() {
      if (destroyed) return
      clearTimeout(dropTimer)
      const ed = editor
      if (ed?.kind === 'sticky') {
        clearTimeout(ed.timer)
        const el = geom(ed.id)
        const last = ed.status === 'editing' && ed.text !== ed.saved && el ? Promise.resolve().then(() => turns?.save?.(el, ed.text)) : Promise.resolve()
        last.catch(() => {}).finally(() => { try { turns?.end?.(ed.id) } catch { /* lapses */ } })
      }
      destroyed = true
      editor = null
      if (action) finish()
      clearInterval(glowTimer)
      if (reconRaf) caf(reconRaf)
      if (cursorRaf) caf(cursorRaf)
      if (typeof storeOff === 'function') storeOff()
      if (typeof liveOff === 'function') liveOff()
      if (typeof turnsOff === 'function') turnsOff()
      host.removeEventListener('wheel', onWheel, { passive: false })
      host.removeEventListener('pointerdown', onHostDown, true)
      host.removeEventListener('pointermove', onHostMove, true)
      host.removeEventListener('pointerup', onHostUp, true)
      host.removeEventListener('pointercancel', onHostUp, true)
      if (ro) ro.disconnect()
      else if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
      stage.destroy()
    },
  }
}

const CURSOR_FOR = { select: 'default', hand: 'grab', shape: 'crosshair', frame: 'crosshair', connector: 'crosshair', pen: 'crosshair', text: 'text', sticky: 'copy' }
const EDITOR_LABEL = { sticky: 'Words on the sticky', text: 'Text', shape: 'Words in the shape', frame: 'Frame name', connector: 'Words on the connector' }

function WordsEditor({ editor, inputMode, onInput, onBlur, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    try { t.focus({ preventScroll: true }) } catch { t.focus() }
    try { t.setSelectionRange(t.value.length, t.value.length) } catch { /* not every input takes a range */ }
  }, [editor.id])
  const b = editor.box
  if (!b) return null
  const ended = editor.status === 'ended'
  return (
    <div
      data-moth-board-editor
      style={{
        position: 'absolute', left: b.left, top: b.top, width: Math.max(40, b.width), zIndex: 4,
        transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined, transformOrigin: '0 0',
      }}
    >
      <textarea
        ref={ref}
        aria-label={EDITOR_LABEL[editor.kind] || 'Words'}
        value={editor.text}
        maxLength={10000}
        readOnly={ended}
        onChange={(e) => onInput(e.target.value)}
        onBlur={onBlur}
        style={{
          display: 'block', width: '100%', height: Math.max(b.height, b.fontSize * 1.4), boxSizing: 'border-box', margin: 0,
          padding: 0, border: `1px solid ${SELECT_COLOUR}`, outline: 'none', resize: 'none', overflow: 'hidden',
          // board-type: the textarea over the words, sized and led as Konva draws them
          background: b.background, color: b.colour, fontSize: b.fontSize, lineHeight: 1, fontFamily: 'var(--font-sans)', textAlign: b.align,
        }}
      />
      {editor.words && (
        <div role="status" style={{
          marginTop: 6, padding: inputMode === 'touch' ? 10 : 6, borderRadius: 6, background: 'var(--color-paper-raised, #fff)',
          border: '1px solid var(--color-rule, rgba(0,0,0,0.15))', fontSize: 'var(--text-dense)', color: 'var(--color-ink, #1F2933)',
          display: 'flex', gap: 8, alignItems: 'center', width: 'max-content', maxWidth: 320,
        }}
        >
          <span>{editor.words}</span>
          {ended && <button type="button" onClick={onClose} style={{ minHeight: inputMode === 'touch' ? 40 : 24 }}>Close</button>}
        </div>
      )}
    </div>
  )
}

export default function BoardCanvas({ store, live = null, turns = null, adapter = null, canWrite, inputMode = 'mouse', escape = null }) {
  const hostRef = useRef(null)
  const ctlRef = useRef(null)
  const writable = canWrite ?? !!store?.getBoard?.()?.can_write
  const [tool, setTool] = useState('select')
  const [shape, setShape] = useState('rectangle')
  const [selection, setSelection] = useState([])
  const [tick, setTick] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [notice, setNotice] = useState(null)
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [dropOn, setDropOn] = useState(false)
  const fileInputRef = useRef(null)
  const initRef = useRef(null)
  initRef.current = { live, turns, adapter, writable, inputMode }
  const embedOpenRef = useRef(false)
  embedOpenRef.current = embedOpen

  // "Picture or file": the system's file chooser; what is chosen goes to the middle of the view.
  const pickFiles = () => {
    const input = fileInputRef.current
    if (!input || !initRef.current.writable) return
    try { input.value = '' } catch { /* some engines keep it */ }
    input.click()
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host || !store) return undefined
    const now = initRef.current
    const ctl = mountBoard(host, {
      store, live: now.live, turns: now.turns, adapter: now.adapter, canWrite: now.writable, inputMode: now.inputMode,
      ui: {
        onSelection: setSelection,
        onCamera: (c) => setZoom(c.scale),
        onNotice: (words) => setNotice(words ? { words, at: Date.now() } : null),
        onEdit: setEditor,
        onBusy: setBusy,
        onTool: setTool,
        onChange: () => setTick((t) => t + 1),
        onPickFiles: () => pickFiles(),
        onEmbed: () => setEmbedOpen((v) => !v),
        onDropping: setDropOn,
      },
    })
    ctlRef.current = ctl
    return () => { ctl.destroy(); ctlRef.current = null }
  }, [store])

  useEffect(() => { ctlRef.current?.setLive(live) }, [live])
  useEffect(() => { ctlRef.current?.setTurns(turns) }, [turns])
  useEffect(() => { ctlRef.current?.setAdapter(adapter) }, [adapter])
  useEffect(() => { ctlRef.current?.setCanWrite(writable) }, [writable])
  useEffect(() => { ctlRef.current?.setInputMode(inputMode) }, [inputMode])
  useEffect(() => { ctlRef.current?.setShape(shape) }, [shape])
  useEffect(() => { ctlRef.current?.setTool(tool) }, [tool])

  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  // A board turned read-only closes the embed list.
  useEffect(() => { if (!writable) setEmbedOpen(false) }, [writable])

  // While there is something to let go of, the canvas takes Escape before the panel does; the embed list first.
  const escapable = !!editor || busy || tool !== 'select' || selection.length > 0 || embedOpen
  useEffect(() => {
    if (!escapable || typeof escape?.push !== 'function') return undefined
    const pop = escape.push(() => {
      if (embedOpenRef.current) { setEmbedOpen(false); return true }
      return ctlRef.current?.escape() ?? false
    })
    return () => { if (typeof pop === 'function') pop() }
  }, [escapable, escape])

  const selectedEls = useMemo(() => {
    const els = store?.getElements?.() ?? new Map()
    return selection.map((id) => els.get(id)).filter(Boolean)
  }, [selection, tick, store]) // eslint-disable-line react-hooks/exhaustive-deps
  const canUndo = useMemo(() => !!store?.canUndo?.(), [tick, store]) // eslint-disable-line react-hooks/exhaustive-deps
  const canRedo = useMemo(() => !!store?.canRedo?.(), [tick, store]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    const ctl = ctlRef.current
    if (!ctl) return
    if (e.key === 'Escape') {
      if (typeof escape?.push !== 'function') {
        if (embedOpenRef.current) { setEmbedOpen(false); e.preventDefault(); e.stopPropagation(); return }
        if (ctl.escape()) { e.preventDefault(); e.stopPropagation() }
      }
      return
    }
    if (ctl.key(e)) e.preventDefault()
  }

  const onChosen = (e) => {
    const files = Array.from(e.target.files || [])
    try { e.target.value = '' } catch { /* some engines keep it */ }
    if (files.length) ctlRef.current?.placeFiles(files)
  }
  const onEmbedPick = (file) => {
    setEmbedOpen(false)
    ctlRef.current?.placeEmbed(file)
    try { hostRef.current?.parentElement?.focus({ preventScroll: true }) } catch { /* focus is a courtesy */ }
  }

  return (
    <div
      className="moth-board-canvas"
      data-moth-board-canvas
      data-input={inputMode}
      data-tool={tool}
      data-dropping={dropOn ? '' : undefined}
      role="region"
      aria-label="Board"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => ctlRef.current?.keyUp(e)}
      onBlur={() => ctlRef.current?.keyUp({ key: ' ' })}
      onDragOver={(e) => { ctlRef.current?.dragOver(e) }}
      onDragLeave={(e) => { ctlRef.current?.dragLeave(e) }}
      onDrop={(e) => { ctlRef.current?.drop(e) }}
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', outline: 'none', background: '#F7F8FA' }}
    >
      <div ref={hostRef} data-moth-board-stage style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: CURSOR_FOR[tool] || 'default' }} />
      {writable && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          tabIndex={-1}
          aria-label="Choose pictures or files to add"
          data-moth-board-file-input
          onChange={onChosen}
          style={{ display: 'none' }}
        />
      )}
      {dropOn && writable && (
        <div data-moth-board-drop aria-hidden="true" style={{
          position: 'absolute', inset: 8, zIndex: 6, pointerEvents: 'none', borderRadius: 12, border: `2px dashed ${SELECT_COLOUR}`,
          background: 'rgba(59,130,246,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 'var(--text-body)', color: SELECT_COLOUR,
        }}
        >
          {DROP_WORDS}
        </div>
      )}
      <BoardToolbar
        tool={tool}
        shape={shape}
        onTool={setTool}
        onShape={setShape}
        canWrite={writable}
        inputMode={inputMode}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => ctlRef.current?.undo()}
        onRedo={() => ctlRef.current?.redo()}
        zoom={zoom}
        onZoomIn={() => ctlRef.current?.zoomBy(1.25)}
        onZoomOut={() => ctlRef.current?.zoomBy(0.8)}
        onFit={() => ctlRef.current?.fit()}
        escape={escape}
        onPickFiles={pickFiles}
        onEmbed={() => setEmbedOpen((v) => !v)}
        embedOpen={embedOpen}
      />
      {embedOpen && writable && (
        <EmbedPicker
          adapter={adapter}
          board={store?.getBoard?.() ?? null}
          inputMode={inputMode}
          escape={escape}
          onPick={onEmbedPick}
          onClose={() => setEmbedOpen(false)}
        />
      )}
      <StylePanel
        elements={editor ? [] : selectedEls}
        canWrite={writable}
        inputMode={inputMode}
        onStyle={(patch) => ctlRef.current?.applyStyle(patch)}
        onShape={(s) => ctlRef.current?.applyShape(s)}
        onStack={(dir) => ctlRef.current?.stack(dir)}
        onRemove={() => ctlRef.current?.removeSelection()}
      />
      {editor && (
        <WordsEditor
          editor={editor}
          inputMode={inputMode}
          onInput={(text) => ctlRef.current?.editInput(text)}
          onBlur={() => ctlRef.current?.editBlur()}
          onClose={() => ctlRef.current?.endEdit({ discard: true })}
        />
      )}
      {!writable && (
        <div data-moth-board-readonly style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 3, padding: '4px 10px', borderRadius: 999,
          background: 'var(--color-paper-raised, #fff)', border: '1px solid var(--color-rule, rgba(0,0,0,0.12))',
          fontSize: 'var(--text-dense)', color: 'var(--color-ink-2, #555)',
        }}
        >
          {READ_ONLY_WORDS}
        </div>
      )}
      {notice && (
        <div role="status" data-moth-board-notice style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 3, padding: '6px 12px', borderRadius: 8,
          background: 'var(--color-ink, #1F2933)', color: 'var(--color-paper, #fff)', fontSize: 'var(--text-dense)', maxWidth: '80%',
        }}
        >
          {notice.words}
        </div>
      )}
    </div>
  )
}
