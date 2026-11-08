// mothTagWords.js — MO3 (0126): what Moth says while a person names a tag, before anything is saved.
//
// The database keeps one live tag of a label per type, tier and owner, in moth_tag_norm's form (NFKC, spaces
// collapsed, lower case, trimmed), and refuses a second with its unique key. Before that, the page says:
//   * duplicate  — the person has this tag already, of this type: use it.
//   * company    — the company has a tag of these words (any type): use it instead of a private one. The nudge
//                  never names another person's tag: only the company's and the person's own are read here.
//   * similar    — tags whose words are near (one or two letters apart, or one starting the other), to catch a
//                  typo before it becomes a second tag. Never a refusal: a person may mean a new one.
// Pure; reads only the tags the person may see (listMothTags: the company's and their own).

export function tagNorm(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

// Letters apart (Levenshtein), stopping once past `max`.
export function lettersApart(a, b, max = 2) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

const live = (t) => t && !t.canonical_id && !t.retired_at

/** What to say about the words a person is giving a new tag of type `typeId`. */
export function tagAdvice(label, { tags = [], typeId = null, userId = null } = {}) {
  const n = tagNorm(label)
  if (!n) return { duplicate: null, company: null, similar: [] }
  const seen = tags.filter(live)
  const mine = seen.filter((t) => t.tier === 'personal' && (userId == null || t.owner_id === userId))
  const duplicate = mine.find((t) => tagNorm(t.label) === n && (typeId == null || t.type_id === typeId)) || null
  const company = seen.find((t) => t.tier === 'company' && tagNorm(t.label) === n) || null
  const similar = n.length < 3 ? [] : seen
    .filter((t) => t !== duplicate && t !== company)
    .map((t) => ({ t, w: tagNorm(t.label) }))
    .filter(({ w }) => w !== n && (lettersApart(n, w) <= (n.length > 5 ? 2 : 1) || (w.length >= 3 && (w.startsWith(n) || n.startsWith(w)))))
    .sort((a, b) => lettersApart(n, a.w, 3) - lettersApart(n, b.w, 3) || a.w.localeCompare(b.w))
    .slice(0, 3)
    .map(({ t }) => t)
  return { duplicate, company, similar }
}
