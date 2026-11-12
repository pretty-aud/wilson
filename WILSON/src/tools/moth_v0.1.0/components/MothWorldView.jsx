// MothWorldView.jsx — MO2: the world's two canvases (the light behind, the graph in front) and the controller
// that drives them (state/mothWorld.js). The page hands it a graph and settings; it hands back what a person did.
// It sizes itself to its box (a ResizeObserver), stops the light and every frame while the page is hidden, and
// tears everything down when it goes.
import { useEffect, useRef } from 'react'
import { createMothWorld } from '../state/mothWorld.js'

export default function MothWorldView({
  graph, layout, saved, savedKey, active, appearance, reducedMotion, selection, rules, flyTo,
  onPick, onOpen, onHover, onBloom, onDrop, onArranged, onDrag, onSettled, onFrame, onDropFile, worldRef,
  createWorld = createMothWorld,
}) {
  const boxRef = useRef(null)
  const graphRef = useRef(null)
  const glowRef = useRef(null)
  const world = useRef(null)
  const handlers = useRef({})
  handlers.current = { onPick, onOpen, onHover, onBloom, onDrop, onArranged, onDrag, onSettled, onFrame, onDropFile }

  // The world, once. Its listeners read the newest handlers, so a re-render never rebinds the pointer.
  useEffect(() => {
    const w = createWorld({ canvas: graphRef.current, glowCanvas: glowRef.current, reducedMotion })
    world.current = w
    if (worldRef) worldRef.current = w
    w.on('pick', (id, how) => handlers.current.onPick?.(id, how))
    w.on('open', (id) => handlers.current.onOpen?.(id))
    w.on('hover', (id) => handlers.current.onHover?.(id))
    w.on('bloom', (at) => handlers.current.onBloom?.(at))
    w.on('drop', (d) => handlers.current.onDrop?.(d))
    w.on('arranged', (d) => handlers.current.onArranged?.(d))
    w.on('drag', (d) => handlers.current.onDrag?.(d))
    w.on('settled', () => handlers.current.onSettled?.())
    w.on('frame', (f) => handlers.current.onFrame?.(f))
    const box = boxRef.current
    const size = () => {
      const r = box.getBoundingClientRect()
      w.resize(Math.max(1, r.width), Math.max(1, r.height), typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    }
    size()
    let ro = null
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(size)
      ro.observe(box)
    }
    return () => {
      ro?.disconnect()
      w.destroy()
      world.current = null
      if (worldRef) worldRef.current = null
    }
    // The world is made once per mount; its inputs flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // setScene and the layout's run in one turn (the engine's R1-11), every time the graph or the layout changes.
  // A view's saved places are applied once, when the view is loaded (its key changes), never over what the person
  // has moved since.
  const savedApplied = useRef(null)
  useEffect(() => {
    const fresh = savedKey && savedKey !== savedApplied.current
    if (fresh) savedApplied.current = savedKey
    world.current?.setGraph(graph, { layout, saved: fresh ? saved || {} : null })
  }, [graph, layout, savedKey, saved])
  useEffect(() => { world.current?.setAppearance(appearance || {}) }, [appearance])
  useEffect(() => { world.current?.setReducedMotion(reducedMotion) }, [reducedMotion])
  useEffect(() => { world.current?.setActive(active) }, [active])
  useEffect(() => { world.current?.setSelection(selection) }, [selection])
  useEffect(() => { if (rules) world.current?.setRules(rules) }, [rules])
  useEffect(() => { if (flyTo?.id) world.current?.flyTo(flyTo.id) }, [flyTo])

  // A file dragged from a card onto a dot of the graph.
  const FILE_DRAG = 'application/x-wilson-moth-file'
  const dropAt = (e) => {
    const fid = e.dataTransfer?.getData(FILE_DRAG)
    const w = world.current
    if (!fid || !w) return
    e.preventDefault()
    const r = graphRef.current.getBoundingClientRect()
    const hit = w.renderer.hitTest(e.clientX - r.left, e.clientY - r.top, 6)
    if (hit?.type === 'dot') handlers.current.onDropFile?.(fid, hit.id)
  }

  return (
    <div className="moth-world" ref={boxRef} data-moth-world
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes(FILE_DRAG)) e.preventDefault() }} onDrop={dropAt}>
      <canvas className="moth-world-glow" ref={glowRef} aria-hidden="true" />
      <canvas className="moth-world-graph" ref={graphRef} aria-label="The map of your projects. Use the list on the right to move through it with the keyboard." role="img" />
    </div>
  )
}
