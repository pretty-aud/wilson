#!/usr/bin/env node
/**
 * Post-overhaul S2b — O.T.T.E.R.'s reading surfaces over Audrey's REAL
 * library: the Functions reference, the Search dialog's function results,
 * the lesson page and the subject's outline (stub) page, at 1440x900 and
 * 1280x700, with the measurements the hand-off quotes.
 *
 *   node scripts/otter-reading-shots.mjs <before|after> [port] [--library <dir>] [--out <dir>] [--no-shots]
 *
 * Writes `<out>/po-s2b-<phase>-<view>-<W>x<H>.png` (default out:
 * docs/sessions/handoffs/img) and prints one JSON line of measurements per
 * view and size.
 *
 * THE REPLAY (post-overhaul plan §4 item 10). Anything that renders her
 * O.T.T.E.R. content is replayed against her real library, not a fixture.
 * The dev fixtures hold one software course, so the library under --library
 * (default `%APPDATA%\wilson\otter-data\software`, read-only: this script
 * writes nothing there) is read here, mapped to the fixture store's row shapes
 * (otter_courses / otter_subjects) and put in front of the fixture courses by
 * rewriting `src/dev/fixtures/store.js` IN FLIGHT: `createStore` is rebound
 * at the end of the module (an ESM live binding, so install.js's call reaches
 * the wrapper). Nothing on disk changes, and the documents reach Otter.jsx
 * exactly as stored — a category with no name stays nameless — because they
 * are not passed through any merge.
 *
 * PREREQUISITES: the worktree's OWN dev server on <port> (prove it with a
 * marker file's content — S2a trap 12), `.env.local` with
 * VITE_DEV_AUTOLOGIN=tester and VITE_DEV_FIXTURES=1.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const phase = args[0];
if (!['before', 'after'].includes(phase)) {
  console.error('usage: node scripts/otter-reading-shots.mjs <before|after> [port] [--library <dir>] [--out <dir>] [--no-shots]');
  process.exit(1);
}
const PORT = args[1] && /^\d+$/.test(args[1]) ? args[1] : '5275';
const BASE = `http://localhost:${PORT}`;
const OUT = flag('out', 'docs/sessions/handoffs/img');
const LIBRARY = flag('library', join(process.env.APPDATA || '', 'wilson', 'otter-data', 'software'));
const SHOTS = !args.includes('--no-shots');
const SIZES = [[1440, 900], [1280, 700]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the replay: her library, in the fixture store's row shapes ──────────────
function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}
function buildReplay(root) {
  if (!existsSync(root)) throw new Error(`no library at ${root}`);
  const courses = [];
  const subjects = [];
  for (const slug of readdirSync(root)) {
    const dir = join(root, slug);
    if (!statSync(dir).isDirectory()) continue;
    const meta = readJson(join(dir, '_meta.json'), null);
    if (!meta) continue;
    const id = `real-${slug}`;
    courses.push({
      id, slug, name: meta.name || slug,
      course_type: meta.type || 'software',
      skill_level: meta.skill_level || 'beginner',
      visibility: 'company_standard',
      source_course_id: null,
      hotkeys: readJson(join(dir, '_hotkeys.json'), { categories: [] }),
      functions: readJson(join(dir, '_functions.json'), { categories: [] }),
      nodes: readJson(join(dir, '_nodes.json'), { systems: [] }),
      reference_urls: readJson(join(dir, '_references.json'), { urls: [] }),
      corrections: { corrections: [] },
      created_at: meta.created_at || '2026-01-01T00:00:00Z',
      updated_at: meta.created_at || '2026-01-01T00:00:00Z',
    });
    const sdir = join(dir, 'subjects');
    const files = existsSync(sdir) ? readdirSync(sdir).filter((f) => f.endsWith('.json')) : [];
    files.forEach((f, i) => {
      const s = readJson(join(sdir, f), null);
      if (!s) return;
      subjects.push({
        id: `${id}-${s.slug || f.replace(/\.json$/, '')}`,
        course_id: id,
        slug: s.slug || f.replace(/\.json$/, ''),
        title: s.title || s.slug,
        description: s.description || '',
        skill_level: s.skill_level || 'beginner',
        is_stub: !!s.is_stub,
        subject_order: Number.isFinite(s.subject_order) ? s.subject_order : i,
        estimated_hours: s.estimated_hours ?? null,
        sections: s.sections || [],
        section_outlines: s.section_outlines || [],
        sources: s.sources || [],
        prerequisites: s.prerequisites || [],
        deleted_at: null,
        created_at: s.created_at || '2026-01-01T00:00:00Z',
        updated_at: s.updated_at || s.created_at || '2026-01-01T00:00:00Z',
      });
    });
  }
  return { courses, subjects };
}

const REBIND = `
;const __s2bCreateStore = createStore;
createStore = function () {
  const s = __s2bCreateStore.apply(this, arguments);
  const r = globalThis.__S2B_REPLAY;
  if (r) {
    const owner = s.courses[0] && s.courses[0].owner_id;
    const ws = s.workspace && s.workspace.id;
    s.courses.unshift(...r.courses.map((c) => ({ ...c, owner_id: owner, workspace_id: ws })));
    s.subjects.push(...r.subjects.map((x) => ({ ...x, owner_id: owner, workspace_id: ws })));
  }
  return s;
};
`;

// ── driving the page ────────────────────────────────────────────────────────
/** Click the first VISIBLE element whose own text is `text` (every page stays
 *  mounted, so a hidden twin must never be the target — ui-shots.mjs). */
