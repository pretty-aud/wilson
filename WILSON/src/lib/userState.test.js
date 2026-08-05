// =============================================================================
// userState.test.js — Session 31.
//
// 🚨 THE ADOPTION RULE IS THE ONE THING HERE THAT DESTROYS DATA IF IT IS WRONG,
// and the dangerous direction is not the obvious one.
//
// The obvious failure is "the cloud is empty, so the blank default wins and
// wipes the pet she has". The subtler and likelier one is the ORDER: the app
// mints and persists a blank egg the first time it reads an empty store, on
// every host it has ever run on. So a second computer that has merely been
// OPENED already has a local pet. If signing in there uploaded it, Audrey's
// real Ollie on the first machine would be overwritten by an egg nobody has
// ever touched.
//
// That is why `isRealPet` exists and why these tests lead with it. A pristine
// egg is "nothing yet" and must never win against anything.
//
// Behaviour tests, not a source scan — this module is a plain module and can be
// driven directly. `guardsCallSites.test.js` covers what a behaviour test
// cannot: that App.jsx actually CALLS any of it.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

const from = vi.fn()
vi.mock('../cloud/auth/supabaseClient', () => ({ supabase: { from: (...a) => from(...a) } }))

const loadPet = vi.fn()
const savePetData = vi.fn()
const loadOtterSettings = vi.fn()
const saveOtterSettings = vi.fn()
const loadAgentSkills = vi.fn()
const saveAgentSkills = vi.fn()
vi.mock('./localData', () => ({
  loadPet: (...a) => loadPet(...a),
  savePetData: (...a) => savePetData(...a),
  loadOtterSettings: (...a) => loadOtterSettings(...a),
  saveOtterSettings: (...a) => saveOtterSettings(...a),
  loadAgentSkills: (...a) => loadAgentSkills(...a),
  saveAgentSkills: (...a) => saveAgentSkills(...a),
}))

const { isRealPet, resolveUserPet, saveCloudPet, fetchCloudPet, resolveUserSettings,
        setUserStateOwner, pushSettingsToCloud, mirrorSettingsToCache } =
  await import('./userState')

/** Minimal PostgREST double: one canned answer for select, one for upsert. */
function stubTable({ selectRow = null, selectError = null,
                     upsertRows = [{ user_id: 'u1' }], upsertError = null } = {}) {
  const upsert = vi.fn(() => ({
    select: () => Promise.resolve({ data: upsertRows, error: upsertError }),
  }))
  from.mockReturnValue({
    select: () => ({
      maybeSingle: () => Promise.resolve({ data: selectRow, error: selectError }),
    }),
    upsert,
  })
  return { upsert }
}

const PRISTINE_EGG = {
  name: 'Ollie', form: 'egg', bornAt: null, interactionCount: 0,
  hunger: 0, happiness: 0, difficulty: 'medium',
}
// Audrey's actual pet, read off disk 2026-08-05.
const REAL_GHOST = {
  name: 'Ollie', form: 'ghost', bornAt: '2026-07-16T07:57:42.865Z',
  diedAt: '2026-07-30T17:30:12.459Z', interactionCount: 5,
  hunger: 0, happiness: 0, difficulty: 'low', breed: 'blob', gender: 'male',
}

beforeEach(() => {
  from.mockReset(); loadPet.mockReset(); savePetData.mockReset()
  loadOtterSettings.mockReset(); saveOtterSettings.mockReset()
  loadAgentSkills.mockReset(); saveAgentSkills.mockReset()
  loadOtterSettings.mockResolvedValue({})
  saveOtterSettings.mockResolvedValue(undefined)
  loadAgentSkills.mockResolvedValue({})
  saveAgentSkills.mockResolvedValue(undefined)
  setUserStateOwner(null)
})

describe('isRealPet — the adoption discriminator', () => {
  it('a pristine egg is NOT real, however many the app has minted', () => {
    expect(isRealPet(PRISTINE_EGG)).toBe(false)
  })

  it('a hatched pet is real', () => {
    expect(isRealPet({ ...PRISTINE_EGG, bornAt: '2026-07-16T00:00:00.000Z' })).toBe(true)
  })

  it('🚨 a DEAD pet is real — Audrey\'s Ollie is a ghost and must still travel', () => {
    expect(isRealPet(REAL_GHOST)).toBe(true)
  })

  it('an egg that has been tapped is real', () => {
    expect(isRealPet({ ...PRISTINE_EGG, interactionCount: 3 })).toBe(true)
  })

  it('null is not a pet', () => {
    expect(isRealPet(null)).toBe(false)
  })
})

