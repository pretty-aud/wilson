/**
 * UI overhaul — the in-page measurements, in ONE place.
 *
 * `ui-page-check.mjs` (T0-T3's twelve-page check) and `ui-walk.mjs` (V1's
 * walk of every page AND sub-view) both measure through this module, so a
 * fix to how a size, a clip or an overflow is counted lands in both at once.
 * T3's trap 3 is why: "a second implementation of the same parse is a second
 * place for the same hole".
 *
 * `pageCensus` is ui-page-check's census moved here VERBATIM by V1 — the
 * page check's output is byte-identical before and after the move, so its
 * numbers still compare with every earlier session's.
 */

/** Sizes, off-scale text, clipped elements and horizontal overflow for
 *  whatever is on screen. Runs in the page; pass it to `page.evaluate`. */
export function pageCensus() {
  const seen = {};
  let offScale = 0;
  let clipped = 0;
  /* 🚨 A CELL THAT CANNOT SHOW ITS OWN CONTENT (T2, 2026-09-22).
     This script measured two things and neither was per-element, so the one
     regression the type pass actually caused — 13px dates in an 80px column,
     every row reading "Aug 19,…" — was invisible to it and had to be found
     with a throwaway script. `clipped` counts elements whose text is wider
     than their box and whose overflow is hidden: the ellipsis case.

     🚨 AND THE FIRST DRAFT WAS BLIND TO HALF THE TABLE IT WAS ADDED FOR.
     It reused the size census's filter, which skips any element with no
     DIRECT text-node child — and a cell that wraps its text in a `<span>`
     has none. Worse, the span itself is INLINE, so `clientWidth` and
     `scrollWidth` are both 0 and it cannot report clipping either. Narrowing
     `ProjectFilesTable`'s Kind column to 18px made all 32 rows truncate and
     the number stayed at **0**: the instrument could not see the very column
     it had been added to watch. So the clip test walks its own list, with no
     text-node filter, and falls back to a `Range` when the box is inline.

     ⚠️ IT IS NOT A PASS/FAIL NUMBER. A long file name in a Name column is
     SUPPOSED to ellipsise. It is a number to COMPARE between runs: if a type
     change makes it jump, something stopped fitting. */
  const clips = (el, cs) => {
    if (cs.overflowX === 'visible') return false;
    if (el.clientWidth > 0) return el.scrollWidth > el.clientWidth + 1;
    /* An inline box reports 0/0, so measure the text itself against the
       nearest ancestor that actually has a width. */
    const host = el.parentElement;
    if (!host || host.clientWidth <= 0) return false;
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().width > host.clientWidth + 1;
  };

  for (const el of document.querySelectorAll('*')) {
    if (el.offsetParent === null && el.tagName !== 'BODY') continue;
    if (!el.textContent || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    /* The clip test runs over EVERY visible element with text. The size
       census below keeps its own filter, because a wrapper's computed
       font-size is not a text node's. */
    if (clips(el, cs)) clipped++;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const px = Math.round(parseFloat(cs.fontSize) * 10) / 10;
    seen[px] = (seen[px] || 0) + 1;
    if (![11, 12, 13, 14, 16, 20].includes(px)) offScale++;
  }
  return {
    sizes: seen, offScale, clipped,
    measured: Object.values(seen).reduce((a, b) => a + b, 0),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
  };
}

/* ───────────────────────── V1's measurements ─────────────────────────
   Everything below was added by V1 (visual QA, plan §5 Wave 4), which was
   asked to "check the chosen face at every step" and "the alignment of every
   table and toolbar". Nothing above measured either. Each function runs IN
   THE PAGE (Playwright serialises it), so each is self-contained. */

/**
 * The type census, one row per visible element that owns text directly.
 *
 * It TAGS each row's element with `data-v1p="<i>"` so `renderedFaces` below
 * can ask Chrome which font actually drew it. Tags from a previous call are
 * cleared first, so a row index always means this call's element.
 *
 * `scope` narrows the census to a subtree (a dialog, say); omitted, it is the
 * whole document.
 */
export function typeCensus(scope) {
  for (const el of document.querySelectorAll('[data-v1p]')) el.removeAttribute('data-v1p');
  const root = scope ? document.querySelector(scope) : document.body;
  if (!root) return [];
  const rows = [];
  let i = 0;
  for (const el of root.querySelectorAll('*')) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent).join('');
    if (!own.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    el.setAttribute('data-v1p', String(i++));
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    rows.push({
      tag: el.tagName.toLowerCase(), cls, text: own.replace(/\s+/g, ' ').trim().slice(0, 40),
      family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      px: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      weight: cs.fontWeight, transform: cs.textTransform,
      tracking: cs.letterSpacing === 'normal' ? 0 : Math.round(parseFloat(cs.letterSpacing) * 100) / 100,
    });
  }
  return rows;
}

