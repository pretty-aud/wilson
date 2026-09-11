// =============================================================================
// pageBars.test.js — Phase 4.
//
// Guards the three properties the bar geometry is load-bearing for. All three
// fail SILENTLY: the app renders, nothing throws, no other test notices, and
// the damage is only visible on a screen the developer is not sitting at.
//
//   1. A bar never exceeds its resting height, so a tall display is unchanged.
//      This rests entirely on `min` being the OUTERMOST function; written the
//      other way round the floor wins and the tool pages' 8px bottom bar takes
//      the floor's value instead. Both orders read as "clamp between floor and
//      cap" to a reviewer, and they differ only when floor > cap — which is
//      the normal case for that 8px bar.
//   2. A bar never GROWS as the viewport shrinks.
//   3. AuthShell's reveal and Home's resting bars are ONE value. If they drift
//      the bars jump at the instant the user arrives after signing in.
//
// 🚨 These assertions EVALUATE the generated expression, they do not pattern
// -match its text. A regex over `min(268px, max(…))` passes just as happily
// when the arithmetic inside it is wrong, which is no guard at all. The
// evaluator below is checked against the browser's own resolution of the same
// strings (see the Phase 4 measurements) and every case here carries a
// deliberate failing control in `evaluator rejects` so the harness itself
// cannot quietly stop testing anything.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { PAGE_BARS, HOME_BAR_HEIGHT, PAGES, PAGE_TITLES } from './pages'
import { bars } from './pageBars'   // the D1b controls build a rival shape through the real generator

// Resolve `min(Apx, max(Bpx, (100vh - Cpx) * S))` at a given viewport height.
// Deliberately strict: an expression it does not recognise throws rather than
// silently resolving to something plausible.
function resolveAt(expr, viewportPx) {
  const m = /^min\((-?[\d.]+)px, max\((-?[\d.]+)px, \(100vh - ([\d.]+)px\) \* ([\d.]+)\)\)$/
    .exec(expr)
  if (!m) throw new Error(`unrecognised bar expression: ${expr}`)
  const [, cap, floor, reserve, share] = m.map(Number)
  return Math.min(cap, Math.max(floor, (viewportPx - reserve) * share))
}

// 700 is Electron's minWindow; 1440 is comfortably past any laptop.
const VIEWPORTS = [700, 800, 845, 860, 900, 956, 982, 1034, 1076, 1200, 1330, 1440]

// The resting heights the pixel table used before Phase 4 — the contract with
// every tall display, restated here so a change to the source table has to be
// a deliberate change to this list too.
const RESTING = {
  home: [268, 268],
  dog: [95, 8], otter: [95, 8], rabbit: [95, 8],
  // Q8(b) / W10 (UI overhaul D1b, 2026-09-11): the three resource-class rows
  // no lane owns are 120/80 — Settings and Help (light) and Team Members
  // (dark since F2). The five lane-C rows stay 200/150 until each page's own
  // conversion commit moves it (W10: "lane C sets its own pages' rows"), so
  // this list is deliberately split for now; Help was the 140/100 outlier.
  settings: [120, 80], 'team-members': [120, 80], help: [120, 80],
  'project-manager': [200, 150], 'rate-card': [200, 150], 'project-files': [200, 150],
  dashboard: [200, 150], 'admin-terminal': [200, 150],
}

