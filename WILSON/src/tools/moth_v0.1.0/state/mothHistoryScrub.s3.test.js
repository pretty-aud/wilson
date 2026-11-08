// MO3 (0129): looking back over workspace notes, typed tags, their assignments and saved links. Each is taken out
// and put back by id as the record says; their kinds do not set the floor, which stays the structural kinds'.
import { describe, it, expect } from 'vitest'
import { rewind, recordedSince, S3_KINDS } from './mothHistoryScrub.js'

const T0 = Date.parse('2026-11-01T00:00:00Z')
const at = (h) => new Date(T0 + h * 3600000).toISOString()
const live = () => ({
  islands: [{ id: 'p1', title: 'Salt Hours' }], folders: {}, files: {}, items: {},
  relations: [{ source: { kind: 'note', id: 'n1' }, target: { kind: 'asset', id: 'a1' }, label: null, relationship: 'r1' }],
  notes: [{ id: 'n1', title: 'Look of the film', tier: 'shared', is_mine: false }],
  mtags: [{ id: 'g1', label: 'Mira', tier: 'company', type_id: 'ty1', shape: 'star', colour: 'rose' }],
  assignments: [{ id: 'x1', tag_id: 'g1', target_type: 'asset', target_id: 'a1', tier: 'company' }],
})

describe('looking back over Session 3\'s rows', () => {
  it('a note, a tag, an assignment and a link made after the time are not there then', () => {
    const rows = [
      { entity_type: 'moth_relationships', entity_id: 'r1', action: 'added', observed_at: at(5), prior: null },
      { entity_type: 'moth_tag_assignments', entity_id: 'x1', action: 'added', observed_at: at(4), prior: null },
      { entity_type: 'moth_tags', entity_id: 'g1', action: 'added', observed_at: at(3), prior: null },
      { entity_type: 'notes', entity_id: 'n1', action: 'added', observed_at: at(2), prior: null },
    ]
    const { catalogue: c } = rewind(live(), rows, T0 + 3600000)
    expect(c.notes).toEqual([])
    expect(c.mtags).toEqual([])
    expect(c.assignments).toEqual([])
    expect(c.relations).toEqual([])
  })

  it('one removed or renamed since comes back as it was, a tag with its type\'s look', () => {
    const now = live()
    now.notes = []
    now.relations = []
    const rows = [
      { entity_type: 'moth_tags', entity_id: 'g1', action: 'changed', observed_at: at(6), prior: { label: 'Mira L', type_id: 'ty1', tier: 'company' } },
      { entity_type: 'moth_relationships', entity_id: 'r1', action: 'removed', observed_at: at(5),
        prior: { source_type: 'note', source_id: 'n1', dest_type: 'asset', dest_id: 'a1', label: 'about', origin: 'manual' } },
      { entity_type: 'notes', entity_id: 'n1', action: 'removed', observed_at: at(4), prior: { title: 'Look of the film', tier: 'shared' } },
    ]
    const { catalogue: c } = rewind(now, rows, T0)
    expect(c.notes.map((n) => [n.id, n.title, n.tier])).toEqual([['n1', 'Look of the film', 'shared']])
    expect(c.mtags[0]).toMatchObject({ id: 'g1', label: 'Mira L', shape: 'star', colour: 'rose' })
    expect(c.relations).toEqual([{ source: { kind: 'note', id: 'n1' }, target: { kind: 'asset', id: 'a1' }, label: 'about', relationship: 'r1', origin: 'manual' }])
  })

  it('a note in the trash then is not there then', () => {
    const rows = [{ entity_type: 'notes', entity_id: 'n1', action: 'restored', observed_at: at(2), prior: { title: 'Look of the film', tier: 'shared', in_trash: true } }]
    expect(rewind(live(), rows, T0).catalogue.notes).toEqual([])
  })

  it('their kinds do not set the floor: looking back at files reaches as far as the files\' record does', () => {
    const windowRows = [
      { entity_type: 'files', project_id: null, recording_since: at(-48) },
      ...S3_KINDS.map((entity_type) => ({ entity_type, project_id: null, recording_since: at(0) })),
    ]
    expect(recordedSince(windowRows, T0 + 3600000)).toBe(T0 - 48 * 3600000)
  })
})
