// =============================================================================
// lightSurface — the tokens for WILSON's LIGHT pages (Session 43 §B).
//
// Light pages are Home, System Settings, Projects, Rate Card, Team Members,
// Dashboard, Admin Terminal and Help. App.jsx paints their content area
// `#f4a261` (`backgroundColor: isDarkPage ? '#1c1917' : '#f4a261'`), so every
// one of them is text on LIGHT ORANGE.
//
// 🚨 THE RULE THESE EXIST TO ENFORCE. Audrey, 2026-08-10, in capitals:
//   "DO NOT USE GRAY TEXT AGAINST ORANGE AS IT IS HARD TO SEE ONLY WHITE OR
//    BLACK." / "keep the orange make the light text black instead."
//
// Measured against #f4a261 — the whole stone ramp fails, which is why the
// complaint was "hard to read" rather than "ugly":
//
//     #a8a29e  stone-400   1.42:1  ✗      #57534e  stone-600   3.70:1  ✗
//     #78716c  stone-500   2.33:1  ✗      #d6d3d1  stone-300   lighter than
//     #e7e5e4  stone-200   lighter than the page itself       the page itself
//     #1c1917  stone-900   8.49:1  ✓
//
// ⚠️ A grey on DARK STONE is correct and must stay. These pages all host
// modals and popups painted #1c1917, and the greys inside those are doing
// their job. Classify by the SURFACE an element actually sits on, never by
// the file it lives in — a blanket find-and-replace wrecks the dark panels,
// which were never the problem.
//
// Hierarchy on a light surface comes from SIZE and WEIGHT, and emptiness from
// italic. Not from a second ink: the moment a lighter grey comes back to mean
// "less important", the rule above is broken again.
//
// (WILSON's convention is local `L` token objects per page — visual-language
// §Composition rule 3. This module is a deliberate exception, because §B3
// asks for ONE table treatment across Team Members, Users and Logs, and three
// local copies is exactly how they drifted apart.)
// =============================================================================

// Every piece of text on a light surface.
export const LIGHT_INK = '#1c1917'

// Hairlines: table borders, dividers, input underlines. A tint of the ink, so
// it recedes without becoming a grey in its own right.
export const LIGHT_RULE = 'rgba(28, 25, 23, 0.22)'

// Grouping surface — table headers, toolbars, inert chips. Warm, so it reads
// as a shade of the page rather than a white card dropped onto it. This is
// Law of Common Region satisfied WITHOUT a card, which is what §B1 asks for:
// "Replace the card, keep the region."
export const LIGHT_WELL = 'rgba(120, 70, 30, 0.18)'

// ⚠️ NOT EXPORTED, deliberately. `rgba(120, 70, 30, 0.55)` is WILSON's
// existing input well on light pages (visual-language §Inputs). It was going
// to live here, and the contrast test refused it: black on that well measures
// 4.32:1, just under AA — and the pale `#fde8d0` it is actually paired with
// measures 3.38:1, which is worse.
//
// That is a REAL, pre-existing problem with every input on every light page,
// and it is NOT the grey complaint Session 43 was asked to fix. Changing the
// well would restyle every field in the app on a guess. Recorded in
// docs/OUTSTANDING.md instead; a token with no caller is not shipped.

// Selected / active chip.
export const LIGHT_ACCENT = '#ea580c'

// OPAQUE surface for floating UI — dropdowns, popovers, menus — which must
// not let the page show through them. This is LIGHT_WELL composited over the
// page and flattened, so a floating panel is the same tone as a docked one.
// Black on it measures 6.91:1.
//
// Audrey, 2026-08-10, on the Rate Card: "NO WHITE BACKGROUND." The panels
// there were #fef3e8 / #fff7ed / #fff — near-white cards dropped onto the
// orange page, which is the same defect as the Team Members box, at scale.
export const LIGHT_SURFACE_SOLID = '#dd9155'

// Shared table treatment (§B3). A table in Team Members, one in Users and one
// in Logs should be the same table; today they are three tables that happen
// to sit near each other.
export const LIGHT_TABLE_FRAME = { border: `1px solid ${LIGHT_RULE}` }
export const LIGHT_TABLE_HEAD_ROW = { backgroundColor: LIGHT_WELL }
export const LIGHT_TABLE_HEAD_CELL = {
  color: LIGHT_INK,
  // 6.91:1 on the header well. Weight and tracking carry the emphasis that a
  // lighter grey used to carry.
  fontWeight: 700,
}
export const LIGHT_TABLE_ROW_DIVIDER = { borderBottom: `1px solid ${LIGHT_RULE}` }
