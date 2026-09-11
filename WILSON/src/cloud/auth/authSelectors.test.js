// =============================================================================
// authSelectors.test.js — the Playwright suite's selectors, checked without a
// browser (UI overhaul D2; hardened after review round 1).
//
// The e2e suite selects the auth screens by their VISIBLE TEXT and by their
// `aria-label`s. This session changed how those screens are typed, and one of
// the changes moves visible text: the page titles go to sentence case (Q2 —
// uppercase survives only in the page-transition title and the 11px Label
// step). `page.getByText(/^LOGIN$/)` was case-SENSITIVE, so "Login" would
// have walked straight past it.
//
// 🚨 Playwright cannot run here. It needs a live server and the probe admin's
// password, so the fix the plan prescribes — "source-text tests are updated in
// the same commit as the source they pin" — has no way to prove itself. This
// file is that proof: it reads the specs and the sources as text and asserts
// that every selector still resolves to something the app actually renders.
//
// ── WHAT ROUND 1 FOUND, AND WHAT CHANGED ───────────────────────────────────
//
// R1 landed three findings against the first draft. All three were right.
//
// 1. The corpus OVER-MATCHED. It harvested every quoted string in every file
//    under src/, comments included, so `/^NEW PASSWORD$/i` was satisfied by a
//    COMMENT in AuthShell.jsx and `/^login$/i` by App.jsx's `authMode` state
//    literal. Deleting the real element left the test green.
//    → `stripComments()` now removes `//` and `/* */` from every source
//      before harvesting (string- and regex-literal aware, so a `//` inside a
//      URL or a `\/\/` inside a RegExp survives), and every ANCHORED selector
//      (source `/^…$/`) is additionally matched against ONE NAMED FILE —
//      `ANCHORED_HOME` below — not against the whole corpus. A selector that
//      matched only because an unrelated module contains the word now fails.
//
// 2. The extractor MISSED selectors. It understood `getByRole('button', …)`
//    only, so two `getByRole('heading', …)` and one `getByText(VARIABLE)`
//    were silently unchecked.
//    → `roleSelectors()` handles every role; `textSelectors()` handles regex,
//      string and identifier arguments, resolving an identifier where it is a
//      plain string constant in the same spec. Anything genuinely uncheckable
//      is listed BY NAME in `SKIPPED_EXPECTED` and asserted, and a per-spec
//      coverage test compares `getBy*(` call sites against checked + skipped,
//      so a new selector shape cannot slip through unnoticed.
//
// 3. AMBIGUITY. Two reviewers found Playwright strict-mode hazards. They are
//    PRE-EXISTING — none of them was introduced by this session — and they
//    are recorded in `KNOWN_LABEL_COLLISIONS` and in the ResetPasswordWizard
//    test below rather than papered over. See those blocks for why each is
//    currently harmless and exactly when it stops being.
//
// It is still deliberately blunt: it does not parse JSX, and it cannot prove a
// selector resolves to exactly ONE element in a live DOM — only Playwright
// can. What it now does prove is that each selector's text exists, in the file
// that actually renders it, and that the ambiguities are the ones we know
// about. Every check ends with a failing control.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../..')
const REPO = resolve(SRC, '..')
const E2E = resolve(REPO, 'tests/e2e')

const rel = (p) => relative(REPO, p).replace(/\\/g, '/')

// ── Comment stripping ──────────────────────────────────────────────────────
// A `//` inside a string ("https://…") or inside a regex literal (/\/\//) is
// not a comment, so this walks the source rather than running a regex over it.
// Deciding whether `/` opens a regex or is division needs the previous
// significant character; this is the usual heuristic and it only has to be
// right often enough that no comment survives and no literal is eaten.
const REGEX_MAY_FOLLOW = new Set(
  ['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^'],
)

