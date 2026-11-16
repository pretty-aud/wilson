// ============================================================
// RABBIT — an asset's own types, and their words (VW1b, 2026-10-17)
// ============================================================
//
// Moved here from ProjectAssetsView.jsx, which re-exports both, so the model
// can read them without importing a view: Audrey's answer of 2026-10-17 to
// Q-N1b (docs/design/CUSTOM_VIEWS_QUESTIONS.md, batch 15), "The asset's own
// type", makes a task's items sorted by type follow an asset's own type, in
// the order the Assets table already sorts and groups them by (this list's
// order), and the task window names each run by these words.

export const ASSET_TYPES = [
  'character','environment','prop','vehicle','vfx','animation','rig','model',
  'texture','audio','vo','music','cinematic','ui','level','script','treatment',
  'concept','storyboard','illustration','document','deliverable','other',
]

// V2 (2026-09-27), B4c §4.2 item 8: a type printed its raw code ("script",
// "vfx") in the table, the popups and the pickers, where the file tables'
// kinds read in sentence case ("Script"). It reads in sentence case now, and
// its three acronyms in capitals. The CODE is unchanged everywhere: only the
// words on screen are.
const TYPE_ACRONYMS = { vfx: 'VFX', vo: 'VO', ui: 'UI' }
export function assetTypeLabel(type) {
  const t = type || 'other'
  if (TYPE_ACRONYMS[t]) return TYPE_ACRONYMS[t]
  const words = t.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
