// =============================================================================
// devFixtures.test.js — the dev fixtures can never reach a shipped build.
//
// Sibling of src/cloud/auth/devAutoLogin.test.js, which pins the sign-in
// modes. The same rule, applied to the fixtures: every read of the switch and
// every seam that consults it sits on a line that names `import.meta.env.DEV`
// first, so `vite build` (which replaces DEV with `false`) leaves dead code
// the bundler removes; the dataset and backends are reached through ONE
// dynamic import in main.jsx behind the same constant, so no chunk is emitted
// for src/dev/fixtures; and nothing under src/dev/fixtures can reach the
// network or the Supabase client at all.
//
// Reads the source as text. A refactor that hoists a read out of its guard, a
// second static import of the dataset, or a fetch inside the fixtures fails
// here before it can ship.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.(jsx?|cjs|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

const files = walk(SRC)
const rel = (p) => relative(SRC, p).replace(/\\/g, '/')
const read = (p) => readFileSync(p, 'utf8')
const codeLines = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))

const SWITCH = 'dev/devFixtures.js'
const inFixturesDir = (p) => rel(p).startsWith('dev/fixtures/')
const outsideDev = files.filter((p) => !rel(p).startsWith('dev/'))

/** The seams: every production file allowed to consult the switch. */
const SEAMS = [
  'cloud/adminApi.js',
  'cloud/auth/InviteMemberDialog.jsx',
  'components/AdminTerminal/MultiInviteDialog.jsx',
  'components/TeamMembers/TeamMembersPage.jsx',
  'components/TeamMembers/useWorkspaceMembers.js',
  'components/settings/ProfileSection.jsx',
  'lib/modelSources.js',
  'lib/userState.js',
  'main.jsx',
  'permissions/usePermissions.js',
  'tools/otter_v0.3.1/adapters/index.js',
  'tools/rabbit_v0.1.0/adapters/index.js',
  'tools/rabbit_v0.1.0/state/RabbitProvider.jsx',
]

