// =============================================================================
// binsBrowserVariant.test.js — BC3: `?bins=browser` on the dev fixtures.
//
// The fake cloud answers the Bins tab, by default, with every clip reachable
// (there is no disk behind it). A real browser's cloud cannot say what this
// computer reaches, so BC3's catalogue — "not on this computer" on every
// clip, the browser's sentence, the picture large — could not be rehearsed on
// the fixtures. `?bins=browser` makes them answer as the cloud does there:
// the same capability object with `resolveFiles` false, and no `online` on
// any clip row, from the list and from every write. The default is
// unchanged, and binsAdapterParity.test.js keeps pinning it.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../cloud/auth/supabaseClient.js', () => ({ supabase: null }))

const { buildDevFixtures } = await import('./install')
const { binsFixtureMode } = await import('./store')
const { FIXTURES_BINS_CAPABILITIES, FIXTURES_BROWSER_BINS_CAPABILITIES } = await import('./rabbitFixturesAdapter')
const { PROJECT } = await import('./data/project')

describe('the query flag', () => {
  it('reads ?bins=browser and nothing else', () => {
    expect(binsFixtureMode('?bins=browser')).toBe('browser')
    expect(binsFixtureMode('?fixtures=game&bins=browser')).toBe('browser')
    expect(binsFixtureMode('?bins=desktop')).toBeNull()
    expect(binsFixtureMode('')).toBeNull()
  })
})

describe('the browser variant answers as the cloud does in a browser', () => {
  it('the capability object: the fixtures\' keys, resolveFiles false, frozen', () => {
    expect(Object.keys(FIXTURES_BROWSER_BINS_CAPABILITIES).sort()).toEqual(Object.keys(FIXTURES_BINS_CAPABILITIES).sort())
    expect(FIXTURES_BROWSER_BINS_CAPABILITIES).toEqual({ ...FIXTURES_BINS_CAPABILITIES, resolveFiles: false })
    expect(Object.isFrozen(FIXTURES_BROWSER_BINS_CAPABILITIES)).toBe(true)
    expect(buildDevFixtures({ bins: 'browser' }).rabbitAdapter().binsCapabilities()).toBe(FIXTURES_BROWSER_BINS_CAPABILITIES)
  })

  it('no clip row carries `online`, from the list, the project load, or a write; the default carries true', async () => {
    const browser = buildDevFixtures({ bins: 'browser' }).rabbitAdapter()
    const list = await browser.listBins(PROJECT.id)
    expect(list.binFiles.length).toBeGreaterThan(0)
    expect(list.binFiles.every(f => !('online' in f))).toBe(true)
    expect(list.capabilities).toBe(FIXTURES_BROWSER_BINS_CAPABILITIES)
    const loaded = await browser.loadProject(PROJECT.id)
    expect(loaded.binFiles.every(f => !('online' in f))).toBe(true)
    const patched = await browser.updateBinFile(PROJECT.id, list.binFiles[0].id, { notes: 'x' })
    expect('online' in patched).toBe(false)
    expect(patched.notes).toBe('x')
    // CONTROL: the default is what BC1 made it.
    const plain = buildDevFixtures().rabbitAdapter()
    expect(plain.binsCapabilities()).toBe(FIXTURES_BINS_CAPABILITIES)
    const plainList = await plain.listBins(PROJECT.id)
    expect(plainList.binFiles.every(f => f.online === true)).toBe(true)
    expect((await plain.updateBinFile(PROJECT.id, plainList.binFiles[0].id, { notes: 'y' })).online).toBe(true)
  })
})
