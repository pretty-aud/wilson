#!/usr/bin/env node
/**
 * Post-overhaul S2b — O.T.T.E.R.'s reading surfaces over Audrey's REAL
 * library: the Functions reference, the Search dialog's function results,
 * the lesson page and the subject's outline (stub) page, at 1440x900 and
 * 1280x700, with the measurements the hand-off quotes.
 *
 *   node scripts/otter-reading-shots.mjs <before|after> [port] [--library <dir>] [--out <dir>] [--no-shots] [--sizes WxH,…]
 *                                        [--prefix <name>] [--views <view,…>] [--plant]
 *
 * Writes `<out>/<prefix>-<phase>-<view>-<W>x<H>.png` (default out:
 * docs/sessions/handoffs/img, default prefix po-s2b) and prints one JSON line
 * of measurements per view and size.
 *
 * Views (default: the first five, S2b's): functions, search-functions, lesson,
 * lesson-crumbs, stub; and, post-overhaul S2c: stub-stress (the outline page
 * of a subject whose title nearly fills the column — a stress title added in
 * memory to her Python course, sized in the page to sit 25px inside the line;
 * with it, `outlineSweep`: every one of her subjects and a run of stress
 * titles through the live outline breadcrumb, "[outline]" whole or not) and
 * a11y (what the accessibility tree holds under each breadcrumb, read through
 * the DevTools protocol). --plant (S2c, S2b-05) adds entries that are not
 * objects — null, a string, a number, a list — to her Python function library
 * IN MEMORY, for the Functions view and the Search dialog.
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
  console.error('usage: node scripts/otter-reading-shots.mjs <before|after> [port] [--library <dir>] [--out <dir>] [--no-shots] [--sizes WxH,…] [--prefix <name>] [--views <view,…>] [--plant]');
  process.exit(1);
}
const PORT = args[1] && /^\d+$/.test(args[1]) ? args[1] : '5275';
const BASE = `http://localhost:${PORT}`;
const OUT = flag('out', 'docs/sessions/handoffs/img');
const LIBRARY = flag('library', join(process.env.APPDATA || '', 'wilson', 'otter-data', 'software'));
const SHOTS = !args.includes('--no-shots');
const PREFIX = flag('prefix', 'po-s2b');
const VIEWS = new Set(flag('views', 'functions,search-functions,lesson,lesson-crumbs,stub').split(',').map((v) => v.trim()));
const PLANT = args.includes('--plant');
// --sizes 1024x700,853x583 measures the smallest window (and it at about
// 120% zoom, as A3 did) without changing the shots' default pair.
const SIZES = flag('sizes', '1440x900,1280x700').split(',').map((s) => s.trim().split('x').map(Number));
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

/** S2c (S2b-05): her Python library with one entry of each kind that is not
 *  an object, IN MEMORY — the replay's copy, never her file. */
const PLANTS = [null, 'print', 5, ['len']];
function plantNonObjects(replay) {
  const py = replay.courses.find((c) => c.course_type === 'coding_language');
  const cat = py && (py.functions.categories || []).find((c) => c && Array.isArray(c.functions) && c.functions.length);
  if (!cat) throw new Error('no coding-language course with functions to plant in');
  cat.functions.splice(1, 0, ...PLANTS);
  return { course: py.name, planted: PLANTS.length };
}

/** S2c (S2b-03): a stress subject — a stub in her Python course, in memory,
 *  whose title is `title` (sized in the page to nearly fill the column). */
