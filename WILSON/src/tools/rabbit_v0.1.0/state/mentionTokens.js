// MO3 (0127): a typed link in R.A.B.B.I.T.'s text is [[the author's words|m:<12 hex>]]. The key is opaque and names
// no destination: the picker reserves it for one the writer sees (moth_mention_reserve), and the server turns it into
// a link of that field when the words are saved, and removes the link when the key leaves them. Pure; the same rule
// as rabbit_private.moth_mention_keys reads (0127 §3): words of 1 to 200 characters with no bracket, bar or control.

const TOKEN = /\[\[([^\][|\u0000-\u001f\u007f]{1,200})\|m:([0-9a-f]{12})\]\]/g
const KEY = /^[0-9a-f]{12}$/

export function isMentionKey(key) {
  return typeof key === 'string' && KEY.test(key)
}

// The keys a text holds, each once, in the order they first appear.
export function mentionKeys(text) {
  const out = []
  if (typeof text !== 'string' || !text.includes('[[')) return out
  for (const m of text.matchAll(TOKEN)) if (!out.includes(m[2])) out.push(m[2])
  return out
}

// The text in pieces: plain runs as { text }, typed links as { words, key, raw }.
export function splitMentions(text) {
  if (typeof text !== 'string' || text === '') return []
  if (!text.includes('[[')) return [{ text }]
  const parts = []
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) })
    parts.push({ words: m[1], key: m[2], raw: m[0] })
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}

// The words as a typed link may hold them: brackets, bars and control characters out, spaces collapsed, 200 at most.
export function mentionWords(words) {
  return String(words ?? '')
    .replace(/[\][|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .trim()
}

export function mentionToken(words, key) {
  const w = mentionWords(words)
  if (!w || !isMentionKey(key)) return null
  return `[[${w}|m:${key}]]`
}

// What a reader without the link sees: the words alone, with no sign that a link was there.
export function mentionPlainText(text) {
  return splitMentions(text).map(p => (p.key ? p.words : p.text)).join('')
}
