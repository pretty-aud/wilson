#!/usr/bin/env node
/**
 * The three tools' strips, measured — post-overhaul S2a (2026-09-30).
 *
 *   node scripts/tool-strip-probe.mjs <port> [--check] [--json <file>] [--shots <dir>] [--prefix <name>]
 *
 * Audrey's rulings C1 and C7 (docs/design/POST_OVERHAUL_PLAN.md §0.1): each
 * tool's Help and Settings live at the right end of the tool's OWN strip,
 * Help then Settings ("settings at the right end"), and the "Tool settings"
 * item leaves the WILSON nav strip. That ruling is only kept if the two
 * buttons land at ONE x and ONE y in all three tools — Law of Similarity: the
 * same control in the same place — and no test in this repo lays out a page
 * (jsdom has no layout). So this probe measures, at each window size:
 *
 *   - each tool's strip: its top and its height, which is the kit tab's 36px
 *     plus the 1px hairline (D.O.G.'s "Deck outline" bar takes that height,
 *     not the kit Toolbar's 44, so its gear sits where the other two do);
 *   - the two buttons in it: their boxes, their order, and how far the
 *     Settings button's right edge is from the window's;
 *   - O.T.T.E.R.'s tab list: whether its LAST tab (Validate) is clipped, in
 *     cloud mode (eight tabs, "Requests" / "Admin" among them) and in local
 *     mode — which the dev fixtures cannot show in a browser build (a 'local'
 *     library pin is ignored there), so the adapter module is rewritten in
 *     flight to answer "not cloud" (the A4 hand-off's §5 trap 9 technique;
 *     no source file changes);
 *   - the nav strip's items: "Tool settings" is not one of them.
 *
 * `--check` fails on any breach. Measured with REAL scrollbars (Playwright's
 * headless Chromium hides them by default — the A1 hand-off's §5 trap 3).
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. It creates nothing: it opens three pages and reads.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--json', '--shots', '--prefix'];
const positional = args.filter((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1]));
const PORT = positional[0] || '5273';
const BASE = `http://localhost:${PORT}`;
const CHECK = args.includes('--check');
const JSON_OUT = flag('--json');
const SHOTS = flag('--shots');
const PREFIX = flag('--prefix') || 'strip';
/* Electron's smallest window is 1024x700, and Ctrl+= adds 0.5 to the zoom
   level (x1.095 a press: electron/main.cjs), so one, two and four presses
   leave 935x639, 853x583 and 711x486 CSS pixels (S2a review round 2,
   V-R2-01: the strip broke at 711 after round 1; "853 = one press" was wrong). */
const SIZES = [[1440, 900], [1280, 700], [1024, 700], [935, 639], [853, 583], [711, 486]];
/* The nav strip's main column on each tool page: the registry's primary
   pages in its order (pages.test.js pins ['home','dog','otter','rabbit',
   'dashboard','settings']) without the page you are on and App settings,
   one separator, then Resources and App settings. Read whole, so a row added
   anywhere — not only after the separator — is caught (review round 2,
   G-R2-02). */
const PRIMARY = ['Home', 'D.O.G.', 'O.T.T.E.R.', 'R.A.B.B.I.T.', 'Dashboard'];
const expectedNav = (label) => [...PRIMARY.filter((p) => p !== label), '|', 'Resources', 'App settings'];

/* Which element is each tool's strip. R.A.B.B.I.T.'s is the reference (its
   ViewTabs with the right-hand slot); O.T.T.E.R.'s is its nav; D.O.G.'s is
   the "Deck outline" bar this bundle lifts out of the sidebar. `drawer` is
   the settings drawer the gear must open (review round 1, G-R1-02: nothing
   clicked the buttons). */
