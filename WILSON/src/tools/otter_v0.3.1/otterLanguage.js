// =============================================================================
// otterLanguage.js — post-overhaul S2b (C9, C10). What language a course's
// code is in, and the ONE look every code block in O.T.T.E.R. is drawn with:
// the lesson's fenced code, the quiz's wells and the function library.
//
// Audrey (C9): "background color is fine. its more the color of the text …
// see how string, etc has different color. think how VS colors text." The
// lessons already coloured their code with Prism's oneDark — VS Code's One
// Dark palette: strings green, keywords violet, functions blue, numbers
// amber — so the function library takes the same theme rather than a second
// one (one code look across the tool; her answer to C9 kept the default).
// The colours live in this object, never in otter.css: they are data the
// highlighter writes as inline styles, and the sheet's orange guard
// (otterCss.test.js) holds her complete list of orange inks there.
// otterLanguage.test.js measures every token colour against the well.
// =============================================================================

import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// ── The code look (moved here from Otter.jsx, A3's, unchanged) ───────────────
//  THE LESSON'S CODE BLOCK (A3). react-markdown wraps every fence in its own
//  <pre>, even when the `code` renderer returns the highlighter (PreTag="div"
//  names only the highlighter's inner wrapper), so `.lesson-content pre` in
//  index.css draws the ONE code well for tagged and untagged fences alike.
//  oneDark's block style is inline and would draw a second well inside it —
//  a cool hsl(220) ground, its own padding, margin and radius, Fira Code —
//  so this object takes all of that away and keeps only the app's mono. The
//  syntax colours on the tokens inside are data and stay the theme's, but
//  for the comments (LESSON_CODE_THEME, below).
//  (A3 review round 1 measured the first version: two nested wells.)
//  The box is as wide as its code, so a scrolled line ends 16px inside the
//  well as an untagged fence's does (it ended on the edge — round 2).
export const LESSON_CODE_BLOCK = {
  background: 'transparent',
  color: 'inherit',
  border: 0,
  borderRadius: 0,
  padding: 0,
  margin: 0,
  overflow: 'visible',
  width: 'max-content',
  minWidth: '100%',
  textShadow: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-dense)',
  lineHeight: 'var(--text-dense--line-height)',
};
// oneDark draws comments in hsl(220 10% 40%): 3.27:1 on the well at 13px,
// the one text on the lesson page under AA (A3 review round 2). The third
// ink is the app's own quiet text and measures 5.70:1 there. Its colours are
// inline styles, so they are changed in the theme object, not in CSS.
export const LESSON_CODE_THEME = {
  ...oneDark,
  comment: { ...oneDark.comment, color: 'var(--color-ink-3)' },
  prolog: { ...oneDark.prolog, color: 'var(--color-ink-3)' },
  cdata: { ...oneDark.cdata, color: 'var(--color-ink-3)' },
};
export const LESSON_CODE_TEXT = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-dense)',
  lineHeight: 'var(--text-dense--line-height)',
  whiteSpace: 'pre',
};
/** The function library's wells (FunctionCard): the lesson's text, wrapping
 *  as `.otter-code-well` always has — the highlighter writes `white-space:
 *  pre` on its code tag unless told otherwise, and a signature that wrapped
 *  before S2b must not start scrolling. */
export const WELL_CODE_TEXT = { ...LESSON_CODE_TEXT, whiteSpace: 'pre-wrap' };

// ── The course → language map (C10) ──────────────────────────────────────────
// A course carries only name / slug / type, so its language is read from its
// NAME first and its slug second. The name comes first because a slug loses
// the symbols that tell the C family apart — slugify('C#') and slugify('C++')
// are both 'c' — and in the cloud a course's wire slug is its id. A trailing
// version ("Python 3.12", "Unity 6") and one trailing generic word ("Go
// programming", "Rust fundamentals") are forgiven. Anything else is unknown
// and draws as plain text, exactly as before S2b.
// Audrey's library (read 2026-09-30): one coding-language course, "Python".
// Her software courses' lessons tag their own fences (python, csharp, cpp,
// glsl, blueprint), which the lesson highlighter reads from the fence.
const LANGUAGE_NAMES = {
  python: ['python', 'py', 'python3'],
  javascript: ['javascript', 'js', 'node', 'node.js', 'nodejs', 'ecmascript'],
  typescript: ['typescript', 'ts'],
  csharp: ['c#', 'csharp', 'c sharp', 'c-sharp', 'cs'],
  cpp: ['c++', 'cpp', 'cplusplus', 'c plus plus'],
  c: ['c'],
  java: ['java'],
  rust: ['rust'],
  go: ['go', 'golang'],
  lua: ['lua', 'luau'],
  sql: ['sql', 'mysql', 'postgresql', 'postgres', 'sqlite', 't-sql', 'tsql'],
  bash: ['bash', 'shell', 'sh', 'zsh'],
  glsl: ['glsl'],
  hlsl: ['hlsl'],
  gdscript: ['gdscript'],
  powershell: ['powershell', 'pwsh'],
  kotlin: ['kotlin'],
  swift: ['swift'],
  ruby: ['ruby'],
  php: ['php'],
  r: ['r'],
  json: ['json'],
  yaml: ['yaml', 'yml'],
  css: ['css'],
  markup: ['html', 'xml'],
};
/** Every alias → its Prism language id. Exported for its test. */
export const COURSE_LANGUAGES = Object.freeze(Object.fromEntries(
  Object.entries(LANGUAGE_NAMES).flatMap(([id, aliases]) => aliases.map((a) => [a, id])),
));

const GENERIC_TAIL = /\s+(?:programming language|programming|language|scripting|basics|fundamentals)$/;
const VERSION_TAIL = /[\s-]+v?\d+(?:[.-]\d+)*$/;

/** The readings of one name or slug, most literal first. */
function readings(raw) {
  const k = String(raw ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!k) return [];
  const out = [k];
  const add = (s) => { s = s.trim(); if (s && !out.includes(s)) out.push(s); };
  add(k.replace(VERSION_TAIL, ''));
  add(k.replace(GENERIC_TAIL, ''));
  add(k.replace(GENERIC_TAIL, '').replace(VERSION_TAIL, ''));
  add(k.replace(/-/g, ' ').replace(VERSION_TAIL, ''));
  return out;
}

/**
 * The Prism language id a course's code is drawn in, or null for plain text.
 * @param {{ name?: string, slug?: string } | null | undefined} course
 */
export function courseLanguage(course) {
  for (const raw of [course?.name, course?.slug]) {
    for (const key of readings(raw)) {
      if (Object.prototype.hasOwnProperty.call(COURSE_LANGUAGES, key)) return COURSE_LANGUAGES[key];
    }
  }
  return null;
}
