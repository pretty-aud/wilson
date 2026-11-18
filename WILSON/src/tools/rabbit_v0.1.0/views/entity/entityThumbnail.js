// =============================================================================
// entityThumbnail.js — a scene's, a shot's, a level's or an experience's
// picture, set and cleared (post-overhaul F10, rabbit A1).
//
// Six places wrote these two: the three windows (the scene's, the shot's, the
// level's and experience's) and three table cells in ScenesView (a scene's
// row, a scene's nested shot row, a shot's row). Each called the same two
// desktop channels with the same arguments under the same guard, which F9
// keeps this week: `generateEntityThumbnail({ entityType, entityId,
// sourcePath })` and `clearEntityThumbnail({ entityType, entityId })`. They
// are called here exactly so, in the same order: the seat's refusal first,
// then (setting) the desktop's picker, the row's path written, the channel,
// and the caller told its picture changed — whether the channel answered or
// threw (a failure is said in the console by the windows, `say`, and left
// silent by the cells, as each did). Assets' own pair (generateAssetThumbnail,
// clearAssetThumbnail) is the asset window's and is not here.
// =============================================================================

/** Pick a picture on the desktop and make it the thing's thumbnail. */
export async function pickEntityThumbnail({ canWrite, entityType, entityId, update, onChanged, say = null }) {
  if (!canWrite || !window.electronAPI?.rabbit?.pickImage) return
  const imagePath = await window.electronAPI.rabbit.pickImage()
  if (!imagePath) return
  update({ thumbnail_image: imagePath })
  try {
    await window.electronAPI.rabbit.generateEntityThumbnail({ entityType, entityId, sourcePath: imagePath })
  } catch (e) {
    if (say) console.error(`${say} thumbnail gen failed:`, e)
  }
  onChanged?.()
}

/** Take the thing's thumbnail away. */
export async function clearEntityThumbnail({ canWrite, entityType, entityId, update, onChanged }) {
  if (!canWrite) return
  update({ thumbnail_image: null })
  try { await window.electronAPI.rabbit.clearEntityThumbnail({ entityType, entityId }) } catch { /* the row is written; the picture follows */ }
  onChanged?.()
}
