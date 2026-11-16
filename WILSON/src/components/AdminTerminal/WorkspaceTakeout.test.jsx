/** @vitest-environment jsdom */
// =============================================================================
// WorkspaceTakeout.test.jsx — MO1 (0110, MOTH_DESIGN §2.2 TK-1, SEC-4): the takeout
// leaves out personal spaces and every row under them, names the exclusion in the
// manifest and on the card, and stops rather than guess when it cannot tell which
// projects are personal. An admin's RLS reads those rows; her ruling is that
// admins reach them from Files, where each open is logged.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ tables: {}, personalError: null, zipped: null, downloads: [] }))

vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: {
    from(table) {
      let personalOnly = false
      const b = {
        select: () => b,
        order: () => b,
        not: (col) => { if (col === 'personal_owner_id') personalOnly = true; return b },
        range: async (from, to) => {
          if (personalOnly) {
            if (holder.personalError) return { data: null, error: holder.personalError }
            const rows = (holder.tables.projects || []).filter(p => p.personal_owner_id != null).map(p => ({ id: p.id }))
            return { data: rows.slice(from, to + 1), error: null }
          }
          return { data: (holder.tables[table] || []).slice(from, to + 1), error: null }
        },
      }
      return b
    },
  },
}))
vi.mock('jszip', () => ({
  default: class {
    constructor() { this.files = {}; holder.zipped = this.files }
    file(name, text) { this.files[name] = text }
    async generateAsync() { return 'zip-blob' }
  },
}))
vi.mock('../../lib/csvExport', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadBlob: (name, blob) => { holder.downloads.push({ name, blob }) },
}))

const { default: WorkspaceTakeout, droppedRow } = await import('./WorkspaceTakeout')

afterEach(() => { cleanup(); holder.tables = {}; holder.personalError = null; holder.zipped = null; holder.downloads = [] })

const PERSONAL = { id: 'ps1', title: 'Personal space', personal_owner_id: 'u2', is_private: true }
const SALT = { id: 'p1', title: 'Salt Hours', personal_owner_id: null }
function seed() {
  holder.tables = {
    projects: [SALT, PERSONAL],
    project_members: [{ project_id: 'p1', user_id: 'u1' }, { project_id: 'ps1', user_id: 'u2' }],
    assets: [{ id: 'a1', project_id: 'p1' }, { id: 'a-secret', project_id: 'ps1' }],
    tasks: [{ id: 't1', project_id: 'p1' }, { id: 't-secret', project_id: 'ps1' }],
    task_dependencies: [{ id: 'd1', predecessor_id: 't1', successor_id: 't1' }, { id: 'd-secret', predecessor_id: 't-secret', successor_id: 't1' }],
    task_links: [{ id: 'l1', task_id: 't1' }, { id: 'l-secret', task_id: 't-secret' }],
    files: [{ id: 'f1', project_id: 'p1' }, { id: 'f-secret', project_id: 'ps1' }],
    file_events: [{ id: 'e1', project_id: 'p1', file_id: 'f1' }, { id: 'e-secret', project_id: 'ps1', file_id: 'f-secret' }],
    asset_versions: [{ id: 'v1', asset_id: 'a1' }, { id: 'v-secret', asset_id: 'a-secret' }],
    comments: [{ id: 'c1', entity_type: 'asset', entity_id: 'a1' }, { id: 'c-secret', entity_type: 'project', entity_id: 'ps1' }],
    ingestion_runs: [{ id: 'r1', project_id: 'p1' }, { id: 'r-secret', project_id: 'ps1' }],
    ingestion_chunks: [{ id: 'k1', run_id: 'r1' }, { id: 'k-secret', run_id: 'r-secret' }],
    edit_history: [{ id: 'h1', project_id: 'p1', entity_id: 'a1' }, { id: 'h-secret', project_id: null, entity_id: 't-secret' }],
    app_events: [{ id: 'log1', code: 'WIL-4114', context: { project_id: 'ps1' } }],
  }
}
async function runTakeout() {
  render(<WorkspaceTakeout workspaceId="w1" slug="petal" />)
  fireEvent.click(screen.getByRole('button', { name: /Download takeout/ }))
  await waitFor(() => expect(holder.downloads.length + document.querySelectorAll('.ui-banner').length).toBeGreaterThan(0))
}