function withStressSubject(replay, title) {
  const py = replay.courses.find((c) => c.slug === 'python') || replay.courses[0];
  return {
    courses: replay.courses,
    subjects: [...replay.subjects, { id: `${py.id}-s2c-stress`, course_id: py.id, slug: 's2c-stress', title, description: 'S2c stress title (in memory only).',
      skill_level: 'beginner', is_stub: true, subject_order: 999, estimated_hours: null, sections: [], section_outlines: [{ title: 'One', lessons: [] }],
      sources: [], prerequisites: [], deleted_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
  };
}
/** Titles of every length from 70 to 118 characters: around the outline
 *  page's column at the Caption step (about 99 characters of Geist). */
const STRESS_BASE = 'Understanding GameObjects, Components and the Transform Hierarchy in Unity 6 for Complete Beginners and Returning Artists';
const STRESS_TITLES = [...new Set(Array.from({ length: 49 }, (_, i) => STRESS_BASE.slice(0, 70 + i).trimEnd()))];

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
      segments: [...crumbs.querySelectorAll('.otter-crumb-keep, .otter-crumb, .otter-crumb-current, .otter-crumb-note')].map((x) => ({ text: x.textContent, width: +x.getBoundingClientRect().width.toFixed(1), truncated: x.scrollWidth > x.clientWidth + 0.5 })) };
  }
  // Right edges on the reading surface: every edge should be one length.
  const edges = {};
  for (const sel of ['.otter-lesson-title', '.lesson-content p', '.lesson-content pre', '.ui-card.otter-lesson-card', '.otter-lesson-foot', '.otter-crumbs', '.otter-view-title', '.otter-outline-card']) {
    const e = [...document.querySelectorAll(sel)].find(vis);
    if (e) edges[sel] = +e.getBoundingClientRect().right.toFixed(2);
  }
  out.rightEdges = edges;
  // Characters a line on the prose: a range per character, grouped by LINE
  // (a character joins the line whose middle is within 6px of its own, so an
  // inline-code chip's taller box stays on its line — review round 1 found
  // `Math.round(top)` splitting lines at every chip). Each text node counts
  // once, in its nearest paragraph or list item.
  const counts = [];
  for (const p of [...document.querySelectorAll('.lesson-content p, .lesson-content li')].filter(vis)) {
    const lines = [];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest('p, li') !== p) continue;
      for (let i = 0; i < n.data.length; i++) {
        const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1);
        const b = rg.getClientRects()[0];
        if (!b) continue;
        const mid = (b.top + b.bottom) / 2;
        const line = lines.find((l) => Math.abs(l.mid - mid) < 6);
        if (line) line.n++; else lines.push({ mid, n: 1 });
      }
    }
    const per = lines.sort((a, b) => a.mid - b.mid).map((l) => l.n);
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

/** S2b gave the outline page the Body step (14px) so it can declare the
 *  column's length. Its text all sets its own size, so the step should move
 *  nothing: every box on the page is read, the page's old 16px / 24px put
 *  back in place, every box read again, and the differences returned (the
 *  page's own width aside). [] is "the step moved nothing". */
const STEP_NEUTRAL = () => {
  const page = [...document.querySelectorAll(".otter-view-page[data-width='subject']")].find((e) => e.offsetParent !== null);
  if (!page) return 'no outline page';
  const boxes = () => [...page.querySelectorAll('*')].filter((e) => e.offsetParent !== null).map((e) => {
    const b = e.getBoundingClientRect(); const p = page.getBoundingClientRect();
    return `${e.tagName}.${typeof e.className === 'string' ? e.className.split(' ')[0] : ''} ${(b.left - p.left).toFixed(2)},${(b.top - p.top).toFixed(2)} ${b.width.toFixed(2)}x${b.height.toFixed(2)}`;
  });
  const width = page.style.width;
  page.style.width = `${page.getBoundingClientRect().width}px`; // hold the page's own width still
  const now = boxes();
  page.style.fontSize = '16px'; page.style.lineHeight = '24px';
  const before = boxes();
  page.style.fontSize = ''; page.style.lineHeight = ''; page.style.width = width;
  const diffs = [];
  for (let i = 0; i < Math.max(now.length, before.length); i++) if (now[i] !== before[i]) diffs.push(`${before[i]} → ${now[i]}`);
  return diffs.slice(0, 10);
};

/** The one thing that can cut the lesson's name in the breadcrumb is the
 *  name itself being longer than the line (the path and then the course
 *  give way first — review round 1). Every lesson title in her library,
 *  measured in the breadcrumb's own font; the longest, to read against the
 *  column at the smallest window. */
