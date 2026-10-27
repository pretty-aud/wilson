#!/usr/bin/env node
/**
 * Landmarks and names, measured in real Chromium — post-overhaul FX15
 * (2026-10-26, FX14's leftovers FX14-02, FX14-03 and FX14-04).
 *
 *   node scripts/fx15-landmarks-names.mjs <port> --out <dir> [--size 1440x900] [--tag before|after] [--shots]
 *
 * --shots also writes a picture of the moment each note has left
 * (`po-fx15-<tag>-0N-note-gone-<page>-<W>x<H>.png`): where focus went, and
 * the kit's ring when it went to the page's main region.
 *
 * Headless Chromium (no window on screen), closed in a `finally`. Needs the
 * dev server with the dev fixtures' tester (`fx15-worktree` in
 * .claude/launch.json). Nothing outlives the page: the fixture store is in
 * memory, nothing is saved or sent, no file is uploaded (so no file name is
 * ever read out), and no AI call is made (every page counts requests to an
 * Edge Function, which must stay 0).
 *
 * Everything a screen reader hears is read from Chromium's own
 * accessibility tree over CDP (`Accessibility.getFullAXTree`,
 * `getPartialAXTree`): CSS text-transform shows there as it is spoken, and
 * Playwright's ariaSnapshot would compute its own names (FX14's trap).
 *
 * What it measures:
 *   pages     every page of the registry, and R.A.B.B.I.T.'s every tab: the
 *             landmarks Chromium exposes (role and name), how many of them
 *             are main; every `main` / `[role=main]` element in the DOM and
 *             how it is hidden (display: none on itself or above, the
 *             `hidden` attribute, `inert`, `aria-hidden`); and which element
 *             the kit toast's focus return would choose when the element
 *             focus came from is gone (`toastFocusReturn`, the app's own
 *             module)
 *   names     D.O.G.'s comboboxes by Chromium's role and name, Full deck and
 *             Single page
 *   settings  D.O.G.'s settings drawer, both tabs: each folding header's
 *             role, name, expanded state, aria-controls and whether it names
 *             a drawn element; one opened and closed again
 *   toast     a real kit toast (the dev fixtures' refusal note, 6 s) on
 *             R.A.B.B.I.T.'s Tasks tab and on Team members: focus put in it
 *             from a control by keyboard, that control taken out of the page,
 *             the toast's Dismiss pressed with Enter; where focus is then
 *
 * Writes `po-fx15-landmarks-<tag>-<W>x<H>.json` into --out and prints it.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--size', '--tag'];
const PORT = args.find((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])) || '5305';
const OUT = flag('--out');
const TAG = flag('--tag') || 'now';
const SHOTS = args.includes('--shots');
const SHOT_NO = { rabbit: 1, 'team-members': 2 };
if (!OUT) {
  console.error('usage: fx15-landmarks-names.mjs <port> --out <dir> [--size WxH] [--tag before|after] [--shots]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
const PAGES = ['home', 'dog', 'otter', 'rabbit', 'dashboard', 'settings', 'project-manager', 'rate-card', 'team-members', 'project-files', 'admin-terminal', 'help'];
const LANDMARKS = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'form', 'search']);
const BASE = `http://localhost:${PORT}`;
const urlOf = (id) => `${BASE}/${id === 'home' ? '' : id}`;

async function withCdp(page, fn) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    await cdp.send('DOM.enable');
    return await fn(cdp);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** The landmarks Chromium exposes on the page as it stands. */
async function landmarks(page) {
  return withCdp(page, async (cdp) => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const out = [];
    for (const n of nodes) {
      const role = n.role?.value;
      if (n.ignored || !LANDMARKS.has(role)) continue;
      let el = '?';
      if (n.backendDOMNodeId) {
        try {
          const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId });
          const { result } = await cdp.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: 'function () { return this.tagName.toLowerCase() + (this.className && typeof this.className === "string" ? "." + this.className.trim().split(/\\s+/)[0] : "") }',
            returnByValue: true,
          });
          el = result.value;
        } catch { /* a node without a DOM element */ }
      }
      out.push({ role, name: n.name?.value || '', el });
    }
    return out;
  });
}