async function clickText(page, text, selector = 'button, [role="button"], [role="tab"], h1, h2, h3, h4, span') {
  return page.evaluate(({ text, selector }) => {
    const hit = [...document.querySelectorAll(selector)]
      .find((e) => e.offsetParent !== null && (e.textContent || '').trim() === text);
    if (!hit) return false;
    (hit.closest('button, [role="button"], [role="tab"]') || hit).click();
    return true;
  }, { text, selector });
}
async function tab(page, name) {
  const ok = await page.evaluate((name) => {
    const t = [...document.querySelectorAll('[role="tab"]')].find((b) => b.offsetParent !== null && (b.textContent || '').trim() === name);
    if (!t) return false;
    t.click();
    return true;
  }, name);
  await sleep(2600);
  return ok;
}
/** Library → course → subject (→ lesson): the sidebars, by their text. */
async function openSubject(page, course, subject, lesson) {
  await tab(page, 'Library');
  const c = await clickText(page, course);
  await sleep(2500);
  const s = await clickText(page, subject);
  await sleep(2500);
  let l = true;
  if (lesson) { l = await clickText(page, lesson, 'button, [role="button"], li, span'); await sleep(1500); }
  return { course: c, subject: s, lesson: l };
}

/** The subject page BEFORE content (renderStudyView's stub branch). No click
 *  reaches it on fixture or replayed data: a stub's sidebar row and its card
 *  open the Library, and the app shows this page only straight after an
 *  outline is generated (generateCourse / generateSubjectContent call
 *  setCurrentView('study')), which needs the AI. So the probe does what those
 *  calls do: it selects the stub through its sidebar row, then sets Otter's
 *  FIRST state hook — `const [currentView, setCurrentView] =
 *  useState('library')` is the first line of the component — to 'study'
 *  through React's own dispatcher. Probe-only; if that line moves, this
 *  reports it rather than photographing the wrong page. */
