// =============================================================================
// crDocuments.test.js — A4, Audrey's decision 37
//
// "Approving a change request moves subjects but not the five reference
// documents." Now four of them move. Two things have to be true and neither is
// visible by reading the diff:
//
//   * THE ORDER. The fork's documents are read BEFORE the RPC, because deciding
//     CLOSES the consented review window — after otter_cr_apply returns, the
//     approver cannot read the proposer's course at all. And the merge is
//     written AFTER, because otter_fork_course snapshots the target's documents
//     into the archive during the RPC; merging first would put the NEW
//     documents in the "before change #n" copy.
//
//   * THE SHAPE. The mergers were written for the GENERATOR's output, not for a
//     stored document. For `nodes` the stored form is `{systems:[…]}` and the
//     merger wants a flat `{system, category, nodes}` list, so handing it the
//     stored document merges NOTHING and reports success.
//
// The adapter half uses a recording fake for supabase-js, so call ORDER is
// asserted rather than assumed.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CR_DOC_MERGE, mergeReferenceUrls, flattenNodesForMerge, COURSE_DOCS,
} from './otterRoutes.js'

// ── the merge rules ─────────────────────────────────────────────────────────

describe('mergeReferenceUrls', () => {
  it('adds new URLs and keeps the existing ones', () => {
    const out = mergeReferenceUrls(
      { urls: [{ url: 'https://a', title: 'A' }] },
      [{ url: 'https://b', title: 'B' }])
    expect(out.urls.map(u => u.url)).toEqual(['https://a', 'https://b'])
  })

  it('dedupes by url, keeping the standard version', () => {
    const out = mergeReferenceUrls(
      { urls: [{ url: 'https://a', title: 'Standard title' }] },
      [{ url: 'https://a', title: 'Fork title' }])
    expect(out.urls).toHaveLength(1)
    expect(out.urls[0].title).toBe('Standard title')
  })

  it('ignores blank and whitespace-only urls rather than storing junk', () => {
    const out = mergeReferenceUrls({ urls: [] }, [{ title: 'no url' }, { url: '   ' }])
    expect(out.urls).toEqual([])
  })

  it('🚨 is ADDITIVE — a URL the fork deleted survives on the standard', () => {
    const out = mergeReferenceUrls({ urls: [{ url: 'https://keep' }] }, [])
    expect(out.urls.map(u => u.url)).toEqual(['https://keep'])
  })

  it('survives a null document on either side', () => {
    expect(mergeReferenceUrls(null, null).urls).toEqual([])
  })
})

