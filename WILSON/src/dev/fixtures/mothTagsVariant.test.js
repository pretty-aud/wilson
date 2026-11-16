// MO3 (walkthrough 96): `?fixtures=tags` seeds Session 3, and `?as=theo` reads the same pretend company as Theo. What
// each person sees of it is the two-person check the walkthrough shows: Mara's own tag is not there for Theo at all,
// and the shared note's link into Mara's personal space is, for him, its words alone.
import { describe, it, expect } from 'vitest'
import { buildDevFixtures } from './install'
import { fixturePerson, fixtureVariant } from './store'
import { SHARED_NOTES } from './data/notes'
import { fid } from './ids'

const NOTE = SHARED_NOTES[0].id
const CHARACTER = fid('asset', 5)

describe('the tags variant and a second person', () => {
  it('the switches read the address', () => {
    expect(fixtureVariant('?fixtures=tags')).toBe('tags')
    expect(fixturePerson('?as=theo')?.display_name).toBe('Theo Lindqvist')
    expect(fixturePerson('?as=Theo')?.app_role).toBe('manager')
    expect(fixturePerson('?as=nobody')).toBe(null)
    expect(fixturePerson('')).toBe(null)
  })

  it("Mara sees her own tag beside the company's, and both of the shared note's links", async () => {
    const fx = buildDevFixtures({ variant: 'tags' })
    const a = fx.rabbitAdapter()
    expect((await a.listMothTags()).map((t) => t.label).sort()).toEqual(['Lantern', 'Lead'])
    const links = await a.listMothItemRelationships('note', NOTE)
    expect(links.out.map((l) => l.name).sort()).toEqual(['Mara', 'lantern-sketch.png'])
    expect(fx.permissions.userId).toBe(fx.store.members[0].user_id)
  })

  it('Theo sees no tag of hers and only the link to what he can see; his window acts as him', async () => {
    const theo = fixturePerson('?as=theo')
    const fx = buildDevFixtures({ variant: 'tags', person: theo })
    const a = fx.rabbitAdapter()
    expect((await a.listMothTags()).map((t) => t.label)).toEqual(['Lead'])
    const links = await a.listMothItemRelationships('note', NOTE)
    expect(links.out.map((l) => l.name)).toEqual(['Mara'])
    const onCharacter = await a.listMothTagAssignments({ targetKind: 'asset', targetId: CHARACTER })
    expect(onCharacter.map((x) => x.tier)).toEqual(['company'])
    expect(fx.permissions).toMatchObject({ userId: theo.user_id, role: 'manager' })
    expect(fx.profile.email).toBe(theo.email)
  })

  it('the default company has no Session 3 seed', async () => {
    const a = buildDevFixtures().rabbitAdapter()
    expect(await a.listMothTags()).toEqual([])
  })
})
