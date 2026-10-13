/** @vitest-environment jsdom */
// =============================================================================
// remoteViewingsTable.test.jsx — GW3 (item 5): the viewings table, taken out
// of the Settings card so the Bins inspector can show it filtered to a clip.
// One table, two grounds: the Settings page (light, no stamp) and the Bins
// dialog (dark: the table stamped data-surface="dark", which settings.css
// reads to give it the dark ground's ink). The cells are gatewayWords.js's.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import RemoteViewingsTable, { whenWords } from './RemoteViewingsTable'

afterEach(() => { cleanup() })

const row = (over = {}) => ({
  id: 1, file_name: 'A001_C001_0921AB.mov', project_title: 'Salt Hours', actor_label: 'Priya Raman',
  created_at: new Date(2026, 9, 9, 15, 7).toISOString(),
  details: { bytes: 950, clip_bytes: 1000, fraction: 0.95, fraction_from: 'coverage', read_in_full: true, source_address: '203.0.113.7', via: 'cloudflare', gateway_name: 'Studio NAS' },
  ...over,
})

describe('the table', () => {
  it('when in the day-month order of the rest of the app, 24-hour; an unreadable time is blank', () => {
    expect(whenWords(new Date(2026, 9, 9, 15, 7).toISOString())).toBe('9 Oct, 15:07')
    expect(whenWords('not a date')).toBe('')
  })
  it('one row per viewing: when, who, the clip and its project, how much, from where and through which gateway', () => {
    render(<RemoteViewingsTable rows={[row()]} />)
    const table = document.querySelector('[data-testid="gateway-viewings"]')
    const cells = [...within(table).getAllByRole('cell')].map((c) => c.textContent)
    expect(cells[0]).toBe('9 Oct, 15:07')
    expect(cells[1]).toContain('Priya Raman')
    expect(cells[2]).toBe('A001_C001_0921AB.movSalt Hours')
    expect(cells[3]).toBe('950 B of 1000 B (95% covered) · read in full')
    expect(cells[4]).toContain('Cloudflare Tunnel')
    expect(cells[4]).toContain('through')
    expect(table.getAttribute('data-surface')).toBeNull()
  })
  it('a clip removed since, a project the reader cannot open, a gateway forgotten since: said in words', () => {
    render(<RemoteViewingsTable rows={[row({ file_name: null, project_title: null, details: { bytes: 10, clip_bytes: 100 } })]} />)
    const text = document.querySelector('[data-testid="gateway-viewings"]').textContent
    expect(text).toContain('a clip removed since')
    expect(text).toContain('a project you cannot open')
    expect(text).toContain('a gateway forgotten since')
  })
  it('on a dark island (the Bins dialog) the table is stamped dark, under its own test id; settings.css gives that stamp the dark ground\'s ink', () => {
    render(<RemoteViewingsTable rows={[row()]} testId="clip-viewings-table" surface="dark" />)
    expect(document.querySelector('[data-testid="clip-viewings-table"]').getAttribute('data-surface')).toBe('dark')
    const css = readFileSync(path.resolve(process.cwd(), 'src/components/settings/settings.css'), 'utf8')
    expect(css).toMatch(/\.s-table\[data-surface='dark'\] td[\s\S]*?color: var\(--color-ink\)/)
  })
})