/**
 * Which font Chrome ACTUALLY drew each census row in, via the DevTools
 * protocol — not what the stylesheet asked for.
 *
 * 🚨 WHY NOT `getComputedStyle().fontFamily`. The declared family is Geist on
 * every element in this app whether or not Geist drew a single glyph: if the
 * woff2 fails to load, or a character is outside the subset's
 * `unicode-range`, the browser silently falls through the stack to Inter,
 * then `system-ui` (Segoe UI on Windows). V1 measured exactly that — "Run
 * Intake →" declares Geist and draws its arrow in Segoe UI Semibold, because
 * fontsource's Latin subset does not contain U+2192.
 *
 * ⚠️ `getPlatformFontsForNode` reports the font's INTERNAL family name
 * ("Geist"), never an `@font-face` alias, and an EMPTY list means "not laid
 * out yet", not "no font". Both cost V1 a run of a throwaway probe.
 *
 * Returns { tally: {family: glyphs}, off: [row + {used, glyphs}] }.
 */
export async function renderedFaces(cdp, rows, allowed = /^Geist( Mono)?$/) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-v1p]' });
  const tally = {};
  const off = [];
  let unmeasured = 0;
  /* Pipelined in chunks: two DevTools round trips per text node, one after
     another, made a dense table ~30s a screen and a full walk over an hour.
     The protocol answers requests in flight concurrently. */
  const one = async (nodeId) => {
    const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
    const idx = Number(attributes[attributes.indexOf('data-v1p') + 1]);
    try { return { idx, fonts: (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts }; }
    catch { return { idx, fonts: [] }; }
  };
  for (let i = 0; i < nodeIds.length; i += 50) {
    for (const { idx, fonts } of await Promise.all(nodeIds.slice(i, i + 50).map(one))) {
      if (!fonts.length) { unmeasured++; continue; }
      for (const f of fonts) {
        tally[f.familyName] = (tally[f.familyName] || 0) + f.glyphCount;
        if (!allowed.test(f.familyName)) off.push({ ...rows[idx], used: f.familyName, glyphs: f.glyphCount });
      }
    }
  }
  return { tally, off, unmeasured, probed: nodeIds.length };
}

/**
 * §3.1's rules that a size census cannot see, applied to census rows.
 *
 *   weight   400 or 600 only (Q3: the faces are declared 400-600)
 *   case     uppercase only at the Label step (11px), plus Home's 16px
 *            capitals, which Audrey ruled in W4 ("make sure its all capitals
 *            in the home page") — `homeCaps` turns that exemption on
 *   tracking zero, except the Label step (+0.06em) and H1 (+0.01em)
 */
export function typeRules(rows, { homeCaps = false } = {}) {
  const homeCap = (r) => homeCaps && r.px === 16 && r.transform === 'uppercase' && r.weight === '600';
  return {
    weight: rows.filter((r) => r.weight !== '400' && r.weight !== '600'),
    upper: rows.filter((r) => r.transform === 'uppercase' && r.px !== 11 && !homeCap(r)),
    tracking: rows.filter((r) => r.tracking !== 0 && r.px !== 11 && r.px !== 20 && !homeCap(r)),
  };
}