describe('flattenNodesForMerge', () => {
  it('turns the stored {systems:[…]} shape into flat merge rows', () => {
    const rows = flattenNodesForMerge({
      systems: [{ system: 'Shader Nodes', categories: [{ category: 'Input', nodes: [{ name: 'Attribute' }] }] }],
    })
    expect(rows).toEqual([
      { system: 'Shader Nodes', category: 'Input', nodes: [{ name: 'Attribute' }] },
    ])
  })

  it('upgrades the pre-0.3 {categories:[…]} shape instead of dropping it', () => {
    const rows = flattenNodesForMerge({
      categories: [{ category: 'Shader Stuff', nodes: [{ name: 'Mix' }] }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].nodes).toEqual([{ name: 'Mix' }])
  })

  it('is empty, not undefined, for an empty or null document', () => {
    expect(flattenNodesForMerge(null)).toEqual([])
    expect(flattenNodesForMerge({ systems: [] })).toEqual([])
  })
})

describe('CR_DOC_MERGE — stored document in, stored document out', () => {
  it('hotkeys: adds the fork categories, keeps the standard ones', () => {
    // The STORED shape is {categories:[{category, shortcuts}]} — `name`/
    // `hotkeys` are only accepted as incoming aliases. Writing this test
    // against the aliases produced a merged category named `undefined`,
    // which is what the first run of this file actually reported.
    const out = CR_DOC_MERGE.hotkeys(
      { categories: [{ category: 'General', shortcuts: [{ keys: 'A', action: 'Select all' }] }] },
      { categories: [{ category: 'Modelling', shortcuts: [{ keys: 'E', action: 'Extrude' }] }] })
    expect(out.categories.map(c => c.category)).toEqual(['General', 'Modelling'])
  })

  it('hotkeys: does not duplicate a shortcut the standard already has', () => {
    const out = CR_DOC_MERGE.hotkeys(
      { categories: [{ category: 'General', shortcuts: [{ keys: 'A', action: 'Select all' }] }] },
      { categories: [{ category: 'General', shortcuts: [{ keys: 'Ctrl+A', action: 'Select All' }] }] })
    expect(out.categories).toHaveLength(1)
    expect(out.categories[0].shortcuts).toHaveLength(1)
  })

  it('functions: same, and does not duplicate a function the standard has', () => {
    const out = CR_DOC_MERGE.functions(
      { categories: [{ name: 'Math', functions: [{ name: 'sin' }] }] },
      { categories: [{ name: 'Math', functions: [{ name: 'sin' }, { name: 'cos' }] }] })
    expect(out.categories).toHaveLength(1)
    expect(out.categories[0].functions.map(f => f.name)).toEqual(['sin', 'cos'])
  })

  it('🚨 nodes: merges from the STORED shape — the silent-no-op case', () => {
    // Handing the merger `fork.categories` (which is what doc.merge does) would
    // pass undefined here and move nothing while reporting success.
    const target = { systems: [{ system: 'Shader Nodes', categories: [{ category: 'Input', nodes: [{ name: 'Attribute' }] }] }] }
    const fork = { systems: [{ system: 'Shader Nodes', categories: [{ category: 'Input', nodes: [{ name: 'Fresnel' }] }] }] }
    const out = CR_DOC_MERGE.nodes(target, fork)
    const names = out.systems[0].categories[0].nodes.map(n => n.name)
    expect(names).toEqual(['Attribute', 'Fresnel'])
  })

  it('references: merges from the stored {urls:[…]} shape', () => {
    const out = CR_DOC_MERGE.references(
      { urls: [{ url: 'https://a' }] }, { urls: [{ url: 'https://b' }] })
    expect(out.urls.map(u => u.url)).toEqual(['https://a', 'https://b'])
  })

  it('🚨 every rule is ADDITIVE: an empty fork changes nothing', () => {
    // 🚨 REWRITTEN. The first version used ONE shared fixture carrying both
    // `shortcuts` and `functions`, and asserted only that the stringified
    // output contained 'keep'. mergeHotkeys copies `{...c, shortcuts:[…]}` and
    // mergeFunctions copies `{...c, functions:[…]}` — each spread carries the
    // OTHER document's key through verbatim, so a mutation that dropped every
    // shortcut still left `"functions":[{"name":"keep"}]` in the JSON and the
    // test stayed green. Measured, not guessed. Each document now gets a
    // fixture holding only its OWN key, and the surviving list is asserted.
    const cases = {
      hotkeys: {
        target: { categories: [{ category: 'Keep', shortcuts: [{ keys: 'K', action: 'keep' }] }] },
        read: out => out.categories[0].shortcuts,
      },
      functions: {
        target: { categories: [{ name: 'Keep', functions: [{ name: 'keep' }] }] },
        read: out => out.categories[0].functions,
      },
      nodes: {
        target: { systems: [{ system: 'S', categories: [{ category: 'C', nodes: [{ name: 'keep' }] }] }] },
        read: out => out.systems[0].categories[0].nodes,
      },
      references: {
        target: { urls: [{ url: 'https://keep' }] },
        read: out => out.urls,
      },
    }
    for (const [doc, { target, read }] of Object.entries(cases)) {
      const { empty } = COURSE_DOCS[doc]
      const survivors = read(CR_DOC_MERGE[doc](target, empty))
      expect(survivors, doc + ' lost its own content when the fork was empty')
        .toHaveLength(1)
    }
  })

  it('🚨 …and additive means the FORK cannot delete either', () => {
    // The same property from the other side: the fork has a DIFFERENT entry, and
    // the standard's own must still be there afterwards. An overwriting merge
    // passes the empty-fork test above and fails this one.
    const out = CR_DOC_MERGE.hotkeys(
      { categories: [{ category: 'Keep', shortcuts: [{ keys: 'K', action: 'keep' }] }] },
      { categories: [{ category: 'Other', shortcuts: [{ keys: 'O', action: 'other' }] }] })
    const kept = out.categories.find(c => c.category === 'Keep')
    expect(kept, 'the standard category vanished').toBeTruthy()
    expect(kept.shortcuts).toHaveLength(1)
    expect(out.categories.map(c => c.category)).toEqual(['Keep', 'Other'])
  })

  it('🚨 `corrections` is NOT in the map, and that is deliberate', () => {
    // otter_fork_course blanks corrections when it makes a fork — "the original
    // author's agent memory, not content" — so a fork never inherits them and
    // pushing a proposer's back onto the standard would leak private agent
    // history to the whole company. Four documents move, not five.
    expect(Object.keys(CR_DOC_MERGE).sort())
      .toEqual(['functions', 'hotkeys', 'nodes', 'references'])
    expect(CR_DOC_MERGE.corrections).toBeUndefined()
  })
})

// ── the adapter: order is the design ────────────────────────────────────────

const calls = []
let rpcError = null
let updateReturnsRow = true
let forkReadError = null
let nullRowFor = null       // 'fork-1' | 'target-1'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  supabase: {
    from(table) {
      const api = {
        __sel: null,
        select(cols) { api.__sel = cols; return api },
        // 🚨 The patch is recorded at maybeSingle(), NOT at update(): the
        // course id arrives via eq() afterwards, so recording early loses it
        // and a write aimed at the wrong course looks identical. That gap was
        // real — the mutation that pointed every write at the proposer's fork
        // survived the first version of this file.
        update(patch) { api.__patch = patch; api.__isUpdate = true; return api },
        eq(col, val) { api.__id = val; return api },
        async maybeSingle() {
          if (api.__isUpdate) {
            calls.push({ kind: 'update', table, patch: api.__patch, id: api.__id })
            return { data: updateReturnsRow ? { id: api.__id } : null, error: null }
          }
          calls.push({ kind: 'read', table, cols: api.__sel, id: api.__id })
          if (table === 'otter_change_requests') {
            return { data: { id: 'cr-1', source_course_id: 'fork-1', target_course_id: 'target-1' }, error: null }
          }
          // Both courses answer with a document; the values differ so a merge
          // that read the wrong course is visible in the patch.
          const isFork = api.__id === 'fork-1'
          if (isFork && forkReadError) return { data: null, error: forkReadError }
          if (nullRowFor && api.__id === nullRowFor) return { data: null, error: null }
          const col = api.__sel
          const doc = {
            hotkeys: { categories: [{ category: isFork ? 'ForkKeys' : 'StdKeys', shortcuts: [] }] },
            functions: { categories: [{ name: isFork ? 'ForkFns' : 'StdFns', functions: [] }] },
            nodes: { systems: [{ system: 'S', categories: [{ category: 'C', nodes: [{ name: isFork ? 'ForkNode' : 'StdNode' }] }] }] },
            reference_urls: { urls: [{ url: isFork ? 'https://fork' : 'https://std' }] },
          }[col]
          return { data: { [col]: doc }, error: null }
        },
      }
      return api
    },
    async rpc(fn, args) {
      calls.push({ kind: 'rpc', fn, args })
      if (rpcError) return { data: null, error: rpcError }
      return { data: 'archive-1', error: null }
    },
  },
}))

