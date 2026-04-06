// ============================================================
// RABBIT intake — pitch bible chunker
// ============================================================
//
// Splits a series/franchise pitch bible per chapter or section
// heading. Pitch bibles are long documents (50–150 pages) with
// clear chapter structure (Series Overview, World, Characters,
// Pilot, Episode Loglines, etc.) so we use H1/H2 boundaries.

const HEADING = /^(#{1,2})\s+(.+?)\s*$/

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []

  const lines = text.split(/\r?\n/)
  const chapters = []
  let current = null

  for (const line of lines) {
    const m = line.match(HEADING)
    if (m) {
      if (current) chapters.push(current)
      current = {
        level: m[1].length,
        title: m[2].trim(),
        body: [line],
      }
    } else if (current) {
      current.body.push(line)
    } else {
      current = { level: 0, title: 'Front Matter', body: [line] }
    }
  }
  if (current) chapters.push(current)

  if (chapters.length === 0) {
    return [{ chunk_label: 'whole-bible', raw_text: text }]
  }

  return chapters.map((c, i) => ({
    chunk_label: `Chapter ${i + 1}: ${c.title}`,
    raw_text: c.body.join('\n'),
  }))
}

export default { split, kind: 'pitch_bible' }
