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
// and nothing ignores it. F12 added the other half of "what it packs": every
// bare module a file under electron/ requires is Node's, Electron's or a
// production dependency, because electron-builder ships `dependencies` and
// never `devDependencies`.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire, builtinModules } from 'node:module'
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
  it('the same text on every machine: no absolute path, no carriage return, nothing but ASCII', () => {
    for (const [file, text] of Object.entries(built)) {
      expect(text, file).not.toContain('\r')
      expect(text, file).not.toContain(ROOT.replace(/\\/g, '/'))
      expect(text, file).not.toContain(ROOT)
      // review round 1: say what the title says — ASCII only, and no user's folder
      expect(text, file).toMatch(/^[\x00-\x7f]*$/)
      expect(text, file).not.toMatch(/Users[\\/]|[A-Za-z]:[\\/]/)
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
  // How many of the generated names each twin hands on under the same name (review round 1: a twin
  // that stopped exporting a rule must not drop out of the identity check unseen).
  const EXPORTED = { 'rabbitTaskItems.cjs': 11, 'rabbitTableViews.cjs': 34, 'rabbitShotLists.cjs': 5, 'rabbitBins.cjs': 12 }
  for (const [twin, rules] of cases) {
    it(`${twin} takes each rule from rules/${rules}, the very function, and declares none of them again`, () => {
      const text = readFileSync(path.join(ELECTRON, twin), 'utf8')
      expect(text).toContain(`require('./rules/${rules}')`)
      // A second declaration of a generated name would shadow it where the routes run (review round 1).
      for (const n of RULES.find((r) => r.file === rules).names) {
        expect(text, `${twin} declares ${n} again`).not.toMatch(new RegExp(`(function\\s+${n}\\s*\\(|\\b(const|let|var)\\s+${n}\\s*=)`))
      }
      if (twin === 'main.cjs') return // main.cjs cannot be required without Electron
      const mod = require(path.join(ELECTRON, twin))
      const gen = require(path.join(ELECTRON, 'rules', rules))
      const shared = RULES.find((r) => r.file === rules).names.filter((n) => n in mod)
      expect(shared.length, twin).toBe(EXPORTED[twin])
      for (const n of shared) expect(mod[n], `${twin} ${n}`).toBe(gen[n])
    })
  }
  it('main.cjs keeps no merge of its own, and binds each of the module\'s once (the two O.T.T.E.R. merges)', () => {
    const main = readFileSync(path.join(ELECTRON, 'main.cjs'), 'utf8')
    expect(main).not.toMatch(/function mergeFunctionsDoc\(/)
    expect(main).toContain('const merged = mergeHotkeys(stored, incoming);')
    expect(main).toContain('const merged = mergeFunctions(readJSON(filePath, { categories: [] }), (req.body || {}).categories);')
    // review round 1: one binding each (the require); a later one would win at runtime, unread by the merge tests.
    for (const n of ['mergeFunctions', 'mergeHotkeys']) {
      const bindings = main.match(new RegExp(`(function\\s+${n}\\s*\\(|\\b(const|let|var)\\s+${n}\\b|\\b(const|let|var)\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=)`, 'g')) || []
      expect(bindings, n).toHaveLength(1)
    }
  })
})

/** Every file under electron/, by its forward-slash name whatever the host's separator is. */
function electronSources(dir = ELECTRON, prefix = '') {
  const out = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) Object.assign(out, electronSources(path.join(dir, entry.name), `${prefix}${entry.name}/`))
    else out[`${prefix}${entry.name}`] = readFileSync(path.join(dir, entry.name), 'utf8')
  }
  return out
}

/** F12: the entries of the packer's own list that take electron/, its rules or every .cjs back out. */
const takenOut = (files) => (files || []).filter((f) => typeof f === 'string' && f.startsWith('!') && /electron|rules|\.cjs/.test(f))

