// =============================================================================
// electronRules.test.js — F9 item 4 (the desktop-build review's B1): the
// desktop's CommonJS copies of the renderer's rules are GENERATED from the ES
// modules (scripts/build-electron-rules.mjs) into electron/rules/, committed,
// and this is the one check in place of the parity tests: each file is built
// again in memory and must equal the committed text (checkout line endings
// aside). A rule changed in a module and not regenerated fails here, with the
// command that fixes it.
//
// And what a packaged build needs, proved without electron-builder: the folder
// is inside what it packs, every require of it names a file the script makes,
// and nothing ignores it.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildRules, RULES, RULES_DIR, ROOT } from '../../scripts/build-electron-rules.mjs'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const ELECTRON = path.resolve(here, '../../electron')
const committed = (file) => readFileSync(path.join(ROOT, RULES_DIR, file), 'utf8').replace(/\r\n/g, '\n')
const FIX = 'npm run build:rules'

/** The files the build makes that differ from the committed ones. */
function staleAmong(built, read = committed) {
  return Object.entries(built).filter(([file, text]) => {
    try { return read(file) !== text } catch { return true }
  }).map(([file]) => file)
}

let built
beforeAll(async () => { built = await buildRules() }, 60_000)

describe('the generated rules are the modules\' own, and current', () => {
  it(`every file in ${RULES_DIR}/ is what the build makes now (else: ${FIX})`, () => {
    expect(Object.keys(built).sort()).toEqual(RULES.map((r) => r.file).sort())
    expect(staleAmong(built), `stale: run ${FIX}`).toEqual([])
  })
  it('CONTROL: a committed copy one character off is stale', () => {
    const [file] = Object.keys(built)
    const off = (f) => (f === file ? committed(f).replace('function', 'functio') : committed(f))
    expect(staleAmong(built, off)).toEqual([file])
  })
  it('CONTROL: a rule changed in its module and not regenerated is stale', async () => {
    // One rule changed in memory: taskItemsModel.js's position cap.
    const changed = {
      name: 'change-one-rule',
      setup(b) {
        b.onLoad({ filter: /taskItemsModel\.js$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8').replace('MAX_ITEM_POSITION = 2147483647', 'MAX_ITEM_POSITION = 2147483646'),
          loader: 'js',
        }))
      },
    }
    const rebuilt = await buildRules({ plugins: [changed] })
    expect(staleAmong(rebuilt)).toEqual(['taskItems.cjs'])
  }, 60_000)
  it('the same text on every machine: no absolute path, no carriage return, ASCII outside comments', () => {
    for (const [file, text] of Object.entries(built)) {
      expect(text, file).not.toContain('\r')
      expect(text, file).not.toContain(ROOT.replace(/\\/g, '/'))
      expect(text, file).not.toContain(ROOT)
      expect(text.startsWith('// GENERATED from src/'), file).toBe(true)
    }
  })
})

describe('the twins require the generated rules, and keep their own names', () => {
  const cases = [
    ['rabbitTaskItems.cjs', 'taskItems.cjs'],
    ['rabbitTableViews.cjs', 'tableViews.cjs'],
    ['rabbitShotLists.cjs', 'shotLists.cjs'],
    ['rabbitBins.cjs', 'binMedia.cjs'],
    ['main.cjs', 'otterMerges.cjs'],
  ]
  for (const [twin, rules] of cases) {
    it(`${twin} takes each rule from rules/${rules}, the very function`, () => {
      expect(readFileSync(path.join(ELECTRON, twin), 'utf8')).toContain(`require('./rules/${rules}')`)
      if (twin === 'main.cjs') return // main.cjs cannot be required without Electron
      const mod = require(path.join(ELECTRON, twin))
      const gen = require(path.join(ELECTRON, 'rules', rules))
      const shared = RULES.find((r) => r.file === rules).names.filter((n) => n in mod)
      expect(shared.length, twin).toBeGreaterThan(0)
      for (const n of shared) expect(mod[n], `${twin} ${n}`).toBe(gen[n])
    })
  }
  it('main.cjs keeps no merge of its own (the two O.T.T.E.R. merges are the module\'s)', () => {
    const main = readFileSync(path.join(ELECTRON, 'main.cjs'), 'utf8')
    expect(main).not.toMatch(/function mergeFunctionsDoc\(/)
    expect(main).toContain('const merged = mergeHotkeys(stored, incoming);')
    expect(main).toContain('const merged = mergeFunctions(readJSON(filePath, { categories: [] }), (req.body || {}).categories);')
  })
})

describe('a packaged build carries the folder', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  it('electron-builder packs electron/**/* (so electron/rules/ with it)', () => {
    expect(pkg.build.files).toContain('electron/**/*')
    expect(pkg.scripts['build:rules']).toBe('node scripts/build-electron-rules.mjs')
  })
  it('every require of a rules file names one the script makes, and the folder holds nothing else', () => {
    const asked = new Set()
    for (const name of readdirSync(ELECTRON).filter((n) => n.endsWith('.cjs'))) {
      for (const m of readFileSync(path.join(ELECTRON, name), 'utf8').matchAll(/require\('\.\/rules\/([^']+)'\)/g)) asked.add(m[1])
    }
    const made = RULES.map((r) => r.file).sort()
    expect([...asked].sort()).toEqual(made)
    expect(readdirSync(path.join(ELECTRON, 'rules')).sort()).toEqual(made)
  })
  it('nothing ignores it: not .gitignore, not the forge config', () => {
    for (const line of readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
      expect(['rules', 'rules/', 'electron/rules', 'electron/rules/', '/electron/rules', '*.cjs', 'electron/']).not.toContain(line)
    }
    const forge = readFileSync(path.join(ROOT, 'forge.config.cjs'), 'utf8')
    expect(forge).not.toMatch(/rules/)
    expect(existsSync(path.join(ELECTRON, 'rules', 'README.md'))).toBe(false)
  })
})