/**
 * Which of the two page classes this screen is on (plan §2 Q1): the light
 * ground `#f4a261`, or the dark `paper` family. Samples three points across
 * the middle of the field and walks up from each to the first opaque
 * background, so a transparent wrapper does not answer for the page.
 */
export function pageGround() {
  // See `stopPointCensus` for why a colour is read through a canvas.
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { if (!c || c === 'transparent') return null; cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return d[3] ? [d[0], d[1], d[2], d[3] / 255] : null; };
  const opaque = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c && c[3] >= 0.95) return c.slice(0, 3);
    }
    return null;
  };
  const name = (c) => {
    if (!c) return 'none';
    const hex = '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const known = { '#f4a261': 'light', '#1c1917': 'paper', '#232020': 'paper-raised', '#0c0a09': 'paper-recessed', '#dd9155': 'surface-light-solid' };
    return known[hex] || hex;
  };
  const y = Math.round(innerHeight * 0.6);
  return [0.2, 0.5, 0.8].map((fx) => name(opaque(document.elementFromPoint(Math.round(innerWidth * fx), y))));
}

/**
 * The open dialog, if there is one: where it sits and what it is made of.
 *
 * A kit `Dialog` carries `role="dialog"`; about sixty hand-rolled overlays do
 * not (plan §1), so the fallback is the top-most fixed layer that covers most
 * of the viewport — the backdrop — and its largest opaque descendant, the
 * panel. `fits` is §3.3's 1280x700 question: is every edge of the panel on
 * screen?
 */
export function openDialog() {
  /* ⚠️ Two things that are fixed layers and are NOT a dialog's panel, both of
     which V1's first full walk reported as one: the dev-fixtures badge (a
     249x24 fixed pill at z200, on #232020 — six overlays "measured" as that
     badge), and an opaque element inside a scrolled panel whose box sits
     below the viewport (R.A.B.B.I.T. settings "off screen" at y=1343). The
     badge is excluded by its test id; a panel candidate must intersect the
     viewport. */
  const badge = document.querySelector('[data-testid="dev-fixtures-badge"]');
  const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const vis = (e) => { if (badge && badge.contains(e)) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && onScreen(e); };
  // See `stopPointCensus` for why a colour is read through a canvas.
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { if (!c || c === 'transparent') return null; cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return d[3] ? [d[0], d[1], d[2], d[3] / 255] : null; };
  const opaqueBg = (e) => { const c = rgba(getComputedStyle(e).backgroundColor); return c && c[3] >= 0.95 ? c.slice(0, 3) : null; };
  let panel = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(vis).pop() || null;
  let kind = panel ? 'role' : null;
  if (!panel) {
    const layers = [...document.querySelectorAll('body *')].filter((e) => {
      const cs = getComputedStyle(e);
      if (cs.position !== 'fixed' || !vis(e) || Number(cs.zIndex || 0) < 10) return false;
      const r = e.getBoundingClientRect();
      return r.width * r.height >= innerWidth * innerHeight * 0.6;
    });
    const backdrop = layers.pop();
    if (!backdrop) return null;
    const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    const inner = [...backdrop.querySelectorAll('*')].filter((e) => vis(e) && opaqueBg(e)).sort((a, b) => area(b) - area(a));
    /* ⚠️ Not every overlay nests its panel. R.A.B.B.I.T.'s New task, task
       details and asset popups render the backdrop and the panel as two
       SIBLING fixed layers at the same z-index — measured by V1's discovery
       pass as "div z50 1280x700; div z50 512x527" — so a panel search inside
       the backdrop finds nothing. Fall back to the largest opaque fixed layer
       that is not full-screen and sits at or above the backdrop. */
    const bz = Number(getComputedStyle(backdrop).zIndex || 0);
    const siblings = [...document.querySelectorAll('body *')].filter((e) => {
      const cs = getComputedStyle(e);
      return e !== backdrop && cs.position === 'fixed' && vis(e) && opaqueBg(e) && Number(cs.zIndex || 0) >= bz
        && area(e) < innerWidth * innerHeight * 0.95;
    }).sort((a, b) => area(b) - area(a));
    panel = inner[0] || siblings[0] || null;
    kind = inner[0] ? 'overlay' : 'overlay-sibling';
    if (!panel) return null;
  }
  const r = panel.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  const bg = opaqueBg(panel);
  const hex = bg ? '#' + bg.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : cs.backgroundColor;
  const title = [...panel.querySelectorAll('.ui-dialog-title,h1,h2,h3,h4,[class*="text-h2"],[class*="text-h3"]')].find(vis);
  const tcs = title ? getComputedStyle(title) : null;
  return {
    kind, bg: hex, radius: cs.borderRadius, border: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
    box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    fits: r.top >= -0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5,
    title: title ? { text: title.textContent.trim().slice(0, 40), px: parseFloat(tcs.fontSize), weight: tcs.fontWeight, color: tcs.color, transform: tcs.textTransform } : null,
  };
}

