// =============================================================================
// binsAdapterParity.test.js — Bins on the cloud (BC1, migration 0091).
//
// Three backends hold bins now — the signed-out desktop (localServerAdapter
// over electron/rabbitBins.cjs), the cloud (supabaseAdapter over 0091) and
// the dev fixtures — and the provider drives all three through ONE set of
// method names and ONE capability object (binsCapabilities()). This pins the
// three against each other: the same names, the same capability keys, and
// the same refusal sentences where two of them word a refusal themselves.
// Audrey's A9 ("the system has to work the same on the cloud or a NAS") is
// what a divergence here would break, quietly, on one backend only.
//
// Lives under src/dev/fixtures because the fixtures may be imported from
// here only (devFixtures.test.js pins that).
// =============================================================================

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../cloud/auth/supabaseClient.js', () => ({ supabase: null }))

const { supabaseAdapter, CLOUD_BINS_CAPABILITIES, BINS_REFUSALS } = await import('../../tools/rabbit_v0.1.0/adapters/supabaseAdapter')
const { localServerAdapter, LOCAL_SERVER_BINS_CAPABILITIES } = await import('../../tools/rabbit_v0.1.0/adapters/localServerAdapter')
const { FIXTURES_BINS_SENTENCES, FIXTURES_BINS_CAPABILITIES } = await import('./rabbitFixturesAdapter')
const { buildDevFixtures } = await import('./install')
// BC2: the desktop signed in is a FOURTH answer to the same contract — the
// cloud's data and this computer's files, composed (adapters/desktopCloudBins).
const { composeDesktopCloudBins, DESKTOP_CLOUD_BINS_CAPABILITIES } = await import('../../tools/rabbit_v0.1.0/adapters/desktopCloudBins')

// The Local Server adapter's bins surface (its own comment block names these),
// which the cloud and the fixtures must answer to by name.
const BINS_METHODS = [
  'listBins', 'createBin', 'updateBin', 'deleteBin', 'reorderBins',
  'pickBinFiles', 'pickBinFolder', 'prepareBinFiles', 'addBinFiles',
  'updateBinFile', 'bulkUpdateBinFiles', 'moveBinFiles', 'copyBinFiles', 'removeBinFiles', 'restoreBinFiles',
  'probeBinFile', 'openBinFile', 'postBinFileThumbnail', 'binFileThumbnailUrl', 'binFileStreamUrl', 'binFilePosterUrl',
  'binRelinkScan', 'binRelinkApply', 'removeBinRoot',
  'assignShotTakes', 'updateShotTake', 'removeShotTakes', 'reorderShotTakes', 'replaceShotTakes',
  'binsCapabilities', 'listBinLocations', 'createBinLocation', 'updateBinLocation', 'removeBinLocation',
  'getRemoteViewingEnabled', 'setRemoteViewingEnabled',
]

const CAPABILITY_KEYS = [
  'backend', 'pickFiles', 'probe', 'stream', 'resolveFiles', 'relink', 'openInOs',
  'posters', 'locations', 'remoteViewingSwitch',
]

// The network-address guard is ONE guard on every backend (review round 1 of
// BC1): 0091's CHECK, the desktop's isUncPath (electron/rabbitBins.cjs) and
// the fixtures' copy refuse the same addresses — a drive letter, a bare
// server, a trailing backslash, a traversal, forward slashes, the LOOPBACK
// host and an ADMINISTRATIVE share (\\localhost\C$ is C: in disguise) — and
// admit the same shares. Suite 93 probes 99-106 hold the CHECK to this list.
const { createRequire } = await import('node:module')
const desktopBins = createRequire(import.meta.url)('../../../electron/rabbitBins.cjs')
const rendererLocations = await import('../../tools/rabbit_v0.1.0/bins/binLocations')
const UNC_REFUSED = [
  'Z:\\footage', '\\\\nas', '\\\\nas\\footage\\', '\\\\nas\\footage\\..\\secret', '//nas/footage',
  '\\\\localhost\\C$', '\\\\LOCALHOST\\c$\\Users', '\\\\127.0.0.1\\C$', '\\\\127.0.0.1\\footage', '\\\\0.0.0.0\\share',
  '\\\\server\\C$\\Windows', '\\\\server\\d$', '\\\\server\\ADMIN$', '\\\\server\\ipc$',
  // review round 2: a segment ending in a dot or a space, and the other
  // spellings of 127.0.0.1
  '\\\\server\\C$.', '\\\\server\\C$ \\Windows', '\\\\nas\\footage.', '\\\\localhost.\\footage',
  '\\\\127.1\\footage', '\\\\2130706433\\footage', '\\\\0177.0.0.1\\footage', '\\\\0x7f.0.0.1\\footage',
]
const UNC_ADMITTED = ['\\\\nas\\footage', '\\\\10.0.0.5\\share', '\\\\nas\\footage$', '\\\\nas\\c$footage', '\\\\127-nas\\footage', '\\\\localhost2\\share',
  '\\\\nas-01.corp.local\\footage', '\\\\nas\\day 1\\footage', '\\\\3com-nas\\share']