describe('the dev fixtures switch is gated on import.meta.env.DEV', () => {
  it('VITE_DEV_FIXTURES is read in exactly one file, on a line that names DEV first', () => {
    // Comments and the badge's tooltip may NAME the variable; code may READ it in one place.
    const hits = files.filter((f) => codeLines(read(f)).some((l) => l.includes('import.meta.env.VITE_DEV_FIXTURES'))).map(rel)
    expect(hits).toEqual([SWITCH])
    const reads = codeLines(read(join(SRC, SWITCH))).filter((l) => l.includes('import.meta.env.VITE_DEV_FIXTURES'))
    expect(reads.length).toBe(1)
    expect(reads[0]).toMatch(/import\.meta\.env\.DEV && import\.meta\.env\.VITE_DEV_FIXTURES === '1'/)
  })

  it('every exported function of the switch answers "off" before doing anything when DEV is false', () => {
    const src = read(join(SRC, SWITCH))
    const bodies = src.split(/^export function /m).slice(1)
    expect(bodies.length).toBeGreaterThanOrEqual(6)
    for (const body of bodies) {
      const name = body.slice(0, body.indexOf('('))
      const firstStatement = body.split('\n').slice(1).find((l) => l.trim() && !l.trim().startsWith('//'))
      expect(firstStatement, name).toMatch(/if \(!import\.meta\.env\.DEV\) return/)
    }
  })

  it('the seams are exactly the listed files, and each consults the switch only on a line that names DEV', () => {
    const consulting = outsideDev.filter((f) => /devFixtures(Configured|Active)?\(\)/.test(read(f))).map(rel).sort()
    expect(consulting).toEqual(SEAMS)
    for (const f of consulting) {
      const lines = codeLines(read(join(SRC, f))).filter((l) => /devFixtures(Configured|Active)?\(\)/.test(l))
      expect(lines.length, f).toBeGreaterThan(0)
      for (const l of lines) expect(l, `${f}: ${l.trim()}`).toContain('import.meta.env.DEV')
    }
  })

  it('the badge is mounted in App.jsx behind DEV, and App.jsx keeps its three chrome bars', () => {
    const app = read(join(SRC, 'App.jsx'))
    expect(app).toContain('{import.meta.env.DEV && <DevFixturesBadge />}')
    expect((app.match(/<DevFixturesBadge/g) || []).length).toBe(1)
    expect((app.match(/className="wilson-chrome"/g) || []).length).toBe(3)
  })

  it('the dataset is reached through ONE dynamic import in main.jsx, behind DEV; nothing else imports src/dev/fixtures', () => {
    const importers = outsideDev.filter((f) => /dev\/fixtures\//.test(read(f))).map(rel)
    expect(importers).toEqual(['main.jsx'])
    const main = read(join(SRC, 'main.jsx'))
    expect(main).not.toMatch(/^import .*dev\/fixtures/m)
    const lines = main.split('\n')
    const at = lines.findIndex((l) => l.includes("import('./dev/fixtures/install.js')"))
    expect(at).toBeGreaterThan(0)
    // The WHOLE switch (env AND the badge's localStorage half), so a session with
    // the badge off never loads or clones the dataset (review round 1).
    expect(lines[at - 1]).toMatch(/if \(import\.meta\.env\.DEV && devFixturesActive\(\)\) \{/)
    // The badge is the only other src/dev module a production file imports.
    const devImporters = outsideDev
      .filter((f) => /from '[^']*\/dev\//.test(read(f)))
      .map((f) => [rel(f), ...(read(f).match(/from '[^']*\/dev\/[^']*'/g) || [])])
    for (const [f, ...imports] of devImporters) {
      for (const imp of imports) {
        expect(imp, f).toMatch(/\/dev\/(devFixtures(\.js)?|DevFixturesBadge)'$/)
      }
    }
  })

  it('nothing under src/dev can reach the network, storage, or the Supabase client', () => {
    const devFiles = files.filter((f) => rel(f).startsWith('dev/'))
    expect(devFiles.length).toBeGreaterThan(10)
    for (const f of devFiles) {
      const src = read(f)
      for (const needle of ['supabaseClient', '@supabase', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'supabase.']) {
        expect(src, `${rel(f)} contains ${needle}`).not.toContain(needle)
      }
    }
    // The fixtures directory imports only pure modules from the app: the folder
    // planner, the O.T.T.E.R. route parser and the note encoder.
    const allowed = ['tools/rabbit_v0.1.0/folderPaths', 'tools/otter_v0.3.1/adapters/otterRoutes', 'components/Dashboard/noteSync']
    for (const f of devFiles.filter(inFixturesDir)) {
      const external = (read(f).match(/from '(\.\.\/){2,}[^']+'/g) || [])
        .map((m) => m.slice(6, -1).replace(/^(\.\.\/)+/, ''))
        .filter((m) => !m.startsWith('devFixtures'))
      for (const m of external) expect(allowed, `${rel(f)} imports ${m}`).toContain(m)
    }
  })

  it('a built dist/, when one is present, carries none of the fixture text', () => {
    // Opt-in: CI has no dist/. Locally, `npx vite build` (or `build:dev`) then this
    // test is the proof the header of devFixtures.js promises. Any build passes
    // it — Vite treats every `vite build` as production and DEV is false.
    const dist = resolve(SRC, '..', 'dist', 'assets')
    if (!existsSync(dist)) return
    const built = readdirSync(dist).filter((n) => /\.(js|css)$/.test(n)).map((n) => readFileSync(join(dist, n), 'utf8')).join('\n')
    expect(built.length).toBeGreaterThan(100000)
    for (const needle of ['VITE_DEV_FIXTURES', 'wilson.dev-fixtures', 'Lantern & Ash', 'Salt Hours', 'f1c70000-', 'DevFixturesBadge', 'dev-fixtures-badge', 'Dev fixtures', 'devFixtures', 'fixturesAdapter', 'otterFixtures']) {
      expect(built, needle).not.toContain(needle)
    }
  })

  it('the control: the checker would catch an unguarded read and an unguarded seam', () => {
    const badRead = "const on = import.meta.env.VITE_DEV_FIXTURES === '1'"
    expect(badRead).not.toMatch(/import\.meta\.env\.DEV && import\.meta\.env\.VITE_DEV_FIXTURES === '1'/)
    const badSeam = 'const fx = devFixtures()'
    expect(badSeam).not.toContain('import.meta.env.DEV')
  })
})
