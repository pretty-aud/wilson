// =============================================================================
// authSelectors.test.js — the Playwright suite's selectors, checked without a
// browser (UI overhaul D2; rebuilt after review round 2).
//
// The e2e suite selects the auth screens by their VISIBLE TEXT and by their
// `aria-label`s. This session changed how those screens are typed, and one of
// the changes moves visible text: the page titles go to sentence case (Q2 —
// uppercase survives only in the page-transition title and the 11px Label
// step). `page.getByText(/^LOGIN$/)` was case-SENSITIVE, so "Login" would
// have walked straight past it.
//
// ── The F2/D1 merge (this file's second re-derivation) ─────────────────────
//
// D2 then merged the shell work, which moved the things several of these pins
// named. Nothing here was loosened for it; every pin was re-derived:
//
//   · The page titles left App.jsx for the `src/layout/pages.js` REGISTRY, as
//     `{ id, title, … }` records. `PAGE_TITLES` is derived there now, not
//     declared, and F2 sentence-cased every title ('HOME' → 'Home').
//   · The page `<h1>` left App.jsx for `src/ui/PageHeader.jsx`, so no page
//     title is a text node in the file that used to own it.
//   · `Invite User` became `Invite user` in TeamMembersPage.jsx.
//   · D1's `src/components/settings/ProfileSection.jsx` added
//     `aria-label="Username"` and `aria-label="Email"`, which the e2e suite
//     also selects on — a NEW cross-file label collision, recorded at the
//     bottom as hazard (d) with the reason it is not biting CI yet.
//
// Every e2e selector these touch is case-INSENSITIVE (`/^HOME$/i`,
// `/invite user/i`, and `getByRole('heading', { name: 'DASHBOARD' })`, whose
// accessible-name match is case-insensitive substring without `exact: true`),
// so the sentence-casing did NOT break Playwright. It broke this file's belief
// about WHERE each string lives, which is the thing it exists to state.
//
// 🚨 Playwright cannot run here. It needs a live server and the probe admin's
// password, so the fix the plan prescribes — "source-text tests are updated in
// the same commit as the source they pin" — has no way to prove itself. This
// file is that proof: it reads the specs and the sources and asserts that
// every selector still resolves to something the app actually renders.
//
// ── WHY THIS IS A PARSER AND NOT A PILE OF REGEXES ─────────────────────────
//
// Round 1 found that the first draft OVER-MATCHED: it harvested every quoted
// string in every file under src/, comments included, so `/^NEW PASSWORD$/i`
// was satisfied by a COMMENT and `/^login$/i` by App.jsx's `authMode` state
// literal. Round 1's fix was a hand-written comment stripper. Round 2 broke
// it in one line: the scanner treated any `'` as a string opener, so
// ForgotPasswordWizard's JSX text `We'll email a reset link.` opened a
// pseudo-string that ran to the next quote and inverted string parity for the
// rest of the file. 33 comment lines across 5 files survived into the corpus.
//
// Round 2 also proved, by mutation, that the per-file pin round 1 added was
// inert for three of its seven entries: deleting
// `<div style={AUTH_TITLE_STYLE}>New password</div>` from ResetPasswordWizard
// left the test green (`label="NEW PASSWORD"` and `aria-label="New password"`
// are ATTRIBUTES, not rendered text, and both still matched), and
// `getByRole('heading', { name: 'DASHBOARD' })` was satisfied by the import
// path `./components/Dashboard/DashboardPage`.
//
// Both failures have the same root cause: a regex cannot tell a comment from
// code, or an import path from a heading. So this file parses. `@babel/parser`
// (already present — @vitejs/plugin-react depends on @babel/core) gives a real
// JSX/TS AST, and every string in the corpus now arrives with a PROVENANCE:
//
//   jsxText  a JSX text node                      <div>Login</div>
//   jsxExpr  a string literal in children position {busy ? '…' : 'Continue'}
//   prop     a `label:` / `title:` object value    { label: 'Team Members' }
//   attr     a `label=` / `title=` JSX attribute   <AuthField label="NEW PASSWORD">
//   aria     an `aria-label=` attribute            — accessible name ONLY,
//            never visible text, so it can never satisfy a getByText
//   table    a value in a declared string table    PAGE_TITLES.dashboard
//            — the mechanism is intact and still proved by a control, but F2
//            left it with nothing to point at: see RENDER_TABLES below.
//
// Import paths, route ids, className strings, comparison operands
// (`authMode === 'login'`) and comments are not any of those, so none of them
// can stand in for a deleted element any more.
//
// ── WHAT THIS SUITE NOW PROVES ─────────────────────────────────────────────
//
//  1. Comments are gone from EVERY file, proved over the whole corpus rather
//     than asserted in the header (`stripComments` blanks the character ranges
//     @babel/parser reports as comments, so offsets are preserved and the
//     index arithmetic further down still works).
//  2. EVERY selector the suite uses — not just the anchored ones — names the
//     ONE file that renders it, and is matched against that file alone. The
//     recorded `sites` list is the complete, ORDERED, un-deduplicated set of
//     render sites in that file, so deleting one, adding one, or adding a
//     second identical copy all fail.
//  3. The heading selectors are matched against `<h1>`/`<h2>` content
//     specifically. Since F2, NEITHER of the two is a text node any more —
//     both titles are declared in `src/layout/pages.js` and reach the screen
//     through `<h1 className="ui-page-header-title">{title}</h1>` in
//     `src/ui/PageHeader.jsx`, which App.jsx feeds from the registry. So what
//     is pinned is the CHAIN: the registry still holds exactly this value, a
//     component still renders that value into a heading, and the shell still
//     joins the two. Each of the three links has its own mutation control, so
//     none of them can rot into a comment.
//  4. Six MUTATION controls actually delete the rendering element from a copy
//     of the source, re-run the harvest, and assert the check goes red. "This
//     test would catch a break" is an assertion here, not a claim.
//  5. Everything uncheckable is named in `SKIPPED_EXPECTED`, and a per-spec
//     coverage test compares `getBy*(` call sites against checked + skipped.
//
// It still does not run a browser, so it cannot prove a selector resolves to
// exactly ONE element in a live DOM. The four known strict-mode hazards are
// recorded at the bottom with the condition that keeps each one harmless —
// (d) is the one the F2/D1 merge introduced.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join, resolve, relative } from 'node:path'

const require = createRequire(import.meta.url)
const parser = require('@babel/parser')

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../..')
const REPO = resolve(SRC, '..')            // …/WILSON
const GIT_ROOT = resolve(REPO, '..')       // the repo root; .github lives here
const E2E = resolve(REPO, 'tests/e2e')

const rel = (p) => relative(REPO, p).replace(/\\/g, '/')

const parseOf = (src, ts) =>
  parser.parse(src, { sourceType: 'module', plugins: [ts ? 'typescript' : 'jsx'], ranges: true })

// ── Comment stripping ──────────────────────────────────────────────────────
// Round 1 hand-rolled a scanner and round 2 broke it with an apostrophe. This
// asks the parser where the comments are and blanks exactly those character
// ranges — newlines kept, so every other offset in the file is unchanged and
// the `.indexOf()` arithmetic in the strict-mode test below still means what
// it says. There is no heuristic left to get wrong.
export function stripComments(src, { ts = false } = {}) {
  const ast = parseOf(src, ts)
  const buf = src.split('')
  for (const c of ast.comments ?? []) {
    for (let i = c.start; i < c.end; i++) if (buf[i] !== '\n') buf[i] = ' '
  }
  return buf.join('')
}

// ── Render-site harvest ────────────────────────────────────────────────────
// `label=` / `title=` are component props that the kit renders as visible
// text, so they count for getByText. `aria-label` does NOT — it is an
// accessible name and produces no text node. Keeping them apart is the whole
// of round 2's second finding.
const VISIBLE_ATTRS = new Set(['label', 'title'])
const NAME_ONLY_ATTRS = new Set(['aria-label'])
const VISIBLE_PROPS = new Set(['label', 'title'])
const COMPARISON = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>='])

