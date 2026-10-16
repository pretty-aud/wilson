#!/usr/bin/env node
/**
 * FX11's measurements and pictures, before and after — post-overhaul FX11
 * (2026-10-16): one connection dot in the bottom-left corner of every
 * R.A.B.B.I.T. tab, just above the orange bar; the project bar keeps the
 * project's name and status on the left and the faces, then Switch, on the
 * right; the Dashboard's Live badge goes; the Bins counter moves up.
 *
 *   node scripts/fx11-shots.mjs <port> --out <dir> --phase before|after [--size 1440x900] [--no-shots] [--check]
 *
 * At each tab of the dev fixtures' Salt Hours (and the Dashboard) it prints:
 * the project bar's children left and right; the orange bar at the window's
 * foot (its box); what the browser paints in the bottom-left corner of the
 * view body (the 32x32 square above the orange bar: each element's tag,
 * class, box and whether it carries text there); the Bins counter's box and
 * the gap from it to the orange bar; and, after the change, the dot's box,
 * colour, state, accessible name and hover text.
 *
 * --check exits 1 unless, on every tab: the project bar holds no LIVE / Sync
 * pill and no adapter dot, its left is PROJECT, the name and the status, and
 * its right the faces (where any) then Switch; exactly one connection dot is
 * drawn, inside the 32px above the orange bar, its left edge in the gutter,
 * nothing with text under it; on Bins the counter's box clears the dot's; the
 * Dashboard draws no Live badge. Each failure is printed.
 *
 * Each file is `po-fx11-<phase>-<nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1. Changes nothing that outlives the page: the fixture
 * store is in memory and the browser context is fresh per run. Animations and
 * transitions are off and the caret transparent, in this page only.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--phase', '--fixtures', '--connection', '--tabs'].includes(args[i - 1])) || '5299';
const OUT = flag('--out');
const PHASE = flag('--phase');
const SHOTS = !args.includes('--no-shots');
const CHECK = args.includes('--check');
const failures = [];
if (!OUT || !['before', 'after'].includes(PHASE)) {
  console.error('usage: fx11-shots.mjs <port> --out <dir> --phase before|after [--size WxH] [--no-shots] [--check]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const TABS = ['Summary', 'Intake', 'Files', 'Team', 'Tasks', 'Timeline', 'Budget', 'Assets', 'Scenes', 'Bins', 'Levels', 'Experiences'];
// ?fixtures=<name> (the dev fixtures' variants: game turns Levels and Experiences on).
const FIXTURES = flag('--fixtures');
// ?connection=files-down|offline (the fixtures' seam, FX11): the dot's amber and red.
const CONNECTION = flag('--connection');
const Q = (() => { const q = new URLSearchParams(); if (FIXTURES) q.set('fixtures', FIXTURES); if (CONNECTION) q.set('connection', CONNECTION); const t = q.toString(); return t ? `?${t}` : ''; })();
const TAG = CONNECTION ? `${CONNECTION}-` : FIXTURES ? `${FIXTURES}-` : '';
// --tabs Summary,Bins: only those tabs (the amber and red runs need two).
const ONLY = flag('--tabs') ? flag('--tabs').split(',') : null;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.clock.setFixedTime(new Date('2026-10-16T14:02:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quietCss = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const must = async (loc, what) => {
    try {
      await loc.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${W}x${H}.png)`);
    }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const shot = async (state) => {
    if (!SHOTS) return;
    n += 1;
    const file = `po-fx11-${PHASE}-${TAG}${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    // The corner, cropped and doubled: the dot and what is around it.
    const corner = await page.evaluate(() => {
      const shell = document.querySelector('.rb-shell');
      const r = shell ? shell.getBoundingClientRect() : null;
      return r && r.width > 0 ? { x: r.left, y: Math.max(0, r.bottom - 120), width: 360, height: 128 } : null;
    });
    if (corner) {
      const cfile = `po-fx11-${PHASE}-${TAG}${String(n).padStart(2, '0')}-${state}-corner-${W}x${H}.png`;
      await page.screenshot({ path: join(OUT, cfile), clip: corner, scale: 'device' });
    }
  };

  // Everything below is read from the browser's own layout and styles.
  const measure = async (state) => {
    const m = await page.evaluate(() => {
      const px = (v) => Math.round(v * 10) / 10;
      const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: px(r.left), y: px(r.top), w: px(r.width), h: px(r.height), right: px(r.right), bottom: px(r.bottom) }; };
      const desc = (e) => `${e.tagName.toLowerCase()}${e.getAttribute('class') ? '.' + e.getAttribute('class').trim().split(/\s+/).join('.') : ''}`;
      const shell = document.querySelector('.rb-shell');
      const shellBox = box(shell);
      // The orange bar at the window's foot: the last `.wilson-chrome` child
      // of the app column, whatever its height.
      const chrome = [...document.querySelectorAll('.wilson-chrome')];
      const foot = chrome.length ? chrome[chrome.length - 1] : null;
      const footBox = box(foot);
      const footBg = foot ? getComputedStyle(foot).backgroundColor : null;
      // The project bar.
      const bar = document.querySelector('.ui-toolbar.rb-ctx');
      const slots = bar ? [...bar.querySelectorAll(':scope > .ui-toolbar-slot')] : [];
      const words = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const flat = (root) => {
        const out = [];
        const walk = (el) => {
          for (const c of el.children) {
            const cls = c.getAttribute('class') || '';
            if (cls.includes('contents') || c.dataset.slot === 'status') { walk(c); continue; }
            out.push({ el: desc(c), words: words(c), slot: c.closest('[data-slot]')?.dataset.slot || null, status: c.dataset.status || null, state: c.dataset.state || null });
          }
        };
        if (root) walk(root);
        return out;
      };
      const projectBar = bar ? { left: flat(slots[0]), right: flat(slots[slots.length - 1]), h: box(bar).h } : null;
      // The tab strip's right end (Summary docks the status there before FX11).
      const tabbarStatus = flat(document.querySelector('.rb-tabbar-status'));
      // The corner: every element whose box meets the 32x32 square at the
      // view body's bottom-left (shell's left, the orange bar's top).
      const cornerBottom = footBox ? footBox.y : (shellBox ? shellBox.bottom : 0);
      const cornerLeft = shellBox ? shellBox.x : 0;
      const square = { x: cornerLeft, y: cornerBottom - 32, right: cornerLeft + 32, bottom: cornerBottom };
      const meets = (r) => r.left < square.right && r.right > square.x && r.top < square.bottom && r.bottom > square.y && r.width > 0 && r.height > 0;
      const under = [];
      const textUnder = [];
      if (shell) {
        for (const el of shell.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (!meets(r)) continue;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
          under.push(desc(el).slice(0, 80));
        }
        // Text nodes whose own rects meet the square (what a dot would cover).
        const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (!t.textContent.trim()) continue;
          range.selectNodeContents(t);
          for (const r of range.getClientRects()) {
            if (meets(r)) { textUnder.push({ text: t.textContent.trim().slice(0, 40), x: px(r.left), y: px(r.top), right: px(r.right), bottom: px(r.bottom) }); break; }
          }
        }
      }
      // What ever reaches the 24px gutter: every text run and every drawn
      // glyph (svg, img, input) in the view body whose left edge is under
      // 24px from the shell's left, wherever it is vertically — rows that
      // scroll pass under the corner, so the corner's content is the
      // column's, not this frame's.
      const body = shell?.querySelector('[role="tabpanel"]');
      const inGutter = [];
      let minTextLeft = Infinity;
      if (body) {
        const bodyBox = body.getBoundingClientRect();
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (!t.textContent.trim()) continue;
          const host = t.parentElement;
          if (host && (getComputedStyle(host).visibility === 'hidden')) continue;
          range.selectNodeContents(t);
          for (const r of range.getClientRects()) {
            if (r.width <= 0 || r.bottom < bodyBox.top || r.top > bodyBox.bottom + 4000) continue;
            const left = r.left - (shell.getBoundingClientRect().left);
            minTextLeft = Math.min(minTextLeft, left);
            if (left < 24 && inGutter.length < 8) inGutter.push({ text: t.textContent.trim().slice(0, 32), x: px(r.left), y: px(r.top), host: desc(host).slice(0, 60) });
            break;
          }
        }
        for (const g of body.querySelectorAll('svg, img, input, select, [role="checkbox"]')) {
          if (g.closest('svg') && g.closest('svg') !== g) continue;
          const r = g.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const left = r.left - shell.getBoundingClientRect().left;
          if (left < 24 && inGutter.length < 16) inGutter.push({ glyph: desc(g).slice(0, 50), x: px(r.left), y: px(r.top), w: px(r.width) });
        }
      }
      // The Bins counter (BinTree's footer readout).
      const counter = document.querySelector('[data-testid="bins-project-count"]');
      const counterFooter = counter?.parentElement;
      // The connection dot (after FX11).
      const dot = document.querySelector('[data-testid="connection-dot"]');
      const dotMark = dot?.querySelector('.ui-status-dot') || dot;
      const dots = document.querySelectorAll('[data-testid="connection-dot"]').length;
      // What the browser actually paints at the dot's centre (a box can be
      // in the right place and still be under a tab's own layer). The stack
      // above it, when it is not the dot, names the layer that wins.
      let onTop = null;
      if (dotMark) {
        const r = dotMark.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const covers = [];
        if (hit && !hit.closest('[data-testid="connection-dot"]')) {
          for (let e = hit; e && e !== document.body && covers.length < 6; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (s.zIndex !== 'auto' || s.position === 'sticky') covers.push(`${desc(e).slice(0, 60)} z=${s.zIndex} ${s.position}`);
          }
        }
        onTop = { dot: !!hit?.closest('[data-testid="connection-dot"]'), hit: hit ? desc(hit).slice(0, 60) : null, covers };
      }
      const live = document.querySelector('[data-testid="connection-dot-live"]');
      // Every status dot and pill anywhere in the shell (the "three green dots").
      const greens = shell ? [...shell.querySelectorAll('.ui-status-dot')].filter((d) => d.getBoundingClientRect().width > 0)
        .map((d) => ({ el: desc(d.parentElement || d).slice(0, 60), tone: d.dataset.tone, at: box(d) })) : [];
      return {
        viewport: { w: innerWidth, h: innerHeight },
        shell: shellBox,
        foot: footBox ? { ...footBox, bg: footBg } : null,
        projectBar,
        tabbarStatus,
        corner: { square, under, textUnder },
        gutter: { minTextLeft: Number.isFinite(minTextLeft) ? px(minTextLeft) : null, inGutter },
        counter: counter ? { box: box(counter), text: counter.textContent, footer: box(counterFooter), gapToFoot: footBox ? px(footBox.y - counter.getBoundingClientRect().bottom) : null } : null,
        dot: dot ? {
          count: dots, onTop, box: box(dot), mark: box(dotMark), tone: dotMark.dataset.tone, state: dot.dataset.state,
          color: getComputedStyle(dotMark).backgroundColor, name: dot.querySelector('.rb-conn-cell')?.getAttribute('aria-label') ?? null, title: dot.querySelector('.rb-conn-cell')?.getAttribute('title') ?? null,
          markTitle: dotMark.getAttribute('title'), button: dot.querySelector('.rb-conn-cell')?.tagName || null,
          shape: { radius: getComputedStyle(dotMark).borderRadius, transform: getComputedStyle(dotMark).transform },
          live: live ? { role: live.getAttribute('role'), ariaLive: live.getAttribute('aria-live'), text: live.textContent } : null,
          gapToFoot: footBox ? px(footBox.y - dotMark.getBoundingClientRect().bottom) : null,
        } : { count: 0 },
        greens,
      };
    });
    console.log(`  ${state}: ${JSON.stringify(m)}`);
    if (CHECK) check(state, m);
    return m;
  };

  const check = (state, m) => {
    const fail = (what) => failures.push(`${state} at ${W}x${H}: ${what}`);
    if (state === 'dashboard') return;
    const pb = m.projectBar;
    if (pb) {
      const right = pb.right.map((c) => c.el + ' ' + c.words).join(' | ');
      if (/\bLive\b|\bSync\b/i.test(right)) fail(`the project bar's right still says Live/Sync: ${right}`);
      if (pb.right.some((c) => c.slot === 'adapter')) fail('the project bar still holds the adapter dot');
      const leftWords = pb.left.map((c) => c.words);
      if (leftWords[0] !== 'Project') fail(`the bar's left starts with ${leftWords[0]}, not PROJECT`);
      if (!pb.left.some((c) => c.el.startsWith('span.ui-status'))) fail('the bar\'s left holds no project status');
      const last = pb.right[pb.right.length - 1];
      if (!last || !/^(button|div.relative)/.test(last.el) || !/^Switch/.test(last.words)) fail(`the bar's right does not end with Switch: ${right}`);
      if (pb.right.some((c) => c.el.includes('ui-status-dot') || c.el.startsWith('span.ui-status'))) fail(`a status dot or pill on the bar's right: ${right}`);
    }
    if (m.tabbarStatus.some((c) => /\bLive\b|\bSync\b/i.test(c.words) || c.slot === 'adapter')) fail('the tab strip still docks the pill or the adapter dot');
    if (m.dot.count !== 1) { fail(`${m.dot.count} connection dots`); return; }
    const d = m.dot.mark;
    if (!m.foot) { fail('no orange bar measured'); return; }
    if (d.bottom > m.foot.y) fail(`the dot's bottom ${d.bottom} is below the orange bar's top ${m.foot.y}`);
    if (m.foot.y - d.bottom > 24) fail(`the dot sits ${px(m.foot.y - d.bottom)}px above the orange bar, not just above it`);
    if (d.x < m.shell.x || d.right > m.shell.x + 24) fail(`the dot (${d.x}..${d.right}) is not in the 24px gutter`);
    const hits = m.corner.textUnder.filter((t) => t.x < d.right + 4 && t.right > d.x - 4 && t.y < d.bottom + 4 && t.bottom > d.y - 4);
    if (hits.length) fail(`text under or touching the dot: ${JSON.stringify(hits)}`);
    if (!m.dot.title || !/Database/.test(m.dot.title) || !/Files/.test(m.dot.title)) fail(`the dot's words do not say each part: ${m.dot.title}`);
    if (m.dot.name !== `Connection: ${m.dot.title}`) fail(`the button's name is not the words: ${m.dot.name}`);
    if (m.dot.markTitle !== m.dot.title) fail("the dot's own title would mask the button's");
    if (m.dot.button !== 'BUTTON') fail('the cell is not a button (no keyboard way to the words)');
    // Never colour alone: green a circle, amber a diamond, red a square.
    const round = m.dot.shape.radius !== '0px';
    const turned = m.dot.shape.transform !== 'none';
    const shapeOk = m.dot.state === 'files' ? (!round && turned) : m.dot.state === 'offline' ? (!round && !turned) : (round && !turned);
    if (!shapeOk) fail(`the ${m.dot.state} dot has the wrong shape: ${JSON.stringify(m.dot.shape)}`);
    // The colour the fixtures' seam asks for (?connection=…), and its tone.
    const want = CONNECTION === 'files-down' ? ['files', 'warning'] : CONNECTION === 'offline' ? ['offline', 'danger'] : ['connected', 'success'];
    if (m.dot.state !== want[0] || m.dot.tone !== want[1]) fail(`the dot is ${m.dot.state}/${m.dot.tone}, not ${want.join('/')}`);
    if (m.dot.live?.ariaLive !== 'polite') fail('the dot has no polite live region');
    if (!m.dot.onTop?.dot) fail(`the dot is covered: ${m.dot.onTop?.hit} ${(m.dot.onTop?.covers || []).join(' < ')}`);
    if (m.counter) {
      const c = m.counter.box;
      if (c.bottom > d.y - 4 && c.x < d.right) fail(`the Bins counter (bottom ${c.bottom}) does not clear the dot (top ${d.y})`);
    }
  };
  const px = (v) => Math.round(v * 10) / 10;

  await page.goto(`http://localhost:${PORT}/rabbit${Q}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quietCss });
  await sleep(600);
  await measure('gallery');
  await shot('gallery');
  if (CHECK || SHOTS) {
    // The keyboard's way to the words (FX11 review round 1, R1-4): Tab reaches
    // the cell, Enter shows the words, Escape hides them.
    let reached = false;
    await page.locator('body').click({ position: { x: 600, y: 10 } });
    for (let i = 0; i < 300 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => !!document.activeElement?.closest?.('.rb-conn-cell'));
    }
    if (!reached && CHECK) failures.push(`gallery at ${W}x${H}: Tab never reaches the connection dot`);
    if (reached) {
      await page.keyboard.press('Enter');
      const words = await page.locator('[data-testid="connection-dot-words"]').innerText().catch(() => null);
      console.log(`  keyboard: Tab reached the dot; Enter shows: ${JSON.stringify(words)}`);
      if (CHECK && (!words || !/Database/.test(words) || !/Files/.test(words))) failures.push(`gallery at ${W}x${H}: Enter shows no words`);
      await shot('keyboard-words');
      await page.keyboard.press('Escape');
      if (CHECK && await page.locator('[data-testid="connection-dot-words"]').count()) failures.push(`gallery at ${W}x${H}: Escape leaves the words open`);
    }
    // Forced colours (R1-5): the dot stays drawn, not painted out with the cell.
    await page.emulateMedia({ forcedColors: 'active' });
    const fc = await page.evaluate(() => {
      const mark = document.querySelector('.rb-conn .ui-status-dot');
      const cell = document.querySelector('.rb-conn');
      return mark && cell ? { dot: getComputedStyle(mark).backgroundColor, cell: getComputedStyle(cell).backgroundColor, adjust: getComputedStyle(mark).forcedColorAdjust } : null;
    });
    console.log(`  forced colours: ${JSON.stringify(fc)}`);
    if (CHECK && (!fc || fc.dot === fc.cell)) failures.push(`gallery at ${W}x${H}: under forced colours the dot is painted out (${JSON.stringify(fc)})`);
    await shot('forced-colors');
    await page.emulateMedia({ forcedColors: 'none' });
  }
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await sleep(800);
  for (const name of TABS) {
    if (ONLY && !ONLY.includes(name)) continue;
    const t = tab(name);
    if (!(await t.isVisible().catch(() => false))) { console.log(`  (no ${name} tab)`); continue; }
    await t.click();
    await sleep(700);
    await measure(name.toLowerCase());
    await shot(name.toLowerCase());
  }
  await page.goto(`http://localhost:${PORT}/dashboard${Q}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quietCss });
  await sleep(800);
  const dash = await page.evaluate(() => {
    const p = document.querySelector('.dash-presence');
    return { presence: p ? p.outerHTML.slice(0, 400) : null, live: [...document.querySelectorAll('.ui-status')].map((s) => s.textContent) };
  });
  console.log(`  dashboard: ${JSON.stringify(dash)}`);
  if (CHECK && dash.live.some((t) => /^Live$/i.test(t.trim()))) failures.push(`dashboard at ${W}x${H}: the Live badge is still drawn`);
  await shot('dashboard');
} finally {
  await browser.close();
}
if (CHECK) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`check at ${W}x${H}: ${failures.length ? `${failures.length} failure(s)` : 'every state holds'}`);
  if (failures.length) process.exit(1);
}
