// ============================================================
// RABBIT — entityNaming
// ============================================================
//
// Scene and shot auto-naming, and the folder slug derived from a name.
//
// Session 25. Audrey: "scenes and shots take their names from the auto-naming
// system." Until now that system lived inside ScenesView.jsx in FIVE copies —
// formatSceneCode (:344), formatShotCode (:358), and inline rebuilds in both
// detail popups (:2105, :2540) — plus a sixth, subtly different, preview in
// ProjectSummaryView.jsx:729-733. View-local logic is why nothing else could
// reuse it, and why the settings preview was free to drift from what the
// create buttons actually produce.
//
// It lives here because it has THREE consumers, not one:
//   1. the Scenes view, naming what it creates;
//   2. the Project Control Panel, previewing what the settings will produce;
//   3. S26's folder tree, which names a scene's folder after the scene.
//
// 🚨 THE POINT OF EXTRACTING IT IS ADAPTER PARITY. The same project must
// produce the same scene name whether it is stored in Supabase or in a local
// JSON bundle. Naming is computed CLIENT-side and the resulting string is
// persisted, so two implementations would mean two naming schemes for one
// project the moment anyone switched backend. There is deliberately no
// server-side generated column doing this on the Supabase side, for exactly
// that reason.
//
// The settings these read (project_code, scene_separator, scene_digits,
// shot_digits, scene_start_number) became real columns in migration 0040. The
// defaults below are the defaults the UI has always applied, so an existing
// project names identically before and after anyone opens the panel.

export const DEFAULT_PROJECT_CODE   = 'PROJ'
export const DEFAULT_SEPARATOR      = '_'
export const DEFAULT_SCENE_DIGITS   = 3
export const DEFAULT_SHOT_DIGITS    = 4
export const DEFAULT_START_NUMBER   = 1

// `||` for the strings and `??` for the numbers, matching the original
// exactly. The difference matters: an empty project_code must fall back to
// 'PROJ' (a name of "_SC001" is useless), but scene_digits of 0 is a
// legitimate choice and must NOT be replaced by 3.
function settings(project) {
  return {
    code:   project?.project_code    || DEFAULT_PROJECT_CODE,
    sep:    project?.scene_separator || DEFAULT_SEPARATOR,
    sDigits: project?.scene_digits   ?? DEFAULT_SCENE_DIGITS,
    hDigits: project?.shot_digits    ?? DEFAULT_SHOT_DIGITS,
  }
}

function pad(n, digits) {
  return String(n).padStart(digits, '0')
}

/** `CODE{sep}SC{n}` — e.g. WLSN_SC001. */
export function formatSceneCode(project, sceneNumber) {
  const { code, sep, sDigits } = settings(project)
  return `${code}${sep}SC${pad(sceneNumber ?? 0, sDigits)}`
}

/** `CODE{sep}SC{n}{sep}SH{n}` — e.g. WLSN_SC001_SH0001. */
export function formatShotCode(project, sceneNumber, shotNumber) {
  const { code, sep, sDigits, hDigits } = settings(project)
  return `${code}${sep}SC${pad(sceneNumber ?? 0, sDigits)}`
       + `${sep}SH${pad(shotNumber ?? 0, hDigits)}`
}

/**
 * The number the next scene should take: one past the highest existing
 * scene_number, or the project's configured starting number when there are
 * no scenes yet.
 *
 * Deliberately max()+1 rather than count+1: deleting scene 3 of 5 must not
 * make the next scene collide with the existing scene 5.
 */
export function nextSceneNumber(scenes, project) {
  const nums = (scenes || [])
    .map(s => s?.scene_number)
    .filter(n => typeof n === 'number')
  if (nums.length === 0) return project?.scene_start_number ?? DEFAULT_START_NUMBER
  return Math.max(...nums) + 1
}

/**
 * The number the next shot in a scene should take.
 *
 * NOTE it seeds from `scene_start_number`, not a shot-specific setting —
 * there is no shot_start_number anywhere in the app, and this preserves the
 * behaviour of ScenesView.jsx:354 exactly. Pinned by a test so that if a
 * separate shot start is ever added, the omission fails loudly here rather
 * than silently renumbering everyone's shots.
 */
export function nextShotNumber(sceneShots, project) {
  const nums = (sceneShots || [])
    .map(s => s?.shot_number)
    .filter(n => typeof n === 'number')
  if (nums.length === 0) return project?.scene_start_number ?? DEFAULT_START_NUMBER
  return Math.max(...nums) + 1
}

/**
 * Title-Case-Hyphenated slug used for folder names.
 *
 * Carried over verbatim from ScenesView.jsx:215 and electron/main.cjs, which
 * hold identical copies. S26 builds the folder tree from these, and a folder
 * slug that disagrees between the renderer and the Electron main process
 * would create two folders for one scene.
 */
export function fileSlugify(str) {
  return String(str ?? '').trim()
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('-')
}