/**
 * F12: the requires a packaged build could not satisfy. electron-builder packs
 * `dependencies` (and `optionalDependencies`) and never `devDependencies`, so a
 * require of a devDependency works in `npm run electron:dev` and throws in the
 * installed app. Each bare module must be Node's, Electron's, or shipped.
 *
 * Read from the RAW text on purpose: a require inside worker source held in a
 * string is seen (its quotes escaped or not), and a comment that writes
 * `require('…')` is counted too (that can only raise a false alarm: reword the
 * comment). Read: `require(…)`, `require.resolve(…)` and `import(…)`, by their
 * FIRST argument (a second one, or a line break, changes nothing).
 *
 * What reading cannot follow is itself a problem (review round 1): a first
 * argument that is not a string literal, and a second require function made
 * with `createRequire(`. A relative path is ours, but one that climbs out of
 * electron/ must land inside what `build.files` packs. A name with a trailing
 * slash (`punycode/`) is the npm package, not Node's module of that name.
 */
function unshippedRequires(files, pkg) {
  const ships = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {})])
  const devOnly = new Set(Object.keys(pkg.devDependencies || {}))
  const nodes = new Set(builtinModules)
  const ELECTRONS = new Set(['electron', 'original-fs']) // modules the Electron runtime itself provides
  // What electron-builder packs beside electron/ itself (package.json's build.files).
  const packedOutside = (p) => p === '../package.json' || p.startsWith('../dist/') || p.startsWith('../public/extensions/')
  const problems = new Set()
  const seen = new Set()
  for (const [file, text] of Object.entries(files)) {
    if (/\bcreateRequire\s*\(/.test(text)) problems.add(`${file}: makes a second require function with createRequire(, which this check cannot follow`)
    for (const m of text.matchAll(/\b(require(?:\.resolve)?|import)\(\s*/g)) {
      const rest = text.slice(m.index + m[0].length)
      if (rest.startsWith(')')) continue // "require()'d" in a comment: with no argument nothing is loaded
      const literal = rest.match(/^\\?(['"`])([^'"`\\$]+)\\?\1\s*[,)]/)
      if (!literal) { problems.add(`${file}: ${m[1]}(${rest.slice(0, rest.search(/[)\n]|$/)).trim()}) is not a string literal, so what it loads cannot be checked`); continue }
      const name = literal[2]
      if (name.startsWith('.')) {                                                     // a file of ours…
        const from = file.split('/').slice(0, -1)
        for (const part of name.split('/')) {
          if (part === '..') { if (from.length && from[from.length - 1] !== '..') from.pop(); else from.push('..') } else if (part !== '.') from.push(part)
        }
        const landed = from.join('/')
        if (landed.startsWith('..') && !packedOutside(landed)) problems.add(`${file}: requires '${name}', a file outside electron/ that the build does not pack`)
        continue
      }
      if (name.startsWith('/')) continue
      if (name.startsWith('node:') || nodes.has(name)) continue                       // Node's
      if (ELECTRONS.has(name) || name.startsWith('electron/')) continue               // the runtime's own
      const bare = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
      seen.add(bare)
      if (ships.has(bare)) continue
      problems.add(devOnly.has(bare)
        ? `${file}: requires '${bare}', a devDependency only: electron-builder ships dependencies and never devDependencies, so the installed app would not find it`
        : `${file}: requires '${bare}', which package.json does not declare`)
    }
  }
  return { problems: [...problems], seen: [...seen].sort() }
}

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
  it('nothing ignores it: not .gitignore, not the packer\'s own list, and no second packager has a config (F12)', () => {
    for (const line of readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
      expect(['rules', 'rules/', 'electron/rules', 'electron/rules/', '/electron/rules', '*.cjs', 'electron/']).not.toContain(line)
    }
    // F12: electron-builder is the one packager. Forge's config, which had an
    // ignore list of its own, is gone; and the one packer's list takes nothing
    // of electron/ back out.
    expect(existsSync(path.join(ROOT, 'forge.config.cjs'))).toBe(false)
    expect(takenOut(pkg.build.files)).toEqual([])
    // CONTROL: a negation that would drop the folder is named.
    expect(takenOut([...pkg.build.files, '!electron/rules/**', '!**/*.cjs', '!dist/**/*.map'])).toEqual(['!electron/rules/**', '!**/*.cjs'])
    expect(existsSync(path.join(ELECTRON, 'rules', 'README.md'))).toBe(false)
  })
  it('every bare module a file under electron/ requires is Node\'s, Electron\'s or a production dependency (F12)', () => {
    const { problems, seen } = unshippedRequires(electronSources(), pkg)
    expect(problems).toEqual([])
    // It cannot pass by seeing nothing: a top-level require, a lazy one and one inside a try are all read.
    expect(seen).toEqual(expect.arrayContaining(['express', 'sharp', 'electron-updater']))
  })
  it('CONTROL: a planted require of a devDependency, of an undeclared module and of a computed name are each named', () => {
    const DEV = 'a devDependency only: electron-builder ships dependencies and never devDependencies, so the installed app would not find it'
    const planted = {
      'planted.cjs': [
        "const v = require('vite');",
        "require('left-pad/lib');",
        "const p = require.resolve('@playwright/test/package.json');",
        'require(name);',
        // review round 1: the shapes the first version let through
        "const { defineConfig } = await import('vitest/config');",           // a dynamic import (the only way a .cjs file loads an ESM-only package)
        "require('punycode/');",                                              // the npm package, not Node's module of the name
        "require('../src/lib/storage.js'); require('../../outside.cjs');",   // files the build does not pack
        'require(`./rules/${which}.cjs`);',                                   // a template with a hole
        // none of these is a problem: ours (beside, below, and the three places the build packs outside electron/),
        // Node's (three spellings), Electron's (three), a shipped package by a deep path, with a second argument,
        // over lines, and inside worker source held in a string with its quotes escaped
        "require('./beside.cjs'); require('./rules/taskItems.cjs'); require('../package.json'); require('../dist/index.html'); require('../public/extensions/Code.gs');",
        "require('node:fs'); require('fs/promises'); require('path'); require('electron'); require('electron/main'); require('original-fs'); require('express/lib/router');",
        "require.resolve('sharp', { paths: [dir] });",
        'require(',
        "  'sharp',",
        ');',
        "const worker = 'const fs = require(\\'node:fs\\'); const s = require(\\'sharp\\');';",
        "// a comment may say a file can't be require()'d",
      ].join('\n'),
      'made.cjs': "const { createRequire } = require('node:module');\nconst load = createRequire(__filename);\nload('vite');\n",
    }
    expect(unshippedRequires(planted, pkg)).toEqual({
      problems: [
        `planted.cjs: requires 'vite', ${DEV}`,
        "planted.cjs: requires 'left-pad', which package.json does not declare",
        `planted.cjs: requires '@playwright/test', ${DEV}`,
        'planted.cjs: require(name) is not a string literal, so what it loads cannot be checked',
        `planted.cjs: requires 'vitest', ${DEV}`,
        "planted.cjs: requires 'punycode', which package.json does not declare",
        "planted.cjs: requires '../src/lib/storage.js', a file outside electron/ that the build does not pack",
        "planted.cjs: requires '../../outside.cjs', a file outside electron/ that the build does not pack",
        'planted.cjs: require(`./rules/${which}.cjs`) is not a string literal, so what it loads cannot be checked',
        'made.cjs: makes a second require function with createRequire(, which this check cannot follow',
      ],
      seen: ['@playwright/test', 'express', 'left-pad', 'punycode', 'sharp', 'vite', 'vitest'],
    })
    // The build's own list is what "packs" means: the three places outside electron/ are in it.
    expect(pkg.build.files).toEqual(expect.arrayContaining(['dist/**/*', 'electron/**/*', 'public/extensions/**/*', 'package.json']))
    // On the real files: a dependency moved to devDependencies is named in every file that requires it.
    const moved = { ...pkg, dependencies: { ...pkg.dependencies }, devDependencies: { ...pkg.devDependencies, express: pkg.dependencies.express } }
    delete moved.dependencies.express
    const named = unshippedRequires(electronSources(), moved).problems
    expect(named).toContain(`main.cjs: requires 'express', ${DEV}`)
    for (const line of named) expect(line).toMatch(/: requires 'express', a devDependency only/)
  })
})
