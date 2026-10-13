#!/usr/bin/env node
/**
 * D.O.G.'s slide preview, measured — plan §0 C4, UI overhaul A1 (2026-09-23).
 *
 *   node scripts/dog-preview-probe.mjs <port> [--check] [--json <file>] [--shots <dir>]
 *
 * C4: "LayoutVisualizer.jsx and VideoThumbnail.jsx are not edited. The preview
 * is mounted inside the D.O.G. output panel and again inside
 * DuplicateResolverModal at a pixel-exact 714x402 frame, so the chrome around
 * it keeps the preview's available width and padding byte-for-byte."
 *
 * WHY THE AVAILABLE WIDTH IS THE NUMBER THAT MATTERS. The preview's slide is a
 * FIXED 1141 x 641 frame with a 280px asset column beside it
 * (LayoutVisualizer's `baseW` / `baseH`), inside an `overflow: hidden` wrapper
 * that D.O.G. owns. At 1440 and at 1280 that row is wider than the space the
 * chrome leaves, so the wrapper CLIPS it, and the width the sidebar, the main
 * column's padding and the two frames leave over is exactly how much of the
 * preview the user sees. A sidebar 16px wider hides 16px of it; nothing inside
 * LayoutVisualizer changes and nothing in a test would notice. So this probe
 * pins that width, the preview root's box and padding, the slide frame, and
 * how much of the slide and its asset column are visible — at both window
 * sizes and at both mounts — and `--check` fails on a one-pixel difference.
 *
 * No test in this repo lays out a page (jsdom has no layout), so the pin
 * lives here, in PINNED below, and is re-run in the real app after every
 * commit that touches the chrome around the preview.
 *
 * It needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (as ui-walk.mjs does). It creates nothing that
 * outlives the page: the deck is pasted into Import/Export History (history
 * is React state, never persisted), and the duplicate resolver is opened by
 * the export's own duplicate check and CANCELLED before anything is written.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('-') && !['--json', '--shots'].includes(args[i - 1]));
const PORT = positional[0] || '5251';
const BASE = `http://localhost:${PORT}`;
const CHECK = args.includes('--check');
const JSON_OUT = flag('--json');
const SHOTS = flag('--shots');
const SIZES = [[1440, 900], [1280, 700]];

/* Three slides, and page #1 twice so the export's duplicate check opens the
   resolver. Format 2 of HistoryModal's importer: `SLIDE #n — Layout`, a rule
   of at least twenty `═`, then the ▸ sections parser.js reads. */
const RULE = '═'.repeat(63);
const slide = (n, layout, title, sub) => `SLIDE #${n} — ${layout}
${RULE}

▸ TITLE:
${title}

▸ SUBTITLE:
${sub}

▸ COPY/TEXT CONTENT:
Probe copy for the preview measurement.

▸ REQUIRED ASSETS:
[Image | 16:9] Hero image

${RULE}
`;
const DECK = [
  slide(1, 'Title slide', 'Probe deck title', 'The first page'),
  slide(2, 'Title and body', 'Probe body page', 'The second page'),
  slide(1, 'Title slide', 'Probe duplicate title', 'The duplicate of page one'),
].join('\n');

/* ── the pinned numbers ──────────────────────────────────────────────────
   Measured with REAL scrollbars (see the launch below), at A1's branch point
   (the file as of 58b23bc, swapped in under the running server) and again
   after A1's restyle: every number below was identical between the two runs
   except the two frame lines marked. The first pin (58b23bc) was taken with
   headless Chromium's hidden scrollbars, which is a layout no user sees
   (A1 review round 1). A change here is a C4 decision, not a re-baseline:
   it needs the reason written beside it.                                  */
