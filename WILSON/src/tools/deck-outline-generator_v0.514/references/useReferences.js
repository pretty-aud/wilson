// =============================================================================
// useReferences — the chosen references of one D.O.G. screen (DG1, 2026-10-16)
//
// Holds the chosen set (keys; see referenceModel.js), lists what can be chosen
// for the project (the pool), previews one reference on demand, and reads the
// chosen bodies ONLY at Generate (resolveForGeneration) or at a Preview the
// person asks for. Pure decisions live in referenceModel.js; this hook is the
// I/O around them.
//
// 🚨 Nothing here writes to browser storage (Audrey's Q12, 2026-10-17: "Same
// as uploads"): the chosen set lives in this screen's memory, which App keeps
// mounted while WILSON is open. No note title, file name or id reaches disk.
//
// 🚨 When a body is read. A FILE is read at Generate, or at a Preview the
// person asked for; never when it is chosen. Both backends record every read
// in the file's activity (the cloud's log_file_downloaded, the desktop's
// `downloaded` event), a preview's included, and the preview says so. Bodies
// are cached per file for the session (by size and date), so a second
// generation does not download, or record, the same file again. A NOTE is
// the person's own and records nothing; its text is read when it is ticked,
// so the meter can count it.
//
// 🚨 A list that FAILED is not a list that came back without the reference
// (design review round 2, finding 5): a chosen reference is greyed only when
// a list that succeeded lacks it, and a generation whose fresh list failed
// stops and says so instead of dropping what was chosen.
//
// DG4 (Audrey, 2026-10-28: "a way for the user to just press a checkbox to
// bypass selecting files and letting the generator just reference the files
// marked as core project files"). While `coreOnly` is on, what is LISTED (the
// card's rows, the meter's count, Generate's reads, the AI file store's
// owners) is the chosen project's readable Core files, coreFileKeys over the
// pool: the window's own All Core files test, so nothing the pool does not
// offer is listed or sent. The set chosen in the window steps aside untouched
// and is listed again when it is cleared. Off at the start and kept while
// WILSON is open, as D.O.G.'s other checkboxes are; nothing reaches disk.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { noteTextFromState } from '../../../components/Dashboard/noteText';
import {
  ITEM_KINDS, KIND_SOURCE, buildPool, poolIndex, kindOfKey, keysKeptOnProjectChange,
  itemWords, noteWords, referencesText, notesText, REFERENCES_SOURCE_NAME, NOTES_SOURCE_NAME,
  fileEntry, legacyFileEntry, fileTokens, textTokens, countPdfPages, folderTrail,
  VIDEO_PLACE_LIMIT, coreFileKeys,
} from './referenceModel';

const ADAPTER_READS = Object.freeze({
  assets: 'listAssets', tasks: 'listTasks', scenes: 'listScenes', shots: 'listShots',
  levels: 'listLevels', experiences: 'listExperiences', phases: 'listPhases',
  milestones: 'listMilestones', folders: 'listFolders', files: 'listFiles',
  taskItems: 'listTaskItems',
});

const KIND_OF_SOURCE = Object.fromEntries(Object.entries(KIND_SOURCE).map(([k, v]) => [v, k]));
const message = (err) => (err?.message || String(err || 'could not be listed'));
const CANNOT_LIST = 'This storage cannot list them.';
const mb = (n) => `${Math.max(1, Math.round((Number(n) || 0) / (1024 * 1024)))} MB`;

/** Pictures larger than this are described in a preview, not downloaded. */
export const PREVIEW_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** A Blob as D.O.G.'s `content`: plain text for text, base64 for the rest. */
export function blobToDogContent(blob, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('could not read the file'));
    if (type === 'text') {
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsText(blob);
    } else {
      reader.onload = () => {
        const s = String(reader.result || '');
        resolve(s.includes(',') ? s.split(',')[1] : s);
      };
      reader.readAsDataURL(blob);
    }
  });
}