/**
 * Header-to-column alignment in every visible real `<table>` (plan §4's
 * Table is one; nineteen-odd hand-built grids are not and are left to the
 * screenshots).
 *
 * Two defects, per column: the header and the body disagree about
 * `text-align` (a left label over right-aligned figures), or they agree and
 * the header's TEXT still starts somewhere else — a sort-icon slot or a
 * padding mismatch pushing the label off its column. Measured on the text
 * itself through a Range, because a cell's box always lines up.
 */
export function tableAlignment() {
  /* The column's CONTENT, not its first text node: a Member cell leads with an
     avatar and a Status cell with a dot, and a header label is meant to line
     up with those, not with the name after them. V1's first run reported the
     Team table's avatar as a 32px misalignment. So the box is the union of
     the cell's text and its drawn things — an svg, an img, or a small element
     that paints a background or a border. */
  const drawn = (e) => {
    if (e.matches('svg, img, canvas')) return true;
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (!r.width || r.width > 40) return false;
    return (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || parseFloat(cs.borderTopWidth) > 0;
  };
  const contentBox = (cell) => {
    let left = Infinity, right = -Infinity;
    const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const rg = document.createRange(); rg.selectNodeContents(n);
      const r = rg.getBoundingClientRect(); if (!r.width) continue;
      left = Math.min(left, r.left); right = Math.max(right, r.right);
    }
    for (const e of cell.querySelectorAll('*')) {
      if (e.offsetParent === null && !e.matches('svg, svg *')) continue;
      if (!drawn(e)) continue;
      const r = e.getBoundingClientRect(); if (!r.width) continue;
      left = Math.min(left, r.left); right = Math.max(right, r.right);
    }
    return left === Infinity ? null : { left, right };
  };
  const side = (cs) => (cs.textAlign === 'start' || cs.textAlign === 'left' || cs.textAlign === '-webkit-left') ? 'left'
    : (cs.textAlign === 'end' || cs.textAlign === 'right' || cs.textAlign === '-webkit-right') ? 'right' : cs.textAlign;
  const textBox = (cell) => {
    const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 });
    const n = w.nextNode();
    if (!n) return null;
    const rg = document.createRange(); rg.selectNodeContents(n);
    const r = rg.getBoundingClientRect();
    return r.width ? r : null;
  };
  const out = { tables: 0, columns: 0, alignMismatch: [], offset: [] };
  for (const t of document.querySelectorAll('table')) {
    if (t.offsetParent === null) continue;
    const head = t.tHead?.rows[0];
    const body = [...(t.tBodies[0]?.rows || [])].filter((r) => r.offsetParent !== null).slice(0, 12);
    if (!head || !body.length) continue;
    out.tables++;
    [...head.cells].forEach((th, c) => {
      const tds = body.map((r) => r.cells[c]).filter((td) => td && td.colSpan === 1 && contentBox(td));
      const label = th.textContent.trim();
      if (!tds.length || !label) return;
      out.columns++;
      const hs = side(getComputedStyle(th));
      const sides = tds.map((td) => side(getComputedStyle(td)));
      const bs = sides.sort((a, b) => sides.filter((x) => x === b).length - sides.filter((x) => x === a).length)[0];
      if (hs !== bs) { out.alignMismatch.push(`"${label.slice(0, 24)}" th ${hs} / td ${bs}`); return; }
      const hb = textBox(th);
      if (!hb) return;
      const deltas = tds.map((td) => { const b = contentBox(td); return hs === 'right' ? b.right - hb.right : b.left - hb.left; });
      const worst = deltas.reduce((m, d) => Math.abs(d) > Math.abs(m) ? d : m, 0);
      if (Math.abs(worst) > 2) out.offset.push(`"${label.slice(0, 24)}" ${hs} ${worst > 0 ? '+' : ''}${Math.round(worst)}px`);
    });
  }
  return out;
}

