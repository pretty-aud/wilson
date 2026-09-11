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
//     specifically: O.T.T.E.R. against the wordmark's text node, DASHBOARD
//     against the PAGE_TITLES value that `<h1>{pageLabel}</h1>` renders.
//  4. Five MUTATION controls actually delete the rendering element from a copy
//     of the source, re-run the harvest, and assert the check goes red. "This
//     test would catch a break" is an assertion here, not a claim.
//  5. Everything uncheckable is named in `SKIPPED_EXPECTED`, and a per-spec
//     coverage test compares `getBy*(` call sites against checked + skipped.
//
// It still does not run a browser, so it cannot prove a selector resolves to
// exactly ONE element in a live DOM. The three known strict-mode hazards are
// recorded at the bottom with the condition that keeps each one harmless.
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

// String tables a file renders through an expression. Declared, not guessed:
// App.jsx's page title is `<h1>{pageLabel}</h1>` and `pageLabel` is
// `PAGE_TITLES[currentPage]`, so PAGE_TITLES' VALUES are rendered text while
// its KEYS ('dashboard', 'home') are route ids that are not.
const RENDER_TABLES = { 'src/App.jsx': ['PAGE_TITLES'] }

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
  // The page title `<h1>{pageLabel}</h1>` (PAGE_TITLES.home) and the nav strip
  // item. Both are real DOM text on the home page; the route id 'home' is not
  // a render site and no longer enters the corpus.
  '/^HOME$/i': {
    file: 'src/App.jsx',
    kind: 'text',
    sites: ['table[PAGE_TITLES]:HOME', 'prop[label]:HOME'],
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
  // icon — App.jsx's nav strip buttons are text-only (App.jsx:2044-2046). So
  // the owner is Home.jsx's tile table, not the nav.
  "'Resources'": { file: 'src/components/Home.jsx', kind: 'name', sites: ['prop[label]:Resources'] },
  '/team members/i': { file: 'src/components/Home.jsx', kind: 'name', sites: ['prop[label]:Team Members'] },
  '/dashboard/i': { file: 'src/components/Home.jsx', kind: 'name', sites: ['prop[label]:Dashboard'] },

  '/invite user/i': {
    file: 'src/components/TeamMembers/TeamMembersPage.jsx',
    kind: 'name',
    sites: ['jsxText:Invite User'],
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
//   headings  — text nodes directly inside an <h1>/<h2>, filtered by the
//               selector; recorded exactly.
//   via       — for a heading whose content is an expression: the identifier
//               the <h1> renders, the table it is read from, and the exact
//               table values the selector matches.
const HEADING_HOME = {
  // <h1 …>O.T.T.E.R.</h1> — the wordmark on the tool's own screen.
  "'O.T.T.E.R.'": { file: 'src/App.jsx', headings: ['O.T.T.E.R.'] },

  // <h1 …>{pageLabel}</h1>, pageLabel = PAGE_TITLES[currentPage] (App.jsx:1910).
  // No text node to match, so the chain is asserted instead: the <h1> still
  // renders {pageLabel}, pageLabel still comes from PAGE_TITLES, and
  // PAGE_TITLES still holds exactly this value for the name.
  "'DASHBOARD'": {
    file: 'src/App.jsx',
    headings: [],
    via: { expr: 'pageLabel', table: 'PAGE_TITLES', values: ['table[PAGE_TITLES]:DASHBOARD'] },
  },
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
    expect(app.sites.some((s) => s.kind !== 'table' && /^login$/i.test(s.value))).toBe(false)
    // And the aria-label is harvested, but as `aria` — not as visible text.
    const rpw = BY_FILE.get('src/cloud/auth/ResetPasswordWizard.jsx')
    expect(rpw.sites.some((s) => s.kind === 'aria' && s.value === 'New password')).toBe(true)
    expect(rpw.sites.some((s) => s.kind !== 'aria' && s.value === 'New password')).toBe(true)
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
      const facts = headingFacts(entry.code, source, RENDER_TABLES[file] ?? [])
      expect(facts.headings, `${source} <h1>/<h2> text nodes`).toEqual(headings)
      if (via) {
        expect(facts.exprs, `no <h1>/<h2> renders {${via.expr}}`).toContain(via.expr)
        expect(entry.code, `${via.expr} is no longer read from ${via.table}`).toContain(`${via.expr} = ${via.table}[`)
        expect(facts.tableValues, `${via.table} no longer holds this name`).toEqual(via.values)
      } else {
        expect(headings.length, `${source} must match an <h1>/<h2> text node`).toBeGreaterThan(0)
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

  it("R2 #1b — deleting App.jsx's PAGE_TITLES entry breaks the DASHBOARD heading", () => {
    // Round 1 stayed green because './components/Dashboard/DashboardPage'
    // contains the word.
    const app = BY_FILE.get('src/App.jsx')
    const via = HEADING_HOME["'DASHBOARD'"].via
    const mutated = removeLineWith(app.code, "dashboard: 'DASHBOARD',")
    const after = headingFacts(mutated, "'DASHBOARD'", RENDER_TABLES['src/App.jsx'])
    expect(after.tableValues).not.toEqual(via.values)
    expect(after.tableValues).toEqual([])
    // The import path is still there and still does not count.
    expect(mutated).toContain('./components/Dashboard/DashboardPage')
  })

  it('R2 #1c — deleting the <h1> breaks the DASHBOARD heading too', () => {
    // The other half of the chain: PAGE_TITLES only renders because
    // <h1>{pageLabel}</h1> renders it.
    const app = BY_FILE.get('src/App.jsx')
    const mutated = removeLineWith(app.code, '{pageLabel}</h1>')
    expect(headingFacts(mutated, "'DASHBOARD'", RENDER_TABLES['src/App.jsx']).exprs).not.toContain('pageLabel')
  })

  it('R2 #1d — deleting the login title breaks /^login$/i', () => {
    const mutated = removeLineWith(
      BY_FILE.get('src/cloud/auth/LoginScreen.jsx').code,
      '<div style={AUTH_TITLE_STYLE}>Login</div>',
    )
    expect(pinnedSites(mutated, '/^login$/i')).toEqual([])
  })

  it('R2 #1e — deleting the O.T.T.E.R. wordmark breaks its heading', () => {
    const mutated = removeLineWith(BY_FILE.get('src/App.jsx').code, '>O.T.T.E.R.</h1>')
    const after = headingFacts(mutated, "'O.T.T.E.R.'", RENDER_TABLES['src/App.jsx'])
    expect(after.headings).toEqual([])
    // The nav item and PAGE_TITLES still spell it; neither is a heading.
    expect(renderSites(mutated, RENDER_TABLES['src/App.jsx']).sites.some((s) => s.value === 'O.T.T.E.R.')).toBe(true)
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
    // the fix this file recommends for the label collisions is exactly that
    // edit, so the extractors are run over a synthetic spec instead. Passing
    // the list and the skip sink in means nothing the other tests read moves.
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