describe('the takeout leaves personal spaces out', () => {
  it('no personal row and no row under one, at any depth; everything else stays', async () => {
    seed()
    await runTakeout()
    const all = Object.entries(holder.zipped).filter(([n]) => n.endsWith('.csv')).map(([, csv]) => csv).join('\n')
    expect(all).not.toContain('ps1,') // the project's own row, its seat, its children's project_id
    expect(all).not.toMatch(/\b[a-z]-secret\b/)
    expect(all).not.toContain('Personal space')
    expect(holder.zipped['projects.csv']).toContain('Salt Hours')
    for (const kept of ['a1', 't1', 'd1', 'l1', 'f1', 'e1', 'v1', 'c1', 'r1', 'k1', 'h1']) expect(all, kept).toContain(kept)
  })

  it('the manifest names the exclusion and counts only what went in', async () => {
    seed()
    await runTakeout()
    const manifest = JSON.parse(holder.zipped['manifest.json'])
    expect(manifest.excluded).toContain('personal spaces (owner-only; admins reach them from Files)')
    expect(manifest.tables.projects.rows).toBe(1)
    expect(manifest.tables.project_members.rows).toBe(1)
    expect(manifest.tables.ingestion_chunks.rows).toBe(1)
  })

  it('the record of an admin opening one is the company\'s log, and stays', async () => {
    seed()
    await runTakeout()
    expect(holder.zipped['app_events.csv']).toContain('WIL-4114')
  })

  it('the card says so before the button is pressed', () => {
    render(<WorkspaceTakeout workspaceId="w1" slug="petal" />)
    expect(document.querySelector('.at-note').textContent).toMatch(/personal spaces/)
  })

  it('a database without 0110: nothing to leave out, the takeout runs', async () => {
    seed()
    holder.personalError = { code: '42703', message: 'column projects.personal_owner_id does not exist' }
    await runTakeout()
    expect(holder.downloads).toHaveLength(1)
  })

  it('it cannot tell which are personal: it stops, and exports nothing', async () => {
    seed()
    holder.personalError = { code: '503', message: 'network' }
    await runTakeout()
    expect(holder.downloads).toEqual([])
    expect(screen.getByText(/projects: network/)).toBeTruthy()
  })
})

describe('droppedRow', () => {
  const personal = new Set(['ps1'])
  const dropped = new Set(['ps1', 'a-secret'])
  it('its project, a row of its project, and a row whose parent was dropped', () => {
    expect(droppedRow('projects', { id: 'ps1' }, personal, dropped)).toBe(true)
    expect(droppedRow('assets', { id: 'x', project_id: 'ps1' }, personal, dropped)).toBe(true)
    expect(droppedRow('asset_versions', { id: 'x', asset_id: 'a-secret' }, personal, dropped)).toBe(true)
    expect(droppedRow('comments', { id: 'x', entity_id: 'ps1' }, personal, dropped)).toBe(true)
  })
  it('FAILING CONTROL: another project\'s rows, and a row with empty keys, stay', () => {
    expect(droppedRow('projects', { id: 'p1' }, personal, dropped)).toBe(false)
    expect(droppedRow('assets', { id: 'x', project_id: 'p1' }, personal, dropped)).toBe(false)
    expect(droppedRow('asset_versions', { id: 'x', asset_id: null }, personal, dropped)).toBe(false)
    expect(droppedRow('workspace_members', { user_id: 'u2' }, personal, dropped)).toBe(false)
  })
})