const LONGEST_LESSON_CRUMBS = (titles) => {
  const nav = document.createElement('nav');
  nav.className = 'otter-crumbs';
  nav.style.cssText = 'position:absolute;visibility:hidden;max-width:none';
  document.body.appendChild(nav);
  const span = document.createElement('span');
  span.className = 'otter-crumb-current';
  nav.appendChild(span);
  const out = titles.map((t) => { span.textContent = t; return { lesson: t, px: +span.getBoundingClientRect().width.toFixed(1) }; });
  nav.remove();
  return out.sort((a, b) => b.px - a.px).slice(0, 5);
};

/** Every lesson path in her library through the LIVE breadcrumb: the open
 *  lesson's nav is cloned once per path (same markup as Otter.jsx, same
 *  sheet, same width) and read. Counts what gave way, in C5's order. */
const CRUMB_SWEEP = (paths) => {
  const live = [...document.querySelectorAll('.otter-crumbs')].find((e) => e.offsetParent !== null);
  if (!live || !live.querySelector('.otter-crumb-trail')) return 'no live lesson breadcrumb';
  const chevron = live.querySelector('.otter-crumb-sep').outerHTML;
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;width:${live.getBoundingClientRect().width}px`;
  live.parentElement.appendChild(host);
  const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // Round 2 (reviewer B): read the TRAIL, not only its parts — whether it is
  // on the line or wrapped out of sight, and if on the line, whether every
  // part is whole (the course at least its "…", the run at least "› …", the
  // final chevron inside it). Each path is a fresh nav, never one resized in
  // place (a resized nav kept painting its old ellipsis — reviewer B).
  const tally = { paths: paths.length, lessonCut: 0, lessonAlone: 0, courseCut: 0, runAtMarker: 0, fragments: 0, taller: 0, overflowRight: 0, lessonCutTitles: [] };
  for (const [course, subject, section, lesson] of paths) {
    host.innerHTML = `<nav class="otter-crumbs"><span class="otter-crumb-trail"><span class="otter-crumb-keep">${esc(course)}</span>`
      + `<span class="otter-crumb">${chevron}${esc(subject)}${section ? chevron + esc(section) : ''}</span>${chevron}</span>`
      + `<span class="otter-crumb-current">${esc(lesson)}</span></nav>`;
    const nav = host.firstChild;
    const box = (sel) => nav.querySelector(sel).getBoundingClientRect();
    const cut = (sel) => { const e = nav.querySelector(sel); return e.scrollWidth > e.clientWidth + 0.5; };
    const n = nav.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(nav).fontSize);
    const shown = box('.otter-crumb-trail').top < n.bottom - 1;
    if (cut('.otter-crumb-current')) { tally.lessonCut++; tally.lessonCutTitles.push(lesson); }
    if (!shown) tally.lessonAlone++;
    else {
      const t = box('.otter-crumb-trail'), run = box('.otter-crumb'), keep = box('.otter-crumb-keep'), sep = box('.otter-crumb-trail > .otter-crumb-sep');
      if (cut('.otter-crumb-keep')) tally.courseCut++;
      if (Math.abs(run.width - 3 * em) < 0.5) tally.runAtMarker++;
      if (keep.width < em - 0.5 || run.width < 3 * em - 0.5 || sep.right > t.right + 0.5 || run.right > t.right + 0.5) tally.fragments++;
    }
    if (n.height > em * 1.4 + 0.5) tally.taller++;
    if (box('.otter-crumb-current').right > n.right + 0.5) tally.overflowRight++;
  }
  host.remove();
  return { width: live.getBoundingClientRect().width, ...tally, lessonCutTitles: tally.lessonCutTitles.slice(0, 5) };
};

/** S2c (S2b-03): subject titles through the LIVE outline breadcrumb — a fresh
 *  nav per title, Otter.jsx's markup, inside the outline page itself (so a
 *  rule scoped to the page reaches it). For each: is "[outline]" whole on the
 *  line, is the subject on the line, is the subject cut, is the nav taller
 *  than its line. `natural` is the title's own width at the Caption step. */
const OUTLINE_SWEEP = ({ pairs }) => {
  const live = [...document.querySelectorAll('.otter-crumbs')].find((e) => e.offsetParent !== null && e.querySelector('.otter-crumb-note'));
  if (!live) return 'no live outline breadcrumb';
  const chevron = live.querySelector('.otter-crumb-sep').outerHTML;
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;width:${live.getBoundingClientRect().width}px`;
  live.parentElement.appendChild(host);
  const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const rows = [];
  for (const [course, title] of pairs) {
    host.innerHTML = `<nav class="otter-crumbs"><span class="otter-crumb-trail"><span class="otter-crumb-keep">${esc(course)}</span>${chevron}</span>`
      + `<span class="otter-crumb-current">${esc(title)}</span><span class="otter-crumb-note">[outline]</span></nav>`;
    const nav = host.firstChild;
    const n = nav.getBoundingClientRect();
    const cur = nav.querySelector('.otter-crumb-current');
    const c = cur.getBoundingClientRect();
    const note = nav.querySelector('.otter-crumb-note').getBoundingClientRect();
    const onLine = (b) => b.width > 0 && b.top < n.bottom - 1 && b.bottom > n.top + 1;
    rows.push({ title, natural: +cur.scrollWidth.toFixed(1),
      noteWhole: onLine(note) && note.left >= n.left - 0.5 && note.right <= n.right + 0.5,
      subjectShown: onLine(c), subjectCut: cur.scrollWidth > cur.clientWidth + 0.5, taller: n.height > parseFloat(getComputedStyle(nav).lineHeight) + 0.5 });
  }
  const noteRect = host.querySelector('.otter-crumb-note').getBoundingClientRect();
  const width = live.getBoundingClientRect().width;
  host.remove();
  const hidden = rows.filter((r) => !r.noteWhole);
  return { width, noteWidth: +noteRect.width.toFixed(2), fontSize: getComputedStyle(live).fontSize, titles: rows.length,
    noteHidden: hidden.length, subjectHidden: rows.filter((r) => !r.subjectShown).length, subjectCut: rows.filter((r) => r.subjectCut).length,
    taller: rows.filter((r) => r.taller).length,
    noteHiddenFrom: hidden.length ? Math.min(...hidden.map((r) => r.natural)) : null, noteHiddenTo: hidden.length ? Math.max(...hidden.map((r) => r.natural)) : null,
    widest: Math.max(...rows.map((r) => r.natural)), rows };
};

