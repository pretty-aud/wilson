// =============================================================================
// writeGate.test.js — Session 29.
//
// A source-level guard, in the shape taskPayloadKeys.test.js established, for
// two failures that no runtime test in this repo can see. Nothing in the suite
// mounts React, so there is no way to assert "the New task button is greyed for
// a reviewer" — the honest substitute is to assert, in the source, that the
// gate is REFERENCED and that it is referenced CORRECTLY.
//
// ── WHAT HAPPENED (1): the ungated surface ───────────────────────────────────
// `TimelineView.jsx` had ZERO occurrences of canWrite / canOnProject /
// usePermissions. It was the only task-creating surface in R.A.B.B.I.T. with no
// permission gate at all, so it offered a dozen ways to create a task to users
// the database would always refuse, and the refusal reached them as
//
//     new row violates row-level security policy for table "tasks"
//
// That took four sessions to find because a missing gate has no symptom until
// someone without permission uses the screen — and everyone who tested it had
// permission. This test fails the moment the gate is deleted again.
//
// ── WHAT HAPPENED (2): the silently-wrong gate ───────────────────────────────
// 🚨 This is the more valuable half, and it caught a REAL live defect while
// being written. `canOnProject` takes `{ appRole, projectRole, isStaffed,
// ready }` and `ready` DEFAULTS TO TRUE. Omit it and "permissions are still
// loading" evaluates as "denied": `appRole` is null until the first
// getSession() settles, so on a staffed project the seat check fails and the
// control disappears for someone fully authorised. If getSession() never
// settles — the known auth-js global-lock defect — it never comes back.
//
// That is the S23 bug. S23 fixed it in ProjectTasksView and ProjectAssetsView
// and the fix was never carried to `TaskDetailPopup.jsx`, which passed three of
// the four fields and looked entirely correct for five sessions. A grep for
// "does this file have a gate" says yes. Only reading the ARGUMENT says no.
//
// So the scan resolves each call's context object — inline literal or named
// const — and requires `ready` in it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(full, out)
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Read one source file by its path relative to `src/`. */
function readSrc(rel) {
  return readFileSync(join(SRC, rel), 'utf8')
}

/**
 * Blank out comments, preserving every offset and line break.
 *
 * Necessary, not tidy: TeamView's header comment says "canOnProject() here is
 * presentation only", and the raw scan matched that prose as a call site with
 * an unresolvable context object. A guard that reports a phantom offender is
 * one someone eventually silences, taking the real offenders with it.
 * Replacing comment bodies with spaces keeps `line` and every index correct.
 */
function blankComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++ }
    } else if (text[i] === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '
        i++
      }
      out += '  '
      i += 2
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

/**
 * Balanced-paren scan for `canOnProject(` argument lists — a regex cannot do
 * this, because the first argument is usually a multi-line object literal.
 * Returns { file, line, args } per site.
 */
