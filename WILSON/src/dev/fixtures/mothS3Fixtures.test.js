// MO3 (the session review): the fake cloud says no where 0125 to 0127 say no, in the same words, so a walkthrough in
// fixtures never shows a change the cloud would refuse. A change that matched no row is refused in words (as the
// cloud adapter now says it); a nomination's second ask, a withdraw or decision of one not open, a merge into a
// retired tag and a tag of a retired type are refused as 0126 refuses them; a label on a typed link is refused as
// moth_relationships_update refuses it; a subject's rename leaves the company standard and the trash alone; a typed
// link's reservation is kept by its field, so the link comes back with its words; and the picker offers folders.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDevFixtures } from './install'
import { fixturePerson, now } from './store'
import { fid } from './ids'

const LEAD = fid('mtag', 1)
const LANTERN = fid('mtag', 2)
const CHARACTER_TYPE = fid('mtype', 1)
const MINE = fid('mtype', 2)
const CHARACTER = fid('asset', 5)
const TYPED_LINK = fid('mlink', 1)
const DRAWN_LINK = fid('mlink', 3)

const tags = (person = null) => {
  const fx = buildDevFixtures({ variant: 'tags', person })
  return { fx, a: fx.rabbitAdapter() }
}
const refusal = (code, message) => expect.objectContaining({ code, message })

describe('🚨 a change that matched no row says why, in the cloud adapter\'s words', () => {
  const WORDS = {
    tag: 'That tag is not one you can change now, or it is no longer there.',
    tagDelete: 'That tag is not one you can delete, or it is gone already.',
    type: 'That type is not one you can change now, or it is no longer there.',
    typeDelete: 'That type is not one you can delete, or it is gone already.',
  }

  it('Theo, no admin, renames or retires the company\'s tag or type, or deletes them', async () => {
    const { a } = tags(fixturePerson('?as=theo'))
    await expect(a.updateMothTag(LEAD, { label: 'Hero' })).rejects.toEqual(refusal('42501', WORDS.tag))
    await expect(a.updateMothTag(LEAD, { retired: true })).rejects.toEqual(refusal('42501', WORDS.tag))
    await expect(a.deleteMothTag(LEAD)).rejects.toEqual(refusal('42501', WORDS.tagDelete))
    await expect(a.updateMothTagType(CHARACTER_TYPE, { name: 'Cast' })).rejects.toEqual(refusal('42501', WORDS.type))
    await expect(a.deleteMothTagType(CHARACTER_TYPE)).rejects.toEqual(refusal('42501', WORDS.typeDelete))
    expect((await a.listMothTags()).find(t => t.id === LEAD).label).toBe('Lead')
  })

  it('the cloud adapter says it in the same words', () => {
    const cloud = readFileSync(join(__dirname, '../../tools/rabbit_v0.1.0/adapters/supabaseAdapter.js'), 'utf8')
    for (const w of Object.values(WORDS)) expect(cloud).toContain(`'${w}'`)
  })

  it('CONTROL: Mara, a live admin, renames the company\'s tag', async () => {
    const { a } = tags()
    expect((await a.updateMothTag(LEAD, { label: 'Hero' })).label).toBe('Hero')
  })
})

describe('🚨 links and types as 0126 and 0127 keep them', () => {
  it('a typed link takes no label; a drawn one does', async () => {
    const { a } = tags()
    await expect(a.updateMothRelationshipLabel(TYPED_LINK, 'see')).rejects.toMatchObject({ code: '42501' })
    expect((await a.updateMothRelationshipLabel(DRAWN_LINK, 'see')).label).toBe('see')
  })

  it('no tag is made on, or moved to, a retired type; one already of it is still renamed', async () => {
    const { a } = tags()
    await a.updateMothTagType(MINE, { retired: true })
    await expect(a.createMothTag({ typeId: MINE, tier: 'personal', label: 'Moth' })).rejects.toMatchObject({ code: '23503' })
    const other = await a.createMothTagType({ tier: 'personal', name: 'Places', shape: 'square', colour: 'sky' })
    const harbour = await a.createMothTag({ typeId: other.id, tier: 'personal', label: 'Harbour' })
    await expect(a.updateMothTag(harbour.id, { typeId: MINE })).rejects.toMatchObject({ code: '23503' })
    expect((await a.updateMothTag(LANTERN, { label: 'Lamp' })).label).toBe('Lamp')
  })
})

