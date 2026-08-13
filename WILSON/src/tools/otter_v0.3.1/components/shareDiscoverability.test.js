// =============================================================================
// shareDiscoverability.test.js — Phase 5 (2026-08-12).
//
// 🚨 THIS SUITE EXISTS BECAUSE THE FEATURE WORKED AND NOBODY COULD FIND IT.
//
// Audrey, 2026-08-10: "in otter, how does a user submit a course to be part of
// the company wide otter tool? i cant see anywau to submit it". The sharing
// model was fully built and correctly wired — the brief written from that
// report concluded the dialog had NO CALLER, and that was wrong: three
// `onShare={setShareDialogCourse}` sites have been live since Session 11. What
// was actually broken was that the only control leading to them was drawn at
// 1.35:1 contrast, in a 16x16 hit box, invisible until hover, labelled with a
// word ("Sharing") that the person hunting for it was not hunting for.
//
// So these assertions are about VISIBILITY AND VOCABULARY, not about wiring.
//
// ── WHAT THIS SUITE CANNOT DO ────────────────────────────────────────────────
// vitest.config.js pins `environment: 'node'` and neither package.json nor the
// installed tree carries jsdom or @testing-library. There is no way to mount a
// component here. validatorSave.test.js already measured exactly what that
// costs: it wrapped FixCard's failure banner in `{false && …}` and all 17 of
// its assertions stayed green, because nothing renders React.
//
// The same limit applies to every line below. A source scan proves the classes
// and strings are in the file. It CANNOT prove the button is on Audrey's
// screen. Only her test plan can. This suite is a regression guard against the
// specific regressions Phase 5 fixed, not evidence the fix works.
//
// ── WHY EVERY SCAN RUNS ON COMMENT-STRIPPED SOURCE ───────────────────────────
// Phase 5 documents each change in a comment that QUOTES the class it removed
// ("was `opacity-0 group-hover/course:opacity-100`"). A raw `not.toMatch` would
// therefore match its own explanation and fail — the house rule is to assert
// the EXECUTABLE form. `stripComments` below is the instrument, and the first
// describe block proves the instrument works before anything relies on it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(here(rel), 'utf8')

/**
 * Drop whole-line comments: `//`, block comments, and JSX `{/* … *\/}`.
 *
 * LINE-ANCHORED ON PURPOSE. The obvious implementation is a character-wise
 * state machine, and it is a trap: to know whether `/` opens a comment it must
 * also decide whether `/` is division, a regex literal, JSX `/>` or JSX `</`.
 * A single regex literal containing an apostrophe — `/it's/` — flips such a
 * scanner's quote parity for the rest of the file, after which it can swallow
 * live code. Every assertion below would then pass because the code is GONE
 * rather than because it is right, which is the precise failure this suite
 * exists to prevent elsewhere. (Measured: the character-wise version desynced
 * on that input and re-synced only by luck, before the regions under test.)
 *
 * Anchoring to line starts removes the ambiguity entirely — a `/` in the middle
 * of a line is never treated as a comment — and it is sufficient, because every
 * comment this suite needs removed occupies whole lines.
 */
function stripComments(src) {
  const out = []
  let inBlock = false
  for (const line of src.split('\n')) {
    const t = line.trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      continue
    }
    if (t.startsWith('{/*') || t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true
      continue
    }
    if (t.startsWith('//') || t.startsWith('*')) continue
    out.push(line)
  }
  return out.join('\n')
}

const MENU_RAW   = read('./CourseRowMenu.jsx')
const DIALOG_RAW = read('./ShareCourseDialog.jsx')
const OTTER_RAW  = read('../Otter.jsx')

const MENU   = stripComments(MENU_RAW)
const DIALOG = stripComments(DIALOG_RAW)
const OTTER  = stripComments(OTTER_RAW)

