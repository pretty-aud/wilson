// =============================================================================
// otterLanguage.test.js — post-overhaul S2b (C9, C10).
//
//  1. The course → language map: the names Audrey's library and the common
//     languages use, the C family told apart by NAME (a slug cannot: 'c' is
//     slugify('C#') and slugify('C++')), and everything else plain text. Each
//     pitfall a looser map would fall into is a case here, and a planted
//     looser map is shown to fall into it.
//  2. Every id the map can return is a language the shipped Prism build has
//     (an id it lacks would draw plain text and look like a working map).
//  3. The one code theme's token colours, measured against the ground every
//     O.T.T.E.R. code well has (paper-recessed): every colour the highlighter
//     can actually write onto a token clears AA at the 13px Dense step. The
//     sweep reads the theme the way react-syntax-highlighter does — a key
//     reaches a token only as a class or dot-joined classes — so the
//     line-number and toolbar colours it can never write are not judged, and
//     a planted oneDark comment (3.27:1) is.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { Prism } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  courseLanguage, COURSE_LANGUAGES, LESSON_CODE_THEME, LESSON_CODE_TEXT, WELL_CODE_TEXT,
} from './otterLanguage.js'
import { THEME, PAPER_RECESSED } from '../../ui/tokens.js'
import { contrast, rgbToHex } from '../../ui/contrast.js'
import { slugify } from './adapters/otterRoutes.js'

// ── 1. the map ───────────────────────────────────────────────────────────────
const course = (name, slug = slugify(name)) => ({ name, slug })
const MAPPED = [
  // Audrey's one coding-language course, as her Local Server stores it.
  [course('Python'), 'python'],
  [course('Python 3.12'), 'python'],
  [course('JavaScript'), 'javascript'],
  [course('TypeScript'), 'typescript'],
  [course('Node.js'), 'javascript'],
  [course('C#'), 'csharp'],
  [course('C++'), 'cpp'],
  [course('C++ Basics'), 'cpp'],
  [course('C'), 'c'],
  [course('Java'), 'java'],
  [course('Rust fundamentals'), 'rust'],
  [course('Go programming'), 'go'],
  [course('Golang'), 'go'],
  [course('Lua'), 'lua'],
  [course('SQL'), 'sql'],
  [course('PostgreSQL'), 'sql'],
  [course('Bash'), 'bash'],
  [course('Shell scripting'), 'bash'],
  [course('GLSL'), 'glsl'],
  [course('HLSL'), 'hlsl'],
  [course('GDScript'), 'gdscript'],
  [course('PowerShell'), 'powershell'],
  [course('HTML'), 'markup'],
  // Read from the slug when the name says nothing (a renamed course).
  [{ name: 'My scripting notes', slug: 'python' }, 'python'],
  [{ name: '', slug: 'typescript-5' }, 'typescript'],
]
const PLAIN = [
  // Audrey's software courses: their functions are not code in one language.
  course('Blender 5.0'), course('Premiere Pro'), course('TouchDesigner'), course('Unity 6'),
  course('Unreal Engine 5'), course('DaVinci Resolve 19'),
  course('Houdini VEX'), course('C# for Unity'), course('Scripting'),
]
// A cloud course's wire slug is its id; it must never read as a language.
const CLOUD = [{ name: 'Blender 5.0', slug: '3f9c2a10-7b4e-4c1d-9a8e-0c5d2e6f7a81' }, { name: 'Notes', slug: 'fx-course-0002' }]

/** A planted looser map: substring matching, the first thing one writes. */
function substringMap(c) {
  const k = `${c?.name || ''} ${c?.slug || ''}`.toLowerCase()
  for (const [alias, id] of Object.entries(COURSE_LANGUAGES)) if (alias.length > 1 && k.includes(alias)) return id
  return null
}
/** A planted slug-first map: what a map keyed only by slug does. */
function slugFirstMap(c) {
  return COURSE_LANGUAGES[String(c?.slug || '')] ?? COURSE_LANGUAGES[String(c?.name || '').toLowerCase()] ?? null
}
const judge = (map) => [
  ...MAPPED.filter(([c, id]) => map(c) !== id).map(([c, id]) => `${JSON.stringify(c)} → ${map(c)}, want ${id}`),
  ...[...PLAIN, ...CLOUD].filter((c) => map(c) !== null).map((c) => `${JSON.stringify(c)} → ${map(c)}, want plain`),
]

