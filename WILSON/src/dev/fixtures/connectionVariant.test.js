// =============================================================================
// connectionVariant.test.js — what the fake cloud tells R.A.B.B.I.T.'s
// connection dot (post-overhaul FX11). `?connection=files-down` and
// `?connection=offline` show its amber and red on the dev fixtures; by
// default both parts answer. In memory: no network, nothing stored.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { connectionFixtureMode, createStore } from './store'
import { createRabbitFixturesAdapter } from './rabbitFixturesAdapter'
import { buildDevFixtures } from './install'

const identity = { userId: 'u', workspaceId: 'w' }

describe('?connection=… (FX11)', () => {
  it('reads files-down and offline; anything else is the default', () => {
    expect(connectionFixtureMode('?connection=files-down')).toBe('files-down')
    expect(connectionFixtureMode('?fixtures=game&connection=offline')).toBe('offline')
    expect(connectionFixtureMode('?connection=on')).toBeNull()
    expect(connectionFixtureMode('')).toBeNull()
  })
  it('the adapter answers the dot: both parts; the database only; neither', async () => {
    const at = (connection) => createRabbitFixturesAdapter(createStore(), identity, { connection }).connectionProbe()
    expect(await at(null)).toEqual({ database: true, files: true })
    expect(await at('files-down')).toEqual({ database: true, files: false })
    expect(await at('offline')).toEqual({ database: false, files: false })
  })
  it('install passes the mode to the one adapter, and leaves the adapter\'s status and the bins alone', async () => {
    const fx = buildDevFixtures({ connection: 'offline', bins: 'browser' })
    const a = fx.rabbitAdapter()
    expect(await a.connectionProbe()).toEqual({ database: false, files: false })
    // A project already open stays open when the network goes: status() is
    // the boot's question, unchanged.
    expect((await a.status()).online).toBe(true)
    expect(a.binsCapabilities().resolveFiles).toBe(false)
    expect(await buildDevFixtures({}).rabbitAdapter().connectionProbe()).toEqual({ database: true, files: true })
  })
})