describe('page bar geometry', () => {
  it('covers every page, and every page in the table is asserted here', () => {
    expect(Object.keys(PAGE_BARS).sort()).toEqual(Object.keys(RESTING).sort())
  })

  // 🚨 F2 replaced this test's MECHANISM, not its subject. It used to read
  // App.jsx as text and scrape PAGE_TITLES out of it, because the two lists
  // were genuinely separate and could genuinely disagree — which is how
  // 'project-files' came to sit in three of the four lists (review F-R04 /
  // F32). They are one list now, so the scrape is gone and the property is
  // asserted where it lives. The control the scrape needed moved with it:
  // `pages.test.js` proves a page with no geometry THROWS at module load.
  it('covers every page the shell can show (the Files-page bug, F-R04, cannot recur)', () => {
    const ids = PAGES.map((p) => p.id)
    expect(ids.length).toBeGreaterThanOrEqual(12)
    expect(ids).toContain('project-files')
    for (const id of ids) {
      expect(PAGE_BARS[id], `PAGE_BARS is missing '${id}'`).toBeDefined()
      expect(PAGE_TITLES[id], `PAGE_TITLES is missing '${id}'`).toBeTruthy()
    }
    // Both derived tables ARE the registry — not a superset kept beside it.
    expect(Object.keys(PAGE_BARS)).toEqual(ids)
    expect(Object.keys(PAGE_TITLES)).toEqual(ids)
    // The control: a page that is not in the table is caught, not defaulted.
    expect(PAGE_BARS['not-a-page']).toBeUndefined()
  })

  it('the Files page takes the resource-class geometry (Q8a), not Home\'s', () => {
    // Its twin is another lane-C row (Projects), not Settings: since D1b the
    // light reading pages sit at 120/80 and Files waits for lane C (W10).
    for (const v of VIEWPORTS) {
      expect(resolveAt(PAGE_BARS['project-files'].top, v)).toBe(resolveAt(PAGE_BARS['project-manager'].top, v))
      expect(resolveAt(PAGE_BARS['project-files'].bottom, v)).toBe(resolveAt(PAGE_BARS['project-manager'].bottom, v))
    }
    // At rest it returns ~186px of field to the densest table (268+268 vs 200+150).
    const rest = (page) => resolveAt(PAGE_BARS[page].top, 1440) + resolveAt(PAGE_BARS[page].bottom, 1440)
    expect(rest('home') - rest('project-files')).toBeCloseTo(186, 5)
  })

  it('never exceeds the resting height, at any viewport', () => {
    for (const [page, [top, bottom]] of Object.entries(RESTING)) {
      for (const v of VIEWPORTS) {
        expect(resolveAt(PAGE_BARS[page].top, v),
          `${page}.top at ${v}px`).toBeLessThanOrEqual(top + 0.01)
        expect(resolveAt(PAGE_BARS[page].bottom, v),
          `${page}.bottom at ${v}px`).toBeLessThanOrEqual(bottom + 0.01)
      }
    }
  })

  it('resolves to EXACTLY the resting height on a tall display', () => {
    for (const [page, [top, bottom]] of Object.entries(RESTING)) {
      expect(resolveAt(PAGE_BARS[page].top, 1440), `${page}.top`).toBeCloseTo(top, 5)
      expect(resolveAt(PAGE_BARS[page].bottom, 1440), `${page}.bottom`).toBeCloseTo(bottom, 5)
    }
  })

  // 🚨 The 8px trap. A flat `max(120px, …)` floor — the obvious way to write
  // this — makes the tool pages' bottom bar 120px on a short screen.
  it('never grows a bar as the viewport shrinks', () => {
    for (const page of Object.keys(RESTING)) {
      for (const edge of ['top', 'bottom']) {
        const expr = PAGE_BARS[page][edge]
        for (let i = 1; i < VIEWPORTS.length; i++) {
          const shorter = resolveAt(expr, VIEWPORTS[i - 1])
          const taller = resolveAt(expr, VIEWPORTS[i])
          expect(shorter, `${page}.${edge}: ${VIEWPORTS[i - 1]}px vs ${VIEWPORTS[i]}px`)
            .toBeLessThanOrEqual(taller + 0.01)
        }
      }
    }
  })

  it('keeps the tool pages\' 8px bottom bar at 8px on every real window size', () => {
    for (const page of ['dog', 'otter', 'rabbit']) {
      for (const v of VIEWPORTS) {
        expect(resolveAt(PAGE_BARS[page].bottom, v), `${page} at ${v}px`).toBeCloseTo(8, 5)
      }
    }
  })

  // Home's six page selections measure 444px in the running app (button stack
  // only); the content wrapper adds 3vh top and bottom.
  it('leaves room for all six of Home\'s page selections on a 14-inch Mac', () => {
    const HOME_STACK_PX = 444
    for (const v of [845, 860, 900, 956, 982]) {
      const content = v - resolveAt(PAGE_BARS.home.top, v) - resolveAt(PAGE_BARS.home.bottom, v)
      expect(content, `content region at ${v}px`).toBeGreaterThanOrEqual(HOME_STACK_PX + 0.06 * v)
    }
  })

  it('keeps an asymmetric row in proportion all the way down', () => {
    // Both shapes in the table: the 3:2 light row (D1b) and the 4:3 lane-C row.
    for (const [page, ratio] of [['settings', 120 / 80], ['project-manager', 200 / 150]]) {
      for (const v of VIEWPORTS) {
        const top = resolveAt(PAGE_BARS[page].top, v)
        const bottom = resolveAt(PAGE_BARS[page].bottom, v)
        expect(top / bottom, `${page} ratio at ${v}px`).toBeCloseTo(ratio, 3)
      }
    }
  })

  // Q8(b) / W10 (UI overhaul D1b, 2026-09-11): the three resource-class rows
  // no lane owns — Settings and Help (light) and Team Members (dark since F2;
  // the surface has nothing to do with it). Numbers, not adjectives — each
  // one is what the browser resolves, and review round 1 measured every one
  // of them live in Chromium.
  describe('the three rows no lane owns are 120/80 (Q8b / W10, D1b)', () => {
    const NO_LANE = ['settings', 'help', 'team-members']
    const restAt = (page, v) => resolveAt(PAGE_BARS[page].top, v) + resolveAt(PAGE_BARS[page].bottom, v)

    it('Settings, Help and Team Members share ONE geometry: 120 over 80 at rest', () => {
      for (const page of NO_LANE.filter((p) => p !== 'settings')) {
        expect(PAGE_BARS[page].top, `${page}.top`).toBe(PAGE_BARS.settings.top)
        expect(PAGE_BARS[page].bottom, `${page}.bottom`).toBe(PAGE_BARS.settings.bottom)
      }
      for (const page of NO_LANE) {
        expect(resolveAt(PAGE_BARS[page].top, 1440), `${page}.top`).toBeCloseTo(120, 5)
        expect(resolveAt(PAGE_BARS[page].bottom, 1440), `${page}.bottom`).toBeCloseTo(80, 5)
      }
    })

    // The gain depends on the window: the 200/150 row only reaches its caps
    // from 891px tall (the knee is 540 + 200 / 0.5714 = 890.02), Home from
    // 1076px. So the headline "150px" is true on a 900px-tall Electron window
    // (a 14-inch Air) and above; in a browser on the same machine (~860px) it
    // is 120px; at the 700px minimum both shapes are floored by the same
    // budget and the gain is 0. "336px against Home" holds from 1076px up.
    it('returns 150px of field against the 200/150 class from 891px tall, 120px at 860, 0 at 700', () => {
      expect(restAt('project-manager', 1440) - restAt('settings', 1440)).toBeCloseTo(150, 5)
      expect(restAt('project-manager', 900) - restAt('settings', 900)).toBeCloseTo(150, 5)
      expect(restAt('project-manager', 860) - restAt('settings', 860)).toBeCloseTo(120, 2)
      expect(restAt('project-manager', 700) - restAt('settings', 700)).toBeCloseTo(0, 2)
      // Against Home: 336px on a display tall enough for Home's caps, 160px
      // at 900 where Home itself resolves to 180/180.
      expect(restAt('home', 1440) - restAt('settings', 1440)).toBeCloseTo(336, 5)
      expect(restAt('home', 900) - restAt('settings', 900)).toBeCloseTo(160, 5)
      // Help was the 140/100 outlier (D2 hand-off §6); it gains 40px at rest.
      expect(140 + 100 - restAt('help', 1440)).toBeCloseTo(40, 5)
    })

    // The cap wins from 740px of viewport up (540 reserve + 120 / 0.6 share),
    // which is every laptop; at Electron's 700px minimum the row gives way in
    // proportion, 96 over 64, still 3:2 and still above its 54 / 36 floors.
    it('holds 120/80 from the 740px knee up and collapses to 96/64 at the 700px minimum', () => {
      for (const page of NO_LANE) {
        for (const v of [...VIEWPORTS.filter((x) => x >= 740), 740]) {
          expect(resolveAt(PAGE_BARS[page].top, v), `${page}.top at ${v}px`).toBeCloseTo(120, 5)
          expect(resolveAt(PAGE_BARS[page].bottom, v), `${page}.bottom at ${v}px`).toBeCloseTo(80, 5)
        }
        // One pixel under the knee the cap has not yet won.
        expect(resolveAt(PAGE_BARS[page].top, 739), `${page}.top at 739px`).toBeCloseTo(119.4, 1)
        expect(resolveAt(PAGE_BARS[page].top, 700), `${page}.top at 700px`).toBeCloseTo(96, 5)
        expect(resolveAt(PAGE_BARS[page].bottom, 700), `${page}.bottom at 700px`).toBeCloseTo(64, 5)
      }
    })

    it('Home stays 268/268 (W10: not a resource page) and the lane-C rows stay 200/150 until lane C', () => {
      expect(resolveAt(PAGE_BARS.home.top, 1440)).toBeCloseTo(268, 5)
      expect(resolveAt(PAGE_BARS.home.bottom, 1440)).toBeCloseTo(268, 5)
      for (const page of ['project-manager', 'rate-card', 'project-files', 'dashboard', 'admin-terminal']) {
        expect(resolveAt(PAGE_BARS[page].top, 1440), `${page}.top`).toBeCloseTo(200, 5)
        expect(resolveAt(PAGE_BARS[page].bottom, 1440), `${page}.bottom`).toBeCloseTo(150, 5)
      }
    })

    // CONTROLS. (a) The three rows really are NOT the 200/150 shape any more:
    // the rival shape built through the real generator must differ from the
    // table's own strings, so a stale table (the mutant that puts 200/150
    // back on all three rows) goes red here on its own, not only through the
    // numeric cases above (review round 2's matrix). (b) The floor is real,
    // not decorative: one viewport below the knee where the share alone would
    // give 48px and the 54px floor (0.45 × 120) is what resolves instead —
    // the case review round 1 found the previous control could not see (a
    // floor ratio up to 0.8 passed unnoticed).
    it('controls: the table is not the 200/150 shape, and the 54px floor beats the share below the knee', () => {
      for (const page of NO_LANE) {
        expect(PAGE_BARS[page].top, `${page}.top`).not.toBe(bars(200, 150).top)
        expect(PAGE_BARS[page].bottom, `${page}.bottom`).not.toBe(bars(200, 150).bottom)
      }
      expect((620 - 540) * 0.6).toBeCloseTo(48, 5)
      expect(resolveAt(bars(120, 80).top, 620)).toBeCloseTo(54, 5)
      expect(resolveAt(bars(120, 80).bottom, 620)).toBeCloseTo(36, 5)
    })
  })

  // The sign-in seam. Identity, not equality of two literals.
  it('gives AuthShell\'s reveal the same value Home rests at', () => {
    expect(HOME_BAR_HEIGHT).toBe(PAGE_BARS.home.top)
    expect(HOME_BAR_HEIGHT).toBe(PAGE_BARS.home.bottom)
    for (const v of VIEWPORTS) {
      expect(resolveAt(HOME_BAR_HEIGHT, v)).toBe(resolveAt(PAGE_BARS.home.top, v))
    }
  })

  // CONTROLS — each builds the mistake the matching assertion above exists to
  // catch and shows it really does violate the property. Without these, every
  // assertion above could be passing because the property is unfalsifiable.
  describe('controls: these really do break', () => {
    // 🚨 THE ORDER CONTROL. `max(floor, min(cap, x))` instead of
    // `min(cap, max(floor, x))` — the swap a tidying refactor makes, and the
    // one that resolves the 8px bottom bar to the floor on every short screen.
    it('swapping min/max order breaks the cap on the 8px bar', () => {
      const cap = 8, floor = 3.6, share = 0.0777, reserve = 540
      const budget = (v) => (v - reserve) * share
      const ours = (v) => Math.min(cap, Math.max(floor, budget(v)))
      const swapped = (v) => Math.max(floor, Math.min(cap, budget(v)))
      // Identical wherever the floor sits below the cap…
      expect(ours(900)).toBeCloseTo(swapped(900), 5)
      // …but with a floor ABOVE the cap the two orders disagree, and only
      // ours still honours the cap.
      const bigFloor = 120
      expect(Math.min(cap, Math.max(bigFloor, budget(700)))).toBeCloseTo(8, 5)
      expect(Math.max(bigFloor, Math.min(cap, budget(700)))).toBe(120)
    })

    it('a negative share grows the bar as the viewport shrinks', () => {
      // Slope inverted: the budget grows as the window shrinks.
      const inverted = (v) => Math.min(268, Math.max(0, (1200 - v) * 0.5))
      expect(inverted(700)).toBeGreaterThan(inverted(1440))
      // …and the real expression does not.
      expect(resolveAt(PAGE_BARS.home.top, 700))
        .toBeLessThanOrEqual(resolveAt(PAGE_BARS.home.top, 1440))
    })

    it('a reserve too small for Home\'s six selections', () => {
      const stingy = 'min(268px, max(120.60px, (100vh - 200px) * 0.5))'
      const content = 900 - 2 * resolveAt(stingy, 900)
      expect(content).toBeLessThan(444 + 0.06 * 900)
      // …and the real one clears it.
      const real = 900 - 2 * resolveAt(PAGE_BARS.home.top, 900)
      expect(real).toBeGreaterThanOrEqual(444 + 0.06 * 900)
    })

    it('the evaluator refuses an expression it does not understand', () => {
      expect(() => resolveAt('268px', 900)).toThrow(/unrecognised/)
      expect(() => resolveAt('calc(50vh - 20px)', 900)).toThrow(/unrecognised/)
    })
  })
})
