// =============================================================================
// noProjectState.test.js — P1-74 (UI overhaul P1, 2026-09-27).
//
// "No project loaded" was drawn five ways across seven R.A.B.B.I.T. views: a
// capitalised Label-step span (Levels/Experiences, Assets, Tasks), an
// inline-styled capitalised span (Team; the Timeline in two hexes), Budget's
// CenterMsg, and the kit EmptyState (Scenes). One way now: the kit
// EmptyState in sentence case, with the view's own icon; Budget's CenterMsg
// renders the same component (its render test pins that).
// =============================================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const VIEWS = ['EntityListView.jsx', 'ProjectAssetsView.jsx', 'ProjectTasksView.jsx', 'TeamView.jsx',
  'TimelineView.jsx', 'ScenesView.jsx', 'BudgetView.jsx']

/** Every place the words appear, and whether each is the kit's empty state. */
function noProjectSites(src) {
  const out = []
  let at = src.indexOf('No project loaded')
  while (at >= 0) {
    const lineStart = src.lastIndexOf('\n', at) + 1
    const nl = src.indexOf('\n', at)
    const line = src.slice(lineStart, nl < 0 ? src.length : nl)
    const kit = /<EmptyState\b[^>]*\btitle="No project loaded"/.test(line) || /<CenterMsg>No project loaded<\/CenterMsg>/.test(line)
    if (!/^\s*(\/\/|\*|\{\/\*)/.test(line)) out.push({ kit, line: line.trim() })
    at = src.indexOf('No project loaded', at + 1)
  }
  return out
}

describe('"No project loaded" is one kit EmptyState in every R.A.B.B.I.T. view (P1-74)', () => {
  it('each view draws it, and only as the kit EmptyState (or Budget\'s CenterMsg, which is one)', () => {
    const bad = []
    for (const f of VIEWS) {
      const sites = noProjectSites(readFileSync(join(here, f), 'utf8'))
      if (!sites.length) bad.push(`${f}: never drawn`)
      for (const s of sites) if (!s.kit) bad.push(`${f}: ${s.line}`)
    }
    expect(bad).toEqual([])
  })
  it('the two classes that styled the old spans are gone from the sheet', () => {
    const css = readFileSync(join(here, 'rabbitFiles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/\.rb-(?:ent|asset)-unloaded\b/)
  })
  it('CONTROL: the five old shapes are caught; the kit shapes pass', () => {
    const old = [
      '        <span className="rb-ent-unloaded text-label uppercase">No project loaded</span>',
      '        <span className="text-label uppercase">No project loaded</span>',
      "        <span className=\"text-label uppercase\" style={{ color: '#a8a29e' }}>\n          No project loaded\n        </span>",
    ]
    for (const src of old) expect(noProjectSites(src).every((s) => !s.kit), src).toBe(true)
    expect(noProjectSites('        <EmptyState Icon={Film} title="No project loaded" />')[0].kit).toBe(true)
    expect(noProjectSites('  if (!project) return <CenterMsg>No project loaded</CenterMsg>')[0].kit).toBe(true)
  })
})