function canOnProjectCallSites() {
  const sites = []
  for (const file of walk(SRC)) {
    const text = blankComments(readFileSync(file, 'utf8'))
    const re = /\bcanOnProject\s*\(/g
    let m
    while ((m = re.exec(text)) !== null) {
      let depth = 1
      let i = re.lastIndex
      while (i < text.length && depth > 0) {
        const c = text[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        i++
      }
      sites.push({
        file: relative(SRC, file).replace(/\\/g, '/'),
        line: text.slice(0, m.index).split('\n').length,
        args: text.slice(re.lastIndex, i - 1),
        text,
      })
    }
  }
  return sites
}

/**
 * The context object a call site actually passes, as raw text.
 *
 * Two shapes are in use and both are legitimate:
 *   canOnProject({ appRole, … }, 'action')   → inline literal
 *   canOnProject(gateCtx, 'action')          → a const declared above
 * The second is the reason a naive "does the call contain `ready`" regex is
 * not enough: it would report a false failure on every correct call site that
 * happens to name its object.
 */
function contextTextFor(site) {
  const first = site.args.trimStart()
  if (first.startsWith('{')) {
    let depth = 0
    for (let i = 0; i < first.length; i++) {
      if (first[i] === '{') depth++
      else if (first[i] === '}') {
        depth--
        if (depth === 0) return first.slice(0, i + 1)
      }
    }
    return first
  }
  const ident = first.match(/^([A-Za-z_$][\w$]*)/)?.[1]
  if (!ident) return null
  // Resolve `const <ident> = { … }` in the same file.
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*=\\s*\\{`)
  const dm = declRe.exec(site.text)
  if (!dm) return null
  const openIdx = site.text.indexOf('{', dm.index)
  let depth = 0
  for (let i = openIdx; i < site.text.length; i++) {
    if (site.text[i] === '{') depth++
    else if (site.text[i] === '}') {
      depth--
      if (depth === 0) return site.text.slice(openIdx, i + 1)
    }
  }
  return null
}

/* ── Reading a JSX element's own attributes (UI overhaul B3, 2026-09-24) ─────
 *
 * The Timeline test below used to find each pane's props by slicing from
 * `<Pane` to the literal "\n      />" — the closing line at SIX spaces of
 * indent — so it checked the file's formatting as much as its gate. Measured
 * by mutating the real file (eight mutants, three legitimate edits): a
 * re-indented block did not fail it, the slice ran on past the block to the
 * next six-space closer in the file, so a re-indented DetailPane with its
 * prop DELETED still passed on a later element's prop. A prop inside a
 * comment passed; `canWrite={true}` after the real prop (the value React
 * uses) passed; a spread after it passed; and a second, ungated render was
 * never looked at. The restyle has to touch all three blocks, so the check
 * had to stop depending on how they are laid out before that began.
 *
 * So this reads what React reads: the element's opening tag, scanned from
 * `<Name` to the `>` or `/>` that closes it, with braces, strings, template
 * literals and comments tracked, so a `>` inside an arrow function or a
 * comparison never ends the tag. The result is the tag's attributes in
 * order — [name, value text] — with a spread recorded as '...'. Anything the
 * scanner cannot read returns null, which the test reports as a FAILURE:
 * an unparseable tag is never a pass.
 */
function skipQuoted(src, i) { // src[i] is ' or "
  const q = src[i]
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] === q) return i + 1
  }
  return -1
}

function skipComment(src, i) { // src[i] is '/', src[i + 1] is '/' or '*'
  if (src[i + 1] === '/') {
    const end = src.indexOf('\n', i)
    return end < 0 ? src.length : end
  }
  const end = src.indexOf('*/', i + 2)
  return end < 0 ? -1 : end + 2
}

function skipTemplate(src, i) { // src[i] is a backtick
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] === '`') return i + 1
    if (src[i] === '$' && src[i + 1] === '{') {
      const end = skipBraced(src, i + 1)
      if (end < 0) return -1
      i = end - 1
    }
  }
  return -1
}

/** From a `{`, the index just past its matching `}` (or -1). */
function skipBraced(src, i) {
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"') i = skipQuoted(src, i)
    else if (c === '`') i = skipTemplate(src, i)
    else if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) i = skipComment(src, i)
    else {
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) return i + 1
      i++
    }
    if (i < 0) return -1
  }
  return -1
}

/** The attributes of the JSX opening tag that starts at `from`, in order, or null. */
function openingTagAttributes(src, from) {
  const open = /^<[A-Za-z_$][\w$.]*/.exec(src.slice(from, from + 200))
  if (!open) return null
  const attrs = []
  let i = from + open[0].length
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '>' || (c === '/' && src[i + 1] === '>')) return attrs
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      i = skipComment(src, i)
      if (i < 0) return null
      continue
    }
    if (c === '{') {
      const end = skipBraced(src, i)
      if (end < 0) return null
      attrs.push(['...', src.slice(i + 1, end - 1).trim()])
      i = end
      continue
    }
    const name = /^[A-Za-z_$][\w$:-]*/.exec(src.slice(i, i + 200))
    if (!name) return null
    i += name[0].length
    let j = i
    while (/\s/.test(src[j] || '')) j++
    if (src[j] !== '=') { attrs.push([name[0], 'true']); continue }
    j++
    while (/\s/.test(src[j] || '')) j++
    let end = -1
    if (src[j] === '{') end = skipBraced(src, j)
    else if (src[j] === '"' || src[j] === "'") end = skipQuoted(src, j)
    if (end < 0) return null
    const raw = src.slice(j, end)
    attrs.push([name[0], raw[0] === '{' ? raw.slice(1, -1).trim() : raw])
    i = end
  }
  return null
}