const { supabaseOtterAdapter } = await import('./supabaseOtterAdapter.js')

beforeEach(() => {
  calls.length = 0; rpcError = null; updateReturnsRow = true
  forkReadError = null; nullRowFor = null
})

describe('cr.approve — reads before the RPC, writes after', () => {
  it('🚨 EVERY fork document is read BEFORE otter_cr_apply is called', async () => {
    // The review window closes on decision. A read afterwards returns nothing,
    // merges nothing, and reports success — the failure this ordering exists
    // to prevent.
    await supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })
    const rpcAt = calls.findIndex(c => c.kind === 'rpc')
    expect(rpcAt).toBeGreaterThan(-1)
    const forkReads = calls
      .map((c, i) => ({ ...c, i }))
      .filter(c => c.kind === 'read' && c.id === 'fork-1')
    expect(forkReads.length, 'expected one read per document from the fork').toBe(4)
    for (const r of forkReads) {
      expect(r.i, r.cols + ' was read from the fork AFTER the RPC').toBeLessThan(rpcAt)
    }
  })

  it('🚨 every document write happens AFTER the RPC, so the archive keeps the old ones', async () => {
    await supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })
    const rpcAt = calls.findIndex(c => c.kind === 'rpc')
    const writes = calls.map((c, i) => ({ ...c, i })).filter(c => c.kind === 'update')
    expect(writes.length).toBe(4)
    for (const w of writes) {
      expect(w.i, 'a document was written BEFORE the RPC — the archive would hold it')
        .toBeGreaterThan(rpcAt)
    }
  })

  it('🚨 writes all four columns, and every one lands on the STANDARD', async () => {
    await supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })
    const writes = calls.filter(c => c.kind === 'update')
    const cols = writes.map(c => Object.keys(c.patch)[0]).sort()
    expect(cols).toEqual(['functions', 'hotkeys', 'nodes', 'reference_urls'])
    expect(cols).not.toContain('corrections')
    // Aiming these at cr.source_course_id would overwrite the PROPOSER'S
    // course and leave the standard untouched — silently, since the write
    // succeeds and the merged value looks right.
    for (const w of writes) {
      expect(w.id, Object.keys(w.patch)[0] + ' was written to the wrong course').toBe('target-1')
    }
  })

  it('🚨 the merged value actually contains the FORK content', async () => {
    // A merge that silently produced the target's own document back would pass
    // every ordering assertion above.
    await supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })
    const patches = JSON.stringify(calls.filter(c => c.kind === 'update').map(c => c.patch))
    for (const marker of ['ForkKeys', 'ForkFns', 'ForkNode', 'https://fork']) {
      expect(patches, marker + ' did not reach the standard').toContain(marker)
    }
    for (const marker of ['StdKeys', 'StdFns', 'StdNode', 'https://std']) {
      expect(patches, marker + ' was lost from the standard').toContain(marker)
    }
  })

  it('🚨 a refused document write is REPORTED, not swallowed', async () => {
    // PostgREST answers an RLS-refused UPDATE with 204 and no error, so the
    // .select("id") is what turns silence into a failure.
    updateReturnsRow = false
    const out = await supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })
    expect(out.ok).toBe(true)                    // the RPC committed; it stands
    expect(out.documents.merged).toEqual([])
    expect(out.documents.failed.map(f => f.doc).sort())
      .toEqual(['functions', 'hotkeys', 'nodes', 'references'])
  })

  it('reports the four merged documents on the happy path', async () => {
    const out = await supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })
    expect(out.documents.failed).toEqual([])
    expect(out.documents.merged.sort()).toEqual(['functions', 'hotkeys', 'nodes', 'references'])
    expect(out.archive_course_id).toBe('archive-1')
  })

  it('🚨 an INVISIBLE fork is refused, not read as an empty document', async () => {
    // `row?.[column] ?? empty` alone cannot tell "I cannot see the fork" from
    // "the fork has no hotkeys". The first merges nothing into all four columns
    // while every write succeeds and the banner reports a clean merge.
    nullRowFor = 'fork-1'
    await expect(supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })).rejects.toThrow()
    expect(calls.filter(c => c.kind === 'rpc'), 'the RPC ran anyway').toEqual([])
    expect(calls.filter(c => c.kind === 'update')).toEqual([])
  })

  it('🚨 an INVISIBLE standard fails the document, it does not overwrite it', async () => {
    // Worse on this side: treating an unreadable standard as EMPTY would merge the
    // fork into nothing and write that back, replacing the standard's own documents
    // with only the proposer's. The RPC has committed, so the subjects still move.
    nullRowFor = 'target-1'
    const out = await supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })
    expect(out.ok).toBe(true)
    expect(out.documents.merged).toEqual([])
    expect(out.documents.failed).toHaveLength(4)
    expect(calls.filter(c => c.kind === 'update'), 'it wrote anyway').toEqual([])
  })

  it('🚨 a failed fork READ aborts BEFORE the RPC — fail closed', async () => {
    // After the RPC the review window is shut and these documents can never be
    // read again. Approving first and discovering the read failed second would
    // lose them permanently, so `unwrap` is allowed to throw here and the whole
    // approval is refused. The approver can simply try again.
    forkReadError = { message: 'network', code: 'XX000' }
    await expect(supabaseOtterAdapter['cr.approve']({ id: 'cr-1' })).rejects.toThrow()
    expect(calls.filter(c => c.kind === 'rpc'), 'the RPC ran anyway').toEqual([])
    expect(calls.filter(c => c.kind === 'update')).toEqual([])
  })

  it('🚨 an RPC refusal writes NOTHING — no half-applied documents', async () => {
    rpcError = { message: 'the target is no longer the company standard' }
    await expect(supabaseOtterAdapter['cr.approve']({ id: 'cr-1' }))
      .rejects.toThrow('no longer the company standard')
    expect(calls.filter(c => c.kind === 'update')).toEqual([])
  })
})
