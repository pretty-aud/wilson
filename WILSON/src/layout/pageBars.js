// =============================================================================
//  PAGE BAR GEOMETRY — the ONE definition of how tall the orange chrome is
// =============================================================================
//
// Phase 4, 2026-08-12 (Audrey, on a 14-inch MacBook Air):
//   "the light orange panel with the content is being hidden behind the orange
//    header and footer. i should be able to see all the page selections and not
//    need to scroll. please make sure the content is full viewable and make
//    sure to instead make the footer and header bars shorter."
//
// The table used to be flat pixels chosen on a tall Windows display. Home spent
// 536px of every viewport on chrome, and its six page selections need 444px of
// button stack plus the content wrapper's 3vh top/bottom padding:
//
//   6 buttons x 56px  =  336   (py-3 -> 24px + a 32px icon)
//   5 gaps    x 12px  =   60   (gap-3)
//   column py-6       =   48
//                        ----
//                        444px, plus 6vh of wrapper padding
//
// So Home only fits without scrolling at a viewport of ~1034px or taller. A
// 14-inch Air gives ~900px in the frameless Electron window and ~860px in a
// browser, which is why the ends of the list disappeared under the chrome
// there and nowhere else.
//
// ── The shape ────────────────────────────────────────────────────────────────
//
//   min(CAP, max(CAP * 0.45, (100vh - 540px) * SHARE))
//
// Read right to left: reserve 540px of the viewport for content, split whatever
// is left between the two bars in their original proportion, never exceed the
// original pixel value, and never collapse past 45% of it.
//
// Three properties matter, and each one is load-bearing:
//
//  1. THE CAP IS THE OLD NUMBER, so a tall display is byte-for-byte unchanged.
//     Home resolves to exactly 268px on any viewport >= 1076px.
//
//     ⚠️ It is NOT true that every other row is capped at every size the app
//     can be opened at, which this note used to say. Measured 2026-09-13
//     against the three rows that now exist (F4):
//
//       bars(268, 268)   Home (1 page)                          cap from 1076px
//       bars(120, 80)    the seven data and reading pages        cap from  740px
//       bars(95, 8)      the four tool pages, Files included     cap from  644px
//
//     Electron's minimum is 700px, so only the tool rows are genuinely at
//     their resting height at every window the app can open at. A 700-739px
//     window collapses the 120/80 rows as well, and Home moves anywhere
//     below 1076px. The 200/150 row this note was written against no longer
//     exists: Team Members was the last one and C3 moved it to 120/80.
//
//  2. THE ORDER IS min(cap, max(floor, …)), NOT max(floor, min(cap, …)).
//     🚨 The outermost function is the one that wins. With `min` outermost the
//     cap is absolute and no bar can ever exceed its resting height whatever
//     the floor says; swap the two and the floor wins instead, which would set
//     D.O.G./O.T.T.E.R./R.A.B.B.I.T.'s 8px bottom bar to the floor value on
//     every short screen. Both orders read as "clamp between floor and cap"
//     and they disagree exactly when floor > cap, which is the normal case for
//     the 8px bar. `pageBars.test.js` pins the order with a control.
//
//     The floor is still a RATIO rather than flat pixels, so that each bar
//     collapses in proportion to its own size. A flat floor would not break
//     the cap, but it sits above the smaller caps and so would silently pin
//     the tool pages' bars at their resting height instead of letting them
//     give way at genuinely tiny windows.
//
//  3. BOTH SIDES SHARE ONE BUDGET, so an asymmetric row keeps its ratio.
//     Settings is 120/80 and stays 3:2 the whole way down (D1b moved it;
//     the shares are 0.6 and 0.4 exactly, so that ratio is held to the pixel
//     rather than to the 4-decimal rounding the other rows take).
//
// ⚠️ Below the floor crossover the bars stop shrinking and content drops under
// 540px. That happens at a DIFFERENT height per row, not at one ~740px for all
// of them (measured 2026-09-13, F4): Home at 781px, the 120/80 rows at 630px,
// the tool rows at 586px. Home is therefore the only one that degrades inside
// Electron's range at all — at the 700px minimum it has 458.8px of content
// against the 444px its button stack needs. It then scrolls internally —
// `justify-content: safe center` plus `overflow-y: auto` on its own column,
// which already handles this. That is the documented degradation, not a
// second bug.
// =============================================================================

// Content the bars must never eat into. Home's 444px stack + the content
// wrapper's padding + ~40px of slack, which is what turns "just barely fits"
// into "obviously fits" on the machines Audrey actually uses.
//
// 📌 UI overhaul F2: that wrapper padding was `3vh 0` and is now a flat 24px
// (plan §3.3, "nothing in vh" — 3vh was 27px at 900px tall and 21px at 700,
// so the app's vertical rhythm changed with the window). 540 was derived
// against 6vh, which is 54px at 900px and more above it, so the reserve is now
// CONSERVATIVE rather than tight: Home fits with more room to spare than the
// number was chosen for, never less. Left at 540 deliberately — lowering it
// would give the bars back space this phase took from them for a reason.
const CONTENT_RESERVE_PX = 540;

// How far a bar may collapse, as a fraction of its own resting height.
const BAR_FLOOR_RATIO = 0.45;

function barSide(capPx, totalPx) {
  if (capPx <= 0) return '0px';
  const floorPx = Number((capPx * BAR_FLOOR_RATIO).toFixed(2));
  const share = Number((capPx / totalPx).toFixed(4));
  return `min(${capPx}px, max(${floorPx}px, (100vh - ${CONTENT_RESERVE_PX}px) * ${share}))`;
}

// `top` and `bottom` are the resting heights on a tall display — i.e. the caps.
//
// Exported for `pages.js`, which owns the per-page table: geometry is defined
// here, ASSIGNED there, so a page and its bars are written in one place
// (UI overhaul F2, review F32).
export function bars(top, bottom) {
  const total = top + bottom;
  return { top: barSide(top, total), bottom: barSide(bottom, total) };
}

// ── The per-page table moved to `pages.js` (UI overhaul F2, review F32) ──────
//
// It lived here as its own object, and a page could be added to App.jsx's
// PAGE_TITLES, to the nav and to the header's OR chain while silently missing
// from this table — which is exactly what 'project-files' did for three weeks
// (review F-R04). The table is now DERIVED from the one page registry, where
// a missing `bars` throws at module load.
//
// `PAGE_BARS` and `HOME_BAR_HEIGHT` are exported from `./pages`. This file
// keeps the geometry and its rationale, which is what the three properties
// above are about; `pageBars.test.js` still proves them, against the derived
// table.
