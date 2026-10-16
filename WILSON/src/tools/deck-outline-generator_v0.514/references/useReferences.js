// =============================================================================
// useReferences — the chosen references of one D.O.G. screen (DG1, 2026-10-16)
//
// Holds the chosen set (keys; see referenceModel.js), lists what can be chosen
// for the project (the pool), previews one reference on demand, and reads the
// chosen bodies ONLY at Generate (resolveForGeneration). Pure decisions live
// in referenceModel.js; this hook is the I/O around them.
//
// 🚨 Nothing here writes to browser storage (provisional Q12, "Same as
// uploads"): the chosen set lives in this screen's memory, which App keeps
// mounted while WILSON is open. No note title, file name or id reaches disk.
//
// 🚨 When a body is read. A FILE is read at Generate, or at a Preview the
// person asked for; never when it is chosen. On the cloud every downloadFile
// writes a `downloaded` record in the file's activity (log_file_downloaded),
// a preview's included, and the preview says so. Bodies are cached per file
// for the session (by size and date), so a second generation does not
// download, or record, the same file again. A NOTE is the person's own and
// records nothing; its text is read when it is ticked, so the meter can count
// it (design review round 1, finding 13: said here as it is).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { noteTextFromState } from '../../../components/Dashboard/noteText';
import {
  ITEM_KINDS, KIND_SOURCE, buildPool, poolIndex, kindOfKey, keysKeptOnProjectChange,
  itemWords, noteWords, referencesText, REFERENCES_SOURCE_NAME, fileEntry,
  legacyFileEntry, fileTokens, textTokens, countPdfPages,
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
 * Every list the pool is built from. The Local Server's list calls each fetch
 * the whole project bundle, so it is read once through loadProject there; the
 * cloud's are separate queries, read side by side. Each list fails on its own
 * and says so in `errors`; a backend with no read for a kind (Google Drive has
 * no scene, shot, level, experience or milestone reads) says it cannot list
 * them rather than hiding the kind (design review round 1, finding 11).
 */
export async function readPoolLists(adapter, adapterMode, projectId) {
  const lists = {};
  const errors = {};
  if (!adapter || !projectId) return { lists, errors };
  if (adapterMode === 'local_server' && typeof adapter.loadProject === 'function') {
    try {
      const b = await adapter.loadProject(projectId);
      for (const key of Object.keys(ADAPTER_READS)) lists[key] = Array.isArray(b?.[key]) ? b[key] : null;
    } catch (err) {
      for (const kind of ITEM_KINDS) errors[kind] = message(err);
      errors.files = message(err);
    }
    return { lists, errors };
  }
  await Promise.all(Object.entries(ADAPTER_READS).map(async ([key, fn]) => {
    const fail = (why) => {
      lists[key] = null;
      if (key === 'files' || key === 'folders') errors.files = errors.files || why;
      else if (KIND_OF_SOURCE[key]) errors[KIND_OF_SOURCE[key]] = why;
      // task_items failing only costs a task its "About" line.
    };
    if (typeof adapter[fn] !== 'function') { fail(CANNOT_LIST); return; }
    try {
      lists[key] = await adapter[fn](projectId);
    } catch (err) {
      fail(message(err));
    }
  }));
  return { lists, errors };
}

/** The person's own notes, on the cloud only; null where notes do not exist. */
async function readNotes(adapter, adapterMode) {
  if (adapterMode !== 'supabase' || typeof adapter?.listNotes !== 'function') return { notes: null, error: null };
  try {
    return { notes: await adapter.listNotes(), error: null };
  } catch (err) {
    return { notes: [], error: message(err) };
  }
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
  // ticked: { key, kind, id, name, isCore, dogType, size, tokens }.
  const [snapshots, setSnapshots] = useState(() => new Map());
  const [unavailable, setUnavailable] = useState(() => new Set());
  const [pool, setPool] = useState(null);
  const [poolBusy, setPoolBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noteTexts, setNoteTexts] = useState(() => new Map()); // note id -> text
  const [pdfPages, setPdfPages] = useState(() => new Map());   // file id -> pages | null
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
  // and brought back when it is chosen again (design review round 1, finding
  // 17: forgiveness without a dialog). Memory only, like the set itself.
  const setAside = useRef(new Map()); // project id -> [key, snapshot][]

  // ── Choosing a project: keep the notes, set the rest aside, bring back ────
  useEffect(() => {
    const prev = projectRef.current;
    projectRef.current = { id: projectId, title: project?.title || '' };
    if (prev.id === projectId) return;
    setPool(null);
    setUnavailable(new Set());
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
      const [{ lists, errors }, { notes, error: notesError }] = await Promise.all([
        projectId ? readPoolLists(adapter, adapterMode, projectId) : Promise.resolve({ lists: {}, errors: {} }),
        readNotes(adapter, adapterMode),
      ]);
      const next = buildPool({
        lists, project: projectId ? project : null, notes,
        errors: notesError ? { ...errors, notes: notesError } : errors,
      });
      if (seq !== poolSeq.current) return null; // a newer read won
      setPool(next);
      setPoolBusy(false);
      // A chosen reference that is no longer offered (deleted, trashed, out
      // of reach) is greyed and will not be sent.
      const idx = poolIndex(next);
      setUnavailable(new Set([...chosenRef.current].filter(k => (kindOfKey(k) !== 'note'
        ? !idx.has(k)
        : (next.notes ? !idx.has(k) : false)))));
      return next;
    })();
    poolPromise.current = run;
    return run;
  }, [getAdapter, adapterMode, projectId, project]);

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
      isCore: entry.kind === 'file' ? !!entry.isCore : false,
      dogType: entry.dogType || null, size: entry.size || 0, tokens,
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

  const notePages = useCallback((fileId, base64) => {
    countPdfPages(base64).then(n => setPdfPages(cur => new Map(cur).set(fileId, n)));
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

  function adoptRows(rows) {
    const p = buildPool({ lists: { files: rows || [] } });
    if (!p.files.length) return;
    setChosen(cur => new Set([...cur, ...p.files.map(f => f.key)]));
    setSnapshots(cur => {
      const next = new Map(cur);
      for (const f of p.files) next.set(f.key, snapshotOf(f, p));
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
  }, [snapshotOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Size ──────────────────────────────────────────────────────────────────
  /** { tokens, uncounted }: PDFs whose pages are not known yet are not guessed. */
  const chosenSize = useMemo(() => {
    let tokens = 0;
    let uncounted = 0;
    for (const k of chosen) {
      const s = snapshots.get(k);
      if (!s || unavailable.has(k)) continue;
      if (s.kind === 'note') { tokens += textTokens(noteTexts.get(s.noteId) || '') + 20; continue; }
      if (s.kind === 'file' && s.dogType === 'pdf') {
        const pages = pdfPages.get(s.id);
        if (pages) tokens += fileTokens('pdf', s.size, pages); else uncounted++;
        continue;
      }
      tokens += s.tokens || 0;
    }
    return { tokens, uncounted };
  }, [chosen, snapshots, unavailable, noteTexts, pdfPages]);

  // ── Reading a body ────────────────────────────────────────────────────────
  const readBody = useCallback(async (entry) => {
    const sig = `${entry.size}:${entry.row?.updated_at || entry.uploadedAt || ''}`;
    const hit = bodyCache.current.get(entry.id);
    if (hit && hit.sig === sig) return hit.content;
    const adapter = getAdapter?.();
    if (typeof adapter?.downloadFile !== 'function') throw new Error('this storage cannot read files');
    const blob = await adapter.downloadFile(entry.row);
    const content = await blobToDogContent(blob, entry.dogType);
    bodyCache.current.set(entry.id, { sig, content });
    if (entry.dogType === 'pdf') notePages(entry.id, content);
    return content;
  }, [getAdapter, notePages]);

  /**
   * What will be sent for one reference: { title, text?, image?, line?,
   * tokens }. Words are shown exactly; a PDF and a video are described, never
   * downloaded, to preview them (a PDF goes whole, a video never goes); a
   * picture over 8 MB is described too.
   */
  const preview = useCallback(async (key) => {
    const p = pool;
    const idx = poolIndex(p);
    const snap = snapshots.get(key);
    const entry = idx.get(key);
    const kind = kindOfKey(key);
    if (kind === 'note') {
      const id = entry?.id || snap?.noteId;
      const t = noteTexts.get(id) ?? await readNoteText(id);
      const words = noteWords(entry || { name: snap?.name, subject: null, noteDate: null }, t);
      return { title: entry?.name || snap?.name, text: words, tokens: textTokens(words) };
    }
    if (!entry) throw new Error('it is no longer available');
    if (kind !== 'file') {
      const words = itemWords(entry, p);
      return { title: entry.name, text: words, tokens: textTokens(words) };
    }
    const recorded = adapterMode === 'supabase' && entry.source === 'stored'
      ? ' Reading it here is recorded in the file’s activity, as any download is.' : '';
    if (entry.dogType === 'video') {
      return { title: entry.name, line: 'A video is never sent to the AI. With Use project assets ticked it can be placed in a slide.', tokens: 0 };
    }
    if (entry.dogType === 'pdf') {
      const pages = pdfPages.get(entry.id);
      return {
        title: entry.name,
        line: `Sent whole, as a PDF the AI reads page by page${pages ? ` (${pages} page${pages === 1 ? '' : 's'})` : ''}${entry.isCore ? '; marked Core in the Files tab' : ''}.`,
        tokens: pages ? fileTokens('pdf', entry.size, pages) : null,
      };
    }
    if (entry.dogType === 'image' && entry.source === 'stored' && entry.size > PREVIEW_IMAGE_MAX_BYTES) {
      return { title: entry.name, line: 'A large picture: it is not previewed here. It is sent as a picture the AI looks at.', tokens: fileTokens('image', entry.size) };
    }
    const content = entry.source === 'legacy' ? legacyFileEntry(entry).content : await readBody(entry);
    if (entry.dogType === 'image') {
      return { title: entry.name, image: `data:${entry.mime || 'image/png'};base64,${content}`, line: `Sent as a picture the AI looks at.${recorded}`, tokens: fileTokens('image', entry.size) };
    }
    return { title: entry.name, text: content, line: recorded.trim() || null, tokens: textTokens(content) };
  }, [pool, snapshots, noteTexts, pdfPages, adapterMode, readNoteText, readBody]);

  // ── Generate: read what is chosen, now ────────────────────────────────────
  /**
   * The chosen references as D.O.G.'s own source entries, read now.
   * Returns { files, referencesSource, unreadable } where `files` are entries
   * buildSourceParts takes as they are, `referencesSource` is the one text
   * source carrying the items' and notes' words (null when there are none),
   * and `unreadable` names what could not be read and was NOT sent.
   *
   * The pool is listed again first, through the same gate: an item edited
   * since it was chosen sends its words as they are now, and a reference
   * deleted, trashed or out of reach since is not sent (design review round 1,
   * finding 8: a trashed file's blob still downloads, so the fresh list is the
   * test, not the download).
   *
   * A video is never sent to the AI; it is read only when `includeVideo`
   * ("Use project assets" may place it), and skipped quietly otherwise.
   */
  const resolveForGeneration = useCallback(async ({ includeVideo = false } = {}) => {
    const keys = [...chosenRef.current];
    if (!keys.length) return { files: [], referencesSource: null, unreadable: [] };
    const p = (await freshPool()) || pool;
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
          unreadable.push(snap?.name || 'a note');
          lost.add(key);
        }
        continue;
      }
      if (!entry) { unreadable.push(snap?.name || 'a reference'); lost.add(key); continue; }
      if (kind === 'file') {
        if (entry.dogType === 'video' && !includeVideo) continue;
        if (entry.source === 'legacy') { files.push(legacyFileEntry(entry)); continue; }
        try {
          files.push(fileEntry(entry, await readBody(entry)));
        } catch (err) {
          console.warn('[DOG] reference not read:', entry.name, err?.message || err);
          unreadable.push(entry.name);
          lost.add(key);
        }
        continue;
      }
      itemParas.push(itemWords(entry, p));
    }
    if (lost.size) setUnavailable(cur => new Set([...cur, ...lost]));
    const refText = referencesText(itemParas, noteParas);
    const referencesSource = refText ? {
      id: 'dog-references',
      file: { name: REFERENCES_SOURCE_NAME, size: refText.length },
      content: refText,
      type: 'text',
      mediaType: 'text/plain',
      isCore: false,
      source: 'references',
    } : null;
    return { files, referencesSource, unreadable };
  }, [freshPool, pool, readNoteText, readBody]);

  const chosenList = useMemo(() => [...chosen].map(k => snapshots.get(k)).filter(Boolean), [chosen, snapshots]);

  return {
    chosen, chosenList, unavailable, pool, poolBusy, notice,
    chosenTokens: chosenSize.tokens, chosenUncounted: chosenSize.uncounted, pdfPages,
    loadPool, tick, untick, toggle, adoptUploadedFiles, preview, resolveForGeneration,
    clearNotice: () => setNotice(''),
  };
}