/**
 * One baseline per toolbar (§4 `Toolbar`: "every child 28px so the row has
 * one baseline"). A toolbar is taken to be any horizontal flex row with three
 * or more visible children that are controls; the check is the spread of
 * their vertical CENTRES, which is what the eye reads as "not lined up".
 * Heights that differ are listed separately and are not a defect by
 * themselves — an icon button and a field can differ and still share a
 * centre line.
 */
export function toolbarAlignment() {
  const isCtl = (e) => e.matches('button, input, select, textarea, [role="button"], [role="tab"], a') || (e.children.length === 1 && e.firstElementChild.matches('button, input, select, [role="button"]'));
  const rows = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.offsetParent === null) continue;
    const cs = getComputedStyle(el);
    if (!cs.display.includes('flex') || cs.flexDirection !== 'row' || cs.flexWrap === 'wrap') continue;
    const kids = [...el.children].filter((k) => k.offsetParent !== null && k.getBoundingClientRect().width > 0 && isCtl(k));
    if (kids.length < 3) continue;
    const rs = kids.map((k) => k.getBoundingClientRect());
    const centres = rs.map((r) => r.top + r.height / 2);
    const spread = Math.max(...centres) - Math.min(...centres);
    if (spread > 1.5) rows.push({ spread: Math.round(spread * 10) / 10, heights: [...new Set(rs.map((r) => Math.round(r.height)))].join('/'), labels: kids.slice(0, 4).map((k) => (k.textContent || k.getAttribute('aria-label') || k.getAttribute('title') || k.tagName).trim().slice(0, 14)).join(' · ') });
  }
  return rows.sort((a, b) => b.spread - a.spread);
}

/**
 * Controls with no name at all: a visible button (or role=button) with no
 * text, no `aria-label`, no `title` and no `aria-labelledby`. §3.3: "Icon-only
 * buttons carry both `aria-label` and `title`". V1's dry run of every page
 * found them on D.O.G., and on R.A.B.B.I.T.'s Tasks, Budget, Assets and Scenes
 * — a screen reader announces each one as "button" and nothing else, and a
 * mouse user gets no tooltip.
 *
 * Returns a short description of each: the icon's lucide class if it has one,
 * and the nearest labelled neighbour, which is how a person finds it.
 */
export function unnamedControls() {
  const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
  const named = (e) => (e.textContent || '').trim() || e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('aria-labelledby');
  return [...document.querySelectorAll('button, [role="button"]')].filter((e) => vis(e) && !named(e)).map((e) => {
    const icon = e.querySelector('svg[class*="lucide-"]')?.getAttribute('class')?.match(/lucide-([a-z0-9-]+)/g)?.pop() || 'no-icon';
    let near = '';
    for (let s = e.previousElementSibling; s && !near; s = s.previousElementSibling) near = (s.textContent || s.getAttribute('aria-label') || '').trim().slice(0, 24);
    return `${icon} after "${near}"`;
  });
}