/** Every main in the DOM and how it is hidden; and the toast's choice. */
const domMains = (page) => page.evaluate(async () => {
  const displayNone = (m) => { for (let e = m; e; e = e.parentElement) if (getComputedStyle(e).display === 'none') return true; return false; };
  const label = (m) => m.tagName.toLowerCase() + (typeof m.className === 'string' && m.className.trim() ? '.' + m.className.trim().split(/\s+/)[0] : '');
  const mains = [...document.querySelectorAll('main, [role="main"]')].map((m) => ({
    el: label(m),
    shown: m.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }),
    displayNone: displayNone(m),
    hiddenAttr: !!m.closest('[hidden]'),
    inert: !!m.closest('[inert]'),
    ariaHidden: !!m.closest('[aria-hidden="true"]'),
  }));
  const { toastFocusReturn } = await import('/src/ui/Toast.jsx');
  const gone = document.createElement('button');
  const choice = toastFocusReturn(gone);
  return { mains, toastChoice: choice ? label(choice) : null };
});

async function open(browser, id) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const seen = { requests: 0, errors: [] };
  page.on('request', (r) => { if (/\/functions\/v1\//.test(r.url())) seen.requests++; });
  page.on('pageerror', (e) => seen.errors.push(String(e).slice(0, 160)));
  // A cold dev server serves several thousand modules: up to two minutes.
  await page.goto(urlOf(id), { waitUntil: 'networkidle', timeout: 120000 });
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForTimeout(1500);
  return { ctx, page, seen };
}

/** R.A.B.B.I.T. opens on its project list; its tabs wait for a project. */
async function openSaltHours(page) {
  await page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first().click({ timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim() === 'Tasks' && !t.disabled), null, { timeout: 30000 });
  await page.waitForTimeout(500);
}

async function pages(browser) {
  const rows = [];
  for (const id of PAGES) {
    const { ctx, page, seen } = await open(browser, id);
    try {
      const at = new URL(page.url()).pathname;
      rows.push({ page: id, at, landmarks: await landmarks(page), ...(await domMains(page)), requests: seen.requests, errors: seen.errors });
      if (id === 'rabbit') {
        await openSaltHours(page);
        const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].filter((t) => t.checkVisibility() && !t.disabled).map((t) => t.textContent.trim()));
        for (const name of tabs) {
          await page.getByRole('tab', { name, exact: true }).first().click();
          await page.waitForTimeout(600);
          rows.push({ page: `rabbit: ${name}`, at, landmarks: await landmarks(page), ...(await domMains(page)), requests: seen.requests, errors: seen.errors });
        }
      }
    } finally {
      await ctx.close();
    }
  }
  return rows;
}

