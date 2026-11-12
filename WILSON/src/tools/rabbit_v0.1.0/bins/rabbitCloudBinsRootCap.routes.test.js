// =============================================================================
// rabbitCloudBinsRootCap.routes.test.js — the desktop's DEFAULT cap on
// questions to location roots (BC2, after review round 1).
//
// Measured in the desktop app: with the first cap of four, six company
// locations whose servers do not answer kept a live share's question queued
// past the 2 s limit, and the share read "not reachable". A held question
// costs a parked worker thread, not one of libuv's pool slots, so the
// default is sixteen. Its own file: the routes keep their registry at module
// level, and this mount must use the DEFAULT cap (no cloudBinsRootMaxAsking).
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountRabbitBins } = require('../../../../electron/rabbitBins.cjs')

const WAIT_MS = 150
const LIVE = '\\\\live-nas\\footage'
const dead = Array.from({ length: 6 }, (_, i) => `\\\\dead-nas-${i}\\footage`)
let server, base
const saved = { value: { version: 1, locations: {}, connected: Object.fromEntries([LIVE, ...dead].map(u => [u.toLowerCase(), { unc_path: u }])) } }

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  mountRabbitBins(app, {
    readRabbitBundle: () => null, writeRabbitBundle: () => {}, rabbitTouch: (r) => r, rabbitUpsertInto: (a, r) => r, rabbitRemoveFrom: () => false,
    rabbitNotFound: (res) => res.status(404).json({ error: 'not found' }),
    getThumbCacheDir: () => '.', generateVideoThumbOnce: async () => ({ ok: false }), safeMediaContentType: (m) => m,
    userAuthorizedDirs: new Set(), dialog: null, getMainWindow: () => null, shell: null,
    cloudBinsLocalPaths: { read: () => saved.value, write: (v) => { saved.value = v } },
    cloudBinsRootWaitMs: WAIT_MS,
    // A dead server never answers; the live one answers at once.
    cloudBinsAskRoot: (root) => (root === LIVE ? Promise.resolve(true) : new Promise(() => {})),
  })
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => new Promise(r => server.close(r)))

describe('the default cap on root questions', () => {
  it('six servers that never answer do not keep a live share\'s question from answering in time', async () => {
    const r = await fetch(`${base}/api/rabbit/cloud-bins/locations`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ locations: [...dead.map((u, i) => ({ id: `d${i}`, unc_path: u })), { id: 'live', unc_path: LIVE }] }),
    })
    const locs = (await r.json()).locations
    expect(locs.find(l => l.id === 'live')).toMatchObject({ connected: true, reachable: true })
    expect(locs.filter(l => l.id.startsWith('d')).every(l => l.reachable === false)).toBe(true)
  })
})