export function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  let prev = ''   // last non-whitespace character actually emitted
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++      // keep the newline
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      out += ' '                                 // do not glue the two sides
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        const ch = src[i]
        out += ch; i++
        if (ch === c) break
      }
      prev = c
      continue
    }
    if (c === '/' && REGEX_MAY_FOLLOW.has(prev)) {
      out += c; i++
      let inClass = false
      while (i < n) {
        const r = src[i]
        if (r === '\\') { out += r + (src[i + 1] ?? ''); i += 2; continue }
        if (r === '\n') break                    // unterminated: not a regex
        out += r; i++
        if (r === '[') inClass = true
        else if (r === ']') inClass = false
        else if (r === '/' && !inClass) break
      }
      prev = '/'
      continue
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

// Every string the app could plausibly render: JSX text nodes plus quoted
// literals (a title/label passed as a prop is a literal, not a text node, so
// both passes are needed). Comments are gone before either pass runs.
function harvest(code) {
  const out = new Set()
  for (const m of code.matchAll(/>([^<>{}]+)</g)) {
    const t = m[1].replace(/\s+/g, ' ').trim()
    if (t) out.add(t)
  }
  for (const m of code.matchAll(/'([^'\\\n]{2,120})'|"([^"\\\n]{2,120})"/g)) {
    const t = (m[1] ?? m[2]).replace(/\s+/g, ' ').trim()
    if (t) out.add(t)
  }
  return out
}

const FILES = walk(SRC).map((f) => ({ path: rel(f), code: stripComments(readFileSync(f, 'utf8')) }))
const CODE_BY_FILE = new Map(FILES.map((f) => [f.path, f.code]))
const TEXT_BY_FILE = new Map(FILES.map((f) => [f.path, harvest(f.code)]))
const RENDERED = [...new Set(FILES.flatMap((f) => [...TEXT_BY_FILE.get(f.path)]))]

/** aria-label value → the source files that declare it, sorted. */
const ARIA_LABEL_SITES = (() => {
  const out = new Map()
  for (const f of FILES) {
    for (const m of f.code.matchAll(/aria-label="([^"]+)"/g)) {
      if (!out.has(m[1])) out.set(m[1], [])
      out.get(m[1]).push(f.path)
    }
  }
  for (const v of out.values()) v.sort()
  return out
})()
const ARIA_LABELS = new Set(ARIA_LABEL_SITES.keys())

const specs = readdirSync(E2E)
  .filter((f) => /\.ts$/.test(f))
  .map((f) => ({ name: f, text: stripComments(readFileSync(join(E2E, f), 'utf8')) }))

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A selector is ANCHORED when its own source reads /^…$/ — those are the ones
// that pin an exact string and so must be pinned to an exact file.
const isAnchored = (body) => body.startsWith('^') && body.endsWith('$')

// ── Extractors ─────────────────────────────────────────────────────────────

/** `const NAME = '…'` in the same spec, or null. */
function literalConstant(specText, ident) {
  const m = specText.match(
    new RegExp(`(?:const|let|var)\\s+${escapeRe(ident)}\\s*=\\s*(?:'([^'\\n]*)'|"([^"\\n]*)")\\s*(?:;|$)`, 'm'),
  )
  return m ? (m[1] ?? m[2]) : null
}

/** The module a named import comes from, or null. */
function importOrigin(specText, ident) {
  for (const m of specText.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim())
    if (names.includes(ident)) return m[2]
  }
  return null
}

const SKIPPED = []   // { spec, selector, reason }

/** Every `getByText(…)` in the suite — regex, string literal, or identifier. */
function textSelectors() {
  const out = []
  const call = /getByText\(\s*(?:\/((?:\\.|[^/\\])+)\/([gimsuy]*)|'([^'\n]*)'|"([^"\n]*)"|([A-Za-z_$][\w$]*))\s*[,)]/g
  for (const { name, text } of specs) {
    for (const m of text.matchAll(call)) {
      if (m[1] != null) {
        out.push({ spec: name, kind: 'text', source: `/${m[1]}/${m[2]}`, re: new RegExp(m[1], m[2]), anchored: isAnchored(m[1]) })
        continue
      }
      const lit = m[3] ?? m[4]
      if (lit != null) {
        // getByText('x') is substring + case-insensitive unless exact is set.
        out.push({ spec: name, kind: 'text', source: `'${lit}'`, re: new RegExp(escapeRe(lit), 'i'), anchored: false })
        continue
      }
      const ident = m[5]
      const value = literalConstant(text, ident)
      if (value != null) {
        out.push({ spec: name, kind: 'text', source: `${ident} = '${value}'`, re: new RegExp(escapeRe(value), 'i'), anchored: false })
      } else {
        const from = importOrigin(text, ident)
        SKIPPED.push({
          spec: name,
          selector: `getByText(${ident})`,
          reason: from
            ? `${ident} is imported from '${from}', not a string literal in this spec`
            : `${ident} is not a string literal in this spec`,
        })
      }
    }
  }
  return out
}

