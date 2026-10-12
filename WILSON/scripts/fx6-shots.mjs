#!/usr/bin/env node
/**
 * FX6: the status line under an item popup's title, photographed and
 * measured — post-overhaul FX6 (2026-10-12).
 *
 *   node scripts/fx6-shots.mjs <port> --out <dir> --phase before|after|candidates|forced [--size 1440x900] [--chosen 3] [--expect 3]
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
 *                   Each band is a copy of the open popup's band, re-toned by
 *                   ONE function (`retone`): its tone, status and word from
 *                   the one status map (StatusDot.jsx, imported from this dev
 *                   server), its weight written on that copy alone. CONTROL,
 *                   before any sheet: the popup's own Status is set to every
 *                   status it offers, and each time the live banner must
 *                   equal `retone` of that status byte for byte, with the
 *                   same computed line; a difference stops the run (review
 *                   round 1, R1-01: the first control compared one status,
 *                   the popup's own, which re-toned nothing). The column
 *                   marked "what the app now draws" is the weight MEASURED on
 *                   the live banner (and on a light copy for the light
 *                   sheet), never a flag; `--chosen N` only asserts it. The
 *                   line's colour against its ground is printed as WCAG
 *                   computes contrast.
 *   forced          the task popup under forced colours (Windows High
 *                   Contrast, emulated by Chromium): the line still drawn,
 *                   in a system colour.
 *   --expect N      (after, forced) stop unless every popup's line MEASURES
 *                   N px solid in its tone (the dot's colour), or in the
 *                   word's colour under forced colours: the end-to-end check
 *                   of the weight, which sees the page around each popup,
 *                   Tailwind's own classes and the focus as they are (review
 *                   round 2, R2-01; the unit tests read stylesheets only).
 *
 * Each file is `po-fx6-<phase>-<nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the `fx6-worktree` entry in .claude/launch.json).
 * Changes nothing that outlives the page: the fixture store is in memory, the
 * browser context is fresh per run, the control puts the task's status back,
 * and the candidate sheets are drawn over the page in this page only.
 * Animations and transitions are off and the caret transparent. A state
 * whose control is not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--phase', '--chosen', '--expect'].includes(args[i - 1])) || '5294';
const OUT = flag('--out');
const PHASE = flag('--phase');
const PHASES = ['before', 'after', 'candidates', 'forced'];
if (!OUT || !PHASES.includes(PHASE)) {
  console.error('usage: fx6-shots.mjs <port> --out <dir> --phase before|after|candidates|forced [--size WxH] [--chosen N] [--expect N]');
  process.exit(1);
}
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const CHOSEN = flag('--chosen') ? Number(flag('--chosen')) : null;
const EXPECT = flag('--expect') ? Number(flag('--expect')) : null;
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
        lineWidth: cs.borderBottomWidth,
        lineStyle: cs.borderBottomStyle,
        lineColor: cs.borderBottomColor,
        toneColor: getComputedStyle(b.querySelector('.ui-status-dot')).backgroundColor,
        ink: getComputedStyle(b.querySelector(':scope > span:not(.ui-status-dot)')).color,
      };
    });
    if (!m) throw new Error(`${label}: no banner to measure`);
    const { lineWidth, lineStyle, lineColor, toneColor, ink, ...shown } = m;
    console.log(`  ${label}: ${JSON.stringify(shown)}`);
    // --expect N (review round 2, R2-01): the one check that sees the page
    // around a popup, Tailwind's own classes and the focus as they are. The
    // line must MEASURE N px solid, in the status's tone (the dot's colour)
    // or, under forced colours, in the word's.
    if (EXPECT != null) {
      const want = m.forcedColors ? ink : toneColor;
      if (lineWidth !== `${EXPECT}px` || lineStyle !== 'solid' || lineColor !== want) {
        unexpected.push(`${label}: ${lineWidth} ${lineStyle} ${lineColor}, expected ${EXPECT}px solid ${want}`);
      }
    }
    return m;
  };
  const unexpected = [];

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
  }
  if (EXPECT != null && (PHASE === 'after' || PHASE === 'forced')) {
    if (unexpected.length) throw new Error(`the line is not what --expect ${EXPECT} says:\n${unexpected.join('\n')}`);
    console.log(`  --expect ${EXPECT}: every popup measured ${EXPECT}px solid in its ${PHASE === 'forced' ? 'word\'s colour' : 'tone'}`);
  }
  if (PHASE === 'candidates') {
    // ── The candidates ──────────────────────────────────────────────────
    await open();
    await click(tab('Tasks'), 'the Tasks tab');
    await rowAction('View task details', 'a task\'s details');
    // ONE re-tone, defined once in the page, used by the control and by every
    // sheet: a copy of the band as it was when the popup opened, its tone,
    // status and word from the one status map, its surface, and (when given)
    // its weight written on the copy alone.
    await page.evaluate(async () => {
      const { STATUS, STATUS_TONES, statusMeta } = await import('/src/ui/StatusDot.jsx');
      const real = [...document.querySelectorAll('.ui-dialog')].pop();
      const strip = (node) => { node.removeAttribute('id'); node.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id')); return node; };
      window.__fx6 = {
        STATUS, STATUS_TONES, statusMeta, strip,
        band: real.querySelector('.ui-dialog-band').cloneNode(true),
        head: real.querySelector('.ui-dialog-head').cloneNode(true),
        retone(status, surface, weight) {
          const b = strip(this.band.cloneNode(true));
          const s = b.querySelector('.ui-status-banner');
          const dot = s.querySelector('.ui-status-dot');
          const m = statusMeta(status);
          s.dataset.tone = m.tone; s.dataset.status = status; s.dataset.surface = surface;
          dot.dataset.tone = m.tone; dot.dataset.surface = surface;
          s.querySelector(':scope > span:not(.ui-status-dot)').textContent = m.label;
          if (weight != null) s.style.borderBottomWidth = `${weight}px`;
          return b;
        },
      };
    });
    // CONTROL: every status the popup offers, set through its own Status
    // field; each time the live banner must BE `retone` of that status, byte
    // for byte, with the same computed line. Then the status goes back.
    const status = anyDialog().getByRole('combobox', { name: 'Status' }).first();
    await must(status, 'the task popup\'s Status');
    const original = await status.inputValue();
    const options = await status.evaluate((s) => [...s.options].map((o) => o.value).filter(Boolean));
    const bad = [];
    const tones = new Set();
    let drawn = null;
    for (const v of options) {
      await status.selectOption(v);
      await sleep(250);
      const r = await page.evaluate((v) => {
        const live = [...document.querySelectorAll('.ui-dialog')].pop().querySelector('.ui-dialog-band > .ui-status-banner');
        const copy = window.__fx6.retone(v, live.dataset.surface, null);
        // Measured beside the live band, under the same dialog, then removed
        // before anything can render.
        live.parentElement.after(copy);
        const a = getComputedStyle(live);
        const b = getComputedStyle(copy.querySelector('.ui-status-banner'));
        const out = {
          same: copy.querySelector('.ui-status-banner').outerHTML === live.outerHTML,
          live: `${a.borderBottomWidth} ${a.borderBottomStyle} ${a.borderBottomColor}`,
          copy: `${b.borderBottomWidth} ${b.borderBottomStyle} ${b.borderBottomColor}`,
          tone: live.dataset.tone,
          word: live.textContent.trim(),
        };
        copy.remove();
        return out;
      }, v);
      tones.add(r.tone);
      drawn = drawn ?? r.live.split(' ')[0];
      if (!r.same || r.live !== r.copy || r.live.split(' ')[0] !== drawn) bad.push(`${v}: ${JSON.stringify(r)}`);
    }
    await status.selectOption(original);
    await sleep(250);
    console.log(`  control: ${options.length} statuses (${[...tones].join(', ')}), each live banner = its re-toned copy: ${bad.length === 0} — the line drawn ${drawn}`);
    if (bad.length) throw new Error(`a re-toned copy does not match the live banner:\n${bad.join('\n')}`);
    if (tones.size !== 5) throw new Error(`the control reached ${tones.size} of the 5 tones`);
    if (CHOSEN != null && drawn !== `${CHOSEN}px`) throw new Error(`--chosen ${CHOSEN}, but the app draws ${drawn}`);
    const DRAWN = parseFloat(drawn);

    // 01 — the task popup's top, once per weight, at its real width.
    await page.evaluate(({ WEIGHTS, DRAWN }) => {
      const { strip } = window.__fx6;
      const real = [...document.querySelectorAll('.ui-dialog')].pop();
      const s = document.createElement('div');
      s.id = 'fx6-sheet';
      Object.assign(s.style, { position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'hidden', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--color-paper)' });
      document.body.appendChild(s);
      const width = Math.round(real.getBoundingClientRect().width);
      for (const w of WEIGHTS) {
        const l = document.createElement('div');
        l.textContent = w === DRAWN ? `${w} px · what the app now draws` : `${w} px`;
        Object.assign(l.style, { fontSize: 'var(--text-label)', lineHeight: '1', letterSpacing: '0.06em', fontWeight: '600', textTransform: 'uppercase', color: 'var(--color-ink-2)', whiteSpace: 'nowrap' });
        s.appendChild(l);
        const d = strip(real.cloneNode(true));
        d.querySelector('.ui-dialog-foot')?.remove();
        // A copied <select> shows its first option (React sets the value as a
        // property, which a copy does not carry): give each copy the value the
        // real field shows, so the copy's Status reads what the banner says.
        const from = real.querySelectorAll('select, input, textarea');
        d.querySelectorAll('select, input, textarea').forEach((f, i) => {
          if (f.type === 'checkbox' || f.type === 'radio') f.checked = from[i].checked;
          else if (f.type !== 'file') f.value = from[i].value;
        });
        d.querySelector('.ui-status-banner').style.borderBottomWidth = `${w}px`;
        Object.assign(d.style, { width: `${width}px`, height: `${Math.floor((innerHeight - 48 - WEIGHTS.length * 24) / WEIGHTS.length) - 8}px`, maxHeight: 'none', boxShadow: 'none', overflow: 'hidden', flexShrink: '0' });
        s.appendChild(d);
      }
    }, { WEIGHTS, DRAWN });
    await shot('task-top', { hover: false });

    // 02 / 03 — every tone at every weight, dark ground then light ground.
    for (const ground of ['dark', 'light']) {
      const { lines, drawnHere } = await page.evaluate(({ WEIGHTS, ground }) => {
        const { STATUS, STATUS_TONES, strip } = window.__fx6;
        // One status per tone, the first the map gives it (the map's order is
        // the app's): the word on each row is the app's own.
        const rows = STATUS_TONES.map((tone) => Object.keys(STATUS).find((k) => STATUS[k].tone === tone));
        const real = [...document.querySelectorAll('.ui-dialog')].filter((d) => !d.closest('#fx6-sheet')).pop();
        document.getElementById('fx6-sheet')?.remove();
        const s = document.createElement('div');
        s.id = 'fx6-sheet';
        Object.assign(s.style, { position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'hidden', padding: '24px', display: 'grid', gridTemplateColumns: `repeat(${WEIGHTS.length}, minmax(0, 1fr))`, columnGap: '24px', rowGap: '12px', alignContent: 'start', backgroundColor: ground === 'light' ? 'var(--color-ground-light)' : 'var(--color-paper)' });
        if (ground === 'light') s.dataset.surface = 'light';
        document.body.appendChild(s);
        const surface = ground === 'light' ? 'light' : 'dark';
        // What the app draws on this ground: a copy at the stylesheet's own
        // weight, measured in the sheet.
        const probe = window.__fx6.retone(rows[0], surface, null);
        s.appendChild(probe);
        const drawnHere = parseFloat(getComputedStyle(probe.querySelector('.ui-status-banner')).borderBottomWidth);
        probe.remove();
        const ink = ground === 'light' ? 'var(--color-ink-light)' : 'var(--color-ink-2)';
        const label = (text, span) => {
          const l = document.createElement('div');
          l.textContent = text;
          Object.assign(l.style, { fontSize: 'var(--text-label)', lineHeight: '1.3', letterSpacing: '0.06em', fontWeight: '600', textTransform: 'uppercase', color: ink });
          if (span) l.style.gridColumn = '1 / -1'; else l.style.whiteSpace = 'nowrap';
          return l;
        };
        if (!WEIGHTS.includes(drawnHere)) {
          s.appendChild(label(`On this ground the app draws the line ${drawnHere} px: no status colour is drawn here, so there is no bar, only the page's rule`, true));
        }
        for (const w of WEIGHTS) s.appendChild(label(w === drawnHere ? `${w} px · what the app now draws` : `${w} px`));
        const measured = [];
        for (const key of rows) {
          for (const w of WEIGHTS) {
            // The window: on the dark ground the popup's own surface (a shallow
            // copy of the real dialog: its class, its border, its paper); on the
            // light ground no window exists, so the title and the band sit on
            // the light ground itself, in its one ink.
            const cell = ground === 'dark' ? strip(real.cloneNode(false)) : document.createElement('div');
            Object.assign(cell.style, { width: 'auto', maxWidth: 'none', maxHeight: 'none', boxShadow: 'none', paddingBottom: '16px' });
            if (ground === 'light') { cell.dataset.surface = 'light'; cell.style.color = 'var(--color-ink-light)'; }
            const head = strip(window.__fx6.head.cloneNode(true));
            if (ground === 'light') {
              head.querySelector('.ui-dialog-title').style.color = 'var(--color-ink-light)';
              head.querySelector('button')?.remove();
            }
            const b = window.__fx6.retone(key, surface, w);
            cell.append(head, b);
            s.appendChild(cell);
            const st = b.querySelector('.ui-status-banner');
            const cs = getComputedStyle(st);
            measured.push({ tone: st.dataset.tone, word: st.textContent.trim(), weight: w, width: cs.borderBottomWidth, color: cs.borderBottomColor, ground: getComputedStyle(ground === 'dark' ? cell : s).backgroundColor });
          }
        }
        return { lines: measured, drawnHere };
      }, { WEIGHTS, ground });
      // The dark sheet's copy sits outside the popup and its page, so a rule
      // keyed on them would change the live line and not the copy (review
      // round 2, R2-04): its mark must be the live measurement, or the run
      // stops. The light ground has no live banner to measure: its copy is
      // the measurement, and the sheet says so.
      if (ground === 'dark' && drawnHere !== DRAWN) {
        throw new Error(`the dark sheet's copy draws ${drawnHere}px where the live banner draws ${DRAWN}px: a rule reaches one and not the other`);
      }
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
      console.log(`  ${ground} ground: the app draws ${drawnHere}px; the candidates drawn ${widths.join(', ')}`);
      await shot(`tones-${ground}`, { hover: false });
    }
  }
  await page.close();
} finally {
  await browser.close();
}