describe('🚨 nominations and merges as 0126 answers them', () => {
  it('a second nomination of a tag, a withdraw or a decision of one not open, are refused in words', async () => {
    const { a } = tags()
    const id = await a.nominateMothTag(LANTERN)
    await expect(a.nominateMothTag(LANTERN)).rejects.toEqual(refusal('23505', 'That tag is put forward already.'))
    expect(await a.withdrawMothTagNomination(id)).toBe(true)
    await expect(a.withdrawMothTagNomination(id)).rejects.toEqual(refusal('42501', 'That is not an open nomination of yours.'))
    await expect(a.decideMothTagNomination(id, true)).rejects.toEqual(refusal('42501', 'That nomination is not open.'))
  })

  it('an approval makes a plain company type, leaves a retired tag alone, and approves the open ones it folds', async () => {
    const { fx, a } = tags()
    await a.updateMothTagType(MINE, { shape: 'star', colour: 'rose' })
    const theo = fixturePerson('?as=theo').user_id
    const ws = fx.store.workspace.id
    const at = now()
    fx.store.mothTagTypes.push({ id: 'theo-type', workspace_id: ws, tier: 'personal', owner_id: theo, name: 'Mine', shape: 'diamond', colour: 'teal', retired_at: null, updated_at: at })
    const theirs = (id, retired_at) => ({ id, workspace_id: ws, type_id: 'theo-type', tier: 'personal', owner_id: theo, label: 'Lantern',
      canonical_id: null, retired_at, revision: 1, updated_at: at })
    fx.store.mothTags.push(theirs('theo-live', null), theirs('theo-retired', at))
    fx.store.mothTagNominations.push({ id: 'theo-nom', workspace_id: ws, proposer_id: theo, tag_id: 'theo-live', label: 'Lantern', type_name: 'Mine',
      note: null, status: 'open', review_note: null, decided_by: null, decided_at: null, result_tag_id: null, created_at: at })
    const into = await a.decideMothTagNomination(await a.nominateMothTag(LANTERN), true)
    const type = fx.store.mothTagTypes.find(t => t.tier === 'company' && t.name === 'Mine')
    expect([type.shape, type.colour]).toEqual(['circle', 'mist'])
    expect(fx.store.mothTags.find(t => t.id === 'theo-live').canonical_id).toBe(into)
    expect(fx.store.mothTags.find(t => t.id === 'theo-retired').canonical_id).toBe(null)
    expect(fx.store.mothTagNominations.find(n => n.id === 'theo-nom')).toMatchObject({ status: 'approved', result_tag_id: into })
  })

  it('a merge into a retired tag is refused', async () => {
    const { a } = tags()
    const tag = await a.createMothTag({ typeId: CHARACTER_TYPE, tier: 'company', label: 'Extra' })
    await a.updateMothTag(tag.id, { retired: true })
    await expect(a.mergeMothTags(LEAD, tag.id)).rejects.toMatchObject({ code: '22023' })
  })
})

