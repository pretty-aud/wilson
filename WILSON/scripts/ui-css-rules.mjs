// =============================================================================
// ui-css-rules.mjs — A3 review round 2 (2026-09-24). One reading of a
// stylesheet for the guards that judge rules, so each guard stops carrying its
// own regex over `selector { body }`.
//
// Why it exists: round two's tests review ran 118 mutants against the CSS
// guards and 88 survived. Most went through one of three doors a regex over
// the flat text leaves open:
//   - a declaration inside a NESTED block (`.a { & strong { color: … } }`)
//     that a leaf-rule regex never reads, or reads as part of a selector;
//   - an at-rule wrapper (`@supports`, `@media`) around a rule the guard
//     thought was at the top level;
//   - a selector LIST whose members the guard did not split on their
//     top-level commas.
// So: walk the braces, keep every rule's full selector and the chain of
// blocks it sits in, and read declarations at the rule's own level only.
// =============================================================================

/** Comments blanked to spaces, so offsets and line numbers survive. */
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** A selector list split on its TOP-LEVEL commas: a comma inside `:is(…)`
 *  belongs to one selector. */
export function splitTop(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Every block in a stylesheet, brace-walked: `{ sel, body, depth, nested,
 * parents }`. `sel` is the block's whole head (a selector list, or an at-rule
 * such as `@media print` / `@property --x`), `body` everything between its
 * braces (nested blocks included), `depth` how many blocks enclose it,
 * `nested` whether its body opens a block of its own, and `parents` the heads
 * of the enclosing blocks, outermost first.
 */
export function allRules(source) {
  const css = stripComments(source);
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      const head = css.slice(start, i).split(/[;}]/).pop().trim();
      stack.push({ head, open: i });
      start = i + 1;
    } else if (c === '}') {
      const top = stack.pop();
      if (top) {
        const body = css.slice(top.open + 1, i);
        out.push({ sel: top.head, body, depth: stack.length, nested: /\{/.test(body), parents: stack.map((s) => s.head) });
      }
      start = i + 1;
    } else if (c === ';') {
      start = i + 1;
    }
  }
  return out;
}

/** A rule's declarations at its OWN level (nested blocks removed), as
 *  `[property, value]` with the property lower-cased and `!important` dropped. */
export function decls(body) {
  let flat = '';
  let d = 0;
  for (const ch of body) {
    // A nested block's selector sits at this level before its `{`; drop it,
    // or `a:hover { … }` would read as a declaration of `a`.
    if (ch === '{') { if (d === 0) flat = flat.slice(0, flat.lastIndexOf(';') + 1); d++; }
    else if (ch === '}') { d--; if (d === 0) flat += ';'; }
    else if (d === 0) flat += ch;
  }
  return flat.split(';').map((x) => x.trim()).filter((x) => /^-{0,2}[a-zA-Z][-\w]*\s*:/.test(x))
    .map((x) => { const i = x.indexOf(':'); return [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim().replace(/\s*!\s*important$/i, '')]; });
}

/** The names `@theme` declares in a stylesheet (without their `--`). */
export function themeNames(source) {
  const theme = allRules(source).find((r) => /^@theme\b/.test(r.sel));
  return new Set(theme ? decls(theme.body).map(([p]) => p.replace(/^--/, '')) : []);
}

/** A selector's specificity as [ids, classes / attributes / pseudo-classes,
 *  types]. `:is()`, `:not()` and `:has()` count their most specific argument,
 *  `:where()` counts nothing, a pseudo-element counts as a type (A4 review
 *  round 1: the cascade guards compare A4's rules with the kit's). */
export function specificity(sel) {
  let s = sel.replace(/::[\w-]+(\([^)]*\))?/g, ' x ');
  let a = 0, b = 0, c = 0;
  s = s.replace(/:(is|not|where|has)\(((?:[^()]|\([^()]*\))*)\)/g, (m, f, inner) => {
    if (f === 'where') return '';
    const best = splitTop(inner).map(specificity).sort(compareSpecificity).pop() || [0, 0, 0];
    a += best[0]; b += best[1]; c += best[2];
    return '';
  });
  a += (s.match(/#[\w-]+/g) || []).length;
  b += (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  c += (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [a, b, c];
}

/** Sort order for two specificities: negative when `x` is weaker. */
export const compareSpecificity = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/** The custom properties `@theme` declares in a stylesheet, name (with its
 *  `--`) → raw value (post-overhaul S2a, the orange guards). */
export function themeValues(source) {
  const theme = allRules(source).find((r) => /^@theme\b/.test(r.sel));
  return new Map(theme ? decls(theme.body) : []);
}

/** Properties that paint a glyph's ink (text or an icon), in every spelling
 *  the orange guards have been beaten by (S2a review rounds 1 and 2,
 *  G-R1-04, G-R2-03: a shadow on transparent text, a stroke). */
export const INK_PROPS = /^(color|-webkit-text-fill-color|fill|stroke|caret-color|text-emphasis-color|text-decoration-color|text-shadow|-webkit-text-stroke|-webkit-text-stroke-color)$/;

/** True when ANY token named anywhere in the value — a fallback, a mix, a
 *  shadow's colour — resolves through @theme to one of `hexes` (review round
 *  2, G-R2-03: `var(--unset, var(--color-signal))` paints the fallback). */
export function mentionsTokenHex(value, theme, hexes, vars = new Map()) {
  for (const m of String(value).matchAll(/var\(\s*(--[\w-]+)/g)) {
    const hex = resolveTokenHex(`var(${m[1]})`, theme, vars);
    if (hex && hexes.has(hex)) return true;
  }
  return false;
}

/** A value's colour as a lower-case hex when it is exactly one token (or a
 *  chain of tokens) that `@theme` defines as a hex; null otherwise. A mix, a
 *  gradient or a literal is not resolved — the sheets' own guards forbid
 *  literals, and a mix is not the token itself. `vars` holds custom
 *  properties the sheet itself sets, which shadow the theme's. */
export function resolveTokenHex(value, theme, vars = new Map(), depth = 0) {
  if (depth > 8 || value == null) return null;
  const v = String(value).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase();
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);
  if (!m) return null;
  const next = vars.get(m[1]) ?? theme.get(m[1]);
  return resolveTokenHex(next, theme, vars, depth + 1);
}
