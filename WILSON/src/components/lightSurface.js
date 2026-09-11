// =============================================================================
// lightSurface — ABSORBED into src/ui/tokens.js (UI overhaul F1, 2026-09-11).
//
// This module was Session 43 §B's shared token set for the LIGHT pages and,
// by its own header, "a deliberate exception" to the old "local tokens, not
// global" rule. The exception won: the review (F04) found it was the one
// thing keeping five table headers from drifting, and the overhaul made it
// the rule. Every value now lives in `@theme` (src/index.css) and is
// re-exported by src/ui/tokens.js, whose test measures each one.
//
// The names below are kept as aliases so the 31 files that import them keep
// working unchanged. New code imports from '../ui/tokens' (INK_LIGHT,
// RULE_LIGHT, WELL_LIGHT, SURFACE_LIGHT_SOLID …). The history and the
// measurements this file used to carry are in tokens.js and tokens.test.js.
//
// 🚨 THE RULE THESE EXIST TO ENFORCE. Audrey, 2026-08-10, in capitals:
//   "DO NOT USE GRAY TEXT AGAINST ORANGE AS IT IS HARD TO SEE ONLY WHITE OR
//    BLACK." / "keep the orange make the light text black instead."
// =============================================================================

export {
  LIGHT_INK,
  LIGHT_RULE,
  LIGHT_WELL,
  LIGHT_ACCENT,
  LIGHT_SURFACE_SOLID,
  LIGHT_TABLE_FRAME,
  LIGHT_TABLE_HEAD_ROW,
  LIGHT_TABLE_HEAD_CELL,
  LIGHT_TABLE_ROW_DIVIDER,
} from '../ui/tokens'