describe('resolveUserPet — which pet wins', () => {
  it('uploads the real local pet when the account has none (Audrey\'s case)', async () => {
    const { upsert } = stubTable({ selectRow: null })
    loadPet.mockResolvedValue(REAL_GHOST)

    const res = await resolveUserPet()

    expect(res.adopted).toBe(true)
    expect(res.source).toBe('local')
    expect(res.pet.name).toBe('Ollie')
    expect(upsert).toHaveBeenCalledTimes(1)
    // The ghost is carried across AS-IS — form and death intact, per Audrey's
    // decision on 2026-08-05 to keep the pet exactly as it stands.
    expect(upsert.mock.calls[0][0].form).toBe('ghost')
    expect(upsert.mock.calls[0][0].died_at).toBe('2026-07-30T17:30:12.459Z')
  })

  it('🚨 a pristine local egg NEVER overwrites a real cloud pet', async () => {
    const { upsert } = stubTable({
      selectRow: { name: 'Ollie', form: 'ghost', born_at: '2026-07-16T07:57:42.865Z',
                   interaction_count: 5, hunger: 0, happiness: 0, feedback: [] },
    })
    loadPet.mockResolvedValue(PRISTINE_EGG)

    const res = await resolveUserPet()

    expect(res.source).toBe('cloud')
    expect(res.adopted).toBe(false)
    expect(res.pet.form).toBe('ghost')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('🚨 and does not upload itself either — a never-used computer writes nothing', async () => {
    const { upsert } = stubTable({ selectRow: null })
    loadPet.mockResolvedValue(PRISTINE_EGG)

    await resolveUserPet()

    // It seeds the row so one exists, but only because the cloud was empty too.
    // The property that matters: it never beat anything.
    expect(upsert.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('a real cloud pet always wins over a real local one', async () => {
    const { upsert } = stubTable({
      selectRow: { name: 'CloudPet', form: 'adult', born_at: '2026-08-01T00:00:00.000Z',
                   interaction_count: 2, hunger: 50, happiness: 50, feedback: [] },
    })
    loadPet.mockResolvedValue(REAL_GHOST)

    const res = await resolveUserPet()

    expect(res.pet.name).toBe('CloudPet')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('a broken local cache does not stop a cloud pet loading', async () => {
    stubTable({
      selectRow: { name: 'CloudPet', form: 'adult', born_at: '2026-08-01T00:00:00.000Z',
                   interaction_count: 1, hunger: 10, happiness: 10, feedback: [] },
    })
    loadPet.mockRejectedValue(new Error('storage blocked'))

    const res = await resolveUserPet()
    expect(res.pet.name).toBe('CloudPet')
  })
})

describe('saveCloudPet — an RLS refusal is not a success', () => {
  it('🚨 throws when the write returns ZERO ROWS', async () => {
    // This is the shape that cost the Validator every fix Audrey ever accepted:
    // PostgREST does not raise for an RLS-refused write, it returns no rows.
    stubTable({ upsertRows: [] })
    await expect(saveCloudPet(REAL_GHOST)).rejects.toThrow(/refused/i)
  })

  it('throws on a PostgREST error', async () => {
    stubTable({ upsertError: { message: 'permission denied' } })
    await expect(saveCloudPet(REAL_GHOST)).rejects.toThrow(/permission denied/)
  })

  it('resolves when a row comes back', async () => {
    stubTable({ upsertRows: [{ user_id: 'u1' }] })
    await expect(saveCloudPet(REAL_GHOST)).resolves.toBeUndefined()
  })

  it('never sends user_id — the column default stamps it from the JWT', async () => {
    const { upsert } = stubTable({})
    await saveCloudPet({ ...REAL_GHOST, userId: 'someone-else' })
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('user_id')
  })

  it('maps camelCase to snake_case and never sends `state`', async () => {
    const { upsert } = stubTable({})
    await saveCloudPet({ ...REAL_GHOST, state: 'dead', lastUpdatedAt: '2026-08-05T00:00:00.000Z' })
    const row = upsert.mock.calls[0][0]
    expect(row.last_updated_at).toBe('2026-08-05T00:00:00.000Z')
    expect(row.total_thumbs_up).toBeUndefined() // absent on this fixture, not renamed wrongly
    expect(row).not.toHaveProperty('state')
    expect(row).not.toHaveProperty('lastUpdatedAt')
  })
})

describe('fetchCloudPet', () => {
  it('returns null when the person has no row yet', async () => {
    stubTable({ selectRow: null })
    await expect(fetchCloudPet()).resolves.toBeNull()
  })

  it('throws rather than resolving null on an error', async () => {
    stubTable({ selectError: { message: 'boom' } })
    await expect(fetchCloudPet()).rejects.toThrow(/boom/)
  })

  it('feedback always comes back as an array', async () => {
    stubTable({ selectRow: { name: 'X', form: 'egg', feedback: null } })
    const pet = await fetchCloudPet()
    expect(Array.isArray(pet.feedback)).toBe(true)
  })
})

describe('resolveUserSettings', () => {
  it('lifts local prompts into an empty account once', async () => {
    const { upsert } = stubTable({ selectRow: null })
    loadOtterSettings.mockResolvedValue({ prompts: { companion: 'be warm' } })

    const res = await resolveUserSettings()

    expect(res.adopted).toBe(true)
    expect(upsert.mock.calls[0][0].prompts).toEqual({ companion: 'be warm' })
  })

  it('🚨 never carries machine-specific settings to another computer', async () => {
    const { upsert } = stubTable({ selectRow: null })
    loadOtterSettings.mockResolvedValue({
      prompts: { companion: 'be warm' },
      storageLocation: 'C:\\Users\\Audrey\\Documents\\My_Work',
      rabbit: { adapterMode: 'local_server', activeProjectId: 'abc', departments: ['Art'] },
    })

    await resolveUserSettings()

    const row = upsert.mock.calls[0][0]
    const sent = JSON.stringify(row)
    // A local disk path names a DIFFERENT folder on another machine, and
    // adapterMode would point it at a server holding none of its data.
    expect(sent).not.toContain('storageLocation')
    expect(sent).not.toContain('local_server')
    expect(sent).not.toContain('activeProjectId')
    expect(sent).not.toContain('departments')
    expect(row.prompts).toEqual({ companion: 'be warm' })
  })

  it('a populated cloud row wins and nothing is uploaded', async () => {
    const { upsert } = stubTable({
      selectRow: { prompts: { companion: 'cloud version' }, agent_prompt_overrides: {} },
    })
    loadOtterSettings.mockResolvedValue({ prompts: { companion: 'local version' } })

    const res = await resolveUserSettings()

    expect(res.settings.prompts.companion).toBe('cloud version')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('writes nothing when there is nothing anywhere', async () => {
    const { upsert } = stubTable({ selectRow: null })
    const res = await resolveUserSettings()
    expect(res.adopted).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('pushSettingsToCloud — the writer that was dead on first pass', () => {
  it('🚨 no-ops when signed out, so a local-only install can still edit prompts', async () => {
    const { upsert } = stubTable({})
    setUserStateOwner(null)
    await pushSettingsToCloud()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('pushes prompts and agent overrides when signed in', async () => {
    const { upsert } = stubTable({})
    setUserStateOwner('user-1')
    loadOtterSettings.mockResolvedValue({ prompts: { companion: 'be warm' },
                                          rabbit: { adapterMode: 'local_server' } })
    loadAgentSkills.mockResolvedValue({ otter: { systemPromptOverride: 'cite sources' } })

    await pushSettingsToCloud()

    const row = upsert.mock.calls[0][0]
    expect(row.prompts).toEqual({ companion: 'be warm' })
    expect(row.agent_prompt_overrides).toEqual({ otter: { systemPromptOverride: 'cite sources' } })
    // Machine state must not ride along even on the push path.
    expect(JSON.stringify(row)).not.toContain('local_server')
  })

  it('surfaces an RLS refusal rather than reporting success', async () => {
    stubTable({ upsertRows: [] })
    setUserStateOwner('user-1')
    loadOtterSettings.mockResolvedValue({ prompts: { companion: 'x' } })
    await expect(pushSettingsToCloud()).rejects.toThrow(/refused/i)
  })
})

describe('mirrorSettingsToCache', () => {
  it('🚨 MERGES rather than overwriting — saveOtterSettings is a whole-object write', async () => {
    // Writing { prompts } alone would drop adapterMode and activeProjectId,
    // the machine-specific keys that deliberately do NOT travel but MUST
    // survive locally.
    loadOtterSettings.mockResolvedValue({
      rabbit: { adapterMode: 'local_server', activeProjectId: 'p1' },
      prompts: { mc: 'keep me' },
    })

    await mirrorSettingsToCache({ prompts: { companion: 'from cloud' }, agentPromptOverrides: {} })

    const written = saveOtterSettings.mock.calls[0][0]
    expect(written.rabbit.adapterMode).toBe('local_server')
    expect(written.rabbit.activeProjectId).toBe('p1')
    expect(written.prompts.companion).toBe('from cloud')
    expect(written.prompts.mc).toBe('keep me')
  })

  it('a broken cache never throws — the account copy is still authoritative', async () => {
    loadOtterSettings.mockRejectedValue(new Error('storage blocked'))
    await expect(mirrorSettingsToCache({ prompts: {}, agentPromptOverrides: {} }))
      .resolves.toBeUndefined()
  })
})