const TOOLS = [
  { key: 'dog', path: '/dog', strip: '.dog-outline-bar', ready: 'Generate Page Outline', drawer: 'aside.ui-drawer.dog-settings-drawer' },
  { key: 'otter', path: '/otter', strip: '.otter-nav', ready: 'Course library', drawer: 'aside.ui-drawer.otter-settings-drawer' },
  { key: 'rabbit', path: '/rabbit', strip: '.rb-shell > .rb-viewtabs', ready: null, drawer: 'aside.ui-drawer.rb-tl-settings' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything this probe reads about one strip, in the page. */
function readStrip(sel) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r2(r.x), y: r2(r.y), w: r2(r.width), h: r2(r.height), right: r2(r.right), bottom: r2(r.bottom) }; };
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const strip = [...document.querySelectorAll(sel)].find(shown);
  if (!strip) return { error: `no visible ${sel}` };
  const buttons = [...strip.querySelectorAll('button')].filter(shown);
  const titled = (re) => buttons.find((b) => re.test(b.getAttribute('title') || b.getAttribute('aria-label') || ''));
  const help = titled(/^Help & documentation$/);
  const settings = titled(/settings$/i);
  const cs = getComputedStyle(strip);
  const out = {
    strip: box(strip),
    stripPadding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
    stripBorderBottom: cs.borderBottomWidth,
    help: help ? { ...box(help), title: help.getAttribute('title') } : null,
    settings: settings ? { ...box(settings), title: settings.getAttribute('title') } : null,
    order: help && settings
      ? ((help.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'help, settings' : 'settings, help')
      : null,
    windowRight: document.documentElement.clientWidth,
  };
  if (settings) out.settingsFromRight = r2(out.windowRight - out.settings.right);
  // O.T.T.E.R.: the tab list and its last tab (Validate), clipped or not.
  const list = strip.querySelector('[role="tablist"]');
  if (list) {
    const tabs = [...list.querySelectorAll('[role="tab"]')].filter(shown);
    const last = tabs[tabs.length - 1];
    const lb = list.getBoundingClientRect();
    const tb = last?.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    const used = tabs.reduce((n, t) => n + t.getBoundingClientRect().width, 0) + gap * Math.max(0, tabs.length - 1);
    out.tabs = {
      count: tabs.length,
      names: tabs.map((t) => (t.textContent || '').trim()),
      list: box(list),
      scrollOverflow: list.scrollWidth - list.clientWidth,
      // The width left over once every tab is laid side by side: what a
      // longer label ("Requests" for a member, where the fixtures' admin
      // reads "Admin") has to fit into.
      slack: r2(list.clientWidth - used),
      // …and how much wider "Requests" draws than "Admin" in the tab's own
      // font, so the check can hold a member's strip to the same rule.
      requestsExtra: (() => {
        const c = document.createElement('canvas').getContext('2d');
        c.font = getComputedStyle(tabs[0]).font;
        return r2(c.measureText('Requests').width - c.measureText('Admin').width);
      })(),
      last: last ? { name: (last.textContent || '').trim(), ...box(last) } : null,
      lastClipped: !!tb && (tb.right > lb.right + 0.5 || tb.left < lb.left - 0.5),
      iconsShown: tabs.filter((t) => { const s = t.querySelector('svg'); return s && s.getClientRects().length > 0; }).length,
    };
  }
  // D.O.G.: the sidebar Panel's own header (it drops once the Panel has no
  // title and no actions), and the leading label's type.
  const panelHead = document.querySelector('.dog-sidebar .ui-panel-head');
  if (sel.startsWith('.dog')) {
    out.sidebarHead = shown(panelHead);
    const label = strip.querySelector('.dog-outline-label');
    if (label) {
      const ls = getComputedStyle(label);
      out.label = { text: label.textContent.trim(), fontSize: ls.fontSize, weight: ls.fontWeight, transform: ls.textTransform, ...box(label) };
    }
  }
  return out;
}

/** The WILSON nav strip's own items (they render while the strip is closed):
    all of them, and the main column's TAIL — the rows after its separator. */
function readNav() {
  const all = [...document.querySelectorAll('.wilson-nav-item')].map((b) => (b.textContent || '').trim());
  const sep = [...document.querySelectorAll('.wilson-chrome div[aria-hidden="true"]')]
    .find((d) => d.parentElement && d.parentElement.querySelector(':scope > .wilson-nav-item'));
  const tail = [];
  for (let n = sep?.nextElementSibling; n; n = n.nextElementSibling) tail.push((n.textContent || '').trim());
  // The whole main column, the separator written as '|'.
  const main = sep ? [...sep.parentElement.children].map((n) => (n === sep ? '|' : (n.textContent || '').trim())) : [];
  return { all, tail, main, sepFound: !!sep };
}

/** Click the strip's Help, read what opened, close it; then the same for
    Settings. Opens and closes only — nothing is saved. */
async function pressBoth(page, tool) {
  const strip = page.locator(tool.strip).filter({ visible: true }).first();
  const out = {};
  await strip.locator('button[title="Help & documentation"]').click();
  await sleep(700);
  out.helpDialog = await page.evaluate(() => {
    const d = [...document.querySelectorAll('.ui-dialog')].find((e) => e.getClientRects().length > 0);
    if (!d) return null;
    const id = d.getAttribute('aria-labelledby');
    return (id && document.getElementById(id)?.textContent.trim()) || d.getAttribute('aria-label') || null;
  });
  await page.keyboard.press('Escape');
  await sleep(500);
  await strip.locator('button[title$="settings"]').click();
  await sleep(700);
  out.drawerOpen = await page.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0), tool.drawer);
  await page.keyboard.press('Escape');
  await sleep(400);
  return out;
}