/**
 * Every list the pool is built from, with how many reads were made and how
 * many failed. The Local Server's list calls each fetch the whole project
 * bundle, so it is read once through loadProject there; the cloud's are
 * separate queries, read side by side. Each list fails on its own and says so
 * in `errors`; a backend with no read for a kind (Google Drive has no scene,
 * shot, level, experience or milestone reads) says it cannot list them
 * rather than hiding the kind.
 */
export async function readPoolLists(adapter, adapterMode, projectId) {
  const lists = {};
  const errors = {};
  let attempted = 0;
  let failed = 0;
  if (!adapter || !projectId) return { lists, errors, attempted, failed };
  if (adapterMode === 'local_server' && typeof adapter.loadProject === 'function') {
    attempted = 1;
    try {
      const b = await adapter.loadProject(projectId);
      for (const key of Object.keys(ADAPTER_READS)) lists[key] = Array.isArray(b?.[key]) ? b[key] : null;
    } catch (err) {
      failed = 1;
      for (const kind of ITEM_KINDS) errors[kind] = message(err);
      errors.files = message(err);
    }
    return { lists, errors, attempted, failed };
  }
  await Promise.all(Object.entries(ADAPTER_READS).map(async ([key, fn]) => {
    const fail = (why) => {
      lists[key] = null;
      if (key === 'files') errors.files = why;
      else if (key === 'folders') errors.folders = why;
      else if (KIND_OF_SOURCE[key]) errors[KIND_OF_SOURCE[key]] = why;
      // task_items failing only costs a task its "About" line.
    };
    if (typeof adapter[fn] !== 'function') { fail(CANNOT_LIST); return; }
    attempted++;
    try {
      lists[key] = await adapter[fn](projectId);
    } catch (err) {
      failed++;
      fail(message(err));
    }
  }));
  return { lists, errors, attempted, failed };
}

/** The person's own notes, on the cloud only; null where notes do not exist. */
async function readNotes(adapter, adapterMode) {
  if (adapterMode !== 'supabase' || typeof adapter?.listNotes !== 'function') {
    return { notes: null, error: null, attempted: 0, failed: 0 };
  }
  try {
    return { notes: await adapter.listNotes(), error: null, attempted: 1, failed: 0 };
  } catch (err) {
    return { notes: [], error: message(err), attempted: 1, failed: 1 };
  }
}

/** The list a key's kind comes from, as `errors` names it. */
const listOf = (key) => {
  const kind = kindOfKey(key);
  return kind === 'file' ? 'files' : kind === 'note' ? 'notes' : kind;
};

/** What a kept body is kept by: the file's size and date (a changed file is read again). */
const bodySig = (entry) => `${entry.size}:${entry.row?.updated_at || entry.uploadedAt || ''}`;

/** A pool's readable Core files (DG4), by name, as the window lists files. */
function coreKeysByName(p) {
  const idx = poolIndex(p);
  return coreFileKeys(p).sort((a, b) => (idx.get(a)?.name || '').localeCompare(idx.get(b)?.name || ''));
}

/**
 * @param {object} args
 * @param {() => object} args.getAdapter  RabbitProvider's stable getter
 * @param {string} args.adapterMode       'supabase' | 'local_server' | …
 * @param {string} args.projectId         '' when no project is chosen
 * @param {object|null} args.project      the project record (legacy arrays)
 */
