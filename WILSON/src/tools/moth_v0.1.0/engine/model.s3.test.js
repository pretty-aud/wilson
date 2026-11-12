// MO3 (0125 to 0127): the model's Session 3 dots and lines. A workspace note and a typed tag belong to no project
// and float free; a typed tag joins what it tags; a saved relationship is a 'related to' line between any two
// things on show, a note among them; a folded tag is no dot; an end not handed in is never drawn.
import { describe, it, expect } from 'vitest'
import { buildGraph, indexCatalogue, nodeId, toLayoutInput, MTAG_COLOURS } from './model.js'
import { traceShape } from './renderer.js'

const P = 'p1'
const Q = 'p2'
const catalogue = () => ({
  islands: [{ id: P, title: 'Salt Hours' }, { id: Q, title: 'Second' }],
  folders: {},
  files: {},
  items: {
    [P]: [{ kind: 'asset', id: 'a1', name: 'Mira' }],
    [Q]: [{ kind: 'task', id: 't1', name: 'Grade the harbour' }],
  },
  relations: [
    { source: { kind: 'note', id: 'n1' }, target: { kind: 'asset', id: 'a1' }, label: null },
    { source: { kind: 'note', id: 'n1' }, target: { kind: 'task', id: 't1' }, label: null },
    { source: { kind: 'note', id: 'n1' }, target: { kind: 'task', id: 'hidden' }, label: null },
  ],
  notes: [{ id: 'n1', title: 'Look of the film', tier: 'shared', is_mine: false }],
  mtags: [
    { id: 'g1', label: 'Mira', tier: 'company', shape: 'star', colour: 'rose' },
    { id: 'g2', label: 'mira', tier: 'personal', shape: 'square', colour: 'sky', canonical_id: 'g1' },
  ],
  assignments: [
    { tag_id: 'g1', target_type: 'asset', target_id: 'a1', tier: 'company' },
    { tag_id: 'g1', target_type: 'note', target_id: 'n1', tier: 'personal' },
    { tag_id: 'g2', target_type: 'task', target_id: 't1', tier: 'personal' },
    { tag_id: 'g1', target_type: 'file', target_id: 'not-read', tier: 'company' },
  ],
})
const view = (nodeKinds, edgeKinds = ['tagged_with', 'related_to']) => ({ nodeKinds, edgeKinds, expanded: 'all' })

describe('Session 3 in the graph', () => {
  it('a note and a typed tag are dots of their own, belonging to no project, a folded tag none', () => {
    const g = buildGraph(catalogue(), view(['project', 'asset', 'task', 'note', 'mtag']))
    const note = g.nodes.find((n) => n.id === nodeId('note', 'n1'))
    const tag = g.nodes.find((n) => n.id === nodeId('mtag', 'g1'))
    expect(note).toMatchObject({ kind: 'note', projectId: null, parent: null, label: 'Look of the film', tier: 'shared' })
    expect(tag).toMatchObject({ kind: 'mtag', projectId: null, shape: 'star', colour: MTAG_COLOURS.rose })
    expect(g.nodes.some((n) => n.id === nodeId('mtag', 'g2'))).toBe(false)
  })

  it('a shared note links two projects\' things; a relation to something not handed in is never drawn', () => {
    const g = buildGraph(catalogue(), view(['project', 'asset', 'task', 'note']))
    const related = g.edges.filter((e) => e.kind === 'related_to').map((e) => [e.source, e.target].sort().join(' '))
    expect(related.sort()).toEqual([
      [nodeId('asset', 'a1'), nodeId('note', 'n1')].sort().join(' '),
      [nodeId('note', 'n1'), nodeId('task', 't1')].sort().join(' '),
    ].sort())
  })

  it('a typed tag joins what it tags that is on show, a note too; an assignment of a folded tag or to an unread thing draws nothing', () => {
    const g = buildGraph(catalogue(), view(['project', 'asset', 'task', 'note', 'mtag'], ['tagged_with']))
    const tagged = g.edges.filter((e) => e.kind === 'tagged_with').map((e) => `${e.source}>${e.target}`).sort()
    expect(tagged).toEqual([`${nodeId('asset', 'a1')}>${nodeId('mtag', 'g1')}`, `${nodeId('note', 'n1')}>${nodeId('mtag', 'g1')}`].sort())
  })

  it('without the kinds on show there are no such dots or lines', () => {
    const g = buildGraph(catalogue(), view(['project', 'asset', 'task']))
    expect(g.nodes.some((n) => n.kind === 'note' || n.kind === 'mtag')).toBe(false)
    expect(g.edges.some((e) => e.kind === 'tagged_with')).toBe(false)
  })

  it('both float free in the layout, as a file tag does', () => {
    const g = buildGraph(catalogue(), view(['project', 'asset', 'note', 'mtag']))
    const loose = toLayoutInput(g).nodes.filter((n) => n.loose).map((n) => n.id).sort()
    expect(loose).toEqual([nodeId('mtag', 'g1'), nodeId('note', 'n1')].sort())
  })

  it('the index keeps a note\'s tier and whether it is the reader\'s', () => {
    const idx = indexCatalogue(catalogue())
    expect(idx.rows.get(nodeId('note', 'n1'))).toMatchObject({ tier: 'shared', mine: false })
  })
})

describe('a dot\'s outline', () => {
  const pen = () => {
    const calls = []
    return { calls, moveTo: (x, y) => calls.push(['m', x, y]), lineTo: (x, y) => calls.push(['l', x, y]), arc: () => calls.push(['a']), closePath: () => calls.push(['z']) }
  }
  it('a circle for every kind but a note and a typed tag; a square, a diamond, a triangle, a hexagon, a star', () => {
    const counts = [0, 1, 2, 3, 4, 5].map((shape) => { const c = pen(); traceShape(c, shape, 0, 0, 5); return c.calls.filter((x) => x[0] === 'l').length })
    expect(counts).toEqual([0, 3, 3, 2, 5, 9])
    const circle = pen()
    traceShape(circle, 0, 0, 0, 5)
    expect(circle.calls.map((x) => x[0])).toEqual(['m', 'a'])
  })
})