/** Every `getByLabel('…')` in the suite. */
function labelSelectors() {
  const out = []
  for (const { name, text } of specs) {
    for (const m of text.matchAll(/getByLabel\(\s*(?:'([^'\n]+)'|"([^"\n]+)")/g)) {
      out.push({ spec: name, label: m[1] ?? m[2] })
    }
  }
  return out
}

/** Every `getByRole('<role>', { name: … })` in the suite — EVERY role. */
function roleSelectors() {
  const out = []
  const call = /getByRole\(\s*'(\w+)'\s*(?:,\s*\{([^{}]*)\})?\s*\)/g
  for (const { name, text } of specs) {
    for (const m of text.matchAll(call)) {
      const role = m[1]
      const opts = m[2] ?? ''
      const nm = opts.match(/name:\s*(?:\/((?:\\.|[^/\\])+)\/([gimsuy]*)|'([^'\n]*)'|"([^"\n]*)")/)
      if (!nm) {
        SKIPPED.push({ spec: name, selector: `getByRole('${role}')`, reason: `getByRole('${role}') has no name option` })
        continue
      }
      const exact = /exact:\s*true/.test(opts)
      if (nm[1] != null) {
        out.push({ spec: name, role, source: `/${nm[1]}/${nm[2]}`, re: new RegExp(nm[1], nm[2]), anchored: isAnchored(nm[1]) })
      } else {
        const lit = nm[3] ?? nm[4]
        // An accessible name matches as a case-insensitive SUBSTRING unless
        // `exact: true`, which makes it whole-string and case-sensitive.
        out.push({
          spec: name,
          role,
          source: `'${lit}'`,
          re: exact ? new RegExp(`^${escapeRe(lit)}$`) : new RegExp(escapeRe(lit), 'i'),
          anchored: false,
        })
      }
    }
  }
  return out
}

const TEXT_SELECTORS  = textSelectors()
const LABEL_SELECTORS = labelSelectors()
const ROLE_SELECTORS  = roleSelectors()

// ── The file that actually renders each anchored selector ──────────────────
// An anchored selector pins one exact string. Matching it against the whole
// of src/ is what let a deleted element keep the test green (R1 #0), so each
// one names its owner here and is matched against that file ALONE. `matches`
// is the complete set of strings that file yields for the selector — recorded
// exactly, so a second copy appearing in the same file also fails.
const ANCHORED_HOME = {
  // App.jsx renders the nav label and the page title from PAGE_TITLES.
  // 'home' is the route id (navigateTo('home')) — a state literal the corpus
  // cannot tell apart from rendered text, never a DOM node. Recorded, not a
  // DOM collision.
  '/^HOME$/i': { file: 'src/App.jsx', matches: ['HOME', 'home'] },

  '/^login$/i': { file: 'src/cloud/auth/LoginScreen.jsx', matches: ['Login'] },

  // ⚠️ TWO matches, and both ARE rendered — see the strict-mode test below.
  '/^NEW PASSWORD$/i': {
    file: 'src/cloud/auth/ResetPasswordWizard.jsx',
    matches: ['NEW PASSWORD', 'New password'],
  },

  '/^RESET PASSWORD$/i': { file: 'src/cloud/auth/ForgotPasswordWizard.jsx', matches: ['Reset password'] },

  '/^continue$/i': { file: 'src/cloud/auth/LoginScreen.jsx', matches: ['Continue'] },
}

// Heading names are not anchored (an accessible name matches as a substring),
// but web-path.spec.ts drives them off App.jsx's `<h1>`s and R1 #1 is right
// that a retyped App.jsx would have gone unnoticed. Pin the file.
const HEADING_HOME = {
  "'O.T.T.E.R.'": 'src/App.jsx',
  "'DASHBOARD'": 'src/App.jsx',
}

// ── Pre-existing strict-mode ambiguities ───────────────────────────────────
// NOT introduced by this session; both predate the D2 restyle (the pre-D2
// title was the literal `NEW PASSWORD`, and the two reset inputs have carried
// these aria-labels since the wizard was written). Recorded so a THIRD one
// fails this suite instead of arriving in a Playwright log.
//
//  a. getByLabel('New password') — Playwright matches an accessible name as a
//     case-insensitive SUBSTRING, so it also selects the input labelled
//     "Confirm new password". Both are mounted together at stage 'form', so
//     this is a genuine strict-mode violation when it runs.
//     Why it is harmless today: both call sites are in auth.spec.ts scenarios
//     2 and 3, which open with `test.skip(SKIP_EMAIL, …)`, and the only
//     automated lane that runs this suite sets PLAYWRIGHT_SKIP_EMAIL=1
//     (playwright.config.ts). It bites the first time someone runs the suite
//     locally against mailpit — the fix is `{ exact: true }` on the two calls
//     in auth.spec.ts, which is a spec edit and not this session's file.
//
//  b. getByLabel('Password') — same substring rule, so it ALSO reaches both
//     reset-wizard inputs. Harmless because its only caller is authFlow.ts's
//     sign-in helper, which runs while App.jsx has `authMode === 'login'`;
//     LoginScreen and ResetPasswordWizard are mutually exclusive branches of
//     that one state value, so the wizard's inputs are not in the DOM.
//
// The third ambiguity — getByText(/^NEW PASSWORD$/i) matching both the
// wizard's title and its AuthField label — is asserted separately below,
// because it is a text collision inside one file rather than a label one.
const KNOWN_LABEL_COLLISIONS = [
  { selector: "getByLabel('New password')", alsoMatches: ['Confirm new password'] },
  { selector: "getByLabel('Password')", alsoMatches: ['Confirm new password', 'New password'] },
]

// Every aria-label the specs select on, and the files that declare it. A
// label in more than one file is only safe while those files cannot be on
// screen together — each one says why.
const LABEL_SITES_EXPECTED = {
  Company: ['src/cloud/auth/LoginScreen.jsx'],
  // Two dialogs, each gated on its own `open` prop and living on different
  // pages (TeamMembersPage / AdminTerminal).
  Email: [
    'src/cloud/auth/InviteMemberDialog.jsx',
    'src/components/AdminTerminal/CreateUserDialog.jsx',
  ],
  Password: ['src/cloud/auth/LoginScreen.jsx'],
  // The two auth screens are mutually exclusive `authMode` branches; the two
  // dialogs are `open`-gated and on different pages.
  Username: [
    'src/cloud/auth/ForgotPasswordWizard.jsx',
    'src/cloud/auth/InviteMemberDialog.jsx',
    'src/cloud/auth/LoginScreen.jsx',
    'src/components/AdminTerminal/CreateUserDialog.jsx',
  ],
  'Confirm new password': ['src/cloud/auth/ResetPasswordWizard.jsx'],
  'New password': ['src/cloud/auth/ResetPasswordWizard.jsx'],
}

// Selectors nothing in this file can check, named rather than dropped. A
// silent skip is the same lie as an over-match.
const SKIPPED_EXPECTED = [
  ['auth.spec.ts', "getByRole('img')", 4, "getByRole('img') has no name option"],
  ['auth.spec.ts', 'getByText(USERNAME)', 1, "USERNAME is imported from './authFlow', not a string literal in this spec"],
  ['web-path.spec.ts', "getByRole('img')", 1, "getByRole('img') has no name option"],
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe('the e2e suite still has something to select', () => {
  it('the suite was actually found and read', () => {
    // A glob that silently matches nothing would make every loop below pass.
    expect(specs.map((s) => s.name).sort()).toEqual(['auth.spec.ts', 'authFlow.ts', 'web-path.spec.ts'])
    expect(RENDERED.length).toBeGreaterThan(500)
    expect(ARIA_LABELS.size).toBeGreaterThan(10)
  })

  it('comments are stripped before anything is harvested', () => {
    // R1 #0's first concrete case: `/^NEW PASSWORD$/i` used to be satisfied by
    // AuthShell.jsx's comment about the label, so deleting the real label left
    // the suite green. AuthShell must still SAY it (the comment is load-bearing
    // documentation) and must no longer COUNT.
    const authShellRaw = readFileSync(join(SRC, 'cloud/auth/AuthShell.jsx'), 'utf8')
    expect(authShellRaw).toContain('NEW PASSWORD')
    expect([...TEXT_BY_FILE.get('src/cloud/auth/AuthShell.jsx')].some((t) => /^NEW PASSWORD$/i.test(t))).toBe(false)
  })

  it('the control: stripping keeps strings and drops only comments', () => {
    const sample = [
      `const url = 'https://example.test/a//b'  // trailing comment`,
      `const re = /a\\/\\/b/  /* block */`,
      `const keep = "keep me"`,
    ].join('\n')
    const stripped = stripComments(sample)
    expect(stripped).toContain(`'https://example.test/a//b'`)
    expect(stripped).toContain(`/a\\/\\/b/`)
    expect(stripped).toContain('"keep me"')
    expect(stripped).not.toContain('trailing comment')
    expect(stripped).not.toContain('block')
  })
})

describe('every getByText in the e2e suite still matches rendered text', () => {
  const selectors = TEXT_SELECTORS

  it('there are selectors to check', () => {
    expect(selectors.length).toBeGreaterThanOrEqual(10)
  })

  it.each(selectors.map((s) => [`${s.spec} ${s.source}`, s]))('%s', (_n, s) => {
    expect(RENDERED.some((t) => s.re.test(t)), `${s.source} matches nothing the app renders`).toBe(true)
  })

  it('the control: the pre-D2 case-sensitive login selector would now fail', () => {
    // This is the exact regex that was in authFlow.ts and web-path.spec.ts
    // before this session, and the reason both were loosened to /^login$/i.
    // If the titles ever go back to uppercase this control starts passing,
    // which is the signal to revisit the two specs.
    const login = TEXT_BY_FILE.get('src/cloud/auth/LoginScreen.jsx')
    expect([...login].some((t) => /^LOGIN$/.test(t))).toBe(false)
    expect([...login].some((t) => /^login$/i.test(t))).toBe(true)
  })
})

describe('every anchored selector resolves inside the file that renders it', () => {
  // R1 #0 / #2: matching an anchored selector against all of src/ means an
  // unrelated module's state literal or comment can stand in for a deleted
  // element. Each anchored selector is matched against ONE file here.
  const anchored = [...new Set(
    [...TEXT_SELECTORS, ...ROLE_SELECTORS].filter((s) => s.anchored).map((s) => s.source),
  )].sort()

  it('every anchored selector in the suite names its file', () => {
    expect(anchored).toEqual(Object.keys(ANCHORED_HOME).sort())
  })

  it.each(Object.entries(ANCHORED_HOME).map(([source, v]) => [`${source} in ${v.file}`, source, v]))(
    '%s',
    (_n, source, { file, matches }) => {
      const body = source.slice(1, source.lastIndexOf('/'))
      const flags = source.slice(source.lastIndexOf('/') + 1)
      const re = new RegExp(body, flags)
      const text = TEXT_BY_FILE.get(file)
      expect(text, `${file} is not a source file this test reads`).toBeTruthy()
      expect([...text].filter((t) => re.test(t)).sort()).toEqual(matches)
    },
  )

  it('the control: the whole-corpus match is genuinely weaker than the per-file one', () => {
    // /^login$/i is satisfied by App.jsx's authMode literal — the exact
    // over-match R1 #0 demonstrated. The corpus still contains it; the
    // per-file check above is what makes LoginScreen.jsx load-bearing.
    expect([...TEXT_BY_FILE.get('src/App.jsx')].some((t) => /^login$/i.test(t))).toBe(true)
    expect([...TEXT_BY_FILE.get('src/App.jsx')].some((t) => /^Login$/.test(t))).toBe(false)
  })

  it.each(Object.entries(HEADING_HOME).map(([source, file]) => [`heading ${source} in ${file}`, source, file]))(
    '%s',
    (_n, source, file) => {
      const lit = source.slice(1, -1).toLowerCase()
      expect(
        [...TEXT_BY_FILE.get(file)].some((t) => t.toLowerCase().includes(lit)),
        `${source} is not rendered by ${file}`,
      ).toBe(true)
    },
  )

  it('every getByRole heading name in the suite names its file', () => {
    const headings = [...new Set(ROLE_SELECTORS.filter((s) => s.role === 'heading').map((s) => s.source))].sort()
    expect(headings).toEqual(Object.keys(HEADING_HOME).sort())
  })
})

describe('every getByLabel in the e2e suite still names a real aria-label', () => {
  const selectors = LABEL_SELECTORS

  it('there are selectors to check', () => {
    expect(selectors.length).toBeGreaterThanOrEqual(6)
  })

  it.each(selectors.map((s) => [`${s.spec} getByLabel('${s.label}')`, s]))('%s', (_n, s) => {
    expect([...ARIA_LABELS], `no aria-label="${s.label}" anywhere in src`).toContain(s.label)
  })

  it('each selected aria-label is declared in exactly the files recorded', () => {
    // The guard the suite deserves: one aria-label, one declaration site,
    // unless the duplicate is recorded above with the reason it is safe. A new
    // file that reuses one of these labels fails here rather than in CI.
    const selected = [...new Set(selectors.map((s) => s.label))].sort()
    expect(selected).toEqual(Object.keys(LABEL_SITES_EXPECTED).sort())
    for (const label of selected) {
      expect(ARIA_LABEL_SITES.get(label), `aria-label="${label}"`).toEqual(LABEL_SITES_EXPECTED[label])
    }
  })

  it('the control: the visible field labels are NOT what the suite selects on', () => {
    // Every auth field pairs an UPPERCASE visible label (the Label role, which
    // is the one role that keeps uppercase) with a sentence-case `aria-label`.
    // The two deliberately differ, and a session that "tidied" them into
    // agreement would break every getByLabel in the suite.
    expect([...ARIA_LABELS]).toContain('New password')
    expect([...ARIA_LABELS]).not.toContain('NEW PASSWORD')
    expect([...TEXT_BY_FILE.get('src/cloud/auth/ResetPasswordWizard.jsx')]).toContain('NEW PASSWORD')
  })
})

describe('every getByRole name in the e2e suite still matches a label', () => {
  const selectors = ROLE_SELECTORS

  it('there are selectors to check', () => {
    expect(selectors.length).toBeGreaterThanOrEqual(5)
    // R1 #1: the first draft understood 'button' only. Both other roles the
    // suite uses must be present, or the extractor has silently narrowed.
    expect([...new Set(selectors.map((s) => s.role))].sort()).toEqual(['button', 'heading'])
  })

  it.each(selectors.map((s) => [`${s.spec} getByRole('${s.role}') name: ${s.source}`, s]))('%s', (_n, s) => {
    expect(RENDERED.some((t) => s.re.test(t)), `${s.source} matches no ${s.role} label`).toBe(true)
  })

  it('the control: a label this session could have "improved" is still verbatim', () => {
    // Sentence-casing a button's TEXT is not the same change as sentence-casing
    // its CSS, and these are load-bearing for the suite.
    for (const label of ['Continue', 'Sign in', 'Send reset link', 'Set password', 'Send invite', 'Set up later']) {
      expect(RENDERED, label).toContain(label)
    }
  })
})

// [spec, selector, count, reason], as the extractors actually produced them.
const DERIVED_SKIPS = (() => {
  const counted = new Map()
  for (const s of SKIPPED) {
    const key = JSON.stringify([s.spec, s.selector, s.reason])
    counted.set(key, (counted.get(key) ?? 0) + 1)
  }
  return [...counted.entries()]
    .map(([k, n]) => { const [spec, selector, reason] = JSON.parse(k); return [spec, selector, n, reason] })
    .sort((a, b) => (a[0] + ' ' + a[1]).localeCompare(b[0] + ' ' + b[1]))
})()

describe('nothing in the suite is skipped silently', () => {
  // Each skip gets its own line in the test report, so "checked" and "not
  // checked" are both visible on the board rather than one being implied by
  // the absence of the other.
  it.each(DERIVED_SKIPS.map((s) => [`SKIPPED x${s[2]}  ${s[0]}  ${s[1]}  — ${s[3]}`, s]))('%s', (_n, s) => {
    const recorded = SKIPPED_EXPECTED.find((e) => e[0] === s[0] && e[1] === s[1])
    expect(recorded, `${s[1]} in ${s[0]} is skipped but not recorded in SKIPPED_EXPECTED`).toBeTruthy()
    expect(s).toEqual(recorded)
  })

  it('the skipped selectors are exactly the ones recorded', () => {
    // The other direction: a recorded skip that no longer happens is a stale
    // exemption, and staleness is how a skip turns back into a silent hole.
    expect(DERIVED_SKIPS).toEqual(SKIPPED_EXPECTED)
  })

  it('every getBy* call site in each spec is either checked or named as skipped', () => {
    const checked = new Map(specs.map((s) => [s.name, 0]))
    for (const s of [...TEXT_SELECTORS, ...LABEL_SELECTORS, ...ROLE_SELECTORS]) {
      checked.set(s.spec, checked.get(s.spec) + 1)
    }
    const skipped = new Map(specs.map((s) => [s.name, 0]))
    for (const s of SKIPPED) skipped.set(s.spec, skipped.get(s.spec) + 1)

    for (const { name, text } of specs) {
      const sites = [...text.matchAll(/getBy[A-Z]\w*\(/g)].length
      expect(checked.get(name) + skipped.get(name), `${name}: ${sites} call sites`).toBe(sites)
    }
  })

  it('the control: the counts are the ones the specs actually contain', () => {
    // A regression that deletes a whole scenario would keep the equality above
    // true while quietly halving the coverage. Pin the totals.
    const sites = Object.fromEntries(specs.map((s) => [s.name, [...s.text.matchAll(/getBy[A-Z]\w*\(/g)].length]))
    expect(sites).toEqual({ 'auth.spec.ts': 38, 'authFlow.ts': 9, 'web-path.spec.ts': 7 })
  })
})

describe("known Playwright strict-mode ambiguities (pre-existing, not this session's)", () => {
  it('the aria-label substring collisions are exactly the recorded set', () => {
    // Playwright's getByLabel is case-insensitive SUBSTRING matching unless
    // `exact: true`, so a label that is a substring of another selects both.
    const selected = [...new Set(LABEL_SELECTORS.map((s) => s.label))].sort()
    const derived = []
    for (const label of selected) {
      const also = [...ARIA_LABELS]
        .filter((k) => k !== label && k.toLowerCase().includes(label.toLowerCase()))
        .sort()
      if (also.length) derived.push({ selector: `getByLabel('${label}')`, alsoMatches: also })
    }
    expect(derived).toEqual(KNOWN_LABEL_COLLISIONS)
  })

  it("getByText(/^NEW PASSWORD$/i) still matches the wizard's title AND its field label", () => {
    // The third ambiguity. auth.spec.ts:116 asserts on /^NEW PASSWORD$/i;
    // ResetPasswordWizard renders the sentence-case TITLE outside every stage
    // guard and the uppercase AuthField LABEL inside `stage === 'form'`, and
    // the regex is case-insensitive, so at stage 'form' it resolves to two
    // elements.
    //
    // Why it is harmless today: `toBeVisible()` polls and stops at the first
    // pass, and the spec asserts immediately after `page.goto(link)` while the
    // wizard is still at stage 'loading' (or 'confirm', which needs a click
    // the spec has not made yet) — only the title is mounted, so the locator
    // resolves to one element and the assertion returns. It stops being
    // harmless the moment anything makes the form stage render before that
    // first poll. Same PLAYWRIGHT_SKIP_EMAIL=1 gate as (a) and (b) above.
    const rpw = CODE_BY_FILE.get('src/cloud/auth/ResetPasswordWizard.jsx')
    const titles = [...rpw.matchAll(/>New password</g)]
    const labels = [...rpw.matchAll(/label="NEW PASSWORD"/g)]
    expect(titles.length, 'the sentence-case title').toBe(1)
    expect(labels.length, 'the uppercase AuthField label').toBe(1)

    const formGuard = rpw.indexOf("{stage === 'form' && (")   // the JSX branch, not the focus effect
    expect(formGuard).toBeGreaterThan(-1)
    expect(titles[0].index, 'the title is outside every stage guard').toBeLessThan(formGuard)
    expect(labels[0].index, "the field label is inside stage 'form'").toBeGreaterThan(formGuard)
  })

  it('the two collision-bearing scenarios are still behind the email skip gate', () => {
    // The reason above rests on this: both scenarios that touch the reset
    // wizard open with test.skip(SKIP_EMAIL, …), and the CI lane sets
    // PLAYWRIGHT_SKIP_EMAIL=1. Remove the gate and the hazards go live.
    const auth = specs.find((s) => s.name === 'auth.spec.ts').text
    expect([...auth.matchAll(/test\.skip\(SKIP_EMAIL,/g)].length).toBe(2)
    expect(auth).toContain("process.env.PLAYWRIGHT_SKIP_EMAIL === '1'")
  })

  it('the control: LoginScreen and ResetPasswordWizard are still mutually exclusive', () => {
    // This is what makes getByLabel('Password') safe. If App.jsx ever mounts
    // both auth surfaces at once, that collision becomes real and this fails.
    const app = CODE_BY_FILE.get('src/App.jsx')
    expect(app).toContain("authMode === 'login'")
    expect(app).toContain("authMode === 'recovery'")
    expect([...app.matchAll(/<LoginScreen/g)].length).toBe(1)
    expect([...app.matchAll(/<ResetPasswordWizard/g)].length).toBe(1)
  })
})