describe('🚨 notes and typed links as the cloud keeps them', () => {
  it('a subject\'s rename leaves one\'s company-standard and trashed notes as they are', async () => {
    const { fx, a } = tags()
    const me = fx.permissions.userId
    const mine = fx.store.notes.filter(n => n.owner_id === me).slice(0, 3)
    expect(mine).toHaveLength(3)
    for (const n of mine) n.subject = 'Old'
    mine[1].tier = 'company_standard'
    mine[2].deleted_at = now()
    expect(await a.retagNoteSubject('Old', 'New')).toEqual([mine[0].id])
    expect(mine.map(n => n.subject)).toEqual(['New', 'Old', 'Old'])
  })

  it('a typed link comes back with its words after it was taken out (an undo), its reservation kept by the field', async () => {
    const { fx, a } = tags()
    const task = fx.store.tasks.find(t => !t.deleted_at && !t.set_aside_at)
    const key = await a.reserveMothMention('asset', CHARACTER)
    const linksOut = async () => (await a.listMothItemRelationships('task', task.id)).out.filter(l => l.key === key)
    task.description = `Ask [[Mara|m:${key}]] about the lantern.`
    expect(await linksOut()).toHaveLength(1)
    task.description = 'Ask about the lantern.'
    expect(await linksOut()).toHaveLength(0)
    task.description = `Ask [[Mara|m:${key}]] about the lantern.`
    expect(await linksOut()).toHaveLength(1)
    expect(fx.store.mothMentionReservations.find(m => m.mention_key === key)).toMatchObject({ used_kind: 'task', used_id: task.id, used_field: 'description' })
  })

  it('a key taken by one field links nothing when copied to another', async () => {
    const { fx, a } = tags()
    const [one, two] = fx.store.tasks.filter(t => !t.deleted_at && !t.set_aside_at && t.project_id === fx.store.tasks[0].project_id)
    const key = await a.reserveMothMention('asset', CHARACTER)
    one.description = `[[Mara|m:${key}]]`
    await a.listMothItemRelationships('task', one.id)
    two.description = `[[Mara|m:${key}]]`
    expect((await a.listMothItemRelationships('task', two.id)).out.filter(l => l.key === key)).toEqual([])
  })

  it('the 500 a day counts the keys of the last day, used or not, and not older unused ones', async () => {
    const { fx, a } = tags()
    const me = fx.permissions.userId
    const old = new Date(Date.now() - 2 * 86400000).toISOString()
    const res = (i, created_at, used) => ({ mention_key: `k${String(i).padStart(11, '0')}`, workspace_id: fx.store.workspace.id, created_by: me,
      dest_type: 'asset', dest_id: CHARACTER, created_at, used_kind: used ? 'task' : null, used_id: used ? 'x' : null,
      used_field: used ? 'description' : null, used_at: used ? created_at : null })
    fx.store.mothMentionReservations.push(...Array.from({ length: 500 }, (_, i) => res(i, old, false)))
    expect(await a.reserveMothMention('asset', CHARACTER)).toMatch(/^[0-9a-f]{12}$/)
    expect(fx.store.mothMentionReservations.filter(m => m.created_at === old)).toHaveLength(0)
    fx.store.mothMentionReservations.push(...Array.from({ length: 499 }, (_, i) => res(1000 + i, now(), true)))
    await expect(a.reserveMothMention('asset', CHARACTER)).rejects.toMatchObject({ code: '54000' })
  })

  it('the link picker offers a folder by its name', async () => {
    const { a } = tags()
    const found = await a.listMothMentionCandidates('shots', 50)
    expect(found.some(c => c.kind === 'folder' && c.name === 'SHOTS')).toBe(true)
  })
})

