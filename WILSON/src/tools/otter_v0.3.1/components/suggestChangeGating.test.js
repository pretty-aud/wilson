// =============================================================================
// suggestChangeGating.test.js — 2026-08-13.
//
// 🚨 THIS SUITE EXISTS BECAUSE A CONTROL WAS OFFERED THAT COULD NOT SUCCEED.
//
// `CourseRowMenu`'s `maySuggest` gated on `!!course?.source_course_id` alone —
// "this course is a fork" — and never re-checked that the course it was forked
// FROM is still the company standard. otter_cr_insert (0025) requires
// `otter_course_visibility(target_course_id) = 'company_standard'` at INSERT
// time, so once a standard was demoted every existing fork kept showing
// "Suggest a change…", ChangeRequestDialog rendered its whole submit form, the
// user wrote a summary, and only the POST failed — at RLS, with "Change
// requests can only be raised against a company standard course."
//
// It was filed as a corner case (an admin using ShareCourseDialog's confirmDrop
// by hand). Migration 0064 turned it into the happy path: approving ANY
// nomination demotes the incumbent standard, so every fork of the outgoing
// standard acquires the dead end the moment a nomination is approved.
//
// ── WHAT THIS SUITE CANNOT DO ────────────────────────────────────────────────
// vitest.config.js pins `environment: 'node'` and the tree carries no jsdom and
// no @testing-library, so nothing here mounts a component. validatorSave.test.js
// measured what that costs: it wrapped a banner in `{false && …}` and all 17 of
// its assertions stayed green. Every line below is a SOURCE SCAN. It proves the
// gate is written and wired; it cannot prove the item disappears on Audrey's
// screen. Only her test plan can.
//
// The entry in docs/OUTSTANDING.md is marked "MEASURED at code level; NOT
// observed at runtime", and that is still true of the fix as well as the defect.
//
// ── WHY EVERY SCAN RUNS ON COMMENT-STRIPPED SOURCE ───────────────────────────
// The fix documents itself in comments that QUOTE the thing they removed and
// name the SQL they mirror ("gated on `!!course?.source_course_id`",
// "otter_cr_insert"). A raw `not.toMatch` would match its own explanation. The
// house rule is to assert the EXECUTABLE form; `stripComments` is the
// instrument, lifted verbatim from shareDiscoverability.test.js, and the first
// describe block proves it works before anything relies on it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(here(rel), 'utf8')

/**
 * Drop whole-line comments: `//`, block comments, and JSX `{/* … *\/}`.
 *
 * LINE-ANCHORED ON PURPOSE — see the long note in shareDiscoverability.test.js.
 * A character-wise scanner has to decide whether `/` is division, a regex, JSX
 * `/>` or JSX `</`, and a single regex literal holding an apostrophe flips its
 * quote parity for the rest of the file, after which it silently eats live code
 * and every downstream assertion passes because the code is GONE.
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
const CRD_RAW    = read('./ChangeRequestDialog.jsx')
const OTTER_RAW  = read('../Otter.jsx')

const MENU  = stripComments(MENU_RAW)
const CRD   = stripComments(CRD_RAW)
const OTTER = stripComments(OTTER_RAW)

/**
 * The full `<CourseRowMenu … />` tag text at each render site, executable form.
 * Slicing to the closing `/>` is what lets a per-site assertion fail when ONE
 * of the three is missed — a whole-file `toContain` cannot tell three sites
 * from one.
 */
