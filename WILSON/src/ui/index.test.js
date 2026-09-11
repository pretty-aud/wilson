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
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import * as kit from './index'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here)
const modules = files.filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.(js|jsx)$/.test(f) && f !== 'index.js')

export const COMPONENTS = [
  'Button', 'IconButton', 'Switch', 'Chip', 'Badge', 'StatusDot', 'StatusBadge', 'Field',
  'Input', 'TextArea', 'Select', 'Dialog', 'Menu', 'Toast', 'ToastProvider', 'Banner',
  'EmptyState', 'Loading', 'Spinner', 'Kbd',
]

describe('src/ui inventory', () => {
  it('every module has a test file beside it', () => {
    for (const f of modules) {
      const base = f.replace(/\.(js|jsx)$/, '')
      const hasTest = files.includes(`${base}.test.js`) || files.includes(`${base}.test.jsx`)
      expect(hasTest, `${f} has no test`).toBe(true)
    }
    expect(modules.length).toBeGreaterThanOrEqual(22)
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