// Round 2: 0126's unique keys on live tags and types hold on a rename, a type's change and a bring-back as on a
// create, and fn_moth_tags_pin counts a revision only for new words or a new type.
describe('🚨 a rename or a bring-back that meets a live tag or type of the same words is refused, as 0126 refuses it', () => {
  it('Mara renames a company tag to another\'s words, or brings back a retired one a new one has replaced', async () => {
    const { a } = tags()
    const mora = await a.createMothTag({ typeId: CHARACTER_TYPE, tier: 'company', label: 'Mora' })
    await expect(a.updateMothTag(mora.id, { label: 'lead' })).rejects.toMatchObject({ code: '23505' })
    await a.updateMothTag(LEAD, { retired: true })
    await a.createMothTag({ typeId: CHARACTER_TYPE, tier: 'company', label: 'Lead' })
    await expect(a.updateMothTag(LEAD, { retired: false })).rejects.toMatchObject({ code: '23505' })
    const live = (await a.listMothTags()).filter(t => !t.retired_at && !t.canonical_id && t.label.toLowerCase() === 'lead')
    expect(live).toHaveLength(1)
    expect(live[0].id).not.toBe(LEAD)
  })

  it('a personal tag moved to a type where its words are taken, and a type renamed or brought back onto a live one\'s name', async () => {
    const { a } = tags()
    const places = await a.createMothTagType({ tier: 'personal', name: 'Places', shape: 'square', colour: 'sky' })
    const lamp = await a.createMothTag({ typeId: places.id, tier: 'personal', label: 'Lantern' })
    await expect(a.updateMothTag(lamp.id, { typeId: fid('mtype', 2) })).rejects.toMatchObject({ code: '23505' })
    await expect(a.updateMothTagType(places.id, { name: 'mine' })).rejects.toMatchObject({ code: '23505' })
    await a.updateMothTagType(MINE, { retired: true })
    await a.updateMothTagType(places.id, { name: 'Mine' })
    await expect(a.updateMothTagType(MINE, { retired: false })).rejects.toMatchObject({ code: '23505' })
  })

  it('CONTROL: one\'s own words in new letters, words a retired tag had, a retire, and another type\'s words all pass', async () => {
    const { a } = tags()
    expect((await a.updateMothTag(LEAD, { label: 'LEAD' })).label).toBe('LEAD')
    const extra = await a.createMothTag({ typeId: CHARACTER_TYPE, tier: 'company', label: 'Extra' })
    await a.updateMothTag(extra.id, { retired: true })
    const other = await a.createMothTag({ typeId: CHARACTER_TYPE, tier: 'company', label: 'Other' })
    expect((await a.updateMothTag(other.id, { label: 'extra' })).label).toBe('extra')
    // A retired tag retired again, its words now a live one's, is no clash: a retired tag is out of the key.
    expect((await a.updateMothTag(extra.id, { retired: true })).retired_at).toBeTruthy()
    // A personal tag of Mara's own type may share a company tag's words.
    expect((await a.createMothTag({ typeId: MINE, tier: 'personal', label: 'Lead' })).label).toBe('Lead')
    expect((await a.updateMothTagType(MINE, { name: 'Character' })).name).toBe('Character')
  })

  it('a revision is counted for new words or a new type, not for a retire or a bring-back', async () => {
    const { a } = tags()
    expect((await a.updateMothTag(LEAD, { retired: true })).revision).toBe(1)
    expect((await a.updateMothTag(LEAD, { retired: false })).revision).toBe(1)
    expect((await a.updateMothTag(LEAD, { label: 'Lead' })).revision).toBe(1)
    expect((await a.updateMothTag(LEAD, { label: 'Hero' })).revision).toBe(2)
  })
})

// Round 2: the fixtures' bounded lists say they were cut as the cloud's do, `truncated` on the array, out of sight.
describe('🚨 a list cut at its bound says so, as the cloud adapter says it', () => {
  it('5,000 notes Moth may draw is a full list, said to be cut; 4,999 is not', async () => {
    const { fx, a } = tags()
    const me = fx.permissions.userId
    const seed = fx.store.notes.find(n => n.owner_id === me && !n.deleted_at)
    const have = (await a.listMothNotes()).length
    fx.store.notes.push(...Array.from({ length: 4999 - have }, (_, i) => ({ ...seed, id: `bulk-note-${i}` })))
    const whole = await a.listMothNotes()
    expect(whole).toHaveLength(4999)
    expect(whole.truncated).not.toBe(true)
    fx.store.notes.push({ ...seed, id: 'bulk-note-last' })
    const full = await a.listMothNotes()
    expect(full).toHaveLength(5000)
    expect(full.truncated).toBe(true)
    expect(Object.keys(full)).not.toContain('truncated')
  })

  it('past 20,000 uses the list stops at its bound and says it was cut; exactly 20,000 does not', async () => {
    const { fx, a } = tags()
    const seed = fx.store.mothTagAssignments.find(x => x.tag_id === LEAD && x.target_id === CHARACTER)
    const have = (await a.listMothTagAssignments()).length
    fx.store.mothTagAssignments.push(...Array.from({ length: 20000 - have }, (_, i) => ({ ...seed, id: `bulk-use-${i}` })))
    const whole = await a.listMothTagAssignments()
    expect(whole).toHaveLength(20000)
    expect(whole.truncated).not.toBe(true)
    fx.store.mothTagAssignments.push({ ...seed, id: 'bulk-use-last' })
    const cut = await a.listMothTagAssignments()
    expect(cut).toHaveLength(20000)
    expect(cut.truncated).toBe(true)
    expect(Object.keys(cut)).not.toContain('truncated')
  })
})