function menuSites(src = OTTER) {
  const sites = []
  let from = 0
  for (;;) {
    const at = src.indexOf('<CourseRowMenu', from)
    if (at === -1) break
    const end = src.indexOf('/>', at)
    // null rather than a fixed-size window: a fallback slice would be a
    // plausible-looking string that the per-site assertions could still pass
    // against. The instrument block asserts none of these are null.
    sites.push(end === -1 ? null : src.slice(at, end))
    from = at + 1
  }
  return sites
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the instrument works', () => {
  // Without these, every `not.toMatch` below would pass vacuously — on an empty
  // string, on a file that moved, or on source whose comments were never
  // stripped. Each pair asserts one executable anchor SURVIVED stripping and one
  // comment-only phrase DID NOT.

  it('strips comments without eating code — CourseRowMenu', () => {
    expect(MENU, 'the gate is executable and must survive').toContain('const maySuggest')
    expect(MENU_RAW, 'the SQL citation is comment-only, so it must exist before stripping')
      .toContain('otter_cr_insert')
    expect(MENU, 'comments were not stripped').not.toContain('otter_cr_insert')
  })

  it('strips comments without eating code — ChangeRequestDialog', () => {
    expect(CRD, 'the gate is executable and must survive').toContain('const canPropose')
    expect(CRD_RAW).toContain('Zeigarnik')
    expect(CRD, 'comments were not stripped').not.toContain('Zeigarnik')
  })

  it('strips comments without eating code — Otter.jsx', () => {
    expect(OTTER).toContain('<CourseRowMenu')
    expect(OTTER_RAW).toContain('PHASE 5')
    expect(OTTER, 'comments were not stripped').not.toContain('PHASE 5')
  })

  it('does not silently eat code mid-file', () => {
    // stripComments is a hand-rolled scanner over a 5,000-line JSX file. If it
    // desyncs it can swallow the region it desyncs through, and every assertion
    // downstream would pass because the code is GONE rather than because it is
    // right. Counting anchors in raw vs stripped catches exactly that.
    const count = (s, t) => (s.match(new RegExp(t, 'g')) ?? []).length
    expect(count(OTTER, '<CourseRowMenu'), 'stripping lost a render site')
      .toBe(count(OTTER_RAW, '<CourseRowMenu'))
    expect(count(OTTER, 'sourceCourseOf\\('), 'stripping lost a source lookup')
      .toBe(count(OTTER_RAW, 'sourceCourseOf\\('))
    // `canPropose &&`, not bare `canPropose`: the footer's own comment quotes
    // the gate ("`canPropose || existing`, not `targetId`"), so a bare count is
    // legitimately one lower after stripping and the assertion would fail on a
    // correct file. The `&&` form appears only in executable positions.
    expect(count(CRD, 'canPropose &&'), 'stripping lost a dialog gate')
      .toBe(count(CRD_RAW, 'canPropose &&'))
  })

  it('finds all three CourseRowMenu render sites', () => {
    const sites = menuSites()
    expect(sites.length, 'expected three CourseRowMenu render sites').toBe(3)
    sites.forEach((site, i) => {
      expect(site, `CourseRowMenu site ${i + 1} has no closing />`).not.toBeNull()
      expect(site, 'a site slice must be real tag text').toContain('role={appRole}')
      // A slice that overran its own tag would swallow the next one, and a
      // per-site assertion could then pass on its neighbour's props.
      expect(site.slice(1).includes('<CourseRowMenu'),
        `CourseRowMenu site ${i + 1} ran into the next tag`).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the menu item is gated on the SOURCE still being the standard', () => {
  it('maySuggest ANDs in sourceIsStandard', () => {
    // The whole defect in one line. `!!course?.source_course_id` means "is a
    // fork", which is not the same claim as "its source is still a standard".
    expect(MENU, 'maySuggest must re-check the source tier').toMatch(
      /const maySuggest = !!course\?\.source_course_id && sourceIsStandard && canReadCourse\(course\)/)
  })

  it('the prop fails CLOSED when a render site forgets it', () => {
    // A fourth render site that omits the prop must lose the item, not restore
    // the dead end. `= true` would make every future site buggy by default.
    expect(MENU).toMatch(/sourceIsStandard = false/)
    expect(MENU, 'the prop must not default to true').not.toMatch(/sourceIsStandard = true/)
  })

  it('every CourseRowMenu render site passes it', () => {
    const sites = menuSites()
    expect(sites.length, 'expected three CourseRowMenu render sites').toBe(3)
    sites.forEach((site, i) => {
      expect(site, `CourseRowMenu site ${i + 1} does not pass sourceIsStandard`)
        .toContain('sourceIsStandard=')
    })
  })

  it('resolves the tier rather than merely finding the row', () => {
    // `sourceIsStandard={!!sourceCourseOf(sw)}` would be the tempting shortcut
    // and it is WRONG: a demoted standard is still in softwareList (it is
    // `shared` or `personal` now, and handleCourseChanged merges the new tier
    // into the row in place). Presence proves readability, not tier.
    const values = [...OTTER.matchAll(/sourceIsStandard=\{([^}]*)\}/g)].map(m => m[1])
    expect(values.length, 'expected four sourceIsStandard props — three menus and the dialog')
      .toBe(4)
    for (const v of values) {
      expect(v, `sourceIsStandard={${v}} does not check the tier`)
        .toContain("=== 'company_standard'")
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the source is looked up once, in one place', () => {
  it('Otter.jsx reads source_course_id only inside the shared resolver', () => {
    // House rule: the dialog title already did this lookup inline. A second copy
    // is a second thing to drift — the menu could gate on a rule the title
    // disagrees with. Counting occurrences is the wrong instrument (the resolver
    // legitimately names the field twice, once to guard and once to match); what
    // matters is that NONE of them are outside it.
    const at = OTTER.indexOf('const sourceCourseOf = useCallback(')
    expect(at, 'the shared resolver must exist').toBeGreaterThan(-1)
    const end = OTTER.indexOf('[softwareList],', at)
    expect(end, 'the resolver must have a dependency array').toBeGreaterThan(at)

    const inside = (OTTER.slice(at, end).match(/source_course_id/g) ?? []).length
    const total  = (OTTER.match(/source_course_id/g) ?? []).length
    expect(inside, 'the resolver must actually read source_course_id').toBeGreaterThan(0)
    expect(total, 'source_course_id is read outside sourceCourseOf — reuse the resolver')
      .toBe(inside)
  })

  it('the old inline lookup at the dialog mount is gone', () => {
    expect(OTTER, 'the dialog title must go through the shared resolver')
      .not.toMatch(/softwareList\.find\(sw => sw\.slug === crDialogCourse\.source_course_id\)/)
    expect(OTTER).toMatch(/standardName=\{sourceCourseOf\(crDialogCourse\)\?\.name \?\? null\}/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the dialog defends itself, because the menu is not its only door', () => {
  // RequestsView opens ChangeRequestDialog directly through Otter.jsx's
  // onOpenDialog — it does not go through CourseRowMenu at all. Gating only the
  // menu item would still leave a proposer able to reach the submit form from
  // their own queue after the standard was demoted mid-review.

  it('RequestsView can still open the dialog without the menu', () => {
    // If this ever stops being true the second gate is redundant rather than
    // wrong — but it should be a deliberate decision, not a silent drift.
    expect(OTTER).toMatch(/onOpenDialog=\{\(sourceSlug\) =>/)
    expect(OTTER).toMatch(/setCrDialogCourse\(course\)/)
  })

  it('the dialog mount passes the same resolved tier', () => {
    const at = OTTER.indexOf('<ChangeRequestDialog')
    expect(at, 'the dialog must be mounted').toBeGreaterThan(-1)
    const tag = OTTER.slice(at, OTTER.indexOf('/>', at))
    expect(tag, 'the dialog must decide for itself, not trust the menu')
      .toContain("sourceIsStandard={sourceCourseOf(crDialogCourse)?.visibility === 'company_standard'}")
  })

  it('canPropose requires a target AND a live standard', () => {
    expect(CRD).toMatch(/const canPropose = !!targetId && sourceIsStandard/)
  })

  it('the write half of the form is behind canPropose', () => {
    // STRUCTURAL, not textual. Asserting the textarea merely EXISTS passes just
    // as happily when it renders unconditionally — which is the bug. This pins
    // that the gate opens immediately before it.
    expect(CRD, 'the summary textarea must be inside a canPropose gate')
      .toMatch(/\{canPropose && \(\s*<>\s*<div>\s*<label[\s\S]{0,220}What did you change, and why\?/)
    expect(CRD, 'the submit button must be inside a canPropose gate')
      .toMatch(/\{canPropose && \(\s*<button\s+onClick=\{submit\}/)
  })

  it('does NOT strand a proposer who already has a request open', () => {
    // 🚨 THE ANTI-REGRESSION FOR THIS FIX'S OWN OBVIOUS OVER-CORRECTION.
    // Hiding the whole dialog behind canPropose would be the one-line version,
    // and it would trap anyone whose standard was demoted mid-review: their
    // request stays open with no way to withdraw it and no way to accept a
    // decline. otter_cr_update gates on WHO the caller is and never on the
    // target's visibility (0022 + 0025), so both of those writes still succeed
    // after a demotion — the UI must keep offering them.
    expect(CRD, 'the footer must survive a demotion when a request exists')
      .toMatch(/\{\(canPropose \|\| existing\) && !loading && \(/)
    expect(CRD, 'withdraw must not be gated on canPropose')
      .toMatch(/\{existing && !isDeclined && \(\s*<button\s+onClick=\{withdraw\}/)
    expect(CRD, 'accepting a decline must not be gated on canPropose')
      .toMatch(/\{isDeclined && \(\s*<button\s+onClick=\{acceptDecision\}/)
    expect(CRD, 'the request-state banners must still render after a demotion')
      .toMatch(/\{\(canPropose \|\| existing\) && \(/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the empty state explains which of the two nothings this is', () => {
  // Hiding the menu item removes the dead end but also removes the only place
  // the product explains the company library. The dialog is still reachable
  // from RequestsView, so the explanation lives here and now covers both cases.

  it('covers a demoted standard, not just a course that was never forked', () => {
    const at = CRD.indexOf('{!canPropose && (')
    expect(at, 'the empty state must be gated on canPropose, not targetId')
      .toBeGreaterThan(-1)

    // WHICH ARM the copy is in, not merely that both sentences exist somewhere.
    // Both stranded in an unreachable branch is exactly how validatorSave's 17
    // assertions survived `{false && …}`.
    const arm = CRD.indexOf('{!targetId ? (', at)
    expect(arm, 'the empty state must branch on targetId').toBeGreaterThan(-1)
    expect(arm - at, 'the branch must belong to THIS block').toBeLessThan(200)

    const block = CRD.slice(at, at + 1600)
    const split = block.indexOf(') : (')
    expect(split, 'the branch must have a real else arm').toBeGreaterThan(-1)

    expect(block.slice(0, split), 'the never-forked arm keeps its own sentence')
      .toMatch(/wasn&apos;t copied from a company standard/)
    expect(block.slice(split), 'the demoted arm must say what actually happened')
      .toMatch(/is no\s+longer the company standard/)
  })

  it('tells the user their own copy is untouched', () => {
    // The demotion happened to someone else's course. Without this the message
    // reads as "your work has been invalidated", which is not what occurred —
    // confirmDrop's own copy already promises "Existing copies are not affected".
    expect(CRD).toMatch(/copy is unaffected/)
  })

  it('does not promise a replacement standard that may not exist', () => {
    // confirmDrop demotes with no successor; an approved nomination installs
    // one. The copy must not assert the second case — "take a copy of the new
    // standard" is a dead end of its own when a course was simply stood down.
    const at = CRD.indexOf('{!canPropose && (')
    const block = CRD.slice(at, at + 1600)
    expect(block, 'the replacement must be conditional').toMatch(/If\s+another course has taken its place/)
  })
})