// String tables a file renders through an expression. Declared, not guessed.
// It used to hold `'src/App.jsx': ['PAGE_TITLES']` — App.jsx's page title was
// `<h1>{pageLabel}</h1>` with `pageLabel = PAGE_TITLES[currentPage]`, so that
// object literal's VALUES were rendered text while its KEYS ('dashboard',
// 'home') were route ids that are not.
//
// 🚨 F2 emptied this, and the empty map is the honest state, not an oversight.
// `PAGE_TITLES` is no longer a hand-typed object anywhere: `src/layout/pages.js`
// DERIVES it (`Object.fromEntries(PAGES.map(…))`) from the page records, so the
// title strings are already `title:` object properties — `prop[title]` sites,
// which VISIBLE_PROPS harvests directly. That is a STRICTLY stronger provenance
// than `table` was: `table` had to be opted into per file by name, whereas a
// `title:` property is recognised wherever it is written. The mechanism stays
// for the next hand-written table and is kept honest by its own control below.
const RENDER_TABLES = {}

function eachNode(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const c of node) eachNode(c, visit, parent); return }
  if (typeof node.type !== 'string') return
  if (visit(node, parent) === false) return
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue
    eachNode(node[k], visit, node)
  }
}

const norm = (s) => s.replace(/\s+/g, ' ').trim()
const tagOf = (el) => (el?.openingElement?.name?.type === 'JSXIdentifier' ? el.openingElement.name.name : null)

/**
 * Every string the file can put on screen, each tagged with how it gets there,
 * plus the `<h1>`/`<h2>` content specifically. Returned as an ARRAY, not a
 * Set: two identical copies of one string are two sites, which is what makes
 * "a second copy also fails" true rather than aspirational.
 */
export function renderSites(src, tables = []) {
  const ast = parseOf(src, false)
  const sites = []
  const headingText = []
  const headingExpr = []
  const add = (kind, value, via) => { const v = norm(value); if (v) sites.push({ kind, value: v, via }) }

  // A string literal in JSX CHILDREN position renders. The test of a ternary,
  // the left of a `&&`, and both sides of a comparison do not.
  const fromChild = (node) => eachNode(node, (m) => {
    if (m.type === 'JSXElement' || m.type === 'JSXFragment') return false
    if (m.type === 'BinaryExpression' && COMPARISON.has(m.operator)) return false
    if (m.type === 'ConditionalExpression') { fromChild(m.consequent); fromChild(m.alternate); return false }
    if (m.type === 'LogicalExpression') { fromChild(m.right); return false }
    if (m.type === 'StringLiteral') add('jsxExpr', m.value)
    if (m.type === 'TemplateLiteral') for (const q of m.quasis) add('jsxExpr', q.value.cooked ?? '')
  })

  eachNode(ast, (n, parent) => {
    if (n.type === 'JSXText') { add('jsxText', n.value); return }

    if (n.type === 'JSXAttribute' && n.value?.type === 'StringLiteral') {
      const nm = n.name.type === 'JSXNamespacedName'
        ? `${n.name.namespace.name}:${n.name.name.name}`
        : n.name.name
      if (VISIBLE_ATTRS.has(nm)) add('attr', n.value.value, nm)
      else if (NAME_ONLY_ATTRS.has(nm)) add('aria', n.value.value, nm)
      return
    }

    if (n.type === 'JSXExpressionContainer' && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment')) {
      fromChild(n.expression)
      return
    }

    if (n.type === 'ObjectProperty' && !n.computed && n.value?.type === 'StringLiteral') {
      const key = n.key.type === 'Identifier' ? n.key.name
        : n.key.type === 'StringLiteral' ? n.key.value : null
      if (key && VISIBLE_PROPS.has(key)) add('prop', n.value.value, key)
      return
    }

    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier'
        && tables.includes(n.id.name) && n.init?.type === 'ObjectExpression') {
      for (const p of n.init.properties) {
        if (p.type === 'ObjectProperty' && p.value?.type === 'StringLiteral') add('table', p.value.value, n.id.name)
      }
      return
    }

    if (n.type === 'JSXElement') {
      const t = tagOf(n)
      if (t !== 'h1' && t !== 'h2') return
      for (const c of n.children) {
        if (c.type === 'JSXText') { const v = norm(c.value); if (v) headingText.push(v) }
        if (c.type === 'JSXExpressionContainer') {
          if (c.expression.type === 'Identifier') headingExpr.push(c.expression.name)
          else if (c.expression.type === 'MemberExpression') headingExpr.push(norm(src.slice(c.expression.start, c.expression.end)))
        }
      }
    }
  })

  return { sites, headingText, headingExpr }
}

/** `jsxText:Login`, `attr[label]:NEW PASSWORD` — how a site is recorded. */
const siteLabel = (s) => `${s.kind}${s.via ? `[${s.via}]` : ''}:${s.value}`

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

const FILES = walk(SRC).map((f) => {
  const path = rel(f)
  const raw = readFileSync(f, 'utf8')
  try {
    const code = stripComments(raw)
    return { path, raw, code, ...renderSites(code, RENDER_TABLES[path] ?? []) }
  } catch (e) {
    // A parse failure is a real failure, not something to recover from — but
    // say WHICH file, or the whole suite reads as broken for no visible reason.
    throw new Error(`${path} does not parse as JSX: ${e.message}`, { cause: e })
  }
})
const BY_FILE = new Map(FILES.map((f) => [f.path, f]))
const CODE_BY_FILE = new Map(FILES.map((f) => [f.path, f.code]))
/** Every distinct render-site value in src/ — a sanity gauge, never a pass criterion. */
const CORPUS = [...new Set(FILES.flatMap((f) => f.sites.map((s) => s.value)))]

/** aria-label value → the source files that declare it, sorted. */
const ARIA_LABEL_SITES = (() => {
  const out = new Map()
  for (const f of FILES) {
    for (const s of f.sites) {
      if (s.kind !== 'aria') continue
      if (!out.has(s.value)) out.set(s.value, new Set())
      out.get(s.value).add(f.path)
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]))
})()
const ARIA_LABELS = new Set(ARIA_LABEL_SITES.keys())

const specs = readdirSync(E2E)
  .filter((f) => /\.ts$/.test(f))
  .map((f) => ({ name: f, text: stripComments(readFileSync(join(E2E, f), 'utf8'), { ts: true }) }))

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `/^x$/i` → RegExp; `'x'` → the literal, case-insensitively. */
function reOfSource(source) {
  if (source.startsWith('/')) {
    const cut = source.lastIndexOf('/')
    return new RegExp(source.slice(1, cut), source.slice(cut + 1))
  }
  return new RegExp(escapeRe(source.slice(1, -1)), 'i')
}

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

