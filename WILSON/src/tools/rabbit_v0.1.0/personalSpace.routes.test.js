// =============================================================================
// personalSpace.routes.test.js — MO1 (MOTH_DESIGN §2.2 DT-1, PSA-05, PSA-06, SEC-7):
// the signed-out desktop's personal space. A real Express app on an ephemeral
// port, the real electron/personalSpace.cjs and real files in a temp userData,
// with a bundle store that has disk semantics; the project routes it runs ahead
// of are stand-ins that record what reached them. main.cjs's own wiring is pinned
// by reading it at the end, and the archive by lifting it, as
// runMigrationBins.test.js does.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { createPersonalSpace, mountPersonalSpace } = require('../../../electron/personalSpace.cjs')
const { randomUUID } = require('node:crypto')

let userData
let space
let server
let base
let reached

function bundlePathOf(id) {
  const dir = space.dirFor(id) || path.join(userData, 'rabbit-data', 'projects', String(id))
  return path.join(dir, 'project.json')
}
const readRabbitBundle = (id) => {
  try { return JSON.parse(fs.readFileSync(bundlePathOf(id), 'utf-8')) } catch { return null }
}
const writeRabbitBundle = (id, bundle) => {
  const file = bundlePathOf(id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(bundle))
}

function freshApp() {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-userdata-'))
  space = createPersonalSpace({ fs, path, userDataDir: userData, newId: randomUUID })
  reached = []
  const app = express()
  app.use(express.json())
  mountPersonalSpace(app, { space, emptyBundle: (project) => ({ project, files: [] }), readRabbitBundle, writeRabbitBundle })
  const standIn = (name) => (req, res) => { reached.push({ name, params: req.params, body: req.body }); res.json({ ok: true, reached: name }) }
  app.post('/api/rabbit/projects', standIn('create'))
  app.patch('/api/rabbit/projects/:id', standIn('patch'))
  app.delete('/api/rabbit/projects/:id', standIn('delete'))
  app.post('/api/rabbit/projects/:projectId/files/relink-apply', standIn('relink'))
  return app
}
const listen = (app) => new Promise((resolve) => {
  server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve() })
})
const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  if (server) await new Promise(r => server.close(r))
  await listen(freshApp())
})
afterAll(async () => { if (server) await new Promise(r => server.close(r)) })

const personalDir = () => path.join(userData, 'personal-space')

describe('GET and POST /api/rabbit/personal-space', () => {
  it('GET asks and makes nothing', async () => {
    expect(await call('GET', '/api/rabbit/personal-space')).toEqual({ status: 200, body: { project: null } })
    expect(fs.existsSync(personalDir())).toBe(false)
  })

  it('two POSTs make one space, under userData and outside the data folder', async () => {
    const one = await call('POST', '/api/rabbit/personal-space')
    const two = await call('POST', '/api/rabbit/personal-space')
    expect(one.status).toBe(200)
    expect(two.body.id).toBe(one.body.id)
    expect(one.body).toMatchObject({ title: 'Personal space', personal: true })
    expect(fs.existsSync(path.join(personalDir(), 'project.json'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'rabbit-data'))).toBe(false)
    expect((await call('GET', '/api/rabbit/personal-space')).body.project.id).toBe(one.body.id)
  })

  it('a bundle that cannot be read is refused, never written over', async () => {
    fs.mkdirSync(personalDir(), { recursive: true })
    fs.writeFileSync(path.join(personalDir(), 'project.json'), '{ not json')
    expect((await call('POST', '/api/rabbit/personal-space')).status).toBe(409)
    expect((await call('GET', '/api/rabbit/personal-space')).status).toBe(409)
    expect(fs.readFileSync(path.join(personalDir(), 'project.json'), 'utf-8')).toBe('{ not json')
  })
})

