// =============================================================================
// inviteParsing — pure helpers for the multi-invite flow (Session 9).
//
// Postel's Law: the paste box accepts whatever an admin throws at it —
// comma/semicolon/whitespace-separated lists, newline dumps from a
// spreadsheet column, and "Name <email>" address-book forms. Output is
// strict: lowercased, deduped emails plus USERNAME_RE-safe suggestions.
//
// No I/O, no React — unit-tested in inviteParsing.test.js.
// =============================================================================

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Derive a username suggestion from an email's localpart. Never mutates
// `takenSet` — the caller decides when a suggestion is actually claimed.
export function deriveUsername(email, takenSet) {
  const taken = takenSet || new Set()
  const str = typeof email === 'string' ? email : ''
  const at = str.indexOf('@')
  // at === 0 means an empty localpart ('@x.com') — slice(0, 0) keeps it
  // empty so it reaches the fallback instead of chewing on the domain.
  let base = (at >= 0 ? str.slice(0, at) : str).toLowerCase()
  // Sanitize into USERNAME_RE's alphabet: anything foreign becomes '.', the
  // leading run of non-alphanumerics is stripped (first char must be [a-z0-9]).
  base = base.replace(/[^a-z0-9._-]/g, '.')
  base = base.replace(/^[^a-z0-9]+/, '')
  base = base.slice(0, 32)
  if (base.length === 0) {
    base = 'user.invite'
  } else if (base.length < 2) {
    // Regex minimum is 2 chars — pad rather than reject (Postel).
    base = `user${base}`.slice(0, 32)
  }
  if (!taken.has(base)) return base
  // Numeric-suffix dedupe; trim the base so suffixed forms stay <= 32 chars.
  for (let n = 2; ; n++) {
    const suffix = String(n)
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

// Parse a pasted invite list into { entries: [{ email, username }], invalid }.
// Emails are trimmed, lowercased, and deduped; usernames are derived
// suggestions deduped within the batch (the dialog dedupes against the
// roster separately — the Edge Function is the real gate either way).
export function parseInviteList(text) {
  const src = String(text ?? '')
  const tokens = []
  // Extract "Name <email>" forms FIRST — display names may contain spaces
  // that the separator split below would shred. The name half excludes
  // entry separators and '@' so a preceding bare email is never swallowed.
  const rest = src.replace(/[^<>,;\r\n@]*<([^<>]*)>/g, (_, inner) => {
    tokens.push(inner)
    return ' '
  })
  tokens.push(...rest.split(/[\s,;]+/))

  const entries = []
  const invalid = []
  const seenEmails = new Set()
  const usedUsernames = new Set()
  for (const raw of tokens) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const email = trimmed.toLowerCase()
    if (!EMAIL_RE.test(email)) {
      if (!invalid.includes(trimmed)) invalid.push(trimmed)
      continue
    }
    if (seenEmails.has(email)) continue
    seenEmails.add(email)
    const username = deriveUsername(email, usedUsernames)
    usedUsernames.add(username)
    entries.push({ email, username })
  }
  return { entries, invalid }
}
