// ============================================================
// RABBIT intake — brief chunker
// ============================================================
//
// Whole-document if the brief is under ~8k tokens (≈32k chars),
// otherwise per H1 markdown heading. Briefs are usually short
// and benefit from full-context analysis.

const APPROX_TOKEN_LIMIT_CHARS = 32000
const H1 = /^#\s+(.+?)\s*$/

function splitOnH1(text) {
  const lines = text.split(/\r?\n/)
  const sections = []
  let current = null
  for (const line of lines) {
    const m = line.match(H1)
    if (m) {
      if (current) sections.push(current)
      current = { title: m[1].trim(), body: [line] }
    } else if (current) {
      current.body.push(line)
    } else {
      current = { title: 'Preamble', body: [line] }
    }
  }
  if (current) sections.push(current)
  return sections
}

export function split(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []

  if (text.length <= APPROX_TOKEN_LIMIT_CHARS) {
    return [{ chunk_label: 'whole-brief', raw_text: text }]
  }

  const sections = splitOnH1(text)
  if (sections.length <= 1) {
    return [{ chunk_label: 'whole-brief', raw_text: text }]
  }
  return sections.map(sec => ({
    chunk_label: `# ${sec.title}`,
    raw_text: sec.body.join('\n'),
  }))
}

export default { split, kind: 'brief' }