/** S2c (S2b-04): what the accessibility tree holds under the visible
 *  breadcrumb — its role and name, and every node under it that is NOT
 *  ignored (what a screen reader is given), names JSON-escaped so a
 *  zero-width space reads as ​. Through the DevTools protocol. */
async function crumbsA11y(context, page) {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('Accessibility.enable');
    const { result } = await cdp.send('Runtime.evaluate', { expression: "[...document.querySelectorAll('.otter-crumbs')].find((e) => e.offsetParent !== null) || null" });
    if (!result.objectId) return 'no visible breadcrumb';
    const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const nav = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
    if (!nav) return 'the breadcrumb is not in the accessibility tree';
    const out = [];
    let ignoredZwsp = 0;
    const walk = (n, depth) => {
      for (const id of n.childIds || []) {
        const ch = byId.get(id);
        if (!ch) continue;
        const name = ch.name?.value ?? '';
        if (ch.ignored) { if (/​/.test(name)) ignoredZwsp++; walk(ch, depth); continue; }
        out.push(`${'  '.repeat(depth)}${ch.role?.value} ${JSON.stringify(name).replace(/​/g, '\\u200b')}`);
        walk(ch, depth + 1);
      }
    };
    walk(nav, 1);
    const zwspNodes = out.filter((l) => /\\u200b/.test(l)).length;
    return { role: nav.role?.value, name: nav.name?.value, zwspTextNodes: zwspNodes, ignoredZwsp, tree: out };
  } finally {
    await cdp.detach();
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
const replay = buildReplay(LIBRARY);
const planted = PLANT ? plantNonObjects(replay) : null;
console.log(JSON.stringify({ library: LIBRARY, courses: replay.courses.map((c) => `${c.name} (${c.course_type})`), subjects: replay.subjects.length, views: [...VIEWS], ...(planted ? { planted } : {}) }));
if (SHOTS) mkdirSync(OUT, { recursive: true });

/** A page over `data` (her library in front of the fixture courses). */
async function openReplay(browser, w, h, data) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await context.addInitScript((d) => { globalThis.__S2B_REPLAY = d; }, data);
  await context.route('**/src/dev/fixtures/store.js*', async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    if (!/export function createStore\(/.test(body)) throw new Error('store.js no longer exports createStore() — the replay cannot attach');
    await route.fulfill({ response: res, body: body + REBIND });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log(`    pageerror: ${e.message}`); });
  await page.goto(`${BASE}/otter`, { waitUntil: 'load' });
  await sleep(8000);
  return { context, page, errors };
}
async function shoot(page, w, h, view, opts = {}) {
  const m = await page.evaluate(MEASURE, opts);
  console.log(JSON.stringify({ phase, view, size: `${w}x${h}`, ...m }));
  if (SHOTS) await page.screenshot({ path: join(OUT, `${PREFIX}-${phase}-${view}-${w}x${h}.png`) });
  // The breadcrumb alone, so a squeezed segment can be read.
  if (SHOTS && m.crumbs) {
    await page.screenshot({ path: join(OUT, `${PREFIX}-${phase}-${view}-trail-${w}x${h}.png`), scale: 'device',
      clip: { x: Math.max(0, m.crumbs.left - 8), y: Math.max(0, (await page.evaluate(() => [...document.querySelectorAll('.otter-crumbs')].find((e) => e.offsetParent)?.getBoundingClientRect().top ?? 0)) - 6), width: m.crumbs.width + 16, height: 30 } });
  }
  return m;
}

