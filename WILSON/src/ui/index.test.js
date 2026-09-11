// =============================================================================
// index.test.js — the kit's inventory, in executable form (plan §7: "no
// exported src/ui/ component without a caller"; §5 F1: "one render test per
// src/ui/ file").
//
//   1. Every module in src/ui has a test file beside it.
//   2. Every component the barrel exports is a function, and every module's
//      default export is re-exported by name — a component cannot be added
//      to the folder without being added to the inventory.
//   3. The inventory is printed by name so a session can grep for callers.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import * as kit from './index'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here)
const modules = files.filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.(js|jsx)$/.test(f) && f !== 'index.js')

export const COMPONENTS = [
  // F1 — tokens and primitives
  'Button', 'IconButton', 'Switch', 'Chip', 'Badge', 'StatusDot', 'StatusBadge', 'Field',
  'Input', 'TextArea', 'Select', 'Dialog', 'Menu', 'Toast', 'ToastProvider', 'Banner',
  'EmptyState', 'Loading', 'Spinner', 'Kbd',
  // F2 — the shell and data primitives
  'PageHeader', 'Table', 'Th', 'Td', 'Row', 'Toolbar', 'SectionTitle', 'Card',
  'Tabs', 'Panel', 'Drawer', 'Stat', 'HoverActions',
]

describe('src/ui inventory', () => {
  it('every module has a test file beside it', () => {
    for (const f of modules) {
      const base = f.replace(/\.(js|jsx)$/, '')
      const hasTest = files.includes(`${base}.test.js`) || files.includes(`${base}.test.jsx`)
      expect(hasTest, `${f} has no test`).toBe(true)
    }
    expect(modules.length).toBeGreaterThanOrEqual(32)
  })

  it('every component is exported from the barrel as a component', () => {
    for (const name of COMPONENTS) {
      const c = kit[name]
      // A plain function component, or a forwardRef object with a render.
      const isComponent = typeof c === 'function' || (c && typeof c === 'object' && typeof c.render === 'function')
      expect(isComponent, name).toBe(true)
    }
  })

  it('every module file is represented in the barrel by at least one export', () => {
    const names = new Set(Object.keys(kit))
    for (const f of modules) {
      const base = f.replace(/\.(js|jsx)$/, '')
      const represented =
        names.has(base) ||
        (base === 'tokens' && names.has('THEME')) ||
        (base === 'contrast' && names.has('contrast')) ||
        (base === 'overlay' && names.has('overlayOpen'))
      expect(represented, `${f} exports nothing through index.js`).toBe(true)
    }
  })

  it('the hooks and helpers are there too', () => {
    for (const name of ['useToast', 'useEscapeRevert', 'statusMeta', 'overlayOpen', 'token', 'contrast', 'over']) {
      expect(typeof kit[name], name).toBe('function')
    }
    expect(kit.DIALOG_WIDTHS.confirm).toBe(400)
    expect(kit.STATUS.blocked.tone).toBe('danger')
  })
})

// ── Every exported component has a CALLER, or is on a named list ───────────
//
// Plan §7's grep audit: "no exported src/ui/ component without a caller".
// Plan risk 11: "The kit adds ~25 components at once; F2's worked-example page
// and P1's grep make every one earn a caller." Ten features have shipped in
// this repo with no caller at all, and `RelationBadge` is imported and never
// rendered to this day — the defect is real and it is silent.
//
// 🚨 The test is not "every component has a caller" — four do not yet, and
// three of those CANNOT get an honest one on F2's worked example without
// inventing UI on it, which C1 forbids outright. So the test pins the
// EXCEPTION LIST instead: a component may lack a caller only if it is named
// here, with the lane that adopts it. The list can only shrink without
// editing this file, so the gap is tracked rather than invisible, and P1's
// grep has a baseline rather than a judgement call.
describe('every exported component has a caller, or is on the list', () => {
  // Adopting lane, from plan §5. A name leaves this list when its lane lands.
  const AWAITING_A_CALLER = {
    SectionTitle: 'D1 — Settings has nine copies of this pattern',
    Panel:        'A1 / A3 / C1 — the five hand-rolled sidebars',
    Drawer:       'A2 (D.O.G. settings slide-out) and B3 (EditHistoryDrawer, TL-24)',
    Stat:         'B1 (the Summary band) and B2 (the four Tasks tiles)',
  }

  const root = resolve(here, '..')
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'ui') walk(p); continue }
      if (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name)) files.push(p)
    }
  }
  walk(root)

  // What the app imports from the kit — from `src/ui`, from a single module,
  // or through binUi's re-exports (Bins' callers are real callers).
  const imported = new Set()
  const IMPORT = /import\s*\{([^}]*)\}\s*from\s*'([^']*(?:\/ui(?:\/[A-Za-z]+)?|binUi))'/g
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(IMPORT)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim()
        if (name) imported.add(name)
      }
    }
  }

  // A caller INSIDE the kit counts, and is sometimes the right one: Toast is
  // rendered by ToastProvider, and StatusDot by StatusBadge. Both are proven
  // on a real screen through their wrapper, and giving either a second,
  // direct caller on the worked example would be decoration.
  for (const f of readdirSync(here)) {
    if (!/\.(js|jsx)$/.test(f) || /\.test\./.test(f) || f === 'index.js') continue
    const src = readFileSync(join(here, f), 'utf8')
    for (const name of COMPONENTS) {
      // The boundary matters: `<StatusDot` starts with `<Stat`, so a plain
      // `includes` marked Stat as called by StatusBadge and hid a genuinely
      // uncalled component behind a prefix.
      if (new RegExp(`<${name}(?![A-Za-z0-9])`).test(src)) imported.add(name)
    }
  }

  it('names every component that is exported but not yet called', () => {
    const uncalled = COMPONENTS.filter((c) => !imported.has(c))
    expect(uncalled.sort()).toEqual(Object.keys(AWAITING_A_CALLER).sort())
  })

  it('nothing sits on the list that actually has a caller', () => {
    for (const name of Object.keys(AWAITING_A_CALLER)) {
      expect(imported.has(name), `${name} has a caller now — take it off the list`).toBe(false)
    }
  })

  it('the control: a name that is definitely called is definitely detected', () => {
    // If the import scan silently matched nothing, both assertions above would
    // pass by accident with every component "uncalled" — except that the first
    // one would then fail. This pins the scan itself against a known caller.
    expect(imported.has('Table'), 'the import scan found nothing at all').toBe(true)
    expect(imported.has('PageHeader')).toBe(true)
    expect(imported.size).toBeGreaterThan(15)
  })
})