describe('the row never changes (PSA-06)', () => {
  it('DELETE and PATCH of its id: 409, nothing reaches the project routes, the directory stays', async () => {
    const { id } = (await call('POST', '/api/rabbit/personal-space')).body
    const del = await call('DELETE', `/api/rabbit/projects/${id}`)
    expect(del.status).toBe(409)
    expect(del.body.error).toBe('a personal space cannot be deleted or changed; its files can')
    expect((await call('PATCH', `/api/rabbit/projects/${id}`, { title: 'Mine' })).status).toBe(409)
    expect(reached).toEqual([])
    expect(fs.existsSync(path.join(personalDir(), 'project.json'))).toBe(true)
  })

  it('a relink cannot point its bodies somewhere else', async () => {
    const { id } = (await call('POST', '/api/rabbit/personal-space')).body
    expect((await call('POST', `/api/rabbit/projects/${id}/files/relink-apply`, { baseDir: 'x', mappings: [] })).status).toBe(409)
    expect(reached).toEqual([])
  })

  it('a create naming its id is refused: it would write over the bundle', async () => {
    const { id } = (await call('POST', '/api/rabbit/personal-space')).body
    expect((await call('POST', '/api/rabbit/projects', { id, title: 'Over it' })).status).toBe(409)
    expect(reached).toEqual([])
  })

  it('FAILING CONTROL: another project\'s routes pass, with the two fields gone from the body', async () => {
    await call('POST', '/api/rabbit/personal-space')
    expect((await call('POST', '/api/rabbit/projects', { title: 'Ordinary', personal: true, personal_owner_id: 'u1' })).status).toBe(200)
    expect((await call('PATCH', '/api/rabbit/projects/other', { title: 'Renamed', personal: true, personal_owner_id: 'u1' })).status).toBe(200)
    expect((await call('DELETE', '/api/rabbit/projects/other')).status).toBe(200)
    expect((await call('POST', '/api/rabbit/projects/other/files/relink-apply', { baseDir: 'x' })).status).toBe(200)
    expect(reached.map(r => r.name)).toEqual(['create', 'patch', 'delete', 'relink'])
    expect(reached[0].body).toEqual({ title: 'Ordinary' })
    expect(reached[1].body).toEqual({ title: 'Renamed' })
  })

  it('the same refusals with no space yet: every project passes', async () => {
    expect((await call('PATCH', '/api/rabbit/projects/any', { title: 'x' })).status).toBe(200)
    expect((await call('DELETE', '/api/rabbit/projects/any')).status).toBe(200)
  })
})

describe('where it lives (SEC-7)', () => {
  it('its id resolves to its own directory, and its bodies to files/', async () => {
    const { id } = (await call('POST', '/api/rabbit/personal-space')).body
    expect(space.dirFor(id)).toBe(personalDir())
    expect(space.filesDirFor(id)).toBe(path.join(personalDir(), 'files'))
    expect(fs.existsSync(path.join(personalDir(), 'files'))).toBe(true)
  })

  it('CONTROL: any other id resolves to nothing, so the ordinary paths serve it', async () => {
    await call('POST', '/api/rabbit/personal-space')
    expect(space.dirFor('another-project')).toBe(null)
    expect(space.filesDirFor('another-project')).toBe(null)
    expect(space.dirFor('')).toBe(null)
  })

  it('one space per computer and OS user: another data folder, or a later launch, finds the same one', async () => {
    const { id } = (await call('POST', '/api/rabbit/personal-space')).body
    const nextLaunch = createPersonalSpace({ fs, path, userDataDir: userData, newId: randomUUID })
    expect(nextLaunch.currentId()).toBe(id)
    expect(nextLaunch.mint()).toBe(null)
  })

  it('a copied data folder carries none, and a project in it that SAYS personal is an ordinary project', async () => {
    const copied = path.join(userData, 'copied-rabbit-data', 'projects', 'p9')
    fs.mkdirSync(copied, { recursive: true })
    fs.writeFileSync(path.join(copied, 'project.json'), JSON.stringify({ project: { id: 'p9', personal: true } }))
    expect(space.currentId()).toBe(null)
    expect(space.isPersonalBundle({ project: { id: 'p9', personal: true } })).toBe(false)
    const { id } = (await call('POST', '/api/rabbit/personal-space')).body
    expect(id).not.toBe('p9')
    expect(space.isPersonalBundle({ project: { id: 'p9', personal: true } })).toBe(false)
    expect(space.isPersonalBundle({ project: { id, personal: true } })).toBe(true)
  })
})