const PINNED = {
  "1440x900": {
    output: {
      root: {
        w: 1168,
        h: 751
      },
      padding: "16px 16px 16px 16px",
      available: 1168,
      wrapper: {
        w: 1168,
        h: 781.84
      },
      // A1 restyle, a deliberate C4 decision: the frame lost its 2px stone-600
      // box (review D15, V1-12) and keeps the preview's width with a 2px inset
      // of its own ground (dog.css `.dog-output-frame`). Its borders and its
      // height (the 2px bottom edge) changed; every PREVIEW number did not.
      frameBorders: "0px 0px 0px 0px",
      frame: {
        w: 1172,
        h: 781.84
      },
      mainScrollbar: 10,
      slide: {
        w: 1141,
        h: 641
      },
      slideVisible: 1141,
      assetColumnVisible: 0
    },
    resolver: {
      frame: {
        w: 714,
        h: 402
      },
      frameBorders: "1px 1px 1px 1px",
      inner: {
        w: 714,
        h: 402
      },
      root: {
        w: 672,
        h: 378
      },
      rootPadding: "0px 0px 0px 0px"
    }
  },
  "1280x700": {
    output: {
      root: {
        w: 1008,
        h: 751
      },
      padding: "16px 16px 16px 16px",
      available: 1008,
      wrapper: {
        w: 1008,
        h: 781.84
      },
      // A1 restyle, a deliberate C4 decision: the frame lost its 2px stone-600
      // box (review D15, V1-12) and keeps the preview's width with a 2px inset
      // of its own ground (dog.css `.dog-output-frame`). Its borders and its
      // height (the 2px bottom edge) changed; every PREVIEW number did not.
      frameBorders: "0px 0px 0px 0px",
      frame: {
        w: 1012,
        h: 781.84
      },
      mainScrollbar: 10,
      slide: {
        w: 1141,
        h: 641
      },
      slideVisible: 992,
      assetColumnVisible: 0
    },
    resolver: {
      frame: {
        w: 714,
        h: 402
      },
      frameBorders: "1px 1px 1px 1px",
      inner: {
        w: 714,
        h: 402
      },
      root: {
        w: 672,
        h: 378
      },
      rootPadding: "0px 0px 0px 0px"
    }
  }
};

async function measureOutput(page) {
  return page.evaluate(() => {
    const r2 = (n) => Math.round(n * 100) / 100;
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r2(r.x), w: r2(r.width), h: r2(r.height) }; };
    const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Suggested Theme Colors:'
      && !s.closest('[data-probe-skip]') && !s.closest('.fixed'));
    if (!label) return { error: 'no preview in the output panel' };
    const root = label.parentElement.parentElement;          // LayoutVisualizer's root
    const wrapper = root.parentElement;                       // D.O.G.'s overflow-hidden div
    const frame = wrapper.parentElement;                      // D.O.G.'s output frame
    const main = frame.closest('main');
    const cs = getComputedStyle(root);
    const fcs = getComputedStyle(frame);
    const slideEl = [...root.querySelectorAll('div')].find((d) => d.style.width === '1141px');
    const sideEl = [...root.querySelectorAll('div')].find((d) => d.style.width === '280px');
    const wr = wrapper.getBoundingClientRect();
    const visible = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r2(Math.max(0, Math.min(r.right, wr.right) - Math.max(r.left, wr.left)));
    };
    return {
      root: box(root),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      available: wrapper.clientWidth,
      wrapper: box(wrapper),
      frameBorders: [fcs.borderTopWidth, fcs.borderRightWidth, fcs.borderBottomWidth, fcs.borderLeftWidth].join(' '),
      frame: box(frame),
      mainScrollbar: main ? main.offsetWidth - main.clientWidth : null,
      slide: slideEl ? box(slideEl) : null,
      slideVisible: visible(slideEl),
      assetColumnVisible: visible(sideEl),
    };
  });
}

async function measureResolver(page) {
  return page.evaluate(() => {
    const r2 = (n) => Math.round(n * 100) / 100;
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r2(r.x), y: r2(r.y), w: r2(r.width), h: r2(r.height) }; };
    const outer = [...document.querySelectorAll('div')].find((d) => d.style.width === '714px' && d.classList.contains('overflow-hidden'));
    if (!outer) return { error: 'no resolver frame' };
    const inner = outer.firstElementChild;
    const root = inner.firstElementChild;                      // LayoutVisualizer (compact) root
    const cs = getComputedStyle(root);
    const ocs = getComputedStyle(outer);
    return {
      frame: box(outer),
      frameBorders: [ocs.borderTopWidth, ocs.borderRightWidth, ocs.borderBottomWidth, ocs.borderLeftWidth].join(' '),
      inner: box(inner),
      root: box(root),
      rootPadding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
    };
  });
}

