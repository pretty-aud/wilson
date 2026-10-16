/** @vitest-environment jsdom */
// =============================================================================
// binTreeFoot.test.jsx — the Bins rail's counter moves up for the connection
// dot (post-overhaul FX11). Audrey: "lets move the bin and files counter a
// little higher up to make space for the green dot in the bin tab".
//
// The footer pads its own 8px above the shell's corner square (the page
// gutter, where the dot sits), so the counter and the hint rise 24px; the
// counter's words and everything else in the rail are unchanged. The
// measured result (the counter's box clear of the dot's at 1280 and 1440) is
// scripts/fx11-shots.mjs --check's.
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import BinTree from './BinTree'
import { cssCode } from '../../rabbitCssGuards.js'

afterEach(cleanup)
const here = dirname(fileURLToPath(import.meta.url))
const css = cssCode(readFileSync(join(here, 'bins.css'), 'utf8'))
const shell = cssCode(readFileSync(join(here, '../../rabbitShell.css'), 'utf8'))

describe('the Bins rail footer (FX11)', () => {
  it('the counter still says the project\'s files and bins, in a footer that pads above the corner', () => {
    const { getByTestId } = render(
      <BinTree bins={[{ id: 'b1', name: 'A001' }, { id: 'b2', name: 'A002' }]} counts={new Map()} offlineCounts={new Map()}
        currentBinId={null} expanded={new Set()} allCount={18} allOffline={0} canWrite />,
    )
    const counter = getByTestId('bins-project-count')
    expect(counter.textContent).toBe('18 files in 2 bins')
    const foot = counter.parentElement
    const cls = foot.className.split(/\s+/)
    expect(cls).toContain('bn-tree-foot')
    expect(cls).toContain('pt-2')
    // No utility may set the bottom padding: the utilities layer beats the
    // components layer, and the footer's rule would silently lose.
    expect(cls.filter((c) => /^(p|py|pb)-/.test(c))).toEqual([])
  })
  it('bins.css pads the footer 8px above the page gutter — the corner square the dot owns', () => {
    expect(css).toMatch(/\.bn-tree-foot\s*\{\s*padding-bottom:\s*calc\(8px \+ var\(--spacing-gutter\)\);\s*\}/)
    // The dot's cell is that square (rabbitShell.css), so the two cannot drift apart.
    expect(shell).toMatch(/\.rb-conn\s*\{[^}]*left:\s*0;[^}]*bottom:\s*0;[^}]*width:\s*var\(--spacing-gutter\);[^}]*height:\s*var\(--spacing-gutter\);/)
  })
})
