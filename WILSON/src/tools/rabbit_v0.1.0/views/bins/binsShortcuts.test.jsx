/** @vitest-environment jsdom */
// =============================================================================
// binsShortcuts.test.jsx — UI overhaul B6, Q10 (2026-09-23).
//
// Audrey ruled "no shortcut bar anywhere" (plan §2 Q10). The Bins footer bar
// was the only one; it goes, and C1 says nothing it carried may go with it:
//   · every key hint it showed is in Help → Shortcuts & Tips;
//   · Help names no key the Bins handler does not bind (a doc that lies is
//     worse than no doc) — read out of BinsView's own switch;
//   · the project count it showed on the right is the bin tree's footer;
//   · the adapter dot and presence pill it made room for are ProjectContextBar's
//     (B1's slots; pinned by B1's own tests, not here).
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RabbitHelpContent, BINS_SHORTCUTS } from '../../rabbitHelpContent'
import BinTree from './BinTree'

afterEach(cleanup)

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const binsView = read('../BinsView.jsx')

// What the removed bar showed, verbatim from its last version (e1fed1a).
const BAR = [
  { keys: ['↑', '↓'], word: 'move' }, { keys: ['Shift'], word: 'extend' },
  { keys: ['S'], word: 'select' }, { keys: ['R'], word: 'reject' },
  { keys: ['U'], word: 'unflag' }, { keys: ['C'], word: 'circle' },
  { keys: ['1', '8'], word: 'colour' }, { keys: ['A'], word: 'assign to shot' },
  { keys: ['Space'], word: 'play' }, { keys: ['F2'], word: 'rename' },
  { keys: ['Del'], word: 'remove' }, { keys: ['Ctrl', 'Z'], word: 'undo' },
]

describe('Q10: the Bins footer bar is gone', () => {
  it('BinsView renders no shortcut bar (no Kbd row, no footer hints)', () => {
    expect(binsView).not.toMatch(/<Kbd>Shift<\/Kbd>/)
    expect(binsView).not.toMatch(/Footer hints/)
    // The one Kbd left is the Clear button's own hint (a control's hint is allowed, plan §4 Kbd).
    // Any spelling of the tag (round 1: `<Kbd key={k}>` got past a literal `<Kbd>`).
    expect((binsView.match(/<Kbd\b/g) || []).length).toBe(1)
  })
})

describe('every hint the bar carried is in Help', () => {
  it('each hint the bar showed is ONE Help row carrying both its keys and its word', () => {
    render(<RabbitHelpContent helpPage="rabbit-shortcuts" theme="dark" />)
    const card = screen.getByText('Bins: the keyboard').closest('div')
    // Pair each <dt> (the caps) with its <dd> (the action). A key and a word
    // that merely both appear somewhere is not the hint (review: "undo" is
    // also in the Remove row, and Ctrl + Z are also in Redo).
    const rows = [...card.querySelectorAll('dt')].map(dt => ({
      caps: [...dt.querySelectorAll('kbd')].map(k => k.textContent),
      does: dt.nextElementSibling.textContent.toLowerCase(),
    }))
    for (const { keys, word } of BAR) {
      const hit = rows.find(r => keys.every(k => r.caps.includes(k)) && r.does.startsWith(word.split(' ')[0]))
      expect(hit, `Help has no row for "${keys.join('+')} ${word}"`).toBeTruthy()
    }
  })

  it('renders the kit Kbd on the dark surface in the Timeline and shell help', () => {
    render(<RabbitHelpContent helpPage="rabbit-shortcuts" theme="dark" />)
    const kbd = document.querySelector('kbd')
    expect(kbd.className).toMatch(/ui-kbd/)
  })

  it('names no letter key the Bins handler does not bind', () => {
    const bound = new Set([...binsView.matchAll(/case '([^']+)'/g)].map(m => m[1].toUpperCase()))
    const letters = BINS_SHORTCUTS.flatMap(s => s.keys.flat()).filter(k => /^[A-Z]$/.test(k))
    for (const k of letters) {
      if (k === 'Z' || k === 'Y') { expect(binsView).toMatch(new RegExp(`e\\.key === '${k.toLowerCase()}'`)); continue }
      expect(bound.has(k), `Help documents ${k}, which BinsView does not bind`).toBe(true)
    }
  })
})

describe('the project count the bar showed is in the tree', () => {
  it('says N files in M bins, and the offline count when there is one', () => {
    const bins = [{ id: 'b1', name: 'A', parent_bin_id: null }, { id: 'b2', name: 'B', parent_bin_id: null }]
    render(<BinTree bins={bins} counts={new Map()} offlineCounts={new Map()} currentBinId={null}
      expanded={new Set()} allCount={12} allOffline={3} canWrite />)
    expect(screen.getByTestId('bins-project-count').textContent).toBe('12 files in 2 bins · 3 offline')
  })

  it('and the numbers are the same ones the bar used (files.length, bins.length, offlineAll.length)', () => {
    expect(binsView).toMatch(/allCount=\{files\.length\}/)
    expect(binsView).toMatch(/allOffline=\{offlineAll\.length\}/)
  })
})
