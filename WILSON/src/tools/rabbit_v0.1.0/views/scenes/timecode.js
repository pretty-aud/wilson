// RABBIT — a frame count as timecode at the project's fps (HH:MM:SS:FF).
// One copy for the Scenes tab and its edit table (post-overhaul S3c moved
// it out of ScenesView.jsx, digits unchanged).
export function framesToTimecode(totalFrames, fps) {
  if (!totalFrames || !fps || fps <= 0) return '00:00:00:00'
  const fpsCeil = Math.ceil(fps)
  const f = Math.round(totalFrames)
  const secs = Math.floor(f / fpsCeil)
  const rem = f % fpsCeil
  const hh = Math.floor(secs / 3600)
  const mm = Math.floor((secs % 3600) / 60)
  const ss = secs % 60
  const fDigits = fpsCeil >= 100 ? 3 : 2
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(rem).padStart(fDigits, '0')}`
}