/**
 * Is the tab (or section, or segmented control) named `label` now the
 * SELECTED one? Kit `Tabs` sets `aria-selected` and `data-active`; the Admin
 * Terminal's section nav sets `aria-current` and `data-active`; a toggle sets
 * `aria-pressed`. Any of the four counts.
 *
 * 🚨 WHY THIS EXISTS (V1). ui-page-check's `--tabs` pass printed "NOT OPENED"
 * only when it could not FIND the button. When the click landed and the tab
 * had not switched within its wait, it measured the PREVIOUS tab under the
 * new tab's name: V1 caught a run whose "Intake" row carried Summary's census
 * digit for digit (13px:260, 11px:36, 20px:18…). A tab's label is on screen
 * whichever tab is showing, so no text-based proof can tell them apart; the
 * selection state can.
 */
export function selectedControl(label) {
  const vis = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  return [...document.querySelectorAll('button, [role="tab"], a')].some((el) => vis(el)
    && (el.textContent || '').replace(/\s+/g, ' ').trim().startsWith(label)
    && (el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-active') === 'true'
      || el.hasAttribute('aria-current') || el.getAttribute('aria-pressed') === 'true'));
}

/**
 * For a tab bar that marks its active tab ONLY in inline style (R.A.B.B.I.T.'s
 * Budget views, and ViewTabs until V1): is `label` the one button among its
 * siblings whose ink, fill, underline or weight differs from all the others?
 * Weaker than `selectedControl` — it proves "this one looks selected", not
 * "this one is selected" — so the walker uses it only where a bar exposes no
 * selection state at all, and says so in the registry.
 */
export function styledActive(label) {
  const vis = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  const hit = [...document.querySelectorAll('button')].find((b) => vis(b) && (b.textContent || '').replace(/\s+/g, ' ').trim() === label);
  if (!hit || !hit.parentElement) return false;
  const sig = (b) => { const cs = getComputedStyle(b); return [cs.color, cs.backgroundColor, cs.borderBottomColor, cs.borderBottomWidth, cs.fontWeight].join('|'); };
  const peers = [...hit.parentElement.children].filter((e) => e.tagName === 'BUTTON' && vis(e));
  if (peers.length < 2) return false;
  const mine = sig(hit);
  return peers.filter((p) => sig(p) === mine).length === 1;
}

/**
 * Plan §5 defines stop point 1 as "one face (Geist), one scale, one case, one
 * border, [two radii], no white". The walk's other columns check the first
 * three. This checks the rest, plus the contrast rule behind C6, on whatever
 * is on screen:
 *
 *   border   any visible edge 2px or wider (§3.3: one 1px hairline; the
 *            18 judged stylesheet borders and LayoutVisualizer's are the
 *            known exceptions, and appear here to be matched against them)
 *   radius   any corner that is not 0, 3px, 6px or fully round (Q5)
 *   white    any opaque surface whose relative luminance is above 0.75 —
 *            C9, "no white or near-white backgrounds". The light ground
 *            `#f4a261` is 0.47 and `#dd9155` 0.37; `#f5efe6`, the cream C9
 *            names, is 0.86
 *   contrast text whose ink against its COMPOSITED background is under
 *            4.5:1, or 3:1 at 19px/600 and above or 24px (§3.2, C6). A
 *            translucent layer is composited over the first opaque one
 *            beneath it; text inside a disabled control or under an
 *            opacity below 1 is counted apart as `faded` (WCAG 1.4.3
 *            exempts inactive components), never as a failure
 *
 * Each list holds short descriptions so a caller can de-duplicate a repeated
 * row across a table.
 */
