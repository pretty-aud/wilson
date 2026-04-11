// ============================================================
// RABBIT intake — deck chunker
// ============================================================
//
// Splits an extracted-from-pptx deck into groups of 4–6 slides.
// Slides may be separated by:
//   • A line that matches /^Slide \d+/i  (DOG export pattern).
//   • A bare form-feed (\f) which python-pptx and several other
//     extractors emit between slides.
//   • A heading line that matches `## Slide N`.
//
// Falls back to length-based segmentation if none of those
// markers exist.

const SLIDE_HEADER = /^(?:#{0,3}\s*)?slide\s+\d+\b.*$/im
const SLIDE_FEED = /\f/
const SLIDES_PER_CHUNK = 5

function splitOnSlides(text) {
  // Try form-feed first.
  if (SLIDE_FEED.test(text)) {
    return text.split(/\f/).map((body, i) => ({
      label: `Slide ${i + 1}`,
      body,
    }))
  }
  // Otherwise scan for slide headers line-by-line.
  const lines = text.split(/\r?\n/)
  const slides = []
  let current = null
  let counter = 0
  for (const line of lines) {
    if (SLIDE_HEADER.test(line)) {
      if (current) slides.push(current)
      counter += 1
      current = { label: line.trim() || `Slide ${counter}`, body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      current = { label: 'Title', body: [line] }
    }
  }
  if (current) slides.push(current)
  return slides.map(s => ({ label: s.label, body: s.body.join('\n') }))
}

function splitByLength(text, charsPer = 6000) {
  const out = []
  for (let i = 0, n = 0; i < text.length; i += charsPer, n += 1) {
    out.push({
      chunk_label: `Segment ${n + 1}`,
      raw_text: text.slice(i, i + charsPer),
    })
  }
  return out
}

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []

  const hasMarkers = SLIDE_HEADER.test(text) || SLIDE_FEED.test(text)
  if (!hasMarkers) return splitByLength(text)

  const slides = splitOnSlides(text)
  const chunks = []
  for (let i = 0; i < slides.length; i += SLIDES_PER_CHUNK) {
    const group = slides.slice(i, i + SLIDES_PER_CHUNK)
    chunks.push({
      chunk_label: `Slides ${i + 1}–${i + group.length}`,
      raw_text: group.map(s => `--- ${s.label} ---\n${s.body}`).join('\n\n'),
    })
  }
  return chunks
}

export default { split, kind: 'deck' }
