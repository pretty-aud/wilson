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
//     Home resolves to exactly 268px on any viewport >= 1076px. Every other row
//     is small enough that its cap wins at every window size the app can be
//     opened at (Electron's minimum is 700px), so Home is the only page whose
//     geometry actually moves.
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
//     Settings is 200/150 and stays 4:3 the whole way down.
//
// ⚠️ Below ~740px the floors take over and content drops under 540px. Home
// then scrolls internally — `justify-content: safe center` plus `overflow-y:
// auto` on its own column, which already handles this. That is the documented
// degradation, not a second bug.
// =============================================================================

// Content the bars must never eat into. Home's 444px stack + 6vh of wrapper
// padding + ~40px of slack, which is what turns "just barely fits" into
// "obviously fits" on the machines Audrey actually uses.
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
function bars(top, bottom) {
  const total = top + bottom;
  return { top: barSide(top, total), bottom: barSide(bottom, total) };
}

// Bar height configs per page. Content fills whatever space remains between.
export const PAGE_BARS = {
  home:               bars(268, 268),
  dog:                bars(95, 8),
  otter:              bars(95, 8),
  rabbit:             bars(95, 8),
  settings:           bars(200, 150),
  'project-manager':  bars(200, 150),
  'rate-card':        bars(200, 150),
  'team-members':     bars(200, 150),
  // UI overhaul F1 (2026-09-11), review F-R04 / plan Q8(a): 'project-files'
  // was in PAGE_TITLES, the nav list and the OR chain but never here, so the
  // densest table in the app rendered inside Home's 268/268 chrome and lost
  // about 400px of field. The resource-class geometry, like its neighbours;
  // Q8(b) (120/80 for the class, or the tool geometry for Files) is Audrey's.
  'project-files':    bars(200, 150),
  dashboard:          bars(200, 150),
  'admin-terminal':   bars(200, 150),
  help:               bars(140, 100),
};

// 🚨 THE SIGN-IN SEAM. AuthShell's reveal settles its bars at this exact value
// and App's `playWelcome` picks them straight up from there, so the two
// animations read as one continuous movement: the bars close, say WELCOME, and
// open onto Home. It was a literal '268px' in AuthShell and a literal '268px'
// in App's PAGE_BARS table — two copies of one number, and the first thing
// anyone sees after signing in is the two disagreeing.
//
// Same reason Session 43 made TRANSITION a shared constant. One definition,
// both consumers.
export const HOME_BAR_HEIGHT = PAGE_BARS.home.top;