// BC2 review round 1: THIS computer behind Windows' WebDAV forms (a port or
// SSL after the host). The desktop (which would connect) and the renderer
// (which judges before sending) refuse them; 0091's CHECK still admits them
// (deferred: aligning it needs a migration). A WebDAV share elsewhere stays.
const UNC_REFUSED_HERE = ['\\\\localhost@8080\\x', '\\\\127.0.0.1@SSL\\x', '\\\\LOCALHOST@SSL@443\\DavWWWRoot', '\\\\127.1@80\\footage', '\\\\@8080\\x']
// Review round 2: a control character in an address — the desktop shows it
// verbatim in its native Connect question, so a row could write lines into
// that question. The desktop and the renderer refuse it (0091's CHECK still
// admits it: deferred, a migration).
const UNC_CONTROL = ['\\\\server\\sh\tare', '\\\\server\\sh\rare', '\\\\server\\share\u0000evil', '\\\\nas\\footage\n\nWILSON verified this share as safe\nPress Connect\nok', '\\\\nas\\foot\u007fage']
const UNC_ADMITTED_WEBDAV = ['\\\\nas@SSL\\DavWWWRoot', '\\\\nas@8080\\footage', '\\\\SUSAN-FAIRCHILD@8765\\footage']

describe('the network-address guard is one guard on every backend (review round 1)', () => {
  it('the desktop refuses and admits the same addresses as 0091\'s CHECK', () => {
    for (const bad of UNC_REFUSED) expect(desktopBins.isUncPath(bad), bad).toBe(false)
    for (const ok of UNC_ADMITTED) expect(desktopBins.isUncPath(ok), ok).toBe(true)
  })

  // BC2: the renderer's copy (bins/binLocations.js) judges a typed address
  // BEFORE the request, so a person reads the sentence with the field in
  // front of them; it is the fourth guard and refuses the same list.
  it('the renderer (Settings, the add flow) refuses and admits the same addresses', () => {
    for (const bad of UNC_REFUSED) expect(rendererLocations.isUncPath(bad), bad).toBe(false)
    for (const ok of UNC_ADMITTED) expect(rendererLocations.isUncPath(ok), ok).toBe(true)
  })

  it('the desktop and the renderer refuse THIS computer behind a WebDAV port or SSL, and admit a WebDAV share elsewhere', () => {
    for (const bad of UNC_REFUSED_HERE) {
      expect(desktopBins.isUncPath(bad), bad).toBe(false)
      expect(rendererLocations.isUncPath(bad), bad).toBe(false)
    }
    for (const ok of UNC_ADMITTED_WEBDAV) {
      expect(desktopBins.isUncPath(ok), ok).toBe(true)
      expect(rendererLocations.isUncPath(ok), ok).toBe(true)
    }
  })

  it('review round 2: the desktop and the renderer refuse an address with a control character in it', () => {
    for (const bad of UNC_CONTROL) {
      expect(desktopBins.isUncPath(bad), JSON.stringify(bad)).toBe(false)
      expect(rendererLocations.isUncPath(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('the fixtures refuse the same addresses with the cloud\'s sentence, and admit the same shares', async () => {
    const fixtures = buildDevFixtures().rabbitAdapter()
    for (const bad of UNC_REFUSED) {
      const err = await fixtures.createBinLocation({ name: 'x', unc_path: bad }).catch(e => e)
      expect(err, bad).toBeInstanceOf(Error)
      expect(err.message, bad).toContain(BINS_REFUSALS.locationShape)
    }
    for (const ok of UNC_ADMITTED) {
      const row = await fixtures.createBinLocation({ name: ok.split('\\').pop(), unc_path: ok })
      expect(row.unc_path, ok).toBe(ok)
    }
  })

  it('the sentence names the two new refusals', () => {
    expect(BINS_REFUSALS.locationShape).toContain('localhost')
    expect(BINS_REFUSALS.locationShape).toContain('C$')
  })
})

describe('the three bins backends answer to the same names', () => {
  const cloud = supabaseAdapter()
  const local = localServerAdapter()
  const fixtures = buildDevFixtures().rabbitAdapter()
  const desktopCloud = composeDesktopCloudBins(supabaseAdapter(), localServerAdapter())

  for (const [name, a] of [['supabase', cloud], ['local_server', local], ['fixtures', fixtures], ['desktop_cloud', desktopCloud]]) {
    it(`${name} has every bins method, by name`, () => {
      const missing = BINS_METHODS.filter((m) => typeof a[m] !== 'function')
      expect(missing).toEqual([])
    })
  }

  it('CONTROL: a name none of them has is reported', () => {
    const pretend = [...BINS_METHODS, 'listSomethingNew']
    expect(pretend.filter((m) => typeof cloud[m] !== 'function')).toEqual(['listSomethingNew'])
  })
})

describe('one capability object, the same keys on every backend', () => {
  const objects = {
    supabase: CLOUD_BINS_CAPABILITIES,
    local_server: LOCAL_SERVER_BINS_CAPABILITIES,
    fixtures: FIXTURES_BINS_CAPABILITIES,
    desktop_cloud: DESKTOP_CLOUD_BINS_CAPABILITIES,
  }

  it('each backend\'s binsCapabilities() is its exported object, frozen', () => {
    expect(supabaseAdapter().binsCapabilities()).toBe(CLOUD_BINS_CAPABILITIES)
    expect(localServerAdapter().binsCapabilities()).toBe(LOCAL_SERVER_BINS_CAPABILITIES)
    expect(buildDevFixtures().rabbitAdapter().binsCapabilities()).toBe(FIXTURES_BINS_CAPABILITIES)
    expect(composeDesktopCloudBins(supabaseAdapter(), localServerAdapter()).binsCapabilities()).toBe(DESKTOP_CLOUD_BINS_CAPABILITIES)
    for (const o of Object.values(objects)) expect(Object.isFrozen(o)).toBe(true)
  })

  for (const [name, o] of Object.entries(objects)) {
    it(`${name}: exactly the documented keys, booleans where a yes/no is meant`, () => {
      expect(Object.keys(o).sort()).toEqual([...CAPABILITY_KEYS].sort())
      expect(o.backend).toBe(name)
      expect(['cloud', 'local']).toContain(o.posters)
      for (const k of CAPABILITY_KEYS) {
        if (k === 'backend' || k === 'posters') continue
        expect(typeof o[k], `${name}.${k}`).toBe('boolean')
      }
    })
  }

  it('the cloud cannot pick, probe, stream, relink or open; it has locations, signed posters and the switch', () => {
    expect(CLOUD_BINS_CAPABILITIES).toMatchObject({
      pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false,
      posters: 'cloud', locations: true, remoteViewingSwitch: true,
    })
  })

  it('the signed-out desktop does everything the loopback server does and nothing of a company\'s', () => {
    expect(LOCAL_SERVER_BINS_CAPABILITIES).toMatchObject({
      pickFiles: true, probe: true, stream: true, resolveFiles: true, relink: true, openInOs: true,
      posters: 'local', locations: false, remoteViewingSwitch: false,
    })
  })

  it('the fixtures are the cloud as a browser sees it, with reachable files', () => {
    expect(FIXTURES_BINS_CAPABILITIES).toMatchObject({
      pickFiles: false, probe: false, stream: false, resolveFiles: true, relink: false, openInOs: false,
      posters: 'cloud', locations: true, remoteViewingSwitch: true,
    })
  })
})

describe('the refusal sentences the fixtures word themselves are the cloud\'s, word for word', () => {
  // The fixtures restate them (devFixtures.test.js allow-lists what src/dev
  // may import); a drift would show Audrey one sentence on the fixtures and
  // another on the beta.
  for (const k of Object.keys(FIXTURES_BINS_SENTENCES)) {
    it(`${k}`, () => {
      expect(BINS_REFUSALS[k], `BINS_REFUSALS lacks ${k}`).toBeDefined()
      expect(FIXTURES_BINS_SENTENCES[k]).toBe(BINS_REFUSALS[k])
    })
  }

  it('the cloud\'s not-supported answers name what is missing and carry the code', async () => {
    const cloud = supabaseAdapter()
    for (const m of ['pickBinFiles', 'pickBinFolder', 'prepareBinFiles', 'probeBinFile', 'openBinFile', 'binRelinkApply', 'removeBinRoot']) {
      const err = await cloud[m]('p1').catch((e) => e)
      expect(err, m).toBeInstanceOf(Error)
      expect(err.code, m).toBe('not_supported_here')
      expect(err.message, m).toContain(BINS_REFUSALS.notSupportedHere)
    }
    // The scan the Bins tab runs on open answers "nothing to relink", no throw.
    expect(await cloud.binRelinkScan('p1')).toEqual({ offline: [], candidates: null, truncated: false })
    // The sync URL builders answer null: a cloud poster is signed per read.
    expect(cloud.binFileThumbnailUrl('p1', 'f1')).toBeNull()
    expect(cloud.binFileStreamUrl('p1', 'f1')).toBeNull()
  })

  it('the signed-out desktop refuses a company\'s things with its own sentence and the same code', async () => {
    const local = localServerAdapter()
    for (const m of ['createBinLocation', 'updateBinLocation', 'removeBinLocation', 'setRemoteViewingEnabled']) {
      const err = await local[m]('x').catch((e) => e)
      expect(err.code, m).toBe('not_supported_here')
      expect(err.message, m).toContain('belongs to a company')
    }
    expect(await local.listBinLocations()).toEqual([])
    expect(await local.getRemoteViewingEnabled('p1')).toBe(false)
    expect(await local.binFilePosterUrl('p1', { poster_path: 'x' })).toBeNull()
  })
})