async function open(browser, W, H, tool, { local = false, member = false } = {}) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error(`  pageerror (${tool.key} ${W}x${H}): ${e.message}`));
  if (member) {
    // A member, not the fixtures' admin: the cloud tab reads "Requests"
    // (20px wider than "Admin"). Rewritten in flight; the file is untouched.
    await page.route('**/src/tools/otter_v0.3.1/Otter.jsx*', async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      const next = body.replace(/appRole === ["']admin["'] \? ["']Admin["'] : ["']Requests["']/, '"Requests"');
      if (next === body) throw new Error('member mode: the Admin/Requests anchor did not match');
      await route.fulfill({ response: res, body: next });
    });
  }
  if (local) {
    // Local mode: otterCloudActive answers false, as it does on the desktop
    // with no workspace. Rewritten in flight; the file on disk is untouched.
    await page.route('**/src/tools/otter_v0.3.1/adapters/index.js*', async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      const next = body.replace(/export function otterCloudActive\(\) \{\s*return cloudActive\(\)\s*\}/,
        'export function otterCloudActive() { return Promise.resolve(false) }');
      if (next === body) throw new Error('local mode: the otterCloudActive anchor did not match');
      await route.fulfill({ response: res, body: next });
    });
  }
  await page.goto(`${BASE}${tool.path}`, { waitUntil: 'networkidle' });
  if (tool.ready) await page.getByText(tool.ready).first().waitFor({ timeout: 25000 });
  // The strip, and for O.T.T.E.R. the cloud answer, settle after load.
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0), tool.strip, { timeout: 25000 }).catch(() => {});
  await sleep(tool.key === 'otter' ? 2500 : 1200);
  return page;
}

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const results = {};
try {
  for (const [W, H] of SIZES) {
    const size = `${W}x${H}`;
    results[size] = {};
    for (const tool of TOOLS) {
      const page = await open(browser, W, H, tool);
      results[size][tool.key] = await page.evaluate(readStrip, tool.strip);
      results[size][tool.key].nav = await page.evaluate(readNav);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.mouse.move(W / 2, H - 40);
        await page.screenshot({ path: join(SHOTS, `${PREFIX}-${tool.key}-${size}.png`), clip: { x: 0, y: 0, width: W, height: Math.min(H, 320) } });
      }
      results[size][tool.key].pressed = await pressBoth(page, tool);
      await page.close();
    }
    let page = await open(browser, W, H, TOOLS[1], { local: true });
    results[size]['otter-local'] = await page.evaluate(readStrip, TOOLS[1].strip);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${PREFIX}-otter-local-${size}.png`), clip: { x: 0, y: 0, width: W, height: Math.min(H, 320) } });
    await page.close();
    page = await open(browser, W, H, TOOLS[1], { member: true });
    results[size]['otter-member'] = await page.evaluate(readStrip, TOOLS[1].strip);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${PREFIX}-otter-member-${size}.png`), clip: { x: 0, y: 0, width: W, height: Math.min(H, 320) } });
    await page.close();
  }
} finally {
  await browser.close();
}

const out = JSON.stringify(results, null, 2);
console.log(out);
if (JSON_OUT) writeFileSync(JSON_OUT, out + '\n');

/* --check: the ruling, as numbers.
   1. Every strip is 36 + 1 = 37px tall and starts at one y.
   2. Help and Settings are in every strip, Help first, both 28 x 28.
   3. Settings sits at ONE x in all three tools, 24px (the page gutter) in
      from the window's right edge, and Help at one x beside it.
   4. O.T.T.E.R.'s last tab is never clipped — cloud (an admin), a member
      ("Requests") and local — including at 853 (the smallest window zoomed).
   5. D.O.G.'s sidebar has no header of its own, and its bar's leading label
      is the Label step.
   6. On every tool page the nav strip's tail is exactly Resources, App
      settings; and each tool's Help opens "Help & documentation", its gear
      that tool's settings drawer. */