async function openStub(page, course, subject) {
  await tab(page, 'Library');
  const c = await clickText(page, course);
  await sleep(2500);
  const row = await page.evaluate((subject) => {
    const r = [...document.querySelectorAll('.otter-subject-row')].find((e) => e.offsetParent !== null
      && e.getAttribute('data-stub') === 'true' && (e.textContent || '').includes(subject));
    if (!r) return false;
    r.querySelector('button').click();
    return true;
  }, subject);
  await sleep(2000);
  const study = await page.evaluate(() => {
    const host = document.querySelector('.otter-nav');
    const key = host && Object.keys(host).find((k) => k.startsWith('__reactFiber$'));
    let f = key ? host[key] : null;
    while (f && !(typeof f.type === 'function' && f.type.name === 'Otter')) f = f.return;
    const hook = f && f.memoizedState;
    if (!hook || hook.memoizedState !== 'library' || typeof hook.queue?.dispatch !== 'function') return `the first hook is not currentView (${hook && hook.memoizedState})`;
    hook.queue.dispatch('study');
    return true;
  });
  await sleep(1500);
  return { course: c, row, study };
}

// ── measuring ───────────────────────────────────────────────────────────────
const MEASURE = (opts = {}) => {
  const vis = (e) => e && e.offsetParent !== null;
  // The function cards and headings are read inside the Search dialog when
  // it is the view, and outside every dialog otherwise.
  const inScope = (e) => (opts.inDialog ? !!e.closest('[role="dialog"]') : !e.closest('[role="dialog"]'));
  const r = (e) => { const b = e.getBoundingClientRect(); return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) }; };
  // The page in the main pane (the Search dialog's preview is not one).
  const page = [...document.querySelectorAll('.otter-study-page, .otter-view-page')].find((e) => vis(e) && !e.closest('[role="dialog"]'));
  const pane = page && page.parentElement;
  const out = {};
  if (page) {
    out.page = r(page);
    out.pane = r(pane);
    const pad = parseFloat(getComputedStyle(page).paddingLeft);
    // Left gap minus right gap inside the pane's CONTENT box (its scrollbar
    // gutter is not page): 0 is centred.
    const pb = pane.getBoundingClientRect();
    out.centred = +((page.getBoundingClientRect().left - pb.left) - (pb.left + pane.clientWidth - page.getBoundingClientRect().right)).toFixed(2);
    out.measureLen = getComputedStyle(page).getPropertyValue('--measure-body-len').trim();
    out.contentLeft = +(page.getBoundingClientRect().left + pad).toFixed(2);
  }
  const crumbs = [...document.querySelectorAll('.otter-crumbs')].find(vis);
  if (crumbs) {
    out.crumbs = { ...r(crumbs), lineHeight: parseFloat(getComputedStyle(crumbs).lineHeight), title: crumbs.getAttribute('title'),
      segments: [...crumbs.children].filter((x) => x.tagName === 'SPAN').map((x) => ({ text: x.textContent, width: +x.getBoundingClientRect().width.toFixed(1), truncated: x.scrollWidth > x.clientWidth + 0.5 })) };
  }
  // Right edges on the reading surface: every edge should be one length.
  const edges = {};
  for (const sel of ['.otter-lesson-title', '.lesson-content p', '.lesson-content pre', '.ui-card.otter-lesson-card', '.otter-lesson-foot', '.otter-crumbs', '.otter-view-title', '.otter-outline-card']) {
    const e = [...document.querySelectorAll(sel)].find(vis);
    if (e) edges[sel] = +e.getBoundingClientRect().right.toFixed(2);
  }
  out.rightEdges = edges;
  // Characters a line on the prose: a range per character, grouped by line box.
  const counts = [];
  for (const p of [...document.querySelectorAll('.lesson-content p, .lesson-content li')].filter(vis)) {
    const lines = new Map();
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.data.length; i++) {
        const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1);
        const b = rg.getClientRects()[0];
        if (!b) continue;
        const key = Math.round(b.top);
        lines.set(key, (lines.get(key) || 0) + 1);
      }
    }
    const per = [...lines.values()];
    per.pop(); // a paragraph's last line is short by nature
    counts.push(...per);
  }
  if (counts.length) out.charsPerLine = { lines: counts.length, min: Math.min(...counts), max: Math.max(...counts), avg: +(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1) };
  // The function cards: how many wells, how many carry token colours, does any scroll sideways.
  const wells = [...document.querySelectorAll('.otter-fn-card .otter-code-well')].filter((e) => vis(e) && inScope(e));
  if (wells.length) {
    const colours = new Set();
    let tokenSpans = 0;
    for (const w of wells) for (const s of w.querySelectorAll('span[style*="color"]')) { tokenSpans++; colours.add(getComputedStyle(s).color); }
    out.wells = { count: wells.length, tokenSpans, distinctColours: colours.size, scrolling: wells.filter((w) => w.scrollWidth > w.clientWidth + 0.5).length,
      ground: getComputedStyle(wells[0]).backgroundColor, whiteSpace: getComputedStyle(wells[0]).whiteSpace };
  }
  const headings = [...document.querySelectorAll('.otter-ref-section-title')].filter((e) => vis(e) && inScope(e)).map((h) => h.textContent);
  if (headings.length) out.categoryHeadings = headings.slice(0, 12);
  return out;
};