export function stopPointCensus() {
  /* 🚨 A COLOUR IS READ THROUGH A CANVAS, NOT A REGEX (V1). Tailwind v4
     computes its PALETTE as `oklch(...)` — `bg-stone-800` is
     "oklch(0.268 0.007 34.298)", `bg-black/50` is "oklab(0 0 0 / 0.5)" — and
     only @theme's hex tokens and inline styles come back as `rgb()`. The first
     draft of this census parsed `rgb()` alone, so every palette colour was
     silently skipped: the settings slide-outs' `bg-stone-800` panels read as
     transparent, and the contrast list held only inline hex. Painting the
     value onto a 1x1 canvas and reading the pixel back lets the browser do the
     conversion for any syntax it can render. `fillStyle` IGNORES a value it
     cannot parse, so it is reset to black first and an unparseable colour
     reads as black rather than as the previous one. */
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const parse = (c) => {
    if (!c || c === 'transparent') return null;
    cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return d[3] ? { r: d[0], g: d[1], b: d[2], a: d[3] / 255 } : null;
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (e.offsetParent !== null || cs.position === 'fixed'); };
  const name = (e) => `${e.tagName.toLowerCase()}${(typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const badge = document.querySelector('[data-testid="dev-fixtures-badge"]');

  /* The background a piece of text actually sits on: walk up collecting
     translucent fills until an opaque one, then composite back down. A
     background IMAGE (a gradient, a thumbnail) cannot be reduced to one
     colour, so such text is reported as unknown rather than guessed. */
  const ground = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    if (layers.length && layers[layers.length - 1].a >= 0.999) base = layers.pop();
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const faded = (el) => {
    for (let e = el; e; e = e.parentElement) {
      if (Number(getComputedStyle(e).opacity) < 1) return true;
      if (e.matches?.('button:disabled, [aria-disabled="true"], input:disabled, select:disabled, fieldset:disabled')) return true;
    }
    return false;
  };

  /* A single token broken across lines. V1 found R.A.B.B.I.T.'s Tasks table
     printing its start dates as "2026-11-" over "06": the type pass took the
     mono from ~10.5px to 13px and the column did not grow. Nothing measured
     it — a wrapped cell is not a clipped one, so `clipped` read 0 — and it
     doubles the row height of every key-date row. A token here is text with
     no whitespace, four characters or more, whose own text lays out on more
     than one line box. */
  const brokenToken = (el, own) => {
    if (own.length < 4 || /\s/.test(own)) return false;
    const n = [...el.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim());
    if (!n) return false;
    const rg = document.createRange(); rg.selectNodeContents(n);
    const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    return tops.size > 1;
  };

  const out = { border: [], radius: [], white: [], contrast: [], broken: [], faded: 0, unknown: 0 };
  for (const el of document.querySelectorAll('body *')) {
    if (badge && badge.contains(el)) continue;
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((s) => cs[`border${s}Style`] !== 'none' && parseFloat(cs[`border${s}Width`]) >= 1.5);
    if (sides.length) out.border.push(`${name(el)} ${sides.map((s) => s[0] + parseFloat(cs[`border${s}Width`])).join(' ')} ${cs[`border${sides[0]}Style`]}`);

    const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => parseFloat(cs[`border${k}Radius`]) || 0);
    const full = Math.min(r.width, r.height) / 2 - 0.5;
    const offRadius = radii.filter((v) => v !== 0 && v !== 3 && v !== 6 && v < full && !cs.borderTopLeftRadius.includes('%'));
    if (offRadius.length) out.radius.push(`${name(el)} ${[...new Set(radii)].join('/')}px`);

    const bg = parse(cs.backgroundColor);
    if (bg && bg.a >= 0.95 && lum(bg) > 0.75 && r.width * r.height > 200) out.white.push(`${name(el)} ${hex(bg)} ${Math.round(r.width)}x${Math.round(r.height)}`);

    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    if (brokenToken(el, own)) out.broken.push(`<${name(el)}> "${own.slice(0, 24)}" ${parseFloat(cs.fontSize)}px ${cs.fontFamily.split(',')[0].replace(/["']/g, '')} in ${Math.round(r.width)}px`);
    if (faded(el)) { out.faded++; continue; }
    const g = ground(el);
    if (!g) { out.unknown++; continue; }
    const fg0 = parse(cs.color);
    if (!fg0) continue;
    const fg = fg0.a < 1 ? over(fg0, g) : fg0;
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 19 && Number(cs.fontWeight) >= 600);
    const cr = ratio(fg, g);
    if (cr < (large ? 3 : 4.5)) out.contrast.push(`${cr.toFixed(2)} ${hex(fg)} on ${hex(g)} ${px}px/${cs.fontWeight} <${name(el)}> "${own.replace(/\s+/g, ' ').slice(0, 28)}"`);
  }
  return out;
}