const browser = await chromium.launch();
try {
  for (const [w, h] of SIZES) {
    const size = `${w}x${h}`;
    const { context, page, errors } = await openReplay(browser, w, h, replay);

    // 1. The Functions reference: her Python course (the first coding language).
    if (VIEWS.has('functions')) {
      const fnTab = await tab(page, 'Functions');
      await sleep(1500);
      if (!fnTab) console.log('    (drive: no Functions tab)');
      await shoot(page, w, h, 'functions');
    }

    // 2. The Search dialog's function results. "Search" is a button on the
    //    strip, not one of its tabs; the dialog focuses its field.
    if (VIEWS.has('search-functions')) {
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
      await shoot(page, w, h, 'search-functions', { inDialog: true });
      await page.keyboard.press('Escape');
      await sleep(1200);
    }

    // 3. The lesson page: a real Python lesson with code.
    if (VIEWS.has('lesson')) {
      const lesson = await openSubject(page, 'Python', 'Python Syntax and Basic Operations', 'Creating Variables and Understanding Numbers');
      if (!lesson.course || !lesson.subject || !lesson.lesson) console.log(`    (drive: ${JSON.stringify(lesson)})`);
      await shoot(page, w, h, 'lesson');
    }

    // 4. The longest breadcrumb in her library (Unity 6, a 53-character lesson).
    if (VIEWS.has('lesson-crumbs') || VIEWS.has('a11y')) {
      const crumbs = await openSubject(page, 'Unity 6', 'GameObjects and Components Fundamentals', 'Understanding GameObjects and the Transform Component');
      if (!crumbs.course || !crumbs.subject || !crumbs.lesson) console.log(`    (drive: ${JSON.stringify(crumbs)})`);
      if (VIEWS.has('lesson-crumbs')) {
        await shoot(page, w, h, 'lesson-crumbs');
        if (phase === 'after' || PREFIX !== 'po-s2b') {
          const byId = new Map(replay.courses.map((c) => [c.id, c.name]));
          const paths = replay.subjects.flatMap((s) => (s.sections || []).flatMap((sec) => (sec.lessons || []).map((l) => [byId.get(s.course_id), s.title, sec.title, l.title])));
          console.log(JSON.stringify({ size, crumbSweep: await page.evaluate(CRUMB_SWEEP, paths) }));
        }
      }
      if (VIEWS.has('a11y')) console.log(JSON.stringify({ size, a11y: 'the lesson page', ...(await crumbsA11y(context, page)) }));
    }

    // 5. The subject page before content: a real Python stub.
    if (VIEWS.has('stub') || VIEWS.has('stub-stress') || VIEWS.has('a11y')) {
      const stub = await openStub(page, 'Python', 'Loops and Iteration');
      if (stub.course !== true || stub.row !== true || stub.study !== true) console.log(`    (drive: ${JSON.stringify(stub)})`);
      if (VIEWS.has('stub')) {
        await shoot(page, w, h, 'stub');
        if (phase === 'after') console.log(JSON.stringify({ size, outlinePageStepMoved: await page.evaluate(STEP_NEUTRAL) }));
        if (phase === 'after' && w === SIZES[0][0] && PREFIX === 'po-s2b') {
          const titles = replay.subjects.flatMap((s) => (s.sections || []).flatMap((sec) => (sec.lessons || []).map((l) => l.title)));
          console.log(JSON.stringify({ lessons: titles.length, longestLessonCrumbs: await page.evaluate(LONGEST_LESSON_CRUMBS, titles) }));
        }
      }
      if (VIEWS.has('a11y')) console.log(JSON.stringify({ size, a11y: 'the outline page', ...(await crumbsA11y(context, page)) }));

      // 6. S2c (S2b-03): "[outline]" beside a subject that nearly fills the
      //    column — every one of her 49 subjects, then a run of stress titles
      //    through the live outline breadcrumb, then the page itself for the
      //    stress title that sits 25px inside the line.
      if (VIEWS.has('stub-stress')) {
        const byId = new Map(replay.courses.map((c) => [c.id, c.name]));
        const real = await page.evaluate(OUTLINE_SWEEP, { pairs: replay.subjects.map((s) => [byId.get(s.course_id), s.title]) });
        const stress = await page.evaluate(OUTLINE_SWEEP, { pairs: STRESS_TITLES.map((t) => ['Python', t]) });
        if (typeof real === 'string' || typeof stress === 'string') console.log(`    (drive: ${real} / ${stress})`);
        else {
          const { rows: realRows, ...realTally } = real;
          const { rows: stressRows, ...stressTally } = stress;
          console.log(JSON.stringify({ size, outlineSweep: 'her subjects', ...realTally, hidden: realRows.filter((r) => !r.noteWhole).map((r) => r.title).slice(0, 5) }));
          console.log(JSON.stringify({ size, outlineSweep: 'stress titles', ...stressTally,
            byWidth: stressRows.map((r) => `${r.natural}${r.noteWhole ? '' : ' NOTE-HIDDEN'}${r.subjectShown ? '' : ' SUBJECT-HIDDEN'}${r.subjectCut ? ' cut' : ''}`).join(' | ') }));
          const pick = stressRows.reduce((best, r) => (Math.abs(r.natural - (stress.width - 25)) < Math.abs(best.natural - (stress.width - 25)) ? r : best));
          const s = await openReplay(browser, w, h, withStressSubject(replay, pick.title));
          try {
            const st = await openStub(s.page, 'Python', pick.title);
            if (st.course !== true || st.row !== true || st.study !== true) console.log(`    (drive: ${JSON.stringify(st)})`);
            console.log(JSON.stringify({ size, stressTitle: pick.title, natural: pick.natural, line: stress.width }));
            await shoot(s.page, w, h, 'stub-stress');
          } finally {
            await s.context.close();
          }
        }
      }
    }

    if (errors.length) console.log(JSON.stringify({ size, pageErrors: errors.length }));
    await context.close();
  }
} finally {
  await browser.close();
}