async function clickText(page, text, { exact = true, scope = 'body' } = {}) {
  const ok = await page.evaluate(({ text, exact, scope }) => {
    const root = document.querySelector(scope) || document.body;
    const els = [...root.querySelectorAll('button, [role="button"], label')].filter((e) => e.offsetParent !== null);
    // Case-insensitive, so the same probe measures the file before A1's
    // sentence-case pass and after it.
    const lc = (v) => (v || '').trim().toLowerCase();
    const t = lc(text);
    const hit = els.find((e) => (exact ? lc(e.textContent) === t : lc(e.textContent).startsWith(t)))
      || els.find((e) => lc(e.getAttribute('title')) === t || lc(e.getAttribute('aria-label')) === t);
    if (!hit) return false;
    hit.click();
    return true;
  }, { text, exact, scope });
  if (!ok) throw new Error(`no visible control "${text}"`);
  await page.waitForTimeout(250);
}

async function run(browser, W, H) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  await page.goto(`${BASE}/dog`, { waitUntil: 'networkidle' });
  await page.getByText('Generate Page Outline').first().waitFor({ timeout: 20000 });

  // Paste the deck into Import/Export History and import it.
  await clickText(page, 'Import/export history');
  await clickText(page, 'Import');
  await page.getByPlaceholder('Or paste DECKOUTLINE content here...').fill(DECK);
  await clickText(page, 'Import to History');
  // The modal may close itself on import; if it did not, close it.
  if (await page.getByText('Import to History').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // Open page #1 and switch the output panel to the visualizer.
  await page.getByText('Probe deck title', { exact: true }).first().click();
  await page.waitForTimeout(300);
  await clickText(page, 'Layout visualizer');
  await page.waitForTimeout(600);
  const output = await measureOutput(page);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const frame = page.locator('span', { hasText: 'Suggested Theme Colors:' }).first();
    await frame.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `dog-preview-output-${W}x${H}.png`) });
  }

  // The duplicate resolver: Export sees page #1 twice and opens it.
  await clickText(page, 'Import/export history');
  await clickText(page, 'Export');
  await clickText(page, 'Download', { exact: false });
  await page.waitForTimeout(600);
  // The resolver shows the preview on HOVER INTENT: a 500ms timer on an
  // option card (DuplicateResolverModal's handleMouseEnter). Hold for longer.
  await page.getByText('Option 1', { exact: false }).first().hover();
  await page.waitForTimeout(1200);
  const resolver = await measureResolver(page);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `dog-preview-resolver-${W}x${H}.png`) });
  // Cancel it — the resolver's own close control — so nothing is written.
  // Since A2 the resolver is the kit's Dialog (its named Close); before, it
  // was an 894px box whose first button was the close.
  await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('.ui-dialog')].find((d) => d.textContent.includes('Resolve duplicate'));
    if (dialog) { dialog.querySelector('button[aria-label="Close"]')?.click(); return; }
    const frame = [...document.querySelectorAll('div')].find((d) => d.style.width === '894px');
    frame?.querySelector('button')?.click();
  });
  await page.close();
  return { output, resolver };
}

/* 🚨 REAL SCROLLBARS (A1 review round 1). Playwright starts headless
   Chromium with --hide-scrollbars, so `mainScrollbar` measured 0 whatever the
   page did and every width here was a layout no user sees: in the app the
   main column's 10px scrollbar takes its share. Dropping that flag measures
   the page as it draws, and makes a change that adds or removes the main
   column's scrollbar fail the pin like any other pixel. */
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const results = {};
try {
  for (const [W, H] of SIZES) {
    results[`${W}x${H}`] = await run(browser, W, H);
  }
} finally {
  await browser.close();
}

const out = JSON.stringify(results, null, 2);
console.log(out);
if (JSON_OUT) writeFileSync(JSON_OUT, out + '\n');

/* --check: every pinned number must match. Positions (`x`, `y`) are NOT
   pinned — the sidebar may move the preview sideways; what C4 protects is
   its size, its padding and the width the chrome leaves it. */
if (CHECK) {
  if (!PINNED) { console.error('\n✗ --check: nothing pinned yet'); process.exit(1); }
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'x' || k === 'y' ? undefined : v)));
  const diffs = [];
  const walk = (a, b, path) => {
    if (a && typeof a === 'object') { for (const k of Object.keys(a)) walk(a[k], b?.[k], `${path}.${k}`); return; }
    if (a !== b) diffs.push(`${path}: pinned ${JSON.stringify(a)}, measured ${JSON.stringify(b)}`);
  };
  walk(strip(PINNED), strip(results), 'preview');
  if (diffs.length) { console.error(`\n✗ C4: the preview's box moved\n  ${diffs.join('\n  ')}`); process.exit(1); }
  console.error('\n✓ C4: the preview box matches the pin at both sizes and both mounts');
}