export function useReferences({ getAdapter, adapterMode, projectId, project }) {
  const [chosen, setChosen] = useState(() => new Set());
  // What the card shows for each chosen key, taken from the pool when it was
  // ticked: { key, kind, id, name, trail, isCore, dogType, size, tokens }.
  const [snapshots, setSnapshots] = useState(() => new Map());
  const [unavailable, setUnavailable] = useState(() => new Set());
  const [pool, setPool] = useState(null);
  const [poolBusy, setPoolBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [undoable, setUndoable] = useState(null); // { keys, snaps } after Remove all
  const [noteTexts, setNoteTexts] = useState(() => new Map()); // note id -> text
  const [pdfPages, setPdfPages] = useState(() => new Map());   // file id -> pages | null
  const [readIds, setReadIds] = useState(() => new Set());     // bodies already read this session
  // DG4: Core files only (the header says what it lists).
  const [coreOnly, setCoreOnly] = useState(false);
  const poolSeq = useRef(0);
  const poolPromise = useRef(null);
  const bodyCache = useRef(new Map()); // file id -> { sig, content }
  const projectRef = useRef({ id: projectId, title: project?.title || '' });
  const chosenRef = useRef(chosen);
  const snapshotsRef = useRef(snapshots);
  useEffect(() => { chosenRef.current = chosen; }, [chosen]);
  useEffect(() => { snapshotsRef.current = snapshots; }, [snapshots]);
  // Files the New project window stored for a project this screen has not
  // switched to yet: held until the switch below has run, so the switch
  // cannot drop them (the window selects the project, then uploads).
  const pendingAdopt = useRef(null);
  // A project's items and files, set aside when another project is chosen
  // and brought back when it is chosen again (forgiveness without a dialog).
  // Memory only, like the set itself.
  const setAside = useRef(new Map()); // project id -> [key, snapshot][]

  // ── Choosing a project: keep the notes, set the rest aside, bring back ────
  useEffect(() => {
    const prev = projectRef.current;
    projectRef.current = { id: projectId, title: project?.title || '' };
    if (prev.id === projectId) return;
    // The old project's read, if one is in flight, must never land here.
    poolSeq.current++;
    poolPromise.current = null;
    setPoolBusy(false);
    setPool(null);
    setUnavailable(new Set());
    setUndoable(null);
    const cur = chosenRef.current;
    const snaps = snapshotsRef.current;
    const kept = keysKeptOnProjectChange(cur);
    const leaving = [...cur].filter(k => !kept.has(k)).map(k => [k, snaps.get(k)]).filter(([, v]) => v);
    if (prev.id && leaving.length) setAside.current.set(prev.id, leaving);
    const returning = (projectId && setAside.current.get(projectId)) || [];
    setAside.current.delete(projectId);
    setChosen(new Set([...kept, ...returning.map(([k]) => k)]));
    setSnapshots(new Map([...[...snaps].filter(([k]) => kept.has(k)), ...returning]));
    const parts = [];
    if (leaving.length) {
      const from = prev.title || 'the last project';
      parts.push(`${leaving.length} reference${leaving.length === 1 ? '' : 's'} from ${from} `
        + `${leaving.length === 1 ? 'is' : 'are'} set aside; ${leaving.length === 1 ? 'it comes' : 'they come'} `
        + `back when you choose ${prev.title || 'it'} again.`);
      // The one private thing that travels is named (review round 2, 13).
      if (kept.size) parts.push(`Your ${kept.size} note${kept.size === 1 ? '' : 's'} stay${kept.size === 1 ? 's' : ''}.`);
    }
    if (returning.length) {
      parts.push(`${returning.length} reference${returning.length === 1 ? '' : 's'} from `
        + `${project?.title || 'this project'} ${returning.length === 1 ? 'is' : 'are'} back.`);
    }
    setNotice(parts.join(' '));
    const held = pendingAdopt.current;
    if (held && held.projectId === projectId) {
      pendingAdopt.current = null;
      adoptRows(held.rows);
    }
    // `project` is read for its title only, through the ref above.
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The pool ──────────────────────────────────────────────────────────────
  const loadPool = useCallback(() => {
    const seq = ++poolSeq.current;
    const adapter = getAdapter?.();
    setPoolBusy(true);
    const run = (async () => {
      const [read, noteRead] = await Promise.all([
        projectId ? readPoolLists(adapter, adapterMode, projectId) : Promise.resolve({ lists: {}, errors: {}, attempted: 0, failed: 0 }),
        readNotes(adapter, adapterMode),
      ]);
      const next = buildPool({
        lists: read.lists, project: projectId ? project : null, notes: noteRead.notes,
        errors: noteRead.error ? { ...read.errors, notes: noteRead.error } : read.errors,
        meta: { attempted: read.attempted + noteRead.attempted, failed: read.failed + noteRead.failed },
      });
      if (seq !== poolSeq.current) return null; // a newer read won
      setPool(next);
      setPoolBusy(false);
      // Greyed only when a list that SUCCEEDED lacks it; a failed list says
      // nothing about what it would have held.
      const idx = poolIndex(next);
      setUnavailable(cur => {
        const out = new Set();
        for (const k of chosenRef.current) {
          const list = listOf(k);
          if (next.errors[list]) { if (cur.has(k)) out.add(k); continue; }
          if (list === 'notes' && !next.notes) continue;
          if (!idx.has(k)) out.add(k);
        }
        return out;
      });
      return next;
    })();
    poolPromise.current = run;
    return run;
  }, [getAdapter, adapterMode, projectId, project]);
  // The newest loadPool, for a caller holding an older one (the New project
  // window's handler was made before it chose the project it then fills).
  const loadPoolRef = useRef(loadPool);
  useEffect(() => { loadPoolRef.current = loadPool; }, [loadPool]);

  /** The newest pool: if this read was overtaken, the one that overtook it. */
  const freshPool = useCallback(async () => {
    let p = await loadPool();
    while (!p && poolPromise.current) {
      const pending = poolPromise.current;
      p = await pending;
      if (pending === poolPromise.current) break;
    }
    return p;
  }, [loadPool]);

  // ── Choosing ──────────────────────────────────────────────────────────────
  const snapshotOf = useCallback((entry, p) => {
    if (!entry) return null;
    let tokens = 0;
    if (entry.kind === 'file') tokens = fileTokens(entry.dogType, entry.size);
    else if (entry.kind !== 'note') tokens = textTokens(itemWords(entry, p));
    return {
      key: entry.key, kind: entry.kind, id: entry.id, name: entry.name,
      trail: entry.kind === 'file' ? folderTrail(p, entry.folderId).join(' › ') : '',
      isCore: entry.kind === 'file' ? !!entry.isCore : false,
      dogType: entry.dogType || null, size: entry.size || 0, tokens, source: entry.source || null,
      noteId: entry.kind === 'note' ? entry.id : null,
    };
  }, []);

  const readNoteText = useCallback(async (id) => {
    const adapter = getAdapter?.();
    if (typeof adapter?.getNote !== 'function') throw new Error('notes need the cloud');
    const row = await adapter.getNote(id);
    if (!row) throw new Error('note not found');
    return noteTextFromState(row.ydoc_state);
  }, [getAdapter]);

  const pageCounts = useRef(new Map()); // file id -> Promise<pages | null>
  const notePages = useCallback((fileId, base64) => {
    if (!pageCounts.current.has(fileId)) {
      pageCounts.current.set(fileId, countPdfPages(base64).then((n) => {
        setPdfPages(cur => new Map(cur).set(fileId, n));
        return n;
      }));
    }
    return pageCounts.current.get(fileId);
  }, []);

  const tick = useCallback((keys) => {
    const p = pool;
    const idx = poolIndex(p);
    const add = keys.filter(k => idx.has(k));
    if (!add.length) return;
    setChosen(cur => {
      const next = new Set(cur);
      for (const k of add) next.add(k);
      return next;
    });
    setSnapshots(cur => {
      const next = new Map(cur);
      for (const k of add) if (!next.has(k)) next.set(k, snapshotOf(idx.get(k), p));
      return next;
    });
    setUnavailable(cur => {
      if (!add.some(k => cur.has(k))) return cur;
      const next = new Set(cur);
      for (const k of add) next.delete(k);
      return next;
    });
    for (const k of add) {
      const e = idx.get(k);
      // A chosen note's text is read now, so the meter can count it.
      if (e.kind === 'note') {
        readNoteText(e.id)
          .then(t => setNoteTexts(cur => new Map(cur).set(e.id, t)))
          .catch(() => setUnavailable(cur => new Set(cur).add(k)));
      }
      // A legacy PDF's body is already in memory: count its pages now.
      if (e.kind === 'file' && e.source === 'legacy' && e.dogType === 'pdf') {
        notePages(e.id, legacyFileEntry(e).content);
      }
    }
  }, [pool, snapshotOf, readNoteText, notePages]);

  const untick = useCallback((keys) => {
    const drop = new Set(keys);
    setChosen(cur => new Set([...cur].filter(k => !drop.has(k))));
    setSnapshots(cur => new Map([...cur].filter(([k]) => !drop.has(k))));
    setUnavailable(cur => new Set([...cur].filter(k => !drop.has(k))));
  }, []);

  const toggle = useCallback((key) => {
    if (chosenRef.current.has(key)) untick([key]); else tick([key]);
  }, [tick, untick]);

  /** Remove everything, and keep it for one Undo (review round 2, 14). */
  const removeAll = useCallback(() => {
    const keys = [...chosenRef.current];
    if (!keys.length) return;
    setUndoable({ keys, snaps: keys.map(k => [k, snapshotsRef.current.get(k)]).filter(([, v]) => v) });
    untick(keys);
    setNotice(`${keys.length} reference${keys.length === 1 ? '' : 's'} removed.`);
  }, [untick]);

  const undoRemoveAll = useCallback(() => {
    const u = undoable;
    if (!u) return;
    setChosen(cur => new Set([...cur, ...u.keys]));
    setSnapshots(cur => new Map([...cur, ...u.snaps]));
    setUndoable(null);
    setNotice('');
  }, [undoable]);

  function adoptRows(rows) {
    const p = buildPool({ lists: { files: rows || [] } });
    // Only what D.O.G. can read: a .docx added at project creation is a
    // project file, not a reference.
    const usable = p.files.filter(f => f.readable);
    if (!usable.length) return;
    setChosen(cur => new Set([...cur, ...usable.map(f => f.key)]));
    setSnapshots(cur => {
      const next = new Map(cur);
      for (const f of usable) next.set(f.key, snapshotOf(f, p));
      return next;
    });
  }

  /**
   * Tick files the New project window just stored (they were added in D.O.G.,
   * for this deck). The rows come straight from uploadFile, so they pass the
   * same gate as the pool before they are chosen.
   */
  const adoptUploadedFiles = useCallback((rows) => {
    const list = (rows || []).filter(Boolean);
    if (!list.length) return;
    const target = list[0].project_id;
    if (target && target !== projectRef.current.id) {
      pendingAdopt.current = { projectId: target, rows: list };
      return;
    }
    adoptRows(list);
    // DG4 review round 1, finding 3: the window chose the project, which
    // listed it, before storing these; list again, or Core files only (off,
    // "no Core files") and its rows would miss what Generate then sends.
    loadPoolRef.current?.();
  }, [snapshotOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── What is listed: the chosen set, or the project's Core files (DG4) ─────
  // A list not made yet and a files list that failed are told apart from a
  // project with none, so the checkbox never says "none" when it could not
  // look. A re-list keeps the last pool until it lands: no flicker.
  const coreKeys = useMemo(() => (projectId && pool && !pool.errors?.files ? coreKeysByName(pool) : []), [projectId, pool]);
  const core = useMemo(() => {
    if (!projectId) return { state: 'no-project', count: 0, legacy: 0 };
    if (!pool) return { state: 'listing', count: 0, legacy: 0 };
    if (pool.errors?.files) return { state: 'failed', count: 0, legacy: 0 };
    const idx = poolIndex(pool);
    const legacy = coreKeys.filter(k => idx.get(k)?.source === 'legacy').length;
    return { state: coreKeys.length ? 'ready' : 'none', count: coreKeys.length, legacy };
  }, [projectId, pool, coreKeys]);
  // Each Core file as the card shows it, from the list (never a body).
  const coreSnapshots = useMemo(() => {
    const idx = poolIndex(pool);
    return new Map(coreKeys.map(k => [k, snapshotOf(idx.get(k), pool)]));
  }, [coreKeys, pool, snapshotOf]);
  const listed = useMemo(() => (coreOnly ? new Set(coreKeys) : chosen), [coreOnly, coreKeys, chosen]);
  const listedSnaps = coreOnly ? coreSnapshots : snapshots;

  // ── Size ──────────────────────────────────────────────────────────────────
  /**
   * { tokens, uncounted, bytes } of what is listed: PDFs whose pages are not
   * known yet are not guessed; `bytes` is what Generate will download (videos
   * aside: they are read only to be placed, and never past VIDEO_PLACE_LIMIT).
   */
  const chosenSize = useMemo(() => {
    let tokens = 0;
    let uncounted = 0;
    let bytes = 0;
    for (const k of listed) {
      const s = listedSnaps.get(k);
      if (!s || unavailable.has(k)) continue;
      if (s.kind === 'note') { tokens += textTokens(noteTexts.get(s.noteId) || '') + 20; continue; }
      if (s.kind === 'file' && s.dogType !== 'video' && s.source !== 'legacy' && !readIds.has(s.id)) bytes += s.size || 0;
      if (s.kind === 'file' && s.dogType === 'pdf') {
        const pages = pdfPages.get(s.id);
        if (pages) tokens += fileTokens('pdf', s.size, pages); else uncounted++;
        continue;
      }
      tokens += s.tokens || 0;
    }
    return { tokens, uncounted, bytes };
  }, [listed, listedSnaps, unavailable, noteTexts, pdfPages, readIds]);

  // ── Reading a body ────────────────────────────────────────────────────────
  // A body is kept for the session by its size and date; a read that finds it
  // downloads nothing (and records nothing). `bodyKept` asks that before a
  // read, for the preview's line (FX13, OUTSTANDING DG1b-02).
  const bodyKept = useCallback((entry) => {
    const hit = bodyCache.current.get(entry.id);
    return !!hit && hit.sig === bodySig(entry);
  }, []);
  const readBody = useCallback(async (entry) => {
    const sig = bodySig(entry);
    const hit = bodyCache.current.get(entry.id);
    if (hit && hit.sig === sig) return hit.content;
    const adapter = getAdapter?.();
    if (typeof adapter?.downloadFile !== 'function') throw new Error('this storage cannot read files');
    const blob = await adapter.downloadFile(entry.row);
    const content = await blobToDogContent(blob, entry.dogType);
    bodyCache.current.set(entry.id, { sig, content });
    setReadIds(cur => (cur.has(entry.id) ? cur : new Set(cur).add(entry.id)));
    if (entry.dogType === 'pdf') notePages(entry.id, content);
    return content;
  }, [getAdapter, notePages]);

  /**
   * What will be sent for one reference: { title, text?, image?, line?,
   * tokens }. Words are shown exactly. A PDF is read so its pages can be
   * counted and checked against the AI's cap (review round 2, finding 1); a
   * video is described (it is never sent); a picture over 8 MB is described.
   * The pool is listed first when this screen has not listed it (a reference
   * brought back or added by the New project window: review round 2, 4).
   */
  const preview = useCallback(async (key) => {
    let p = pool;
    if (!p || !poolIndex(p).has(key)) p = (await freshPool()) || p;
    const idx = poolIndex(p);
    const snap = snapshotsRef.current.get(key);
    const entry = idx.get(key);
    const kind = kindOfKey(key);
    if (kind === 'note') {
      if (p?.notes && !entry && !p.errors?.notes) throw new Error('it is no longer among your notes');
      const id = entry?.id || snap?.noteId;
      const t = noteTexts.get(id) ?? await readNoteText(id);
      const words = noteWords(entry || { name: snap?.name, subject: null, noteDate: null }, t);
      return { title: entry?.name || snap?.name, text: words, tokens: textTokens(words) };
    }
    if (!entry) {
      throw new Error(p?.errors?.[listOf(key)]
        ? 'the project could not be listed just now; try again'
        : 'it is no longer in the project, or no longer one you may use');
    }
    if (kind !== 'file') {
      const words = itemWords(entry, p);
      return { title: entry.name, text: words, tokens: textTokens(words) };
    }
    // FX13 (DG1b-02): "recorded" only when this preview downloads, asked
    // before the read; a body already kept is not downloaded or recorded again.
    const recording = entry.source === 'stored' && (adapterMode === 'supabase' || adapterMode === 'local_server');
    const recorded = !recording ? ''
      : bodyKept(entry) ? ' Already read while WILSON is open, so showing it here is not recorded again.'
        : ' Reading it here is recorded in the file’s activity, as any download is.';
    if (entry.dogType === 'video') {
      return { title: entry.name, line: 'A video is never sent to the AI. With Place visual ticked it can be placed in a slide.', tokens: 0 };
    }
    if (entry.dogType === 'image' && entry.source === 'stored' && entry.size > PREVIEW_IMAGE_MAX_BYTES) {
      return { title: entry.name, line: 'A large picture: it is not previewed here. It is sent as a picture the AI looks at.', tokens: fileTokens('image', entry.size) };
    }
    const content = entry.source === 'legacy' ? legacyFileEntry(entry).content : await readBody(entry);
    if (entry.dogType === 'pdf') {
      const pages = await notePages(entry.id, content);
      return {
        title: entry.name,
        line: `Sent whole, as a PDF the AI reads page by page${pages ? ` (${pages} page${pages === 1 ? '' : 's'})` : '; its pages could not be counted'}${entry.isCore ? '; marked Core in the Files tab' : ''}.${recorded}`,
        tokens: pages ? fileTokens('pdf', entry.size, pages) : null,
        pages: pages || null,
      };
    }
    if (entry.dogType === 'image') {
      return { title: entry.name, image: `data:${entry.mime || 'image/png'};base64,${content}`, line: `Sent as a picture the AI looks at.${recorded}`, tokens: fileTokens('image', entry.size) };
    }
    return { title: entry.name, text: content, line: recorded.trim() || null, tokens: textTokens(content) };
  }, [pool, freshPool, noteTexts, pdfPages, adapterMode, readNoteText, readBody, bodyKept, notePages]);

  // ── Generate: read what is chosen, now ────────────────────────────────────
  /**
   * The chosen references as D.O.G.'s own source entries, read now.
   * Returns { files, referencesSource, notesSource, unreadable } where `files`
   * are entries buildSourceParts takes as they are; `referencesSource` carries
   * the items' words and `notesSource` the notes' (marked inline-only: a
   * private note never goes to the AI's file store); `unreadable` names what
   * was chosen and NOT sent, each with its reason.
   *
   * The pool is listed again first, through the same gate: an item edited
   * since it was chosen sends its words as they are now, and a reference
   * deleted, trashed or out of reach since is not sent. If a list that a
   * chosen reference needs FAILED, nothing is generated: this throws
   * `DOG_LIST_FAILED` rather than dropping what was chosen.
   *
   * A video is never sent to the AI; it is read only when `includeVideo`
   * (Place visual may place it), and never past VIDEO_PLACE_LIMIT.
   *
   * DG4: with Core files only ticked, the references are the project's
   * readable Core files in THIS fresh list (one marked or unmarked since the
   * card last listed is as it is now, and the card follows the same list); a
   * files list that failed stops the deck as a chosen file's does.
   */
  const resolveForGeneration = useCallback(async ({ includeVideo = false } = {}) => {
    const none = { files: [], referencesSource: null, notesSource: null, unreadable: [] };
    if (coreOnly ? !projectId : !chosenRef.current.size) return none;
    const p = (await freshPool()) || pool;
    if (coreOnly && p?.errors?.files) {
      throw Object.assign(new Error('a list failed'), { code: 'DOG_LIST_FAILED', lists: ['files'] });
    }
    const keys = coreOnly ? coreKeysByName(p) : [...chosenRef.current];
    if (!keys.length) return none;
    const failedLists = [...new Set(keys.map(listOf).filter(l => p?.errors?.[l]))];
    if (failedLists.length) {
      throw Object.assign(new Error('a list failed'), { code: 'DOG_LIST_FAILED', lists: failedLists });
    }
    const idx = poolIndex(p);
    const files = [];
    const itemParas = [];
    const noteParas = [];
    const unreadable = [];
    const lost = new Set();
    for (const key of keys) {
      const kind = kindOfKey(key);
      const entry = idx.get(key);
      const snap = snapshotsRef.current.get(key);
      if (kind === 'note') {
        const id = entry?.id || snap?.noteId;
        try {
          if (p?.notes && !entry) throw new Error('no longer listed');
          const t = await readNoteText(id);
          noteParas.push(noteWords(entry || { name: snap?.name }, t));
        } catch {
          unreadable.push(`${snap?.name || 'a note'} (could not be read)`);
          lost.add(key);
        }
        continue;
      }
      if (!entry) { unreadable.push(`${snap?.name || 'a reference'} (no longer in the project)`); lost.add(key); continue; }
      if (kind === 'file') {
        if (entry.dogType === 'video') {
          if (!includeVideo) continue;
          if ((entry.size || 0) > VIDEO_PLACE_LIMIT) { unreadable.push(`${entry.name} (${mb(entry.size)}: too large to place)`); continue; }
        }
        if (entry.source === 'legacy') { files.push(legacyFileEntry(entry)); continue; }
        try {
          files.push(fileEntry(entry, await readBody(entry)));
        } catch (err) {
          console.warn('[DOG] reference not read:', entry.name, err?.message || err);
          unreadable.push(`${entry.name} (could not be read)`);
          lost.add(key);
        }
        continue;
      }
      itemParas.push(itemWords(entry, p));
    }
    if (lost.size) setUnavailable(cur => new Set([...cur, ...lost]));
    const refText = referencesText(itemParas);
    const notesBody = notesText(noteParas);
    const textSource = (id, name, content, extra = {}) => ({
      id, file: { name, size: content.length }, content,
      type: 'text', mediaType: 'text/plain', isCore: false, source: 'references', ...extra,
    });
    return {
      files,
      referencesSource: refText ? textSource('dog-references', REFERENCES_SOURCE_NAME, refText) : null,
      notesSource: notesBody ? textSource('dog-notes', NOTES_SOURCE_NAME, notesBody, { inlineOnly: true }) : null,
      unreadable,
    };
  }, [coreOnly, projectId, freshPool, pool, readNoteText, readBody]);

  // What the card lists, the meter counts and Generate reads (DG4: the Core
  // files while Core files only is ticked). `chosen` stays the window's set.
  const chosenList = useMemo(() => [...listed].map(k => listedSnaps.get(k)).filter(Boolean), [listed, listedSnaps]);

  return {
    chosen, chosenList, listedKeys: listed, unavailable, pool, poolBusy, notice, undoable: !!undoable,
    chosenTokens: chosenSize.tokens, chosenUncounted: chosenSize.uncounted, chosenBytes: chosenSize.bytes, pdfPages,
    coreOnly, setCoreOnly, core,
    loadPool, tick, untick, toggle, removeAll, undoRemoveAll, adoptUploadedFiles, preview, resolveForGeneration,
    clearNotice: () => { setNotice(''); setUndoable(null); },
  };
}