describe('courseLanguage — a course, read as a Prism language', () => {
  it('maps the common languages and Audrey\'s Python, by name first, forgiving a version and a generic word', () => {
    expect(judge(courseLanguage)).toEqual([])
  })
  it('leaves everything else plain text (null): her software courses, a cloud id, nothing at all', () => {
    for (const c of [...PLAIN, ...CLOUD, null, undefined, {}, { name: '  ', slug: '' }]) expect(courseLanguage(c), JSON.stringify(c)).toBeNull()
  })
  it('tells the C family apart even though their slugs are all "c"', () => {
    expect(slugify('C#')).toBe('c')
    expect(slugify('C++')).toBe('c')
    expect(courseLanguage(course('C#'))).toBe('csharp')
    expect(courseLanguage(course('C++'))).toBe('cpp')
    expect(courseLanguage(course('C'))).toBe('c')
  })
  it('CONTROL: a substring map and a slug-first map each fall into pitfalls the cases name', () => {
    const sub = judge(substringMap)
    expect(sub.some((m) => m.startsWith('{"name":"C++ Basics"')), sub.join('\n')).toBe(true) // "basics" holds "cs"
    expect(sub.some((m) => m.startsWith('{"name":"C# for Unity"')), sub.join('\n')).toBe(true) // not one language
    expect(sub.some((m) => m.startsWith('{"name":"C"')), sub.join('\n')).toBe(true)
    const slug = judge(slugFirstMap)
    expect(slug.some((m) => m.startsWith('{"name":"C#"')), slug.join('\n')).toBe(true) // reads "c"
    expect(slug.some((m) => m.startsWith('{"name":"C++"')), slug.join('\n')).toBe(true)
  })
})

// ── 2. the Prism build has every id ──────────────────────────────────────────
describe('every language the map can return is in the shipped Prism build', () => {
  it('no id draws plain text by being missing', () => {
    const supported = new Set(Prism.supportedLanguages)
    expect(supported.size, 'the build lists its languages').toBeGreaterThan(100)
    const ids = [...new Set(Object.values(COURSE_LANGUAGES))]
    expect(ids.filter((id) => !supported.has(id))).toEqual([])
    // CONTROL: a made-up id is reported.
    expect(['python', 'vex'].filter((id) => !supported.has(id))).toEqual(['vex'])
  })
})

// ── 3. the theme on the well ─────────────────────────────────────────────────
function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return rgbToHex([f(0), f(8), f(4)].map((x) => Math.round(x * 255)))
}
/** A theme colour as hex, or null when it inherits (the well's own ink). */
function resolve(color) {
  const c = String(color).trim()
  if (/^(inherit|currentcolor)$/i.test(c)) return null
  const v = c.match(/^var\(--([\w-]+)\)$/)
  if (v) {
    if (!THEME[v[1]]) throw new Error(`unknown token ${c}`)
    return THEME[v[1]]
  }
  const h = c.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i)
  if (h) return hslToHex(+h[1], +h[2], +h[3])
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  throw new Error(`a theme colour this test cannot read: ${c}`) // hsla, rgb(), a name: say so, never skip
}
/** The keys react-syntax-highlighter can apply to a token span: one class or
 *  dot-joined classes (create-element.js, createStyleObject). A descendant,
 *  a pseudo-class or an attribute never reaches a token. */
const REACHABLE = /^[\w-]+(\.[\w-]+)*$/
function lowColours(theme, ground = PAPER_RECESSED) {
  const bad = []
  for (const [key, style] of Object.entries(theme)) {
    if (!REACHABLE.test(key) || !style?.color) continue
    const hex = resolve(style.color)
    if (hex === null) continue
    const r = contrast(hex, ground)
    if (r < 4.5) bad.push(`${key} ${style.color} ${r.toFixed(2)}:1`)
  }
  return bad
}

describe('the one code theme, on the code well (C9)', () => {
  it('every token colour the highlighter can write clears AA on paper-recessed at the Dense step', () => {
    expect(PAPER_RECESSED).toBe(THEME['color-paper-recessed'])
    expect(lowColours(LESSON_CODE_THEME)).toEqual([])
  })
  it('the sweep reads the token colours that tell code apart: strings, keywords, functions, numbers, comments', () => {
    const reached = Object.keys(LESSON_CODE_THEME).filter((k) => REACHABLE.test(k) && LESSON_CODE_THEME[k]?.color)
    expect(reached).toEqual(expect.arrayContaining(['string', 'keyword', 'function', 'number', 'comment', 'builtin', 'operator', 'punctuation', 'class-name']))
    const distinct = new Set(['string', 'keyword', 'function', 'number', 'comment'].map((k) => resolve(LESSON_CODE_THEME[k].color)))
    expect(distinct.size, 'five kinds of token, five colours').toBe(5)
  })
  it('CONTROL: oneDark as shipped fails on its comments, and an unreachable key is not judged', () => {
    expect(lowColours(oneDark)).toEqual(expect.arrayContaining([expect.stringMatching(/^comment hsl\(220, 10%, 40%\) 3\.\d\d:1$/)]))
    expect(REACHABLE.test('.language-css .token.important')).toBe(false)
    expect(REACHABLE.test('token.tab:not(:empty):before')).toBe(false)
    expect(REACHABLE.test('attr-name')).toBe(true)
    expect(() => resolve('hsla(220, 14%, 71%, 0.15)')).toThrow(/cannot read/)
    expect(lowColours({ keyword: { color: 'var(--color-ink-3)' } }, THEME['color-paper-raised'])).toEqual([]) // 5.04+ there too
    expect(lowColours({ keyword: { color: '#2a2a2a' } })).toHaveLength(1)
  })
})

describe('the code text settings', () => {
  it('the wells wrap as .otter-code-well always has; the lesson keeps its one line', () => {
    expect(WELL_CODE_TEXT).toEqual({ ...LESSON_CODE_TEXT, whiteSpace: 'pre-wrap' })
    expect(LESSON_CODE_TEXT.whiteSpace).toBe('pre')
  })
})
