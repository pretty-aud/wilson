// =============================================================================
// receiptsAreMoney.test.js — Track C, bundle C4.
//
// An expense receipt is money, and until this bundle it was not treated as
// such. `BudgetView`'s upload passed `{ type: 'expense' }`; `scope.type` is
// read by NOTHING — not supabaseAdapter, not localServerAdapter, not the
// Express server — so the scope was effectively empty and a receipt landed as
// an ordinary project-level file, readable by every project member. The
// `expenses` row pointing at it is manager-only (0037 gates all five money
// tables on can_access_project_money), so the amount was hidden while the
// receipt stating it was not. 0038's own comment calls files.is_financial
// "an invoice or receipt" — the intent was always there; only the receipt
// half was never wired.
//
// WHAT THIS FILE CAN AND CANNOT SEE — stated here rather than discovered
// later, which is C3's own hardest-won lesson (a measured diff is only ever
// accurate about what it measured):
//
//   * The upload happens inside a handler in a 3000-line component, reached
//     only through a file <input>. There is no exported seam, so the CALL
//     SITE is held by a source pin — the same instrument, for the same
//     reason, as deckAttachmentSource.test.js.
//   * A source pin proves the key is PASSED. It cannot prove the key is
//     SPENT. So the two writers that consume it are pinned too, at the exact
//     lines where each gate is decided, and the pgTAP side (suite 78) is what
//     proves the database actually refuses a non-manager.
//   * Nothing here executes an upload. `uploadFile` needs a live client, a
//     storage provider and a workspace-storage read; every other test in this
//     tree stops at the same boundary (uploadScope.test.js drives only the
//     pure helper).
//
// 🚨 Every pin normalises CRLF before matching. The working tree is CRLF under
// core.autocrlf and CI checks out LF, so a multi-line regex that passes here
// fails in CI — Track C has now hit that in C2 and C3.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(HERE, p), 'utf8').replace(/\r\n/g, '\n')

const BUDGET_VIEW = read('../../tools/rabbit_v0.1.0/views/BudgetView.jsx')
const INVOICE_ATT = read('./InvoiceAttachment.jsx')
const SUPA        = read('../../tools/rabbit_v0.1.0/adapters/supabaseAdapter.js')
const LOCAL       = read('../../tools/rabbit_v0.1.0/adapters/localServerAdapter.js')
const SERVER      = read('../../../electron/main.cjs')

// ── 1. The call site: a receipt is uploaded as money ─────────────────────────

