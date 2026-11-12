// =============================================================================
// binsListsPaged.test.js — BC3 review round 2: the cloud's bins reads are
// paged. PostgREST answers at most max_rows (1,000, supabase/config.toml)
// and says nothing about the rest, so an unpaged read showed a browser's
// catalogue — "every bin and clip" — cut at the thousandth clip of a larger
// project (and a desktop signed in the same). Every list of the bins' part
// (bins, clips, takes, the company's locations) is read page by page until
// a page comes back short, in an order whose last key is the id.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')

const PAGE = 1000

// A client that answers like PostgREST: a range is honoured, but never more
// than max_rows an answer; with no range, the first max_rows only.
function makeClient(rows) {
  const ranges = []
  const table = (name) => {
    const q = { range: null, orders: [] }
    const b = {
      select: () => b, eq: () => b, in: () => b,
      order: (col) => { q.orders.push(col); return b },
      range: (from, to) => { q.range = [from, to]; ranges.push([name, from, to, q.orders.join(',')]); return b },
      then: (resolve, reject) => {
        const all = rows[name] || []
        const page = q.range ? all.slice(q.range[0], Math.min(q.range[1] + 1, q.range[0] + PAGE)) : all.slice(0, PAGE)
        return Promise.resolve({ data: page.map(r => ({ ...r })), error: null }).then(resolve, reject)
      },
    }
    return b
  }
  return {
    ranges,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (name) => table(name),
    rpc: async () => ({ data: null, error: null }),
  }
}

const many = (n, make) => Array.from({ length: n }, (_, i) => make(i))

let warn
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  resetSupabaseAdapter()
})
afterEach(() => { warn.mockRestore(); delete globalThis.__testSupabase })

describe('listBins reads every page of every list', () => {
  it('a project of 2,300 clips, 1,200 takes, 1,050 bins and a company of 1,001 locations comes back whole, each list asked for in pages of 1,000 ordered with the id last', async () => {
    const client = makeClient({
      bins: many(1050, (i) => ({ id: `b${String(i).padStart(5, '0')}`, project_id: 'p1', name: `Bin ${i}`, sort_order: i })),
      bin_files: many(2300, (i) => ({ id: `c${String(i).padStart(5, '0')}`, project_id: 'p1', bin_id: 'b00000', sort_order: i })),
      shot_takes: many(1200, (i) => ({ id: `t${String(i).padStart(5, '0')}`, project_id: 'p1', shot_id: 's1', bin_file_id: `c${String(i).padStart(5, '0')}`, position: i })),
      bin_locations: many(1001, (i) => ({ id: `L${String(i).padStart(5, '0')}`, name: `Share ${i}`, unc_path: `\\\\nas\\share${i}` })),
    })
    globalThis.__testSupabase = client
    const data = await supabaseAdapter().listBins('p1')
    expect(data.bins).toHaveLength(1050)
    expect(data.binFiles).toHaveLength(2300)
    expect(data.shotTakes).toHaveLength(1200)
    expect(data.binLocations).toHaveLength(1001)
    // The last row of each list is there (not only the first page's).
    expect(data.binFiles.at(-1).id).toBe('c02299')
    expect(data.binLocations.at(-1).id).toBe('L01000')
    const pagesOf = (t) => client.ranges.filter(r => r[0] === t).map(r => [r[1], r[2]])
    expect(pagesOf('bin_files')).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(pagesOf('shot_takes')).toEqual([[0, 999], [1000, 1999]])
    expect(pagesOf('bins')).toEqual([[0, 999], [1000, 1999]])
    expect(pagesOf('bin_locations')).toEqual([[0, 999], [1000, 1999]])
    // Each order ends in the id: a total order, so no row straddles two pages.
    for (const r of client.ranges) expect(r[3], r[0]).toMatch(/,id$/)
  })

  it('CONTROL: a project under a thousand of everything is one page per list, and comes back as it was', async () => {
    const client = makeClient({
      bins: [{ id: 'b1', project_id: 'p1', name: 'Footage', sort_order: 0 }],
      bin_files: many(3, (i) => ({ id: `c${i}`, project_id: 'p1', bin_id: 'b1', sort_order: i })),
      shot_takes: [],
      bin_locations: [{ id: 'L1', name: 'NAS', unc_path: '\\\\nas\\footage' }],
    })
    globalThis.__testSupabase = client
    const data = await supabaseAdapter().listBins('p1')
    expect(data.bins.map(b => b.id)).toEqual(['b1'])
    expect(data.binFiles.map(c => c.id)).toEqual(['c0', 'c1', 'c2'])
    expect(data.shotTakes).toEqual([])
    expect(data.binLocations.map(l => l.id)).toEqual(['L1'])
    for (const t of ['bins', 'bin_files', 'shot_takes', 'bin_locations']) expect(client.ranges.filter(r => r[0] === t), t).toHaveLength(1)
  })
})
