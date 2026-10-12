#!/usr/bin/env node
/**
 * FX6: the status line under an item popup's title, photographed and
 * measured — post-overhaul FX6 (2026-10-12).
 *
 *   node scripts/fx6-shots.mjs <port> --out <dir> --phase before|after|candidates|forced [--size 1440x900] [--chosen 3]
 *
 *   before / after  the six item popups — asset, task, scene, shot, level,
 *                   experience — each measured: the line's width, style and
 *                   colour, the band's height, the room above and below the
 *                   word, the tone and the word.
 *   candidates      the line at 2, 3 and 4 px side by side, every band drawn
 *                   by the kit's own stylesheet:
 *                     01 the task popup's top, once per weight, at its real
 *                        width (the popup cloned, its body cut short);
 *                     02 every tone at every weight on the dark ground (the
 *                        popups' own: `paper-raised`);
 *                     03 every tone at every weight on the light ground
 *                        (`ground-light`; no window uses it today).
 *                   Each band is the open popup's banner, cloned: its tone,
 *                   status and word set from the ONE status map (StatusDot.jsx,
 *                   imported from this dev server), and its weight written
 *                   on that copy alone. The line's colour against its ground
 *                   is measured and printed (contrast, as WCAG computes it).
 *                   `--chosen N` marks the weight the stylesheet now draws.
 *   forced          the task popup under forced colours (Windows High
 *                   Contrast, emulated by Chromium): the line still drawn,
 *                   in a system colour.
 *
 * Each file is `po-fx6-<phase>-<nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the `fx6-worktree` entry in .claude/launch.json).
 * Changes nothing that outlives the page: the fixture store is in memory, the
 * browser context is fresh per run, and the candidate sheets are drawn over
 * the page in this page only. Animations and transitions are off and the
 * caret transparent. A state whose control is not found stops the run and
 * says which; a sheet whose band does not match the real one stops it too.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--phase', '--chosen'].includes(args[i - 1])) || '5294';
const OUT = flag('--out');
const PHASE = flag('--phase');
const PHASES = ['before', 'after', 'candidates', 'forced'];
if (!OUT || !PHASES.includes(PHASE)) {
  console.error('usage: fx6-shots.mjs <port> --out <dir> --phase before|after|candidates|forced [--size WxH] [--chosen N]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const CHOSEN = flag('--chosen') ? Number(flag('--chosen')) : null;
const WEIGHTS = [2, 3, 4];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, forcedColors: PHASE === 'forced' ? 'active' : 'none' });
  await page.clock.setFixedTime(new Date('2026-10-12T14:02:00'));
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quietCss = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const shot = async (state, { hover = true } = {}) => {
    n += 1;
    if (hover) await page.mouse.move(W - 70, 12);
    await sleep(300);
    const file = `po-fx6-${PHASE}-${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    console.log(`  ${file}`);
  };
  const must = async (loc, what) => {
    try {
      await loc.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${PHASE}-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${PHASE}-${W}x${H}.png)`);
    }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const tab = (name) => page.getByRole('tab', { name, exact: true }).first();
  const anyDialog = () => page.locator('.ui-dialog').last();
  const open = async (query = '') => {
    await page.goto(`http://localhost:${PORT}/rabbit${query}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: quietCss });
    await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
    await sleep(600);
  };
  // A row's hover-only action: the row hovered first, then its button.
  const rowAction = async (name, what) => {
    const b = page.getByRole('button', { name, exact: true }).first();
    await b.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    const row = b.locator('xpath=ancestor::*[self::tr or contains(@class,"card") or contains(@class,"row")][1]');
    if (await row.count()) await row.hover().catch(() => {});
    await click(b, what);
    await must(anyDialog(), `${what}: its popup`);
    await must(anyDialog().locator('.ui-dialog-band > .ui-status-banner'), `${what}: its status banner`);
    await sleep(400);
  };
  const closeDialog = async () => { await page.keyboard.press('Escape'); await sleep(300); };

  // The banner of the topmost popup, measured: the line, the band, and the
  // room the word has above it and between it and the line.
  const measure = async (label) => {
    const m = await page.evaluate(() => {
      const d = [...document.querySelectorAll('.ui-dialog')].pop();
      const b = d?.querySelector('.ui-dialog-band > .ui-status-banner');
      if (!b) return null;
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      const dr = d.getBoundingClientRect();
      const head = d.querySelector('.ui-dialog-head').getBoundingClientRect();
      const body = d.querySelector('.ui-dialog-body').getBoundingClientRect();
      const word = b.querySelector(':scope > span:not(.ui-status-dot)').getBoundingClientRect();
      const line = parseFloat(cs.borderBottomWidth);
      return {
        dialogW: Math.round(dr.width),
        tone: b.dataset.tone,
        word: b.textContent.trim(),
        line: `${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`,
        boxSizing: cs.boxSizing,
        bandH: Math.round(r.height * 10) / 10,
        edgeToEdge: Math.round(r.width) === Math.round(dr.width - 2),
        underHead: Math.round(r.top - head.bottom),
        bodyStartsUnderLine: Math.round(body.top - r.bottom),
        aboveWord: Math.round((word.top - r.top) * 10) / 10,
        wordToLine: Math.round((r.bottom - line - word.bottom) * 10) / 10,
        forcedColors: matchMedia('(forced-colors: active)').matches,
      };
    });
    if (!m) throw new Error(`${label}: no banner to measure`);
    console.log(`  ${label}: ${JSON.stringify(m)}`);
    return m;
  };

  if (PHASE === 'before' || PHASE === 'after') {
    await open();
    await click(tab('Assets'), 'the Assets tab');
    await rowAction('View asset details', 'an asset\'s details');
    await measure('asset'); await shot('asset');
    await closeDialog();
    await click(tab('Tasks'), 'the Tasks tab');
    await rowAction('View task details', 'a task\'s details');
    await measure('task'); await shot('task');
    await closeDialog();
    await click(tab('Scenes'), 'the Scenes tab');
    await sleep(400);
    await rowAction('View details', 'a scene\'s details');
    await measure('scene'); await shot('scene');
    await closeDialog();
    await click(tab('Shots'), 'the Shots content tab');
    await sleep(400);
    await rowAction('View details', 'a shot\'s details');
    await measure('shot'); await shot('shot');
    await closeDialog();
    await open('?fixtures=game');
    await click(tab('Levels'), 'the Levels tab');
    await rowAction('View details', 'a level\'s details');
    await measure('level'); await shot('level');
    await closeDialog();
    await click(tab('Experiences'), 'the Experiences tab');
    await rowAction('View details', 'an experience\'s details');
    await measure('experience'); await shot('experience');
    await closeDialog();
  } else if (PHASE === 'forced') {
    await open();
    await click(tab('Tasks'), 'the Tasks tab');
    await rowAction('View task details', 'a task\'s details');
    const m = await measure('task, forced colours');
    if (!m.forcedColors) throw new Error('forced colours are not active in this page');
    await shot('task');
    await closeDialog();
  } else {
    // ── The candidates ──────────────────────────────────────────────────
    await open();
    await click(tab('Tasks'), 'the Tasks tab');
    await rowAction('View task details', 'a task\'s details');
    const report = await page.evaluate(async ({ WEIGHTS, CHOSEN }) => {
      const { STATUS, STATUS_TONES, statusMeta } = await import('/src/ui/StatusDot.jsx');
      // One status per tone, the first the map gives it (the map's order is
      // the app's): the word on each row is the app's own.
      const rows = STATUS_TONES.map((tone) => {
        const key = Object.keys(STATUS).find((k) => STATUS[k].tone === tone);
        return { tone, key, label: statusMeta(key).label };
      });
      const real = [...document.querySelectorAll('.ui-dialog')].pop();
      const realBanner = real.querySelector('.ui-dialog-band > .ui-status-banner');
      const strip = (node) => { node.removeAttribute('id'); node.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id')); return node; };
      // A copy of the real band, re-toned from the map: the dot, the word and
      // the data attributes the stylesheet keys on, nothing else.
      const band = (row, weight, surface) => {
        const b = strip(real.querySelector('.ui-dialog-band').cloneNode(true));
        const s = b.querySelector('.ui-status-banner');
        const dot = s.querySelector('.ui-status-dot');
        s.dataset.tone = row.tone; s.dataset.status = row.key; s.dataset.surface = surface;
        dot.dataset.tone = row.tone; dot.dataset.surface = surface;
        s.querySelector(':scope > span:not(.ui-status-dot)').textContent = row.label;
        s.style.borderBottomWidth = `${weight}px`;
        return b;
      };
      // CONTROL: a copy re-toned to the real banner's own status, at the
      // stylesheet's own weight, is the real banner byte for byte; so every
      // other copy differs from what the app draws by its tone and weight only.
      const own = rows.find((r) => r.key === realBanner.dataset.status) || { tone: realBanner.dataset.tone, key: realBanner.dataset.status, label: statusMeta(realBanner.dataset.status).label };
      const probe = band(own, 0, realBanner.dataset.surface).querySelector('.ui-status-banner');
      probe.style.removeProperty('border-bottom-width');
      if (probe.getAttribute('style') === '') probe.removeAttribute('style');
      const controlOk = probe.outerHTML === realBanner.outerHTML;

      const label = (text) => {
        const l = document.createElement('div');
        l.textContent = text;
        Object.assign(l.style, { fontSize: 'var(--text-label)', lineHeight: '1', letterSpacing: '0.06em', fontWeight: '600', textTransform: 'uppercase', color: 'var(--color-ink-2)', whiteSpace: 'nowrap' });
        return l;
      };
      const weightName = (w) => (w === CHOSEN ? `${w} px · what the app now draws` : `${w} px`);
      const sheet = (ground) => {
        document.getElementById('fx6-sheet')?.remove();
        const s = document.createElement('div');
        s.id = 'fx6-sheet';
        Object.assign(s.style, { position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'hidden', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: ground === 'light' ? 'var(--color-ground-light)' : 'var(--color-paper)' });
        if (ground === 'light') s.dataset.surface = 'light';
        document.body.appendChild(s);
        return s;
      };
      const out = { controlOk, own: own.key, rows, sheets: {} };

      // 01 — the task popup's top, once per weight, at its real width.
      {
        const s = sheet('dark');
        const width = Math.round(real.getBoundingClientRect().width);
        for (const w of WEIGHTS) {
          s.appendChild(label(weightName(w)));
          const d = strip(real.cloneNode(true));
          d.querySelector('.ui-dialog-foot')?.remove();
          // A copied <select> shows its first option (React sets the value as
          // a property, which a copy does not carry): give each copy the
          // value the real field shows, so the copy's Status reads Final too.
          const from = real.querySelectorAll('select, input, textarea');
          d.querySelectorAll('select, input, textarea').forEach((f, i) => {
            if (f.type === 'checkbox' || f.type === 'radio') f.checked = from[i].checked;
            else if (f.type !== 'file') f.value = from[i].value;
          });
          d.querySelector('.ui-status-banner').style.borderBottomWidth = `${w}px`;
          Object.assign(d.style, { width: `${width}px`, height: `${Math.floor((innerHeight - 48 - WEIGHTS.length * 24) / WEIGHTS.length) - 8}px`, maxHeight: 'none', boxShadow: 'none', overflow: 'hidden', flexShrink: '0' });
          s.appendChild(d);
        }
        out.sheets.taskTop = width;
      }
      return out;
    }, { WEIGHTS, CHOSEN });
    console.log(`  rows: ${report.rows.map((r) => `${r.tone}=${r.label}`).join(', ')}`);
    console.log(`  control (a copy at the real banner's own status and weight IS the real banner): ${report.controlOk} (${report.own})`);
    if (!report.controlOk) throw new Error('a copied band does not match the real banner: the sheets would not show what the app draws');
    await shot('task-top', { hover: false });

    // 02 / 03 — every tone at every weight, dark ground then light ground.
    for (const ground of ['dark', 'light']) {
      const lines = await page.evaluate(async ({ WEIGHTS, CHOSEN, ground }) => {
        const { STATUS, STATUS_TONES, statusMeta } = await import('/src/ui/StatusDot.jsx');
        const rows = STATUS_TONES.map((tone) => {
          const key = Object.keys(STATUS).find((k) => STATUS[k].tone === tone);
          return { tone, key, label: statusMeta(key).label };
        });
        const real = [...document.querySelectorAll('.ui-dialog')].filter((d) => !d.closest('#fx6-sheet')).pop();
        const strip = (node) => { node.removeAttribute('id'); node.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id')); return node; };
        document.getElementById('fx6-sheet')?.remove();
        const s = document.createElement('div');
        s.id = 'fx6-sheet';
        Object.assign(s.style, { position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'hidden', padding: '24px', display: 'grid', gridTemplateColumns: `repeat(${WEIGHTS.length}, minmax(0, 1fr))`, columnGap: '24px', rowGap: '12px', alignContent: 'start', backgroundColor: ground === 'light' ? 'var(--color-ground-light)' : 'var(--color-paper)' });
        if (ground === 'light') s.dataset.surface = 'light';
        document.body.appendChild(s);
        for (const w of WEIGHTS) {
          const l = document.createElement('div');
          l.textContent = w === CHOSEN ? `${w} px · what the app now draws` : `${w} px`;
          Object.assign(l.style, { fontSize: 'var(--text-label)', lineHeight: '1', letterSpacing: '0.06em', fontWeight: '600', textTransform: 'uppercase', color: ground === 'light' ? 'var(--color-ink-light)' : 'var(--color-ink-2)', whiteSpace: 'nowrap' });
          s.appendChild(l);
        }
        const measured = [];
        for (const row of rows) {
          for (const w of WEIGHTS) {
            // The window: on the dark ground the popup's own surface (a shallow
            // copy of the real dialog: its class, its border, its paper); on the
            // light ground no window exists, so the title and the band sit on
            // the light ground itself, in its one ink.
            const cell = ground === 'dark' ? strip(real.cloneNode(false)) : document.createElement('div');
            Object.assign(cell.style, { width: 'auto', maxWidth: 'none', maxHeight: 'none', boxShadow: 'none', paddingBottom: '16px' });
            if (ground === 'light') { cell.dataset.surface = 'light'; cell.style.color = 'var(--color-ink-light)'; }
            const head = strip(real.querySelector('.ui-dialog-head').cloneNode(true));
            if (ground === 'light') {
              head.querySelector('.ui-dialog-title').style.color = 'var(--color-ink-light)';
              head.querySelector('button')?.remove();
            }
            const b = strip(real.querySelector('.ui-dialog-band').cloneNode(true));
            const st = b.querySelector('.ui-status-banner');
            const dot = st.querySelector('.ui-status-dot');
            const surface = ground === 'light' ? 'light' : 'dark';
            st.dataset.tone = row.tone; st.dataset.status = row.key; st.dataset.surface = surface;
            dot.dataset.tone = row.tone; dot.dataset.surface = surface;
            st.querySelector(':scope > span:not(.ui-status-dot)').textContent = row.label;
            st.style.borderBottomWidth = `${w}px`;
            cell.append(head, b);
            s.appendChild(cell);
            const cs = getComputedStyle(st);
            measured.push({ tone: row.tone, word: row.label, weight: w, width: cs.borderBottomWidth, color: cs.borderBottomColor, ground: getComputedStyle(ground === 'dark' ? cell : s).backgroundColor });
          }
        }
        return measured;
      }, { WEIGHTS, CHOSEN, ground });
      // The line against its ground, as WCAG computes contrast (an alpha
      // colour composited over the ground first).
      const rgba = (c) => { const v = c.match(/[\d.]+/g).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
      const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) });
      for (const m of lines.filter((x) => x.weight === WEIGHTS[0])) {
        const g = rgba(m.ground); const c = over(rgba(m.color), g);
        const [hi, lo] = [lum(c), lum(g)].sort((a, b) => b - a);
        console.log(`  ${ground} ground ${m.ground}: ${m.tone} (${m.word}) line ${m.color} — ${((hi + 0.05) / (lo + 0.05)).toFixed(2)}:1`);
      }
      const widths = [...new Set(lines.map((m) => `${m.weight}→${m.width}`))];
      console.log(`  ${ground} ground widths drawn: ${widths.join(', ')}`);
      await shot(`tones-${ground}`, { hover: false });
    }
  }
  await page.close();
} finally {
  await browser.close();
}
