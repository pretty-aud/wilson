// ============================================================
// RABBIT intake — script chunker
// ============================================================
//
// Splits a screenplay-style raw text into 1–5 scenes per chunk
// using the standard slug-line regex (`INT.`, `EXT.`, `INT/EXT.`,
// `I/E.`). If no slug lines are found we fall back to a single
// whole-document chunk so the pipeline still has something to
// hand to the model.

const SLUG_LINE = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/m
const SCENES_PER_CHUNK = 4

function splitScenes(rawText) {
  const lines = String(rawText || '').split(/\r?\n/)
  const scenes = []
  let current = null
  for (const line of lines) {
    if (SLUG_LINE.test(line)) {
      if (current) scenes.push(current)
      current = { slug: line.trim(), body: [line] }
    } else if (current) {
      current.body.push(line)
    }
  }
  if (current) scenes.push(current)
  return scenes
}

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []
  const scenes = splitScenes(text)
  if (scenes.length === 0) {
    return [{ chunk_label: 'whole-script', raw_text: text }]
  }
  const chunks = []
  for (let i = 0; i < scenes.length; i += SCENES_PER_CHUNK) {
    const group = scenes.slice(i, i + SCENES_PER_CHUNK)
    const first = group[0].slug
    const last = group[group.length - 1].slug
    const label =
      group.length === 1
        ? `Scene: ${first}`
        : `Scenes ${i + 1}–${i + group.length}: ${first} … ${last}`
    chunks.push({
      chunk_label: label,
      raw_text: group.map(s => s.body.join('\n')).join('\n\n'),
    })
  }
  return chunks
}

export default { split, kind: 'script' }
