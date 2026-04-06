// ============================================================
// RABBIT intake — lookbook chunker
// ============================================================
//
// Lookbooks are mostly imagery with caption strings extracted by
// the upstream PDF/PPTX text extractor. We chunk per pair of
// pages (≈ one image group / spread) so each model call sees a
// coherent visual reference. Falls back to length-based
// segmentation if no page markers are present.

const PAGE_MARKER = /^(?:#{0,3}\s*)?(?:page|spread|plate)\s+\d+\b.*$/im
const PAGE_FEED = /\f/
const PAGES_PER_CHUNK = 2

function splitOnPages(text) {
  if (PAGE_FEED.test(text)) {
    return text.split(/\f/).map((body, i) => ({
      label: `Page ${i + 1}`,
      body,
    }))
  }
  const lines = text.split(/\r?\n/)
  const pages = []
  let current = null
  let counter = 0
  for (const line of lines) {
    if (PAGE_MARKER.test(line)) {
      if (current) pages.push(current)
      counter += 1
      current = { label: line.trim() || `Page ${counter}`, body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      current = { label: 'Cover', body: [line] }
    }
  }
  if (current) pages.push(current)
  return pages.map(p => ({ label: p.label, body: p.body.join('\n') }))
}

function splitByLength(text, charsPer = 4000) {
  const out = []
  for (let i = 0, n = 0; i < text.length; i += charsPer, n += 1) {
    out.push({
      chunk_label: `Spread ${n + 1}`,
      raw_text: text.slice(i, i + charsPer),
    })
  }
  return out
}

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []

  const hasMarkers = PAGE_MARKER.test(text) || PAGE_FEED.test(text)
  if (!hasMarkers) return splitByLength(text)

  const pages = splitOnPages(text)
  const chunks = []
  for (let i = 0; i < pages.length; i += PAGES_PER_CHUNK) {
    const group = pages.slice(i, i + PAGES_PER_CHUNK)
    chunks.push({
      chunk_label: `Spread ${Math.floor(i / PAGES_PER_CHUNK) + 1}`,
      raw_text: group.map(p => `--- ${p.label} ---\n${p.body}`).join('\n\n'),
    })
  }
  return chunks
}

export default { split, kind: 'lookbook' }