// The extractors take the spec list and the skip sink explicitly so the
// `exact: true` control below can run them over a synthetic spec without
// mutating module state that the other tests read.
/** Every `getByText(…)` in the suite — regex, string literal, or identifier. */
function textSelectors(list = specs, sink = SKIPPED) {
  const out = []
  const call = /getByText\(\s*(?:\/((?:\\.|[^/\\])+)\/([gimsuy]*)|'([^'\n]*)'|"([^"\n]*)"|([A-Za-z_$][\w$]*))\s*(?:,\s*\{([^{}]*)\})?\s*\)/g
  for (const { name, text } of list) {
    for (const m of text.matchAll(call)) {
      const opts = m[6] ?? ''
      if (m[1] != null) {
        out.push({ spec: name, kind: 'text', source: `/${m[1]}/${m[2]}`, re: new RegExp(m[1], m[2]) })
        continue
      }
      const lit = m[3] ?? m[4]
      if (lit != null) {
        // R2 #6: getByText('x') is substring + case-insensitive; `exact: true`
        // makes it whole-string and case-SENSITIVE. roleSelectors() has always
        // honoured it — this one used to document it and then ignore it, which
        // models the selector more loosely than Playwright does.
        const exact = /exact:\s*true/.test(opts)
        out.push({
          spec: name,
          kind: 'text',
          source: `'${lit}'${exact ? ' exact' : ''}`,
          re: exact ? new RegExp(`^${escapeRe(lit)}$`) : new RegExp(escapeRe(lit), 'i'),
        })
        continue
      }
      const ident = m[5]
      const value = literalConstant(text, ident)
      if (value != null) {
        out.push({ spec: name, kind: 'text', source: `${ident} = '${value}'`, re: new RegExp(escapeRe(value), 'i') })
      } else {
        const from = importOrigin(text, ident)
        sink.push({
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
function roleSelectors(list = specs, sink = SKIPPED) {
  const out = []
  const call = /getByRole\(\s*'(\w+)'\s*(?:,\s*\{([^{}]*)\})?\s*\)/g
  for (const { name, text } of list) {
    for (const m of text.matchAll(call)) {
      const role = m[1]
      const opts = m[2] ?? ''
      const nm = opts.match(/name:\s*(?:\/((?:\\.|[^/\\])+)\/([gimsuy]*)|'([^'\n]*)'|"([^"\n]*)")/)
      if (!nm) {
        sink.push({ spec: name, selector: `getByRole('${role}')`, reason: `getByRole('${role}') has no name option` })
        continue
      }
      const exact = /exact:\s*true/.test(opts)
      if (nm[1] != null) {
        out.push({ spec: name, role, source: `/${nm[1]}/${nm[2]}`, re: new RegExp(nm[1], nm[2]) })
      } else {
        const lit = nm[3] ?? nm[4]
        // An accessible name matches as a case-insensitive SUBSTRING unless
        // `exact: true`, which makes it whole-string and case-sensitive.
        out.push({
          spec: name,
          role,
          source: `'${lit}'${exact ? ' exact' : ''}`,
          re: exact ? new RegExp(`^${escapeRe(lit)}$`) : new RegExp(escapeRe(lit), 'i'),
        })
      }
    }
  }
  return out
}

const TEXT_SELECTORS  = textSelectors()
const LABEL_SELECTORS = labelSelectors()
const ROLE_SELECTORS  = roleSelectors()

// ── The file that actually renders each selector ───────────────────────────
// Round 1 pinned five anchored selectors to a file and left the rest matched
// against all of src/, which is how renaming LoginScreen's "Sign in" stayed
// green (src/admin/OperatorLogin.jsx renders the same words, and admin/ is
// out of D2's scope entirely). EVERY selector names its owner here.
//
// `sites` is the complete list of render sites that file yields for the
// selector, in source order, un-deduplicated. Delete the element, rename the
// label, or paste a second copy and this list stops matching.
//
// `kind: 'text'` is a getByText — it must have at least one site that is not
// `aria`, because an aria-label is an accessible name and getByText cannot see
// it. `kind: 'name'` is a getByRole name, which an aria-label CAN supply.
const SELECTOR_HOME = {
  // ── MOVED BY F2 ──────────────────────────────────────────────────────────
  // This was TWO strings in App.jsx: `PAGE_TITLES.home = 'HOME'` and the nav
  // strip's hand-pushed `{ label: 'HOME', … }` (old App.jsx:96 and :1715).
  // The registry collapsed them into ONE — `title: 'Home'` in
  // src/layout/pages.js — because the strip now maps `p.navLabel`, which
  // defaults to `p.title`, and the transition title reads the derived
  // PAGE_TITLES. App.jsx does not contain the letters HOME anywhere any more,
  // so pinning it there would pin nothing.
  //
  // The case changed with the file (Q2 sentence case). All five call sites —
  // auth.spec.ts:62/93/154 and web-path.spec.ts:38/50 — select `/^HOME$/i`,
  // case-INSENSITIVE, so this is not a Playwright break, only a move.
  '/^HOME$/i': {
    file: 'src/layout/pages.js',
    kind: 'text',
    sites: ['prop[title]:Home'],
  },

  '/^login$/i': {
    file: 'src/cloud/auth/LoginScreen.jsx',
    kind: 'text',
    sites: ['jsxText:Login'],
  },

  // ⚠️ THREE sites, and two of them are on screen together — see the
  // strict-mode test at the bottom. The `aria` one cannot satisfy a getByText;
  // the other two can, which is the collision.
  '/^NEW PASSWORD$/i': {
    file: 'src/cloud/auth/ResetPasswordWizard.jsx',
    kind: 'text',
    sites: ['jsxText:New password', 'attr[label]:NEW PASSWORD', 'aria[aria-label]:New password'],
  },

  '/^RESET PASSWORD$/i': {
    file: 'src/cloud/auth/ForgotPasswordWizard.jsx',
    kind: 'text',
    sites: ['jsxText:Reset password'],
  },

  // The kit Dialog renders its `title` prop as the heading of the success
  // pane, so this attribute IS the visible text.
  '/invite sent/i': {
    file: 'src/cloud/auth/InviteMemberDialog.jsx',
    kind: 'text',
    sites: ['attr[title]:Invite sent'],
  },

  '/password updated/i': {
    file: 'src/cloud/auth/ResetPasswordWizard.jsx',
    kind: 'text',
    sites: ['jsxText:Password updated. Sign in with your new password.'],
  },

  '/reset link is on its way/i': {
    file: 'src/cloud/auth/ForgotPasswordWizard.jsx',
    kind: 'text',
    sites: ['jsxText:If an account matches that username, a reset link is on its way. Check your inbox — it expires in 1 hour.'],
  },

  '/^continue$/i': {
    file: 'src/cloud/auth/LoginScreen.jsx',
    kind: 'name',
    sites: ['jsxExpr:Continue'],
  },

  // auth.spec.ts and web-path.spec.ts reach these through
  // `.filter({ has: getByRole('img') })`, and only the Home tiles carry an
  // icon — App.jsx's nav strip buttons render bare `{item.label}` and nothing
  // else (App.jsx:2034-2055, the `getNavStripItems().map` block F2 rewrote).
  // So the owner is Home.jsx's tile table, not the nav.
  //
  // F2 left Home.jsx's tile labels alone — they are still 'Resources',
  // 'Team Members' and 'Dashboard' — so these three pins are unchanged.
  "'Resources'": { file: 'src/components/Home.jsx', kind: 'name', sites: ['prop[label]:Resources'] },
  '/team members/i': { file: 'src/components/Home.jsx', kind: 'name', sites: ['prop[label]:Team Members'] },
  '/dashboard/i': { file: 'src/components/Home.jsx', kind: 'name', sites: ['prop[label]:Dashboard'] },

  // F2 sentence-cased the button: `Invite User` → `Invite user`. The file did
  // not move, only the case, and auth.spec.ts:100 selects `/invite user/i` —
  // case-INSENSITIVE — so Playwright is unaffected. Recorded verbatim so the
  // NEXT rename is caught: `toEqual` on the exact site, not `toContain`.
  '/invite user/i': {
    file: 'src/components/TeamMembers/TeamMembersPage.jsx',
    kind: 'name',
    sites: ['jsxText:Invite user'],
  },

  '/send invite/i': {
    file: 'src/cloud/auth/InviteMemberDialog.jsx',
    kind: 'name',
    sites: ['jsxExpr:Send invite'],
  },

  '/set password/i': {
    file: 'src/cloud/auth/ResetPasswordWizard.jsx',
    kind: 'name',
    sites: ['jsxExpr:Set password'],
  },

  '/send reset link/i': {
    file: 'src/cloud/auth/ForgotPasswordWizard.jsx',
    kind: 'name',
    sites: ['jsxExpr:Send reset link'],
  },

  // R2 #2's mutation: renaming this to "Log in" used to leave the suite green,
  // because src/admin/OperatorLogin.jsx renders "Sign in" too. Pinned here it
  // goes red — see the failing control below.
  '/sign in/i': {
    file: 'src/cloud/auth/LoginScreen.jsx',
    kind: 'name',
    sites: ['jsxExpr:Sign in'],
  },

  '/set up later/i': {
    file: 'src/cloud/auth/MfaSection.jsx',
    kind: 'name',
    sites: ['jsxText:Set up later'],
  },

  '/forgot password/i': {
    file: 'src/cloud/auth/LoginScreen.jsx',
    kind: 'name',
    sites: ['jsxText:Forgot password?'],
  },
}

// Heading selectors are matched against `<h1>`/`<h2>` CONTENT, not against
// every string in the file. R2 #1/#3: the substring-over-all-strings form let
// the import path './components/Dashboard/DashboardPage' and the route-id
// literal 'dashboard' satisfy getByRole('heading', { name: 'DASHBOARD' }).
//
//   file      the file that DECLARES the heading's text.
//   headings  — text nodes directly inside an <h1>/<h2> in that file, filtered
//               by the selector; recorded exactly. Empty for a chain.
//   via       — for a heading whose content arrives as an expression, the rest
//               of the chain, one field per link (see below).
//
// ── Why both entries are chains now (F2) ────────────────────────────────────
//
// Before the merge both lived in App.jsx: the O.T.T.E.R. wordmark was a literal
// `<h1 …>O.T.T.E.R.</h1>` (old App.jsx:1873) and the page title was
// `<h1>{pageLabel}</h1>` with `pageLabel = PAGE_TITLES[currentPage]` (old
// App.jsx:1910). F2 deleted BOTH. App.jsx now has exactly one heading of its
// own — the quit dialog's `<h2 …>Close WILSON</h2>` (App.jsx:2276-2284) — and
// every page title, wordmark included, travels the same three-link path:
//
//   1. DECLARED   src/layout/pages.js   { id: 'otter', title: 'O.T.T.E.R.' }
//   2. RENDERED   src/ui/PageHeader.jsx <h1 …>{title}</h1>
//   3. WIRED      src/App.jsx           <PageHeader title={page.title} …>,
//                                       page = getPage(currentPage)
//
// One link is not enough on its own: the registry alone is a data file nothing
// need read, PageHeader alone renders whatever it is handed, and the wiring
// alone proves nothing about the string. So all three are asserted, and each
// has a mutation control below. This is the same shape as the old `via` (the
// <h1>, the binding, the value) with the links spread across three files
// instead of one — which is the only thing F2 actually changed about it.
const CHAIN = {
  renderedBy: 'src/ui/PageHeader.jsx',
  expr: 'title',
  wiredIn: 'src/App.jsx',
  // Exact source fragments, so a rename of `page` or of the `title` prop is a
  // failure here rather than a Playwright log. `<PageHeader` proves the
  // component is still mounted at all.
  wiring: ['<PageHeader', 'title={page.title}', 'const page = getPage(currentPage)'],
}

const HEADING_HOME = {
  // web-path.spec.ts:31 — the wordmark on the tool's own screen, now the
  // `otter` page record's title. Still the literal 'O.T.T.E.R.', dots and all.
  "'O.T.T.E.R.'": {
    file: 'src/layout/pages.js',
    headings: [],
    via: { ...CHAIN, sites: ['prop[title]:O.T.T.E.R.'] },
  },

  // web-path.spec.ts:45. F2 sentence-cased this to 'Dashboard'. The selector
  // is `getByRole('heading', { name: 'DASHBOARD' })` with no `exact: true`,
  // and an accessible name without `exact` matches as a case-INSENSITIVE
  // substring, so 'DASHBOARD' still resolves to 'Dashboard' in a browser —
  // roleSelectors() models exactly that, which is why this pin can record the
  // sentence-case value without lowering anything.
  "'DASHBOARD'": {
    file: 'src/layout/pages.js',
    headings: [],
    via: { ...CHAIN, sites: ['prop[title]:Dashboard'] },
  },
}

// ── Known strict-mode ambiguities ──────────────────────────────────────────
// (a), (b) and (c) are NOT introduced by this session; all three predate the
// D2 restyle (the pre-D2 title was the literal `NEW PASSWORD`, and the two
// reset inputs have carried these aria-labels since the wizard was written).
// (d) IS new — the F2/D1 merge brought it in, and it is written out at the
// same length as the others rather than filed as a footnote. Recorded so a
// FIFTH one fails this suite instead of arriving in a Playwright log.
//
//  a. getByLabel('New password') — Playwright matches an accessible name as a
//     case-insensitive SUBSTRING, so it also selects the input labelled
//     "Confirm new password". Both are mounted together at stage 'form', so
//     this is a genuine strict-mode violation when it runs.
//     Why it is harmless today: both call sites are in auth.spec.ts scenarios
//     2 and 3, which open with `test.skip(SKIP_EMAIL, …)`, and the only
//     automated lane that runs this suite sets PLAYWRIGHT_SKIP_EMAIL=1 —
//     in .github/workflows/rls.yml (the "Run Playwright" step of the e2e-auth
//     job), NOT in playwright.config.ts, which only mentions it in a comment.
//     R2 #7 caught that misattribution; the workflow is asserted below.
//     It bites the first time someone runs the suite locally against mailpit —
//     the fix is `{ exact: true }` on the two calls in auth.spec.ts, which is
//     a spec edit and not this session's file.
//
//  b. getByLabel('Password') — same substring rule, so it ALSO reaches both
//     reset-wizard inputs. Harmless because its only caller is authFlow.ts's
//     sign-in helper, which runs while App.jsx has `authMode === 'login'`;
//     LoginScreen and ResetPasswordWizard are mutually exclusive branches of
//     that one state value, so the wizard's inputs are not in the DOM.
//
//  c. getByText(/^NEW PASSWORD$/i) matching both the wizard's title and its
//     AuthField label — asserted separately below, because it is a text
//     collision inside one file rather than a label one.
//
//  d. 🚨 NEW, and the only one of the four this merge introduced.
//     getByLabel('Email') and getByLabel('Username') are no longer unique
//     ANYWHERE IN THE SIGNED-IN APP. D1's ProfileSection.jsx carries both
//     labels, and — unlike the two `open`-gated dialogs that already shared
//     them — it is MOUNTED on every authed page, not just on Settings:
//
//       App.jsx renders every page at once and hides the inactive ones with
//       `display: currentPage === id ? 'flex' : 'none'` (PageSurface), so
//       <DashboardPage /> is in the DOM from the moment `authed` flips.
//       DashboardPage keeps all three of its tabs mounted on purpose ("the
//       notes editor must not lose its Y.Doc") and hides the profile one with
//       `display: tab === 'profile' ? 'block' : 'none'`, so ProfileSection —
//       and its two inputs — mount with it, as soon as the member row loads.
//
//     Playwright's strict mode counts MATCHED NODES, not visible ones, so
//     `getByLabel('Email').fill(…)` on TeamMembersPage resolves to two
//     elements and throws. `{ exact: true }` does NOT fix this one — both
//     labels are already exactly 'Email' / 'Username'; the fix is to scope
//     the locator to the dialog (`page.getByRole('dialog').getByLabel(…)`),
//     which is a spec edit and not this session's file.
//     Why it is harmless today: every getByLabel that runs while `authed` is
//     true is in auth.spec.ts scenario 2 (:102-103), which opens with
//     `test.skip(SKIP_EMAIL, …)` — the same gate as (a). Every OTHER
//     getByLabel in the suite runs pre-auth: authFlow.ts's three are on
//     LoginScreen before sign-in, scenario 3's Username is on the forgot
//     wizard after `page.goto('/')`, and its New password / Confirm pair are
//     on the recovery screen, which is `authMode === 'recovery'` — and App.jsx
//     mounts the whole page shell only under `{authed && …}`, so none of them
//     can see ProfileSection at all. The mount chain is asserted below; if a
//     lane ever makes DashboardPage lazy-mount the way project-files does,
//     that control fails and this note gets revisited.
const KNOWN_LABEL_COLLISIONS = [
  { selector: "getByLabel('New password')", alsoMatches: ['Confirm new password'] },
  { selector: "getByLabel('Password')", alsoMatches: ['Confirm new password', 'New password'] },
]

// Hazard (d) in the form the suite can check: a selected aria-label declared
// in more than one file. (a)/(b)/KNOWN_LABEL_COLLISIONS are about label VALUES
// being substrings of one another, which is a different failure and misses
// this one entirely — 'Email' is a substring of nothing.
const KNOWN_LABEL_SITE_COLLISIONS = [
  {
    selector: "getByLabel('Email')",
    declaredIn: [
      'src/cloud/auth/InviteMemberDialog.jsx',
      'src/components/AdminTerminal/CreateUserDialog.jsx',
      'src/components/settings/ProfileSection.jsx',
    ],
  },
  {
    selector: "getByLabel('Username')",
    declaredIn: [
      'src/cloud/auth/ForgotPasswordWizard.jsx',
      'src/cloud/auth/InviteMemberDialog.jsx',
      'src/cloud/auth/LoginScreen.jsx',
      'src/components/AdminTerminal/CreateUserDialog.jsx',
      'src/components/settings/ProfileSection.jsx',
    ],
  },
]

// Every aria-label the specs select on, and the files that declare it. A
// label in more than one file is only safe while those files cannot be on
// screen together — each one says why.
const LABEL_SITES_EXPECTED = {
  Company: ['src/cloud/auth/LoginScreen.jsx'],
  // Two dialogs, each gated on its own `open` prop and living on different
  // pages (TeamMembersPage / AdminTerminal) — plus, since D1's Settings work,
  // the profile editor. 🚨 That third one is NOT gated the way the other two
  // are: see hazard (d) at the bottom. It is recorded here because it is
  // real, not because it is safe.
  Email: [
    'src/cloud/auth/InviteMemberDialog.jsx',
    'src/components/AdminTerminal/CreateUserDialog.jsx',
    'src/components/settings/ProfileSection.jsx',
  ],
  Password: ['src/cloud/auth/LoginScreen.jsx'],
  // The two auth screens are mutually exclusive `authMode` branches; the two
  // dialogs are `open`-gated and on different pages. ProfileSection is the
  // fifth and the one that co-mounts — hazard (d).
  Username: [
    'src/cloud/auth/ForgotPasswordWizard.jsx',
    'src/cloud/auth/InviteMemberDialog.jsx',
    'src/cloud/auth/LoginScreen.jsx',
    'src/components/AdminTerminal/CreateUserDialog.jsx',
    'src/components/settings/ProfileSection.jsx',
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

// ── The pin, as one function both the tests and the mutations call ─────────
/** The render sites in `code` that `source` matches, recorded form, in order. */
function pinnedSites(code, source, tables = []) {
  const re = reOfSource(source)
  return renderSites(code, tables).sites.filter((s) => re.test(s.value)).map(siteLabel)
}

/** The `<h1>`/`<h2>` facts a heading pin is checked against. */
function headingFacts(code, source, tables = []) {
  const re = reOfSource(source)
  const { headingText, headingExpr, sites } = renderSites(code, tables)
  return {
    headings: headingText.filter((t) => re.test(t)),
    exprs: headingExpr,
    tableValues: sites.filter((s) => s.kind === 'table' && re.test(s.value)).map(siteLabel),
  }
}

/** Delete the one line containing `needle`. Throws unless it matches exactly one. */
function removeLineWith(src, needle) {
  const lines = src.split(/\r?\n/)
  const at = lines.reduce((acc, l, i) => (l.includes(needle) ? [...acc, i] : acc), [])
  if (at.length !== 1) throw new Error(`mutation needle ${JSON.stringify(needle)} matched ${at.length} lines, expected 1`)
  lines.splice(at[0], 1)
  return lines.join('\n')
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('the e2e suite still has something to select', () => {
  it('the suite was actually found and read', () => {
    // A glob that silently matches nothing would make every loop below pass.
    expect(specs.map((s) => s.name).sort()).toEqual(['auth.spec.ts', 'authFlow.ts', 'web-path.spec.ts'])
    expect(FILES.length).toBeGreaterThan(200)
    expect(CORPUS.length).toBeGreaterThan(500)
    expect(ARIA_LABELS.size).toBeGreaterThan(10)
  })

  it('no comment survives stripping, in ANY file in the corpus', () => {
    // R2 #0. This is the assertion round 1 was missing: it checked ONE string
    // in ONE file (AuthShell.jsx, which happened to parse cleanly) and called
    // the guarantee general. Round 1's hand-written scanner leaves 33 comment
    // lines across 5 files — ForgotPasswordWizard.jsx, SettingsPage.jsx,
    // rabbitHelpContent.jsx, ProjectSummaryView.jsx, TimelineView.jsx —
    // because a `'` in JSX text ("We'll email a reset link.") opens a
    // pseudo-string that runs to the next quote. This fails against that code
    // and passes against a parser.
    const survivors = []
    for (const f of [...FILES.map((x) => ({ name: x.path, text: x.code })), ...specs]) {
      f.text.split('\n').forEach((line, i) => {
        if (/^\s*\/\//.test(line)) survivors.push(`${f.name}:${i + 1}  ${line.trim().slice(0, 70)}`)
      })
    }
    expect(survivors, `${survivors.length} comment line(s) survived stripping`).toEqual([])
  })

  it('the control: the apostrophe that broke round 1 is harmless now', () => {
    // The exact input: ForgotPasswordWizard.jsx renders `We'll email a reset
    // link.` as JSX text, and line comments follow it further down the file.
    // Round 1's scanner read that apostrophe as a string opener, inverted
    // string parity for everything after it, and let those comments through.
    // Asserted on shape, not on any one comment's wording, so another lane
    // editing that file's prose cannot make this control lie either way.
    const fpw = BY_FILE.get('src/cloud/auth/ForgotPasswordWizard.jsx')
    const apostropheAt = fpw.raw.indexOf("We'll email a reset link.")
    expect(apostropheAt, "the apostrophe in JSX text is gone — pick another file's").toBeGreaterThan(-1)
    const commentsAfter = fpw.raw.slice(apostropheAt).split('\n').filter((l) => /^\s*\/\//.test(l))
    expect(commentsAfter.length, 'no line comment follows the apostrophe any more').toBeGreaterThan(0)
    expect(fpw.code).toContain("We'll email a reset link.")   // the text survives
    expect(fpw.code.slice(apostropheAt).split('\n').filter((l) => /^\s*\/\//.test(l))).toEqual([])
    expect(fpw.sites.some((s) => s.value.startsWith('//'))).toBe(false)
  })

  it('the control: stripping keeps strings and drops only comments', () => {
    const sample = [
      `const url = 'https://example.test/a//b'  // trailing comment`,
      `const re = /a\\/\\/b/  /* block */`,
      `const keep = "keep me"`,
      `const apostrophe = <p>We'll keep this</p>  // and drop this`,
    ].join('\n')
    const stripped = stripComments(sample)
    expect(stripped).toContain(`'https://example.test/a//b'`)
    expect(stripped).toContain(`/a\\/\\/b/`)
    expect(stripped).toContain('"keep me"')
    expect(stripped).toContain("We'll keep this")
    expect(stripped).not.toContain('trailing comment')
    expect(stripped).not.toContain('block')
    expect(stripped).not.toContain('and drop this')
    // Offsets are preserved, which the index arithmetic further down needs.
    expect(stripped.length).toBe(sample.length)
  })

  it('the control: provenance separates rendered text from code that merely spells it', () => {
    // The three strings R2 used to defeat round 1's pin. None of them is a
    // render site any more.
    const app = BY_FILE.get('src/App.jsx')
    expect(app.raw).toContain('./components/Dashboard/DashboardPage')   // the import path
    expect(app.raw).toContain("=== 'login'")                            // the authMode compare
    expect(app.sites.some((s) => s.value === './components/Dashboard/DashboardPage')).toBe(false)
    expect(app.sites.some((s) => /^login$/i.test(s.value))).toBe(false)
    // And the aria-label is harvested, but as `aria` — not as visible text.
    const rpw = BY_FILE.get('src/cloud/auth/ResetPasswordWizard.jsx')
    expect(rpw.sites.some((s) => s.kind === 'aria' && s.value === 'New password')).toBe(true)
    expect(rpw.sites.some((s) => s.kind !== 'aria' && s.value === 'New password')).toBe(true)
  })

  it('the control: the `table` provenance still works, though nothing uses it', () => {
    // RENDER_TABLES is empty since F2 (see its comment), so no file in src/
    // exercises the `table` branch any more. Left untested it would rot, and
    // the next hand-written string table would opt into a mechanism that had
    // quietly stopped working — which is the same class of silent hole as a
    // skipped selector. Exercised on a synthetic source instead, including the
    // part that matters: a table's KEYS are route ids and never render.
    const src = `const PAGE_TITLES = { dashboard: 'DASHBOARD', home: 'HOME' }
const Other = { dashboard: 'NOT A TABLE' }
const A = () => <h1>{pageLabel}</h1>`
    const { sites, headingExpr } = renderSites(src, ['PAGE_TITLES'])
    expect(sites.map(siteLabel)).toEqual(['table[PAGE_TITLES]:DASHBOARD', 'table[PAGE_TITLES]:HOME'])
    expect(headingExpr).toEqual(['pageLabel'])
    // Not opted in → not harvested; and the keys are absent either way.
    expect(renderSites(src, []).sites).toEqual([])
    expect(sites.some((s) => s.value === 'dashboard')).toBe(false)
    // …and headingFacts still surfaces the table values a heading pin reads.
    expect(headingFacts(src, "'DASHBOARD'", ['PAGE_TITLES']).tableValues)
      .toEqual(['table[PAGE_TITLES]:DASHBOARD'])
  })
})

describe('every selector in the suite names the file that renders it', () => {
  const sources = [...new Set([
    ...TEXT_SELECTORS.map((s) => s.source),
    ...ROLE_SELECTORS.filter((s) => s.role !== 'heading').map((s) => s.source),
  ])].sort()

  it('the map covers every selector, and nothing it does not', () => {
    // R2 #2 / #4: round 1 pinned 5 of ~18 and wrote a header saying it pinned
    // them all. Equality here is what keeps the two in step.
    expect(sources).toEqual(Object.keys(SELECTOR_HOME).sort())
  })

  it.each(Object.entries(SELECTOR_HOME).map(([source, v]) => [`${source} in ${v.file}`, source, v]))(
    '%s',
    (_n, source, { file, kind, sites }) => {
      const entry = BY_FILE.get(file)
      expect(entry, `${file} is not a source file this test reads`).toBeTruthy()
      expect(pinnedSites(entry.code, source, RENDER_TABLES[file] ?? [])).toEqual(sites)
      // A getByText cannot read an aria-label. If every recorded site were
      // `aria`, the selector would find nothing in a browser.
      if (kind === 'text') {
        expect(sites.some((s) => !s.startsWith('aria')), `${source} is only satisfied by aria-labels`).toBe(true)
      }
    },
  )

  it.each(Object.entries(HEADING_HOME).map(([source, v]) => [`heading ${source} in ${v.file}`, source, v]))(
    '%s',
    (_n, source, { file, headings, via }) => {
      const entry = BY_FILE.get(file)
      expect(entry, `${file} is not a source file this test reads`).toBeTruthy()
      const facts = headingFacts(entry.code, source, RENDER_TABLES[file] ?? [])
      expect(facts.headings, `${source} <h1>/<h2> text nodes`).toEqual(headings)

      if (!via) {
        // A heading whose text is a literal in its own file still gets the
        // direct check — no entry needs it today, and the branch stays so that
        // the next one is not tempted into a chain it does not have.
        expect(headings.length, `${source} must match an <h1>/<h2> text node`).toBeGreaterThan(0)
        return
      }

      // Link 1 — the declaring file still holds EXACTLY this value, in the
      // recorded provenance. Equality, not containment: a rename, a deletion
      // and a second copy each change this list.
      expect(
        pinnedSites(entry.code, source, RENDER_TABLES[file] ?? []),
        `${file} no longer declares this heading's text`,
      ).toEqual(via.sites)

      // Link 2 — a component still renders that value into an <h1>/<h2>.
      // `toEqual`, so deleting PageHeader's <h1> fails here even though two
      // other files in src/ also render an `<h1>{title}</h1>`.
      const renderer = BY_FILE.get(via.renderedBy)
      expect(renderer, `${via.renderedBy} is not a source file this test reads`).toBeTruthy()
      expect(
        renderSites(renderer.code).headingExpr,
        `no <h1>/<h2> in ${via.renderedBy} renders {${via.expr}}`,
      ).toEqual([via.expr])

      // Link 3 — the shell still hands one to the other.
      const shell = BY_FILE.get(via.wiredIn)
      expect(shell, `${via.wiredIn} is not a source file this test reads`).toBeTruthy()
      for (const fragment of via.wiring) {
        expect(shell.code, `${via.wiredIn} no longer contains ${fragment}`).toContain(fragment)
      }
    },
  )

  it('every getByRole heading name in the suite names its file', () => {
    const headings = [...new Set(ROLE_SELECTORS.filter((s) => s.role === 'heading').map((s) => s.source))].sort()
    expect(headings).toEqual(Object.keys(HEADING_HOME).sort())
  })

  it('the control: the whole-corpus match round 1 relied on is genuinely weaker', () => {
    // /sign in/i is R2 #2's mutation. Eleven files in src/ render those words,
    // including src/admin/OperatorLogin.jsx — the operator console, which Q14
    // puts outside D2's scope. A corpus-wide check is satisfied by any of them;
    // the pin above makes LoginScreen.jsx load-bearing.
    const re = /sign in/i
    const owners = FILES.filter((f) => f.sites.some((s) => re.test(s.value))).map((f) => f.path)
    expect(owners.length).toBeGreaterThan(1)
    expect(owners).toContain('src/admin/OperatorLogin.jsx')
    expect(SELECTOR_HOME['/sign in/i'].file).toBe('src/cloud/auth/LoginScreen.jsx')
  })

  it('the control: the pre-D2 case-sensitive login selector would now fail', () => {
    // This is the exact regex that was in authFlow.ts and web-path.spec.ts
    // before this session, and the reason both were loosened to /^login$/i.
    // If the titles ever go back to uppercase this control starts passing,
    // which is the signal to revisit the two specs.
    const login = BY_FILE.get('src/cloud/auth/LoginScreen.jsx').sites.map((s) => s.value)
    expect(login.some((t) => /^LOGIN$/.test(t))).toBe(false)
    expect(login.some((t) => /^login$/i.test(t))).toBe(true)
  })

  it('the control: a label this session could have "improved" is still verbatim, IN ITS OWN FILE', () => {
    // Sentence-casing a button's TEXT is not the same change as sentence-casing
    // its CSS, and these are load-bearing for the suite. Round 1 checked these
    // against all of src/, where 'Sign in' is satisfied by admin/OperatorLogin.
    const owned = {
      Continue: 'src/cloud/auth/LoginScreen.jsx',
      'Sign in': 'src/cloud/auth/LoginScreen.jsx',
      'Send reset link': 'src/cloud/auth/ForgotPasswordWizard.jsx',
      'Set password': 'src/cloud/auth/ResetPasswordWizard.jsx',
      'Send invite': 'src/cloud/auth/InviteMemberDialog.jsx',
      'Set up later': 'src/cloud/auth/MfaSection.jsx',
    }
    for (const [label, file] of Object.entries(owned)) {
      expect(BY_FILE.get(file).sites.map((s) => s.value), `${label} in ${file}`).toContain(label)
    }
  })
})

describe('the mutation controls: deleting the element really does turn this red', () => {
  // R2 #1's charge was that the pin was inert — it passed whether or not the
  // element existed. The only answer to that is to delete the element and show
  // the check fail. These read a source into a string, remove one line from
  // the COPY, re-run the harvest, and assert the pin no longer holds. Nothing
  // on disk is touched.

  it('R2 #1a — deleting the reset wizard title breaks /^NEW PASSWORD$/i', () => {
    // The mutation R2 ran: round 1 stayed green because label="NEW PASSWORD"
    // and aria-label="New password" still matched.
    const file = 'src/cloud/auth/ResetPasswordWizard.jsx'
    const pin = SELECTOR_HOME['/^NEW PASSWORD$/i']
    const mutated = removeLineWith(BY_FILE.get(file).code, '<div style={AUTH_TITLE_STYLE}>New password</div>')
    const after = pinnedSites(mutated, '/^NEW PASSWORD$/i')
    expect(after).not.toEqual(pin.sites)
    expect(after).toEqual(['attr[label]:NEW PASSWORD', 'aria[aria-label]:New password'])
    // …and the survivors are exactly what round 1 mistook for the title.
    expect(after.filter((s) => s.startsWith('jsxText'))).toEqual([])
  })

  it("R2 #1b — deleting the registry's Dashboard title breaks the DASHBOARD heading", () => {
    // LINK 1 of the chain. This used to delete `dashboard: 'DASHBOARD',` from
    // App.jsx's PAGE_TITLES; F2 moved the declaration to the page registry, so
    // the mutation moved with it. Round 1 stayed green through this because
    // './components/Dashboard/DashboardPage' contains the word — which is
    // still in App.jsx, and still does not count. Asserted below rather than
    // claimed, because that import is the exact over-match this file exists
    // to have closed.
    const pages = BY_FILE.get('src/layout/pages.js')
    const via = HEADING_HOME["'DASHBOARD'"].via
    const mutated = removeLineWith(pages.code, "title: 'Dashboard',")
    const after = pinnedSites(mutated, "'DASHBOARD'", RENDER_TABLES['src/layout/pages.js'] ?? [])
    expect(after).not.toEqual(via.sites)
    expect(after).toEqual([])

    const app = BY_FILE.get('src/App.jsx')
    expect(app.code).toContain('./components/Dashboard/DashboardPage')
    expect(pinnedSites(app.code, "'DASHBOARD'"), 'App.jsx renders nothing named DASHBOARD').toEqual([])
  })

  it('R2 #1c — deleting PageHeader\'s <h1> breaks the DASHBOARD heading too', () => {
    // LINK 2. The registry only renders because something renders it, and
    // since F2 that something is one <h1> in one file, shared by every page
    // header in the app. Deleting it silences all of them at once.
    const header = BY_FILE.get('src/ui/PageHeader.jsx')
    expect(renderSites(header.code).headingExpr).toEqual(['title'])
    const mutated = removeLineWith(header.code, '<h1 className="ui-page-header-title">{title}</h1>')
    expect(renderSites(mutated).headingExpr).toEqual([])
    // The registry still holds the value; with no heading it is data on disk.
    expect(pinnedSites(BY_FILE.get('src/layout/pages.js').code, "'DASHBOARD'")).toEqual(["prop[title]:Dashboard"])
  })

  it('R2 #1f — deleting App.jsx\'s title={page.title} breaks the chain', () => {
    // LINK 3, and the link that did not exist before F2. Both other links can
    // be perfect while the shell hands PageHeader something else entirely —
    // a literal, the route id, nothing at all — and no assertion on either
    // file alone would notice.
    const app = BY_FILE.get('src/App.jsx')
    const wiring = HEADING_HOME["'DASHBOARD'"].via.wiring
    const mutated = removeLineWith(app.code, 'title={page.title}')
    expect(wiring.filter((f) => !mutated.includes(f))).toEqual(['title={page.title}'])
    // …and the two links that are not the wiring are untouched, so this
    // control fails for its own reason and not by collateral.
    expect(mutated).toContain('<PageHeader')
    expect(mutated).toContain('const page = getPage(currentPage)')
  })

  it('R2 #1d — deleting the login title breaks /^login$/i', () => {
    const mutated = removeLineWith(
      BY_FILE.get('src/cloud/auth/LoginScreen.jsx').code,
      '<div style={AUTH_TITLE_STYLE}>Login</div>',
    )
    expect(pinnedSites(mutated, '/^login$/i')).toEqual([])
  })

  it('R2 #1e — deleting the O.T.T.E.R. wordmark breaks its heading', () => {
    // The wordmark was a literal `<h1 …>O.T.T.E.R.</h1>` in App.jsx, so this
    // control used to delete that line. F2 deleted it for real: the wordmark
    // is the `otter` page record's title now and reaches the same <h1> as
    // every other page title, so the mutation is link 1 of its chain.
    const pages = BY_FILE.get('src/layout/pages.js')
    const mutated = removeLineWith(pages.code, "title: 'O.T.T.E.R.',")
    expect(pinnedSites(mutated, "'O.T.T.E.R.'")).toEqual([])
    // Nine other files in src/ still spell the wordmark — Home's tile label
    // among them — and not one of them is this heading. That is the whole
    // point of pinning the declaring file rather than the corpus.
    const elsewhere = FILES.filter((f) => f.path !== 'src/layout/pages.js'
      && f.sites.some((s) => s.value.includes('O.T.T.E.R.')))
    expect(elsewhere.length).toBeGreaterThan(1)
    expect(elsewhere.map((f) => f.path)).toContain('src/components/Home.jsx')
    // And PageHeader's <h1> survives the mutation — it renders {title}, and
    // there is simply no longer a title for it to render here.
    expect(renderSites(BY_FILE.get('src/ui/PageHeader.jsx').code).headingExpr).toEqual(['title'])
  })

  it('R2 #2 — renaming LoginScreen\'s "Sign in" breaks /sign in/i', () => {
    // The mutation that stayed green under round 1, because
    // src/admin/OperatorLogin.jsx renders the same two words.
    const file = 'src/cloud/auth/LoginScreen.jsx'
    const code = BY_FILE.get(file).code
    expect(code).toContain("'Signing in…' : 'Sign in'")
    const mutated = code.replace("'Signing in…' : 'Sign in'", "'Logging in…' : 'Log in'")
    expect(pinnedSites(mutated, '/sign in/i')).toEqual([])
    expect(SELECTOR_HOME['/sign in/i'].sites).toEqual(['jsxExpr:Sign in'])
  })

  it('R2 #5 — a second identical copy in the same file fails too', () => {
    // Round 1's comment promised this and could not deliver it: `harvest()`
    // returned a Set, so N copies and 1 copy were indistinguishable. Sites are
    // an array now, so a duplicate is visible — which matters because two
    // identical copies is exactly what a Playwright strict-mode violation is.
    const twice = renderSites('const A = () => <><div>HOME</div><span>HOME</span></>')
    expect(twice.sites.map(siteLabel)).toEqual(['jsxText:HOME', 'jsxText:HOME'])
    const once = renderSites('const A = () => <div>HOME</div>')
    expect(once.sites.map(siteLabel)).toEqual(['jsxText:HOME'])
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
    const rpw = BY_FILE.get('src/cloud/auth/ResetPasswordWizard.jsx')
    expect([...ARIA_LABELS]).toContain('New password')
    expect([...ARIA_LABELS]).not.toContain('NEW PASSWORD')
    expect(rpw.sites.filter((s) => s.kind !== 'aria').map((s) => s.value)).toContain('NEW PASSWORD')
  })
})

describe('the extractors see every selector shape the suite uses', () => {
  it('there are selectors to check, and every role is handled', () => {
    expect(TEXT_SELECTORS.length).toBeGreaterThanOrEqual(10)
    expect(ROLE_SELECTORS.length).toBeGreaterThanOrEqual(5)
    // R1 #1: the first draft understood 'button' only. Both roles the suite
    // uses must be present, or the extractor has silently narrowed.
    expect([...new Set(ROLE_SELECTORS.map((s) => s.role))].sort()).toEqual(['button', 'heading'])
  })

  it('the control: getByText honours { exact: true } the way getByRole does', () => {
    // R2 #6: textSelectors() documented `exact` and then never read it, so a
    // `getByText('Invite sent', { exact: true })` would have been checked as a
    // case-insensitive SUBSTRING — looser than Playwright, which is the class
    // of over-match this whole file exists to close. No spec uses it yet, and
    // the fix this file recommends for the SUBSTRING collisions (a) and (b) is
    // exactly that edit — hazard (d) needs a scoped locator instead, since its
    // two labels are already equal, not merely overlapping — so the extractors
    // are run over a synthetic spec. Passing the list and the skip sink in
    // means nothing the other tests read moves.
    const synthetic = [{
      name: 'synthetic.ts',
      text: [
        `page.getByText('Invite sent', { exact: true })`,
        `page.getByText('Invite sent')`,
        `page.getByRole('button', { name: 'Invite sent', exact: true })`,
      ].join('\n'),
    }]
    const sink = []
    const [strict, loose] = textSelectors(synthetic, sink)
    const [role] = roleSelectors(synthetic, sink)
    expect(sink).toEqual([])
    expect(strict.source).toBe("'Invite sent' exact")
    expect(strict.re.source).toBe('^Invite sent$')
    expect(strict.re.flags).toBe('')
    expect(strict.re.test('invite sent!')).toBe(false)
    expect(loose.re.test('invite sent!')).toBe(true)
    expect(role.re.source).toBe(strict.re.source)   // the two extractors agree
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

describe('known Playwright strict-mode ambiguities ((a)-(c) pre-existing, (d) from the F2/D1 merge)', () => {
  it('the aria-label substring collisions are exactly the recorded set', () => {
    // Playwright's getByLabel is case-insensitive SUBSTRING matching unless
    // `exact: true`, so a label that is a substring of another selects both.
    // D1's new labels (Display name, Pronouns, Title, Department, Role) add no
    // new substring overlap, which is why this set is unchanged by the merge —
    // the merge's collision is (d), a same-VALUE one, checked next.
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

  it('(d) the selected aria-labels declared in MORE THAN ONE file are exactly the recorded set', () => {
    // The other axis: one label value, several declaring files. Derived from
    // the same harvest as LABEL_SITES_EXPECTED, so a sixth file reusing
    // 'Username' shows up here as a collision and not merely as a longer list.
    const selected = [...new Set(LABEL_SELECTORS.map((s) => s.label))].sort()
    const derived = selected
      .map((label) => ({ selector: `getByLabel('${label}')`, declaredIn: ARIA_LABEL_SITES.get(label) ?? [] }))
      .filter((c) => c.declaredIn.length > 1)
    expect(derived).toEqual(KNOWN_LABEL_SITE_COLLISIONS)
  })

  it('(d) the control: the profile editor really is mounted on every authed page', () => {
    // What turns (d) from "two files spell the same label" into a real strict-
    // mode violation. Each link is a source fragment, so a lane that changes
    // any of them fails here and the hazard note gets re-derived rather than
    // quietly going stale.
    const app = CODE_BY_FILE.get('src/App.jsx')
    const dash = CODE_BY_FILE.get('src/components/Dashboard/DashboardPage.jsx')
    const profile = CODE_BY_FILE.get('src/components/settings/ProfileSection.jsx')

    // 1. The page shell exists only while signed in — which is why every
    //    PRE-auth getByLabel in the suite is untouched by this.
    expect(app).toContain('{authed && (')
    // 2. Inside it, every page is mounted and the inactive ones are HIDDEN,
    //    not unmounted. `project-files` is the one page that opted out, and it
    //    is here as the contrast: opting out is possible, and Dashboard has
    //    not done it.
    expect(app).toContain("display: currentPage === id ? 'flex' : 'none'")
    expect(app).toContain('<DashboardPage />')
    expect(app).toContain("{currentPage === 'project-files' && <ProjectFilesExplorer />}")
    // 3. DashboardPage keeps all three tabs mounted on purpose, so its profile
    //    tab is in the DOM whatever tab is selected…
    expect(dash).toContain("display: tab === 'profile' ? 'block' : 'none'")
    expect(dash).toContain('<ProfileSection />')
    // 4. …and that profile tab is the one carrying the two colliding labels.
    expect(profile).toContain('aria-label="Username"')
    expect(profile).toContain('aria-label="Email"')

    // The contrast that proves step 3 is the load-bearing one: SettingsPage
    // mounts the SAME component behind a real conditional, so Settings alone
    // would never have collided with anything.
    expect(CODE_BY_FILE.get('src/components/SettingsPage.jsx')).toContain("{activeTab === 'profile' && (")
  })

  it('(d) the control: every getByLabel that runs while signed in is behind the email gate', () => {
    // The condition that keeps (d) harmless in CI, stated as a check rather
    // than as prose. auth.spec.ts scenario 2 is the only place a getByLabel
    // runs after a completed sign-in, and it opens with test.skip(SKIP_EMAIL).
    // Everything else is pre-auth: authFlow.ts's three are on LoginScreen, and
    // scenario 3's are on the forgot wizard and the recovery screen, neither
    // of which mounts the page shell.
    const auth = specs.find((s) => s.name === 'auth.spec.ts').text
    const flow = specs.find((s) => s.name === 'authFlow.ts').text
    const web = specs.find((s) => s.name === 'web-path.spec.ts').text

    // web-path.spec.ts selects no labels of its own — all of its sign-in goes
    // through authFlow — so it cannot reach this hazard at all.
    expect([...web.matchAll(/getByLabel\(/g)].length).toBe(0)
    // Company, the Username visibility wait, Username.fill, Password.fill —
    // all four inside clearCompanyStep/signInHere, all on LoginScreen.
    expect([...flow.matchAll(/getByLabel\(/g)].length).toBe(4)

    // In auth.spec.ts, every getByLabel must sit after a `test.skip(SKIP_EMAIL`
    // in its own scenario. Scenario 1 — the one lane that signs in and is NOT
    // skipped — must contain none.
    const scenarios = auth.split(/^test\(/m).slice(1)
    const unskipped = scenarios.filter((s) => !s.includes('test.skip(SKIP_EMAIL,'))
    expect(unskipped.length, 'exactly one scenario runs without the email gate').toBe(1)
    expect(
      [...unskipped[0].matchAll(/getByLabel\(/g)].length,
      'a getByLabel appeared in the ungated scenario — hazard (d) is now LIVE in CI',
    ).toBe(0)
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
    // first poll. Same PLAYWRIGHT_SKIP_EMAIL=1 gate as (a) and (d) — (b) is
    // the one held harmless by mutual exclusion rather than by the gate.
    //
    // The offsets below are the real ones: stripComments() blanks comment
    // characters in place rather than deleting them, so indices into the
    // stripped code are indices into the source.
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
    // Half of the gate: both scenarios that touch the reset wizard open with
    // test.skip(SKIP_EMAIL, …) and read the env var.
    const auth = specs.find((s) => s.name === 'auth.spec.ts').text
    expect([...auth.matchAll(/test\.skip\(SKIP_EMAIL,/g)].length).toBe(2)
    expect(auth).toContain("process.env.PLAYWRIGHT_SKIP_EMAIL === '1'")
  })

  it('the CI lane still SETS the email skip gate', () => {
    // R2 #7: the assertion above is satisfied by a spec that merely READS the
    // variable. The half that decides is the workflow, and the comment used to
    // cite playwright.config.ts, which only mentions it in prose. Delete the
    // line below from the workflow and all three hazards go live in CI while
    // the spec-side assertion stays green.
    // The app lives in WILSON/ and .github/ sits beside it at the git root, so
    // look in both rather than hard-coding one checkout layout.
    const workflow = [GIT_ROOT, REPO]
      .map((base) => resolve(base, '.github/workflows/rls.yml'))
      .find((p) => existsSync(p))
    expect(workflow, '.github/workflows/rls.yml not found — fix this path, do not delete this test').toBeTruthy()
    const yml = readFileSync(workflow, 'utf8')
    expect(yml).toContain("PLAYWRIGHT_SKIP_EMAIL: '1'")
    expect(yml).toContain('npx playwright test')
    // And the misattributed citation: the config does NOT set it.
    const config = readFileSync(resolve(REPO, 'playwright.config.ts'), 'utf8')
    expect(stripComments(config, { ts: true })).not.toContain('PLAYWRIGHT_SKIP_EMAIL')
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