/** Role, name and named states of every element `selector` matches, by CDP. */
const axAll = (page, selector) => withCdp(page, async (cdp) => {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll(${JSON.stringify(selector)})]` });
  const { result: props } = await cdp.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
  const out = [];
  for (const p of props.filter((x) => /^\d+$/.test(x.name))) {
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: p.value.objectId, fetchRelatives: false });
    const n = nodes.find((x) => !x.ignored) || nodes[0] || {};
    const states = Object.fromEntries((n.properties || []).filter((q) => ['expanded', 'focusable', 'disabled'].includes(q.name)).map((q) => [q.name, q.value?.value]));
    const { result: dom } = await cdp.send('Runtime.callFunctionOn', {
      objectId: p.value.objectId,
      functionDeclaration: 'function () { const c = this.getAttribute("aria-controls"); return { ariaExpanded: this.getAttribute("aria-expanded"), ariaControls: c, controlsDrawn: c ? !!document.getElementById(c) : null, id: this.id || null } }',
      returnByValue: true,
    });
    out.push({ role: n.role?.value || '?', name: n.name?.value || '', ...states, ...dom.value });
  }
  return out;
});

async function names(browser) {
  const { ctx, page, seen } = await open(browser, 'dog');
  try {
    await page.waitForSelector('.dog-full-deck [role=switch]', { timeout: 30000 });
    const full = await axAll(page, '.dog-main select');
    await page.click('.dog-full-deck [role=switch]');
    await page.waitForTimeout(400);
    const single = await axAll(page, '.dog-main select');
    return { fullDeck: full, singlePage: single, requests: seen.requests };
  } finally {
    await ctx.close();
  }
}

async function settings(browser) {
  const { ctx, page, seen } = await open(browser, 'dog');
  try {
    await page.getByRole('button', { name: 'D.O.G. settings' }).click();
    await page.waitForSelector('button.dog-acc-head', { timeout: 10000 });
    const tabs = {};
    for (const tab of ['System prompts', 'Output format']) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(300);
      tabs[tab] = await axAll(page, 'button.dog-acc-head');
    }
    // One section opened and closed again, on the Output format tab.
    const first = page.locator('button.dog-acc-head').first();
    await first.click();
    await page.waitForTimeout(200);
    const opened = (await axAll(page, 'button.dog-acc-head'))[0];
    await first.click();
    await page.waitForTimeout(200);
    const closed = (await axAll(page, 'button.dog-acc-head'))[0];
    return { tabs, opened, closed, requests: seen.requests };
  } finally {
    await ctx.close();
  }
}

/** A real kit toast (the fixtures' refusal note) and where focus goes when
    the element it came from is gone. */
async function toastReturn(browser, id, prepare) {
  const { ctx, page, seen } = await open(browser, id);
  try {
    const origin = await prepare(page);
    await origin.focus();
    await page.keyboard.press('Shift');                 // the keyboard is the last input
    await page.evaluate(async () => {
      const { devWriteRefused } = await import('/src/dev/devFixtures.js');
      devWriteRefused('FX15\'s measurement');
    });
    await page.waitForSelector('.ui-toast-stack .ui-toast', { timeout: 5000 });
    // Into the toast from the origin, by keyboard focus (relatedTarget: the origin).
    await page.evaluate(() => document.querySelector('.ui-toast-stack .ui-toast button').focus());
    const inToast = await page.evaluate(() => !!document.activeElement?.closest('.ui-toast-stack'));
    await origin.evaluate((el) => el.remove());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'body';
      return el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '') + (el.getAttribute('tabindex') ? `[tabindex=${el.getAttribute('tabindex')}]` : '');
    });
    const toastLeft = await page.evaluate(() => !document.querySelector('.ui-toast-stack .ui-toast'));
    const focusVisible = await page.evaluate(() => document.activeElement?.matches(':focus-visible') || false);
    if (SHOTS) await page.screenshot({ path: join(OUT, `po-fx15-${TAG}-0${SHOT_NO[id]}-note-gone-${id}-${W}x${H}.png`) });
    return { page: id, inToast, toastLeft, focusAfter: after, focusVisible, requests: seen.requests };
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
try {
  const result = { size: `${W}x${H}`, tag: TAG, at: new Date().toISOString() };
  result.pages = await pages(browser);
  result.names = await names(browser);
  result.settings = await settings(browser);
  result.toast = [
    await toastReturn(browser, 'rabbit', async (page) => {
      await openSaltHours(page);
      await page.getByRole('tab', { name: 'Tasks', exact: true }).first().click();
      await page.waitForTimeout(600);
      return page.getByRole('tab', { name: 'Tasks', exact: true }).first();
    }),
    await toastReturn(browser, 'team-members', async (page) => {
      await page.waitForSelector('button', { timeout: 10000 });
      return page.getByRole('button', { name: /^Export/ }).first();
    }),
  ];
  const file = join(OUT, `po-fx15-landmarks-${TAG}-${W}x${H}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${file}`);
} finally {
  await browser.close();
}