describe('BudgetView uploads a receipt as money', () => {
  it('passes financial: true to adapter.uploadFile', () => {
    expect(BUDGET_VIEW).toMatch(
      /adapter\.uploadFile\(\s*projectId\s*,\s*\{\s*financial:\s*true\s*\}\s*,\s*file\s*\)/,
    )
  })

  it('no longer passes the inert `type` key that made the scope empty', () => {
    // The exact defect. `scope.type` reaches no reader, so this scope said
    // nothing at all — not the money flag, not an entity link.
    expect(BUDGET_VIEW).not.toMatch(/uploadFile\([^)]*\btype:\s*'expense'/)
  })

  it('has exactly one uploadFile call, so the pin cannot be passing on a twin', () => {
    // 🚨 A pin that matches SOMEWHERE in a 3000-line file proves nothing if a
    // second, unfixed call site exists beside it. C3's round 1 found a fix
    // that had moved to a different path than the one being measured.
    const calls = BUDGET_VIEW.match(/\.uploadFile\(/g) || []
    expect(calls).toHaveLength(1)
  })

  it('does not set is_core_definer while it is in there — C3 polarity', () => {
    // The C3 lesson, restated at the one call site most likely to repeat it:
    // this flag says "money" and nothing else. Flipping isCore here would
    // change D.O.G. generation output for every file on the project.
    expect(BUDGET_VIEW).not.toMatch(/uploadFile\([^)]*isCoreDefiner/)
  })
})

// ── 2. The twin that was already right ───────────────────────────────────────

describe('InvoiceAttachment stays the reference implementation', () => {
  it('still passes financial: true', () => {
    // The regression twin. Both call sites now say the same thing, so a future
    // "unification" of the two has to unify them in the RIGHT direction — the
    // failure mode being that someone reads the receipt path as the pattern.
    expect(INVOICE_ATT).toMatch(/uploadFile\([^)]*financial:\s*true/)
  })
})

// ── 3. The key is SPENT, on both gates, by both writers ──────────────────────

describe('scope.financial closes both gates in the cloud writer', () => {
  it('picks the reserved INVOICES path segment — the blob gate', () => {
    // rabbit_files_invoices_* key on the third path segment; the three base
    // policies negate it (0038). This line is the only thing that puts a file
    // on the money side of that test.
    expect(SUPA).toMatch(/const entity\s*=\s*scope\.financial\s*\?\s*'INVOICES'\s*:/)
  })

  it('writes files.is_financial — the row gate', () => {
    expect(SUPA).toMatch(/is_financial:\s*!!scope\.financial/)
  })

  it('pins the body to Supabase — the THIRD use, 0050', () => {
    // 🚨 Review round 1: this file asserted "uploadFile spends it three times"
    // and pinned TWO. Deleting the provider pin turned no probe here red (it
    // was caught only over in storageRegistry.test.js), so the file's own
    // claim outran its own probes. This is the missing third.
    expect(SUPA).toMatch(/fileProviderFor\([^)]*\{\s*financial:\s*!!scope\.financial/)
  })

  it('keeps the two in one function, so they cannot drift apart', () => {
    // 0038: "the row and the blob are gated independently, and either one
    // alone is a way in". One key is only safe BECAUSE one writer spends it
    // on both. If these ever move into different functions, the "one key"
    // claim in BudgetView's comment stops being true.
    const seg = SUPA.indexOf("scope.financial ? 'INVOICES'")
    const row = SUPA.indexOf('is_financial:     !!scope.financial')
    expect(seg).toBeGreaterThan(-1)
    expect(row).toBeGreaterThan(seg)
    const between = SUPA.slice(seg, row)
    // No function boundary between them: `async uploadFile(` opens the block
    // that contains both, and nothing closes and reopens one in between.
    expect(between).not.toMatch(/\n {4}(async )?[a-zA-Z]+\(.*\)\s*\{/)
  })
})

describe('scope.financial reaches the desktop writer too — parity', () => {
  it('the local adapter forwards the whole scope rather than a chosen subset', () => {
    // If this ever became `scope: { phaseId, assetId, ... }` the money flag
    // would be dropped on the desktop only, which is the hardest kind of gap
    // to notice: the web would be gated and the desktop would not.
    expect(LOCAL).toMatch(/uploadFile\(projectId,\s*scope,\s*file\)/)
    expect(LOCAL).toMatch(/\n\s*scope,\n/)
  })

  it('the Express server reads it and mirrors is_financial', () => {
    expect(SERVER).toMatch(/const isFinancial\s*=\s*!!scope\.financial/)
    expect(SERVER).toMatch(/is_financial:\s*isFinancial/)
  })

  it('and routes the body to the invoices directory, not the shared one', () => {
    // The desktop's equivalent of the path segment: a different directory on
    // disk, chosen by the same flag.
    expect(SERVER).toMatch(
      /isFinancial\s*\n?\s*\?\s*resolveProjectInvoicesDir/,
    )
  })
})

// ── 3b. The other half of the gate: the manager can still READ it back ───────

describe('a receipt stays reachable by the person who uploaded it', () => {
  // 🚨 REVIEW ROUND 1 FOUND THIS MISSING, and it is the regression class the
  // fix most risks. Marking a receipt financial removes it from BOTH surfaces
  // that could open a file: FileManager drops every is_financial row, and
  // ProjectsPage filters them out of the project's file table. So the gate
  // also took away the manager's only way to open their own receipt, and
  // walkthrough 16's step A3 asserted the opposite. ExpensePopup now carries
  // the receipt's own open control, the twin of InvoiceAttachment's.
  //
  // Nothing else in the tree pins this. If it is deleted, no other test fails
  // and a manager silently loses access to their own financial documents.

  it('ExpensePopup can open an attachment, not merely name it', () => {
    expect(BUDGET_VIEW).toMatch(/async function openFile\s*\(/)
  })

  it('and it opens the row it re-lists, the way InvoiceAttachment does', () => {
    // Re-lists rather than trusting state: a freshly uploaded file is only
    // { id, name, mime_type } from uploadFile's result, and downloadFile needs
    // the real row. The invoice surface already worked this way.
    const open = BUDGET_VIEW.slice(BUDGET_VIEW.indexOf('async function openFile'))
    expect(open).toMatch(/listFiles\(projectId\)/)
    expect(open).toMatch(/downloadFile\(row\)/)
    expect(open).toMatch(/createObjectURL/)
    expect(INVOICE_ATT).toMatch(/createObjectURL/)
  })

  it('and the attachment row actually renders that control', () => {
    // A handler nothing calls is not an affordance.
    expect(BUDGET_VIEW).toMatch(/onClick=\{\(\)\s*=>\s*openFile\(f\.id\)\}/)
  })
})

// ── 4. The consequence D.O.G. depends on ─────────────────────────────────────

describe('a money-gated receipt cannot become a deck attachment', () => {
  it('the deck attachment contract still rejects a financial row', () => {
    // C3 pinned this for invoices (commit 6d59fed). Receipts join that set the
    // moment they carry the flag — so this is the test that says the two
    // bundles agree, rather than a new rule.
    const CONTRACT = read('../../tools/rabbit_v0.1.0/deckAttachments.js')
    expect(CONTRACT).toMatch(/row\.is_financial\)\s*return false/)
  })
})