if (CHECK) {
  const bad = [];
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  for (const [size, r] of Object.entries(results)) {
    for (const k of ['dog', 'otter', 'rabbit']) {
      const t = r[k];
      if (!t || t.error) continue;
      if (!t.nav?.sepFound) bad.push(`${size} ${k}: the nav strip's separator was not found (the reader is blind)`);
      if (JSON.stringify(t.nav?.tail) !== JSON.stringify(['Resources', 'App settings'])) bad.push(`${size} ${k}: the nav strip's tail is ${JSON.stringify(t.nav?.tail)}`);
      const own = { dog: 'D.O.G.', otter: 'O.T.T.E.R.', rabbit: 'R.A.B.B.I.T.' }[k];
      if (JSON.stringify(t.nav?.main) !== JSON.stringify(expectedNav(own))) bad.push(`${size} ${k}: the nav strip's column is ${JSON.stringify(t.nav?.main)}, not ${JSON.stringify(expectedNav(own))}`);
      if (t.pressed?.helpDialog !== 'Help & documentation') bad.push(`${size} ${k}: Help opened ${JSON.stringify(t.pressed?.helpDialog)}`);
      if (!t.pressed?.drawerOpen) bad.push(`${size} ${k}: the gear did not open ${k}'s settings drawer`);
    }
    if (!(r['otter-member']?.tabs?.names || []).includes('Requests')) bad.push(`${size} otter-member: no "Requests" tab (the member rewrite missed)`);
    const tools = ['dog', 'otter', 'otter-local', 'otter-member', 'rabbit'];
    for (const k of tools) {
      const t = r[k];
      if (!t || t.error) { bad.push(`${size} ${k}: ${t?.error || 'not measured'}`); continue; }
      if (!near(t.strip.h, 37)) bad.push(`${size} ${k}: strip is ${t.strip.h}px tall, not 37 (36 + hairline)`);
      if (!t.help || !t.settings) { bad.push(`${size} ${k}: help=${!!t.help} settings=${!!t.settings}`); continue; }
      if (t.order !== 'help, settings') bad.push(`${size} ${k}: order is "${t.order}"`);
      for (const b of [t.help, t.settings]) if (!near(b.w, 28) || !near(b.h, 28)) bad.push(`${size} ${k}: "${b.title}" is ${b.w} x ${b.h}, not 28 x 28`);
      if (!near(t.settingsFromRight, 24)) bad.push(`${size} ${k}: Settings is ${t.settingsFromRight}px from the right edge, not 24`);
    }
    const ref = r.rabbit;
    for (const k of ['dog', 'otter', 'otter-local', 'otter-member']) {
      const t = r[k];
      if (!t?.settings || !ref?.settings) continue;
      if (!near(t.strip.y, ref.strip.y)) bad.push(`${size} ${k}: strip top ${t.strip.y} ≠ R.A.B.B.I.T.'s ${ref.strip.y}`);
      for (const b of ['help', 'settings']) {
        if (!near(t[b].x, ref[b].x) || !near(t[b].y, ref[b].y)) bad.push(`${size} ${k}: ${b} at (${t[b].x}, ${t[b].y}) ≠ R.A.B.B.I.T.'s (${ref[b].x}, ${ref[b].y})`);
      }
    }
    for (const k of ['otter', 'otter-local', 'otter-member']) {
      if (r[k]?.tabs?.lastClipped) bad.push(`${size} ${k}: the last tab (${r[k].tabs.last?.name}) is clipped`);
      if (r[k]?.tabs && r[k].tabs.scrollOverflow > 0) bad.push(`${size} ${k}: the tab list overflows by ${r[k].tabs.scrollOverflow}px`);
    }
    // The fixtures sign in an admin, whose cloud tab reads "Admin"; a member
    // reads "Requests". The strip must have room for the longer word too.
    const cloud = r.otter?.tabs;
    if (cloud && cloud.names.includes('Admin') && cloud.slack < cloud.requestsExtra) {
      bad.push(`${size} otter: ${cloud.slack}px spare, but "Requests" needs ${cloud.requestsExtra}px more than "Admin"`);
    }
    if (cloud && !cloud.names.some((n) => n === 'Admin' || n === 'Requests')) bad.push(`${size} otter: cloud mode drew no Requests/Admin tab (not cloud?)`);
    // CONTROL: the local rewrite took — local mode draws no cloud-only tab.
    if ((r['otter-local']?.tabs?.names || []).some((n) => n === 'Admin' || n === 'Requests')) bad.push(`${size} otter-local: still drew the cloud tab (the rewrite missed)`);
    if (r.dog?.sidebarHead) bad.push(`${size} dog: the sidebar still draws a header`);
    if (r.dog?.label && (r.dog.label.fontSize !== '11px' || r.dog.label.transform !== 'uppercase')) bad.push(`${size} dog: the leading label is ${r.dog.label.fontSize} ${r.dog.label.transform}, not the Label step`);
    if (!r.dog?.label) bad.push(`${size} dog: no leading "Deck outline" label in the bar`);
    for (const k of ['dog', 'otter', 'rabbit']) {
      const all = r[k]?.nav?.all || [];
      if (all.some((n) => /tool\s+settings/i.test(n))) bad.push(`${size} ${k} nav: "Tool settings" is still an item`);
      if (!all.length) bad.push(`${size} ${k} nav: no items read (the reader is blind)`);
    }
  }
  if (bad.length) {
    console.error(`\n✗ ${bad.length} breach(es):\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.error('\n✓ one strip height, one Help and one Settings position in all three tools; O.T.T.E.R.\'s last tab unclipped; no "Tool settings" in the nav');
}