/** The className string of CourseRowMenu's "⋯" trigger, executable form only. */
function triggerClassName() {
  const anchor = MENU.indexOf('hover:text-orange-400 hover:bg-stone-700')
  if (anchor === -1) return null
  const open = MENU.lastIndexOf('className={`', anchor)
  if (open === -1) return null
  const close = MENU.indexOf('`}', anchor)
  return close === -1 ? null : MENU.slice(open, close)
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the instrument works', () => {
  // Without these, every `not.toMatch` below would pass vacuously — on an empty
  // string, on a file that moved, or on source whose comments were never
  // stripped. Each pair asserts one executable anchor SURVIVED stripping and
  // one comment-only phrase DID NOT.

  it('strips comments without eating code — CourseRowMenu', () => {
    expect(MENU, 'the menu label is executable and must survive').toContain('Share or submit…')
    expect(MENU_RAW, 'the WCAG note is comment-only, so it must exist before stripping').toContain('WCAG')
    expect(MENU, 'comments were not stripped').not.toContain('WCAG')
  })

  it('strips comments without eating code — ShareCourseDialog', () => {
    expect(DIALOG).toContain('Want this to be the company standard?')
    expect(DIALOG_RAW).toContain("AUDREY'S QUESTION")
    expect(DIALOG, 'comments were not stripped').not.toContain("AUDREY'S QUESTION")
  })

  it('strips comments without eating code — Otter.jsx', () => {
    expect(OTTER).toContain('<CourseRowMenu')
    expect(OTTER_RAW).toContain('PHASE 5')
    expect(OTTER, 'comments were not stripped').not.toContain('PHASE 5')
  })

  it('finds the trigger className', () => {
    expect(triggerClassName(), 'the "⋯" trigger className must be locatable').not.toBeNull()
  })

  it('does not silently eat code mid-file', () => {
    // stripComments is a hand-rolled state machine over a 5,000-line JSX file.
    // If it desyncs on a construct it misreads (a regex literal holding a quote,
    // say) it can swallow the region it desyncs through — and every `not.toMatch`
    // downstream would then pass because the code is GONE, not because it is
    // correct. Counting the anchors in raw vs stripped catches exactly that.
    const count = (s, t) => (s.match(new RegExp(t, 'g')) ?? []).length
    expect(count(OTTER, '<CourseRowMenu'), 'stripping lost a render site')
      .toBe(count(OTTER_RAW, '<CourseRowMenu'))
    expect(count(DIALOG, 'await readBody\\(res\\)'), 'stripping lost a dialog fetch')
      .toBe(count(DIALOG_RAW, 'await readBody\\(res\\)'))
    expect(count(MENU, 'className='), 'stripping lost menu markup')
      .toBe(count(MENU_RAW, 'className='))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the sharing dialog has callers (the brief said it did not)', () => {
  // Pinned so the Phase 5 misdiagnosis is not repeated. `setShareDialogCourse`
  // reaching CourseRowMenu as onShare is what makes ShareCourseDialog
  // reachable at all; the S11 wiring was never the defect.
  it('passes setShareDialogCourse to all three CourseRowMenu sites', () => {
    const mounts = OTTER.match(/<CourseRowMenu/g) ?? []
    const wired  = OTTER.match(/onShare=\{setShareDialogCourse\}/g) ?? []
    expect(mounts.length, 'expected three CourseRowMenu render sites').toBe(3)
    expect(wired.length, 'every site must open the share dialog').toBe(mounts.length)
  })

  it('still mounts ShareCourseDialog lazily', () => {
    // Non-negotiable: the dialog mounts useWorkspaceMembers, which fires a
    // workspace_directory RPC. Hoisting it would run that for every user on
    // every O.T.T.E.R. launch (the AdminTerminalBody lesson).
    expect(OTTER).toMatch(/\{shareDialogCourse\s*&&\s*\(\s*<ShareCourseDialog/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the "⋯" trigger is findable', () => {
  // Concealment is not one class. Checking only for `opacity-0` lets the exact
  // defect this suite exists for come back through `hidden`, `invisible`,
  // `sr-only` or `scale-0` — all verified to leave the old assertion green.
  // The lookarounds stop `overflow-hidden` and `opacity-100` matching.
  const CONCEALED = /(?<![\w-])(opacity-0|hidden|invisible|sr-only|scale-0)(?![\w-])/

  it('is not concealed until hover at any render site', () => {
    let from = 0
    let checked = 0
    for (;;) {
      const at = OTTER.indexOf('<CourseRowMenu', from)
      if (at === -1) break
      const wrapper = OTTER.slice(Math.max(0, at - 260), at)
      expect(wrapper, `CourseRowMenu site ${checked + 1} is hidden until hover`)
        .not.toMatch(CONCEALED)
      checked++
      from = at + 1
    }
    expect(checked, 'expected three CourseRowMenu render sites').toBe(3)
  })

  it('is not concealed by the trigger\'s own classes either', () => {
    // The wrappers live in Otter.jsx, but nothing stops the concealment moving
    // INTO CourseRowMenu — where the previous version of this suite never
    // looked, so the trigger could be invisible at rest with all tests green.
    expect(triggerClassName()).not.toMatch(CONCEALED)
  })

  it('meets the 3:1 contrast minimum for a UI component', () => {
    const cls = triggerClassName()
    // stone-600 (#57534e) on the hovered stone-700 sidebar row measures 1.35:1.
    // stone-400 (#a8a29e) measures 4.08:1 there and higher on the darker two.
    expect(cls, 'the trigger must not go back to stone-600').not.toContain('text-stone-600')
    expect(cls).toContain('text-stone-400')
  })

  it('meets the 24x24 target-size minimum in both densities', () => {
    // BOTH terms of the sum, or this pins half an arithmetic and calls it a
    // target size: padding lives on the button, the icon size on <MoreHorizontal>,
    // and shrinking the icon alone drops compact to 20x20 with the old assertion
    // still green.
    // compact: 12px icon + p-1.5 (6px each side) = 24. default: 14px + p-2 = 30.
    // The old p-0.5 / p-1 gave 16x16 and 22x22.
    expect(triggerClassName(), 'padding half of the target size')
      .toMatch(/compact \? 'p-1\.5' : 'p-2'/)
    expect(MENU, 'icon half of the target size')
      .toMatch(/compact \? 'w-3 h-3' : 'w-3\.5 h-3\.5'/)
  })

  it('names only the actions the menu actually contains', () => {
    // A fixed "share, submit, copy or trash" was wrong for every row the caller
    // does not own — including all company-standard courses, where the menu
    // holds one item. Promising "submit" and not offering it is worse than the
    // silence this phase set out to fix.
    expect(MENU, 'the label must be derived from the capability flags')
      .toMatch(/aria-label=\{`Actions for \$\{course\?\.name \?\? 'course'\} — \$\{verbList\}`\}/)
    expect(MENU).toMatch(/mayShare\s+&&\s+'share or submit'/)
    expect(MENU).toMatch(/mayTrash\s+&&\s+'move to trash'/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the vocabulary matches what a user searches for', () => {
  it('the menu item says "submit"', () => {
    // Audrey searched for a way to "submit" a course. "Sharing…" did not
    // contain the word, and it was the only route to the company library.
    expect(MENU).toMatch(/label: 'Share or submit…'/)
  })

  it('the dialog a user lands in still says "submit"', () => {
    expect(DIALOG).toContain('Share or submit')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('a non-admin is told how to reach the company standard', () => {
  // This is the substantive product fix. selectableVisibilities() offers a
  // non-admin only ['personal','shared'] — correct, and pinned by
  // otterSharing.test.js, so it is NOT changed here. What changed is that the
  // one sentence explaining the third tier used to be gated on
  // `role === 'admin'`, i.e. shown only to the people it was not missing for.

  it('the explanation is no longer admin-only', () => {
    // STRUCTURAL, not merely textual. Asserting that both sentences appear
    // somewhere in the file passes just as happily when the non-admin copy has
    // been stranded in a branch nothing can reach — which is precisely how
    // validatorSave.test.js's 17 assertions survived `{false && …}`. So this
    // locates the ternary and checks WHICH ARM the copy is in.
    const at = DIALOG.indexOf("role === 'admin' ?")
    expect(at, 'the tier explanation must be a ternary on role, not an && gate')
      .toBeGreaterThan(-1)

    const arm = DIALOG.indexOf(') : (', at)
    expect(arm, 'the ternary must have a real else arm').toBeGreaterThan(-1)
    expect(arm - at, 'the else arm must belong to THIS ternary, not a later one')
      .toBeLessThan(700)

    expect(DIALOG.slice(at, arm), 'the admin arm keeps its own sentence')
      .toContain('Company standard is admin-only')
    expect(DIALOG.slice(arm, arm + 1400), 'the non-admin copy must be the else arm')
      .toContain('Want this to be the company standard?')
  })

  it('points at a control rather than describing a conversation to go and have', () => {
    // Until 0064 the honest answer was "share it, then ask an admin" — two
    // steps, because otter_courses_select has no admin arm and an admin cannot
    // promote a course they cannot see. Nominations replaced that with an
    // actual submit path, so the copy must now point AT it. If this ever goes
    // back to describing a conversation, the feature has been lost.
    expect(DIALOG).toMatch(/put this\s*\n?\s*course forward for it/)
    expect(DIALOG, 'the panel the copy points at must exist')
      .toContain('Put it forward as the company standard')
    expect(DIALOG, 'and it must actually submit')
      .toMatch(/otterFetch\('\/api\/otter\/nominations'/)
  })

  it('does not tell a non-admin the standard tier is reachable "from here"', () => {
    // After a successful share, onCourseChanged flips `current` to 'shared', so
    // the panel ("ask an admin") and the green notice are on screen together.
    // An unguarded "an admin can make it the company standard from here" told
    // the user to go and ask someone and that the action was right there.
    expect(DIALOG, '"from here" must be inside the admin branch')
      .toMatch(/role === 'admin'[\s\S]{0,140}from here/)
    // And the non-admin arm must point at the submit panel rather than at a
    // conversation. Telling someone to "ask an admin" in the same dialog that
    // offers them a Put it forward button hands them the pre-0064 workaround
    // and the 0064 feature side by side.
    expect(DIALOG, 'the non-admin notice must point at the panel, not at a person')
      .toContain('put it forward below')
    expect(DIALOG, 'and must not send them off to ask someone instead')
      .not.toContain('ask one to make it the company standard')
  })

  it('does not weaken selectableVisibilities to fake a submit path', () => {
    // Guard-function rule: the fix must not hand non-admins a tier the database
    // will silently revert. fn_otter_pin_course_identity never raises — it
    // assigns the old value back — so a client-side loosening would read as a
    // successful submit and change nothing.
    const sharing = stripComments(read('./otterSharing.js'))
    expect(sharing).toMatch(/return isAdmin \? VISIBILITY_ORDER : \['personal', 'shared'\]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the nomination flow has callers end to end', () => {
  // 🚨 NINE FEATURES IN THIS REPO HAVE SHIPPED COMPLETE WITH NO CALLER — the
  // folder tree, task templates, quiz history, setOtterAdapterMode,
  // workspaces.storage_mode, POST /api/pet/reset, S31's settings half,
  // storageSecretClear, and the ShareCourseDialog opener the Phase 5 brief
  // wrongly accused. Migration 0064 adds a table, an RPC and four adapter ops;
  // this walks the chain from SQL to the button, so none of them can end up
  // being the tenth.
  const ADAPTER = stripComments(read('../adapters/supabaseOtterAdapter.js'))
  const ROUTES  = stripComments(read('../adapters/otterRoutes.js'))
  const VIEW    = stripComments(read('./RequestsView.jsx'))
  const MIGRATION = read('../../../../supabase/migrations/0064_otter_course_nominations.sql')

  const OPS = ['nomination.list', 'nomination.create', 'nomination.update', 'nomination.approve']

  it('every adapter op is reachable through a route', () => {
    for (const op of OPS) {
      expect(ADAPTER, `${op} must be implemented`).toContain(`async '${op}'`)
      expect(ROUTES, `${op} must be routable`).toContain(`op: '${op}'`)
    }
  })

  it('every nomination route is cloudOnly', () => {
    // There is no local-server nominations table, and an unmatched GET under
    // /api/ returns 200 with index.html from the SPA catch-all — so a missing
    // cloudOnly turns "signed out" into "you have no nominations".
    const block = ROUTES.slice(ROUTES.indexOf("seg[0] === 'nominations'"))
    const decls = block.slice(0, block.indexOf('return null\n    }'))
    const ops = decls.match(/op: 'nomination\.[a-z]+'/g) ?? []
    expect(ops.length, 'expected four nomination routes').toBe(4)
    expect((decls.match(/cloudOnly: true/g) ?? []).length,
      'every nomination route must be cloudOnly').toBe(ops.length)
  })

  it('the proposer can actually submit, and the approver can actually approve', () => {
    expect(DIALOG, 'ShareCourseDialog must POST a nomination')
      .toMatch(/otterFetch\('\/api\/otter\/nominations', \{\s*\n?\s*method: 'POST'/)
    expect(VIEW, 'RequestsView must call the approve route')
      .toMatch(/nominations\/\$\{n\.id\}\/approve`, \{ method: 'POST' \}/)
    expect(VIEW, 'RequestsView must be able to decline with a note')
      .toContain("status: 'changes_requested'")
  })

  it('approval is the RPC, never a bare status flip', () => {
    // fn_otter_pin_course_identity reverts a manager's visibility change
    // SILENTLY. An approve implemented as a PATCH would record an approval
    // whose course never moved.
    expect(ADAPTER).toContain('otter_nomination_apply')
    expect(ADAPTER, 'approve must not PATCH the status')
      .not.toMatch(/nomination\.approve'[\s\S]{0,400}status: 'approved'/)
  })

  it('managers decide nominations and still cannot decide change requests', () => {
    // The whole point of 0064, and the thing pgTAP 32 breaks on if it leaks.
    expect(VIEW).toMatch(/role === 'admin' \|\| role === 'manager'/)
    // The DECIDE gate is otter_nom_update's WITH CHECK, not its USING clause and
    // not the SELECT policy: USING only says who may touch the row, and a
    // manager arm present ONLY in otter_nom_select would let managers read the
    // queue and decide nothing — which is exactly 0026's behaviour, i.e. the
    // thing 0064 exists to change. Scoping the assertion to the WITH CHECK is
    // what makes it able to fail.
    const upd = MIGRATION.slice(MIGRATION.indexOf('CREATE POLICY otter_nom_update'))
    const withCheck = upd.slice(upd.indexOf('WITH CHECK'), upd.indexOf('-- ── 5.'))
    expect(withCheck, 'managers must be able to DECIDE, not merely see')
      .toMatch(/current_app_role\(\) IN \('admin', 'manager'\)/)
    expect(MIGRATION, 'the migration must assert it did not leak into otter_cr_update')
      .toContain('nomination work leaked a manager arm into otter_cr_update')
  })

  it('the table defaults the columns the client never sends', () => {
    // The client inserts { course_id, summary } only. Without these DEFAULTs
    // every real submit dies on NOT NULL — and a pgTAP suite that supplies
    // them explicitly stays green over it. That gap was live until the adapter
    // was written.
    expect(MIGRATION).toMatch(/workspace_id\s+UUID NOT NULL DEFAULT public\.current_workspace_id\(\)/)
    expect(MIGRATION).toMatch(/proposed_by\s+UUID NOT NULL DEFAULT auth\.uid\(\)/)
    expect(ADAPTER, 'the adapter must send neither')
      .toMatch(/\.insert\(\{ course_id: body\.course_id, summary \}\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the defects the nomination review found stay fixed', () => {
  // Fifteen findings, eight distinct defects, every one introduced by the first
  // draft of this client half and every one invisible to a passing build.
  const VIEW  = stripComments(read('./RequestsView.jsx'))
  const OTTER = stripComments(read('../Otter.jsx'))

  it('Refresh refreshes BOTH lists', () => {
    // It was wired to `load` alone, which fetches only change requests — while
    // new copy told the user to press it to re-check a nomination.
    expect(VIEW).toMatch(/const refreshAll = useCallback\(\(\) => \{ load\(\); loadNoms\(\) \}/)
    expect(VIEW).toContain('onClick={refreshAll}')
  })

  it('a submit from the share dialog reaches an already-open queue', () => {
    // The sidebar renders outside the view switch, so ShareCourseDialog can be
    // opened while RequestsView is mounted behind it.
    expect(OTTER).toMatch(/setShareDialogCourse\(null\); setRequestsRefreshTick\(t => t \+ 1\)/)
  })

  it('jumping to a nominated course probes readability first', () => {
    // selectSoftware caches whatever comes back with no ok-check, so an
    // unreadable id poisons softwareCacheRef for the rest of the session.
    expect(VIEW).toMatch(/const openNominatedCourse = useCallback/)
    expect(VIEW).toMatch(/openNominatedCourse\(n\)/)
    expect(VIEW, 'the raw jump must be gone')
      .not.toMatch(/onClick=\{\(\) => onOpenCourse\?\.\(n\.course_id\)\}/)
  })

  it('promotion invalidates the course list it just changed', () => {
    // Two courses change tier; every badge and capability flag is stale.
    expect(VIEW).toContain('onCoursesChanged?.()')
    expect(OTTER).toMatch(/onCoursesChanged=\{\(\) => \{ invalidateCache\(\); loadSoftwareList\(\); \}\}/)
  })

  it('the "stood down" name is read from the SETTLED row', () => {
    // superseded_course_id is written BY the RPC, so the row captured before
    // the click never carries it and that whole clause was dead code.
    expect(VIEW).toMatch(/const settled = fresh\?\.find\(x => x\.id === n\.id\)/)
    expect(VIEW).toMatch(/superseded: settled\?\.superseded_name \?\? null/)
  })

  it('settled nominations are bucketed by liveness, not by ownership', () => {
    // Ownership-first left the caller's own approved rows in the live list,
    // offering edits the trigger refuses on a course that is now the standard.
    expect(VIEW).toMatch(/if \(!live\) h\.push\(n\)\s*\n\s*else if \(n\.proposed_by === userId\) m\.push\(n\)/)
  })

  it('an open nomination stays withdrawable after the course becomes the standard', () => {
    expect(DIALOG).toMatch(/\(current !== 'company_standard' \|\| !!nom\) && course\?\.is_own !== false/)
  })

  it('a nominations failure cannot masquerade as a change-request failure', () => {
    // Sharing `error` also gated `{promoted && !error}`, so a failed refresh
    // AFTER a committed promotion showed no confirmation at all — and a retry
    // hits "nomination is approved — only an open nomination can be approved".
    expect(VIEW).toContain('const [nomError, setNomError] = useState(null)')
    expect(VIEW).toMatch(/\{promoted && !nomError &&/)
    expect(VIEW, 'the nomination paths must not write the shared error')
      .not.toMatch(/setNomBusy\(true\); setError\(null\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('a refused or failed submission surfaces a real error', () => {
  it('never lets res.json() pre-empt the status check', () => {
    // Every call was `await res.json()` THEN `if (!res.ok)`. otterFetch
    // resolves for every status, so on a non-JSON body (the local server's HTML
    // 404) json() throws first and the authored message is replaced by
    // `Unexpected token '<', "<!DOCTYPE "...`.
    expect(DIALOG, 'read bodies through readBody(), not res.json()').not.toContain('await res.json()')
    // Counted against the fetches rather than pinned to a number: this file has
    // gained four more call sites since the rule was written, and a magic
    // constant would have to be edited every time — which is how it ends up
    // being "fixed" by lowering it. The invariant is that EVERY response body
    // is read defensively, so the two counts must match.
    const fetches = (DIALOG.match(/await otterFetch\(/g) ?? []).length
    const guarded = (DIALOG.match(/await readBody\(res\)/g) ?? []).length
    expect(fetches, 'the dialog must still be making requests').toBeGreaterThan(3)
    expect(guarded, 'every otterFetch response must be read through readBody').toBe(fetches)
  })

  it('treats a 200 with no readable row as a failure, not a silent success', () => {
    // Without this, `row.visibility !== next` compares undefined and renders
    // the "that change wasn't allowed" message for what may have been a
    // transport fault.
    expect(DIALOG).toMatch(/if \(!row\?\.slug\) throw new Error/)
  })

  it('still re-reads the returned row rather than trusting what it sent', () => {
    expect(DIALOG).toMatch(/if \(row\.visibility !== next\)/)
  })
})