// ── run ─────────────────────────────────────────────────────────────────────
const replay = buildReplay(LIBRARY);
console.log(JSON.stringify({ library: LIBRARY, courses: replay.courses.map((c) => `${c.name} (${c.course_type})`), subjects: replay.subjects.length }));
if (SHOTS) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [w, h] of SIZES) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await context.addInitScript((data) => { globalThis.__S2B_REPLAY = data; }, replay);
    await context.route('**/src/dev/fixtures/store.js*', async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      if (!/export function createStore\(/.test(body)) throw new Error('store.js no longer exports createStore() — the replay cannot attach');
      await route.fulfill({ response: res, body: body + REBIND });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`    pageerror: ${e.message}`));
    await page.goto(`${BASE}/otter`, { waitUntil: 'load' });
    await sleep(8000);
    const shoot = async (view, opts = {}) => {
      const m = await page.evaluate(MEASURE, opts);
      console.log(JSON.stringify({ phase, view, size: `${w}x${h}`, ...m }));
      if (SHOTS) await page.screenshot({ path: join(OUT, `po-s2b-${phase}-${view}-${w}x${h}.png`) });
    };

    // 1. The Functions reference: her Python course (the first coding language).
    const fnTab = await tab(page, 'Functions');
    await sleep(1500);
    if (!fnTab) console.log('    (drive: no Functions tab)');
    await shoot('functions');

    // 2. The Search dialog's function results. "Search" is a button on the
    //    strip, not one of its tabs; the dialog focuses its field.
    if (!(await clickText(page, 'Search', 'button'))) console.log('    (drive: no Search button)');
    await sleep(1200);
    await page.keyboard.type('print', { delay: 30 });
    await sleep(1800);
    const picked = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.otter-search-result')].find((b) => b.offsetParent !== null && /Functions reference/.test(b.textContent || ''));
      if (!row) return false;
      row.click();
      return true;
    });
    await sleep(1200);
    if (!picked) console.log('    (drive: no function result for "print")');
    await shoot('search-functions', { inDialog: true });
    await page.keyboard.press('Escape');
    await sleep(1200);

    // 3. The lesson page: a real Python lesson with code.
    const lesson = await openSubject(page, 'Python', 'Python Syntax and Basic Operations', 'Creating Variables and Understanding Numbers');
    if (!lesson.course || !lesson.subject || !lesson.lesson) console.log(`    (drive: ${JSON.stringify(lesson)})`);
    await shoot('lesson');

    // 4. The longest breadcrumb in her library (Unity 6, a 53-character lesson).
    const crumbs = await openSubject(page, 'Unity 6', 'GameObjects and Components Fundamentals', 'Understanding GameObjects and the Transform Component');
    if (!crumbs.course || !crumbs.subject || !crumbs.lesson) console.log(`    (drive: ${JSON.stringify(crumbs)})`);
    await shoot('lesson-crumbs');

    // 5. The subject page before content: a real Python stub.
    const stub = await openStub(page, 'Python', 'Loops and Iteration');
    if (stub.course !== true || stub.row !== true || stub.study !== true) console.log(`    (drive: ${JSON.stringify(stub)})`);
    await shoot('stub');

    await context.close();
  }
} finally {
  await browser.close();
}