describe('electron/main.cjs: the wiring', () => {
  const MAIN = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.cjs'), 'utf8')

  it('the guards are mounted ahead of every route they guard', () => {
    const mount = MAIN.indexOf('mountPersonalSpace(expressApp,')
    expect(mount).toBeGreaterThan(-1)
    for (const route of [
      "expressApp.post('/api/rabbit/projects',",
      "expressApp.patch('/api/rabbit/projects/:id',",
      "expressApp.delete('/api/rabbit/projects/:id',",
      "expressApp.post('/api/rabbit/projects/:projectId/files/relink-apply',",
    ]) {
      expect(MAIN.indexOf(route), route).toBeGreaterThan(mount)
    }
  })

  it('every project path resolves the personal id first', () => {
    const body = (name) => MAIN.slice(MAIN.indexOf(`function ${name}(`), MAIN.indexOf(`function ${name}(`) + 900)
    expect(body('getRabbitProjectDir')).toContain('personalSpace.dirFor(projectId)')
    expect(body('resolveProjectFolder')).toContain('personalSpace.isPersonalBundle(bundle)')
    expect(body('resolveProjectFolderRoot')).toContain('personalSpace.isPersonalBundle(bundle)')
    expect(body('resolveProjectFilesDir')).toContain('personalSpace.filesDirFor(projectId)')
  })

  it('GET /api/rabbit/projects reads projects/ alone, so the list never holds it', () => {
    const route = MAIN.slice(MAIN.indexOf("expressApp.get('/api/rabbit/projects',"), MAIN.indexOf("expressApp.get('/api/rabbit/projects',") + 300)
    expect(route).toContain('getRabbitProjectsDir()')
  })

  it('archive-and-clear leaves it where it is (PSA-05)', () => {
    const start = MAIN.indexOf('function archiveLocalRabbitData(')
    let depth = 0
    let end = -1
    for (let i = MAIN.indexOf('{', start); i < MAIN.length; i++) {
      if (MAIN[i] === '{') depth++
      else if (MAIN[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    // eslint-disable-next-line no-new-func
    const archive = new Function(`${MAIN.slice(start, end)}\nreturn archiveLocalRabbitData`)()
    const { writeJsonAtomic } = require('../../../electron/jsonFile.cjs')
    const rabbit = path.join(userData, 'rabbit-data')
    fs.mkdirSync(path.join(rabbit, 'projects', 'p1'), { recursive: true })
    fs.writeFileSync(path.join(rabbit, 'projects', 'p1', 'project.json'), JSON.stringify({ project: { id: 'p1' } }))
    fs.mkdirSync(path.join(personalDir(), 'files'), { recursive: true })
    fs.writeFileSync(path.join(personalDir(), 'project.json'), JSON.stringify({ project: { id: 'mine', personal: true } }))
    fs.writeFileSync(path.join(personalDir(), 'files', 'note.txt'), 'kept')
    const out = archive(rabbit, fs, path, writeJsonAtomic)
    expect(out.ok).toBe(true)
    expect(fs.existsSync(path.join(rabbit, 'projects', 'p1'))).toBe(false)
    expect(fs.readFileSync(path.join(personalDir(), 'files', 'note.txt'), 'utf-8')).toBe('kept')
    const snapshot = fs.readFileSync(out.archivePath, 'utf-8')
    expect(snapshot).not.toContain('mine')
  })
})