/** What `canWrite` resolves to on an element: the LAST spelling wins, and a
    spread after it could replace it, so that is reported as 'spread'. */
function gateValue(attrs) {
  let at = -1
  attrs.forEach(([name], k) => { if (name === 'canWrite') at = k })
  if (at < 0) return null
  if (attrs.slice(at + 1).some(([name]) => name === '...')) return 'spread'
  return attrs[at][1]
}

/** Offsets of every `<Name` render in `code` (not `<NameX`, not `</Name`). */
const renderSites = (code, name) => [...code.matchAll(new RegExp(`<${name}(?![\\w$.])`, 'g'))].map((m) => m.index)

describe('project write gate', () => {
  const sites = canOnProjectCallSites()

  it('finds the call sites at all — the instrument works', () => {
    // Standing rule 2: before believing an absence, prove the instrument can
    // see a presence. A scan that silently matched nothing would pass every
    // assertion below forever.
    expect(sites.length).toBeGreaterThanOrEqual(4)
    expect(sites.some(s => s.file.includes('ProjectTasksView'))).toBe(true)
  })

  it('every canOnProject() call passes `ready` — omitting it renders "loading" as "denied"', () => {
    const offenders = []
    for (const site of sites) {
      // projectRoleMatrix.js defines the function and calls it internally from
      // projectActionDeniedReason, forwarding whatever ctx it was handed.
      if (site.file.endsWith('permissions/projectRoleMatrix.js')) continue
      const ctxText = contextTextFor(site)
      if (ctxText == null) {
        offenders.push(`${site.file}:${site.line} (context object could not be resolved)`)
        continue
      }
      if (!/\bready\s*[:,}]/.test(ctxText)) {
        offenders.push(`${site.file}:${site.line}`)
      }
    }
    expect(offenders,
      '`ready` defaults to TRUE inside canOnProject, so a call that omits it ' +
      'turns "the session has not resolved yet" into "denied" — the control ' +
      'vanishes for an authorised user and, if getSession() hangs, never returns'
    ).toEqual([])
  })

  it('TimelineView gates its writes — it is the surface that had no gate at all', () => {
    const text = blankComments(readSrc('tools/rabbit_v0.1.0/views/TimelineView.jsx'))

    // 🚨 The first draft of this test asserted only that the file MENTIONED
    // useProjectAccess. Proving it by breaking it (replacing the gate with
    // `const canWrite = true` while leaving the import in place) showed all
    // five assertions still passing — the exact S29 defect, reintroducible in
    // one line, with a green suite. Requiring the CALL is what closes it, and
    // it is the reason the house rule is "prove a test by breaking it" rather
    // than "watch it pass".
    expect(text, 'TimelineView must CALL the gate, not merely import it')
      .toMatch(/useProjectAccess\s*\(/)

    // And the flag must come FROM that call. A hardcoded `canWrite = true`
    // satisfies every downstream check while gating nothing.
    //
    // ⚠️ Stated positively on purpose. The first attempt asserted the file
    // contains no `canWrite = true`, which FAILED on the real code: five
    // sub-components legitimately declare `canWrite = true` as a DEFAULT
    // PARAMETER. A blunt negative would have had to be deleted, and the
    // assertion with it.
    expect(text, 'canWrite must be destructured from the gate, not assigned a literal')
      .toMatch(/const\s*\{[^}]*\bcanWrite\b[^}]*\}\s*=\s*useProjectAccess\s*\(/)
  })

  it('the Timeline gates the funnel AND the affordances, not just the funnel', () => {
    const raw = readSrc('tools/rabbit_v0.1.0/views/TimelineView.jsx')
    // Gating openNewTask alone would leave ~12 visible, inert affordances —
    // the S23 "the button does nothing" defect in a new place. These are the
    // three panes that render or host them; EVERY render of each must pass
    // the flag as its own attribute. Render sites are found in the
    // comment-blanked text (a `<DetailPane` in prose is not a render) and read
    // from the raw text at the same offset, which blankComments preserves.
    const code = blankComments(raw)
    for (const pane of ['DetailZoomToolbar', 'DetailPane', 'OverviewPane']) {
      const sites = renderSites(code, pane)
      expect(sites.length, `${pane} should be rendered by TimelineView`).toBeGreaterThan(0)
      for (const at of sites) {
        const attrs = openingTagAttributes(raw, at)
        expect(attrs, `${pane} (offset ${at}): its opening tag could not be read`).not.toBeNull()
        expect(gateValue(attrs),
          `${pane} must receive canWrite={canWrite} as its own attribute (the last of that name, ` +
          'with no spread after it), or its affordances stay live').toBe('canWrite')
      }
    }
  })

  it('CONTROL: the pane check reads the attribute React reads, at any indent', () => {
    // Written into the real TimelineView.jsx, the commented-out prop, the later
    // `canWrite={true}`, the spread, the second ungated render and the
    // re-indented block with no prop all PASSED the old "\n      />" slice
    // (B3, 2026-09-24). Each is a self-contained snippet here, through the
    // same functions the assertion above uses, so a change to the scanner is
    // checked against every one of them.
    const check = (snippet) => renderSites(blankComments(snippet), 'DetailPane').map((at) => {
      const attrs = openingTagAttributes(snippet, at)
      return attrs && gateValue(attrs)
    })
    // gated, whatever the formatting
    expect(check('<DetailPane\n  rows={rows}\n  canWrite={canWrite}\n        />')).toEqual(['canWrite'])
    expect(check('<DetailPane onX={() => a > b} canWrite={canWrite} label="a > b" />')).toEqual(['canWrite'])
    expect(check('<DetailPane onX={(e) => `${e} }`} canWrite={canWrite}>{kids}</DetailPane>')).toEqual(['canWrite'])
    expect(check('<DetailPane {...rest} canWrite={canWrite} />')).toEqual(['canWrite'])
    // gates nothing
    expect(check('<DetailPane rows={rows} />')).toEqual([null])
    expect(check('<DetailPane canWrite={true} />')).toEqual(['true'])
    expect(check('<DetailPane canWrite={canWrite} canWrite={true} />')).toEqual(['true'])
    expect(check('<DetailPane canWrite={canWrite} {...{ canWrite: true }} />')).toEqual(['spread'])
    expect(check('<DetailPane /* canWrite={canWrite} */ rows={rows} />')).toEqual([null])
    expect(check('<DetailPane rows={rows}\n  // canWrite={canWrite}\n/>')).toEqual([null])
    expect(check('<DetailPane onX={() => { const canWrite = true }} />')).toEqual([null])
    expect(check('<DetailPane canWrite={canWrite} />\n<DetailPane rows={rows} />')).toEqual(['canWrite', null])
    // a render inside a comment is not a render
    expect(check('// <DetailPane canWrite={canWrite} />')).toEqual([])
    expect(check('{/* <DetailPane canWrite={canWrite} /> */}')).toEqual([])
    // an unreadable tag is null, which the assertion reports as a failure
    expect(check('<DetailPane canWrite={canWrite} onX={() => "unterminated} />')).toEqual([null])
  })

  it('every R.A.B.B.I.T. surface that creates project entities consults the gate', () => {
    // The census that would have caught the Timeline in S23 instead of S29.
    const surfaces = [
      'tools/rabbit_v0.1.0/views/TimelineView.jsx',
      'tools/rabbit_v0.1.0/views/ProjectTasksView.jsx',
      'tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx',
      'tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx',
    ]
    const ungated = surfaces.filter(rel => !/useProjectAccess|canOnProject/.test(readSrc(rel)))
    expect(ungated, 'these surfaces write project entities and must gate them').toEqual([])
  })
})
