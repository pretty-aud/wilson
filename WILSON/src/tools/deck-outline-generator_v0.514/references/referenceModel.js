// =============================================================================
// referenceModel.js — what D.O.G. can reference, and what a reference sends.
// Post-overhaul DG1 (2026-10-16). Pure: no React, no adapter, no network.
//
// Audrey's rulings (docs/design/DOG_REFERENCES_QUESTIONS.md, verbatim there;
// the design is docs/design/DOG_REFERENCES_DESIGN.md):
//   * references are production items (assets, scenes, shots, levels,
//     experiences), tasks, the Timeline's phases and milestones, files, and
//     her own notes (Q1);
//   * choosing a project sets what can be chosen and sends nothing on its own
//     (Q2); an item sends its words, its files are ticked one by one (Q3);
//   * Legal and money files are never offered, for anyone (Q6);
//   * quick choices: all Core files, files from today or a range of dates,
//     by the day added; notes by their own date (Q2, Q18);
//   * a folder's tick chooses everything in it D.O.G. may send (Q11);
//   * Core belongs to FILES and is set in R.A.B.B.I.T.; D.O.G. only reads it
//     (Q15); the project's title and description always go (Q17);
//   * a meter that warns past the limit and never blocks (Q8).
//
// A reference is named by a KEY: `${kind}:${id}` for items, notes and stored
// files, `legacy:${category}:${id}` for the old attachment arrays. The chosen
// set is a Set of keys; everything else is derived from the pool.
// =============================================================================

import { isLegalFile } from '../../rabbit_v0.1.0/fileTags';
import { dogTypeForRow } from '../../rabbit_v0.1.0/deckAttachments';

// ── Kinds ───────────────────────────────────────────────────────────────────

/** The R.A.B.B.I.T. kinds a deck can reference (Q1), in the rail's order. */
export const ITEM_KINDS = Object.freeze([
  'asset', 'scene', 'shot', 'level', 'experience', 'task', 'phase', 'milestone',
]);

/** Shown in the rail even when empty (they exist on every project). */
const ALWAYS_SHOWN = new Set(['asset', 'task']);

export const KIND_LABEL = Object.freeze({
  asset: 'Asset', scene: 'Scene', shot: 'Shot', level: 'Level',
  experience: 'Experience', task: 'Task', phase: 'Phase', milestone: 'Milestone',
  file: 'File', note: 'Note',
});

export const KIND_LABEL_PLURAL = Object.freeze({
  asset: 'Assets', scene: 'Scenes', shot: 'Shots', level: 'Levels',
  experience: 'Experiences', task: 'Tasks', phase: 'Phases', milestone: 'Milestones',
  file: 'Files', note: 'Notes',
});

/** The list each kind comes from (adapter method and bundle key alike). */
export const KIND_SOURCE = Object.freeze({
  asset: 'assets', scene: 'scenes', shot: 'shots', level: 'levels',
  experience: 'experiences', task: 'tasks', phase: 'phases', milestone: 'milestones',
});

/** The column on a FILE row that says the file is about an item of a kind. */
const FILE_LINK = Object.freeze({
  asset: 'asset_id', scene: 'scene_id', shot: 'shot_id', level: 'level_id',
  experience: 'experience_id', task: 'task_id', phase: 'phase_id',
});

export const refKey = (kind, id) => `${kind}:${id}`;
export const kindOfKey = (key) => {
  const k = String(key || '');
  return k.startsWith('legacy:') ? 'file' : k.slice(0, k.indexOf(':'));
};

// ── Files: which may be offered ─────────────────────────────────────────────

/**
 * The third path segment of a cloud key (`projects/{uuid}/INVOICES/…`), which
 * the database's own money gate reads (public.rabbit_money_segment, 0042).
 */
function moneySegment(row) {
  const key = typeof row?.storage_path === 'string' ? row.storage_path : '';
  if (!key.startsWith('projects/')) return false;
  const seg = (key.split('/')[2] || '').toUpperCase();
  return seg === 'INVOICES' || seg === 'FINANCE';
}

/** A money file: an invoice or receipt row, or a body under a money folder. */
export function isMoneyFile(row) {
  return !!row && (row.is_financial === true || moneySegment(row));
}

/**
 * May D.O.G. OFFER this file as a reference?
 *
 * 🚨 THE PRIVACY GATE OF THE PICKER (Q6, "Never offer them"). The database
 * already hides what a person may not read (money files from anyone without
 * money access, Legal files from members and reviewers: 0038/0042, 0088,
 * 0092). This is the rule on top of it: a deck reaches every member of the
 * project, so Legal and money files never reach one, even for the admins and
 * managers who may open them. A trashed row is never offered either: cloud
 * deletes are soft (0014), so the row and its blob both survive.
 *
 * Unlike isDeckAttachmentRow (deckAttachments.js, the old automatic set),
 * there is no "classified document or project-level media" test: the person
 * chooses each file now (Q2), so any file they may read is offered, wherever
 * it is filed.
 */
export function isDeckReferenceFile(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.deleted_at) return false;
  if (isMoneyFile(row)) return false;
  if (isLegalFile(row)) return false;
  return true;
}

// ── The pool ────────────────────────────────────────────────────────────────

const live = (rows) => (Array.isArray(rows) ? rows : []).filter(r => r && !r.deleted_at && !r.set_aside_at);
const text = (v) => (v == null ? '' : String(v)).trim();

function itemName(kind, row, byId) {
  switch (kind) {
    case 'task': return text(row.title) || 'Untitled task';
    case 'milestone': return text(row.title) || (row.date ? `Milestone ${row.date}` : 'Untitled milestone');
    case 'scene': return text(row.name) || (row.scene_number != null ? `Scene ${row.scene_number}` : 'Untitled scene');
    case 'shot': {
      const shot = text(row.name) || (row.shot_number != null ? `Shot ${row.shot_number}` : 'Untitled shot');
      const scene = row.scene_id ? byId.scene.get(row.scene_id) : null;
      return scene ? `${itemName('scene', scene, byId)} › ${shot}` : shot;
    }
    default: return text(row.name) || `Untitled ${KIND_LABEL[kind].toLowerCase()}`;
  }
}

/**
 * The legacy attachment arrays on a project record (`documents`,
 * `visualAssets`; written only on the Local Server before C3), as pool files.
 *
 * 🚨 THE LEGACY POLARITY, KEPT (MASTER_PLAN §6 #31 trap (b)): a legacy row's
 * Core defaults TRUE (`isCore !== false`); a stored row's comes from the
 * column strictly (`is_core_definer === true`). The two are never mapped onto
 * each other here; runAttachmentMigration is the only place they meet.
 */
export function legacyPoolFiles(project) {
  if (!project) return [];
  const out = [];
  for (const category of ['documents', 'visualAssets']) {
    for (const f of (Array.isArray(project[category]) ? project[category] : [])) {
      if (!f || !f.content) continue; // nothing to send, as before
      const name = f.name || 'attachment';
      out.push({
        key: `legacy:${category}:${f.id}`,
        kind: 'file',
        id: f.id,
        name,
        folderId: null,
        uploadedAt: null,
        isCore: f.isCore !== false,
        mime: f.type || '',
        size: f.size || 0,
        dogType: legacyDogType(f, category),
        entity: null,
        source: 'legacy',
        category,
        row: f,
      });
    }
  }
  return out;
}

function legacyDogType(f, category) {
  const t = f.type || '';
  if (category === 'visualAssets') {
    return (t.startsWith('video/') || /\.(mp4|mov|webm|avi|mkv)$/i.test(f.name || '')) ? 'video' : 'image';
  }
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/pdf' || /\.pdf$/i.test(f.name || '')) return 'pdf';
  return 'text';
}

function fileEntity(row) {
  for (const kind of ['shot', 'scene', 'asset', 'task', 'level', 'experience', 'phase']) {
    const id = row[FILE_LINK[kind]];
    if (id) return { kind, id };
  }
  return null;
}

/**
 * Everything a person can choose from, for one project (or none), from the
 * lists the backend gave. Each list may be missing (`null`): its error, if
 * any, is in `errors[kind]` and the rest of the pool is unaffected.
 *
 * @param {object} args
 * @param {object} [args.lists]   { assets, tasks, scenes, shots, levels, experiences,
 *                                  phases, milestones, folders, files, taskItems }
 * @param {object} [args.project] the project record (for its legacy arrays)
 * @param {Array}  [args.notes]   the person's own notes (listNotes), or null
 * @param {object} [args.errors]  { [kind|'files'|'notes']: message }
 */
export function buildPool({ lists = {}, project = null, notes = null, errors = {} } = {}) {
  const byId = {};
  for (const kind of ITEM_KINDS) {
    byId[kind] = new Map(live(lists[KIND_SOURCE[kind]]).map(r => [r.id, r]));
  }
  const items = {};
  for (const kind of ITEM_KINDS) {
    items[kind] = [...byId[kind].values()].map(row => ({
      key: refKey(kind, row.id),
      kind,
      id: row.id,
      name: itemName(kind, row, byId),
      status: row.status || null,
      row,
    }));
  }
  const folders = (Array.isArray(lists.folders) ? lists.folders : [])
    .filter(f => f && !f.deleted_at)
    .map(f => ({ id: f.id, parentId: f.parent_id || null, name: text(f.label) || text(f.slug) || 'Folder', path: f.path || '', row: f }));
  const folderIds = new Set(folders.map(f => f.id));
  const stored = (Array.isArray(lists.files) ? lists.files : [])
    .filter(isDeckReferenceFile)
    .map(row => ({
      key: refKey('file', row.id),
      kind: 'file',
      id: row.id,
      name: row.name || 'file',
      // A file filed in a folder the person cannot see (or one since
      // removed) is shown at the top level rather than lost.
      folderId: row.folder_id && folderIds.has(row.folder_id) ? row.folder_id : null,
      uploadedAt: row.uploaded_at || row.created_at || null,
      // 🚨 THE STORED POLARITY: strict, from data. Never `!== false`.
      isCore: row.is_core_definer === true,
      mime: row.mime_type || '',
      size: row.size_bytes ?? 0,
      dogType: dogTypeForRow(row),
      entity: fileEntity(row),
      source: 'stored',
      row,
    }));
  const files = [...legacyPoolFiles(project), ...stored];
  const noteRows = Array.isArray(notes) ? notes.filter(n => n && !n.deleted_at) : null;
  return {
    items,
    files,
    folders,
    notes: noteRows === null ? null : noteRows.map(n => ({
      key: refKey('note', n.id),
      kind: 'note',
      id: n.id,
      name: text(n.title) || 'Untitled note',
      subject: n.subject || null,
      noteDate: n.note_date || null,
      updatedAt: n.updated_at || null,
      row: n,
    })),
    taskItems: Array.isArray(lists.taskItems) ? lists.taskItems : [],
    errors: { ...errors },
  };
}

/** The item kinds the rail shows: assets and tasks always, others when held. */
export function shownKinds(pool) {
  return ITEM_KINDS.filter(k => ALWAYS_SHOWN.has(k) || (pool?.items?.[k]?.length || 0) > 0 || pool?.errors?.[k]);
}

/** Every pool entry by key (items, files, notes). */
export function poolIndex(pool) {
  const map = new Map();
  if (!pool) return map;
  for (const kind of ITEM_KINDS) for (const e of pool.items[kind] || []) map.set(e.key, e);
  for (const f of pool.files || []) map.set(f.key, f);
  for (const n of pool.notes || []) map.set(n.key, n);
  return map;
}

/** The files filed against one item (Q3: listed under it, ticked one by one). */
export function filesOfItem(pool, kind, id) {
  const col = FILE_LINK[kind];
  if (!col || !pool) return [];
  return (pool.files || []).filter(f => f.source === 'stored' && f.row[col] === id);
}

// ── Folders (Q11) ───────────────────────────────────────────────────────────

export function childFolders(pool, parentId = null) {
  return (pool?.folders || []).filter(f => (f.parentId || null) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filesInFolder(pool, folderId = null) {
  return (pool?.files || []).filter(f => (f.folderId || null) === (folderId || null))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every offered file inside a folder, at every depth. Only files already in
 * the pool, which isDeckReferenceFile has filtered, so a folder's tick cannot
 * reach a Legal or money file however deep it sits.
 */
export function fileKeysUnderFolder(pool, folderId) {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of pool?.folders || []) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return (pool?.files || []).filter(f => f.folderId && ids.has(f.folderId)).map(f => f.key);
}

/** 'all' | 'some' | 'none' for a set of keys against the chosen set. */
export function tickState(keys, chosen) {
  if (!keys.length) return 'none';
  let n = 0;
  for (const k of keys) if (chosen.has(k)) n++;
  return n === 0 ? 'none' : n === keys.length ? 'all' : 'some';
}

/** The folder path a file sits in, for search results ("SCENES › The storm"). */
export function folderTrail(pool, folderId) {
  const byId = new Map((pool?.folders || []).map(f => [f.id, f]));
  const names = [];
  let f = folderId ? byId.get(folderId) : null;
  let guard = 0;
  while (f && guard++ < 64) { names.unshift(f.name); f = f.parentId ? byId.get(f.parentId) : null; }
  return names;
}

// ── Quick choices (Q2, Q18): they only tick ─────────────────────────────────

/** A timestamp's day on this computer's calendar, 'YYYY-MM-DD'. */
export function localDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function coreFileKeys(pool) {
  return (pool?.files || []).filter(f => f.isCore).map(f => f.key);
}

/** Files ADDED between two days, inclusive (by the day they were uploaded). */
export function fileKeysAddedBetween(pool, fromDay, toDay) {
  if (!fromDay || !toDay) return [];
  const [a, b] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay];
  return (pool?.files || []).filter(f => {
    const day = localDay(f.uploadedAt);
    return day && day >= a && day <= b;
  }).map(f => f.key);
}

/** Notes DATED between two days, inclusive (by the date each note carries). */
export function noteKeysDatedBetween(pool, fromDay, toDay) {
  if (!fromDay || !toDay) return [];
  const [a, b] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay];
  return (pool?.notes || []).filter(n => n.noteDate && n.noteDate.slice(0, 10) >= a && n.noteDate.slice(0, 10) <= b)
    .map(n => n.key);
}

// ── Changing project ────────────────────────────────────────────────────────

/** A project change keeps the notes (they are nobody's project) and drops the rest. */
export function keysKeptOnProjectChange(chosen) {
  return new Set([...chosen].filter(k => kindOfKey(k) === 'note'));
}

// ── What a reference sends ──────────────────────────────────────────────────

const words = (s) => text(s).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const dates = (a, b) => (a && b ? `${a} to ${b}` : a ? `from ${a}` : b ? `until ${b}` : '');

function lines(pairs) {
  return pairs.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`);
}

/**
 * The words an item sends (Q3), as one labelled paragraph. Only the fields
 * named in the design's §3 table; what is never sent is never read here.
 *
 * 🚨 A task's bid and logged days are NOT sent: they feed the budget, which
 * is money (D8: "only project admins can access the budget").
 */
export function itemWords(entry, pool) {
  const r = entry.row || {};
  const head = `[${KIND_LABEL[entry.kind]}] ${entry.name}`;
  let body = [];
  switch (entry.kind) {
    case 'asset':
      body = lines([
        ['Type', text(r.type_label) || words(r.type)],
        ['Status', words(r.status)],
        ['Dates', dates(r.start_date, r.end_date)],
        ['Description', text(r.description)],
      ]);
      break;
    case 'scene':
      body = lines([
        ['Scene number', r.scene_number ?? ''],
        ['Status', words(r.status)],
        ['Type', text(r.type)],
        ['Time of day', words(r.time_of_day)],
        ['Dates', dates(r.start_date, r.end_date)],
        ['Description', text(r.description)],
        ['Notes', text(r.notes)],
      ]);
      break;
    case 'shot':
      body = lines([
        ['Shot number', r.shot_number ?? ''],
        ['Status', words(r.status)],
        ['Framing', text(r.framing)],
        ['Camera movement', text(r.camera_movement)],
        ['Frame count', r.frame_count ? r.frame_count : ''],
        ['Description', text(r.description)],
        ['Notes', text(r.notes)],
      ]);
      break;
    case 'level':
    case 'experience':
      body = lines([
        ['Status', words(r.status)],
        ['Dates', dates(r.start_date, r.end_date)],
        ['Description', text(r.description)],
        ['Notes', text(r.notes)],
      ]);
      break;
    case 'task': {
      body = lines([
        ['Status', words(r.status)],
        ['Priority', words(r.priority)],
        ['Dates', dates(r.start_date, r.end_date)],
        ['Role', text(r.assigned_position)],
        ['About', taskItemNames(entry, pool).join('; ')],
        ['Description', text(r.description)],
        ['Notes', text(r.notes)],
      ]);
      break;
    }
    case 'phase':
      body = lines([
        ['Dates', dates(r.start_date, r.end_date)],
        ['Description', text(r.description)],
      ]);
      break;
    case 'milestone': {
      const phase = r.phase_id ? pool?.items?.phase?.find(p => p.id === r.phase_id) : null;
      body = lines([
        ['Date', r.date || ''],
        ['Phase', phase ? phase.name : ''],
        ['Description', text(r.description)],
      ]);
      break;
    }
    default:
      body = [];
  }
  return [head, ...body].join('\n');
}

/** The names of what a task is about: its items (0096), or its own links. */
function taskItemNames(entry, pool) {
  const idx = poolIndex(pool);
  const names = [];
  const rows = (pool?.taskItems || []).filter(ti => ti.task_id === entry.id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (rows.length) {
    for (const ti of rows) {
      const e = idx.get(refKey(ti.entity_type, ti.entity_id));
      if (e) names.push(`${KIND_LABEL[e.kind]} ${e.name}`);
    }
    return names;
  }
  const r = entry.row || {};
  for (const kind of ['asset', 'scene', 'shot', 'level', 'experience']) {
    const id = r[FILE_LINK[kind]];
    const e = id ? idx.get(refKey(kind, id)) : null;
    if (e) names.push(`${KIND_LABEL[kind]} ${e.name}`);
  }
  return names;
}

/** A note's paragraph: its title, subject and date, then the whole text. */
export function noteWords(entry, noteText) {
  const head = `[Note] ${entry.name}`;
  const meta = lines([['Subject', text(entry.subject)], ['Date', entry.noteDate || '']]);
  return [head, ...meta, '', text(noteText)].join('\n');
}

export const REFERENCES_SOURCE_NAME = 'Chosen references (items and notes)';

/**
 * The one text block the chosen items and notes travel in. It is passed to
 * buildSourceParts as one more text source, so the 256 KB rule that moves a
 * large text to the AI's file store applies to it with no new transport.
 */
export function referencesText(itemParagraphs, noteParagraphs) {
  const parts = [...itemParagraphs, ...noteParagraphs].filter(Boolean);
  if (!parts.length) return '';
  return [
    'CHOSEN REFERENCES',
    'Items from the project and the person’s own notes, chosen for this deck. Use them as source material, as you use the files.',
    '',
    parts.join('\n\n'),
  ].join('\n');
}

// ── Files as D.O.G.'s source entries ────────────────────────────────────────

export const coreLabel = (isCore) => (isCore ? '[Project · CORE]' : '[Project · REF]');

/**
 * A name without D.O.G.'s source label, for placement: the AI is told a file's
 * bare name and writes it back between << >>; the visualizer and the export
 * find the file by it. Strips the old `[Project]` and today's
 * `[Project · CORE]` / `[Project · REF]` alike.
 */
export function bareAssetName(name) {
  return String(name || '').replace(/^\[Project(?: · (?:CORE|REF))?\]\s*/, '');
}

/**
 * D.O.G.'s file entry for a chosen file whose body has been read: the shape
 * buildSourceParts, placement and the export already take (the same shape the
 * old automatic set built, so nothing downstream changes).
 */
export function fileEntry(poolFile, content) {
  const t = poolFile.dogType;
  return {
    id: poolFile.source === 'legacy' ? `proj-${poolFile.id}` : `file-${poolFile.id}`,
    file: { name: `${coreLabel(poolFile.isCore)} ${poolFile.name}`, size: poolFile.size || 0 },
    content,
    type: t,
    mediaType: poolFile.mime
      || (t === 'pdf' ? 'application/pdf' : t === 'text' ? 'text/plain' : t === 'video' ? 'video/mp4' : 'image/png'),
    isCore: poolFile.isCore,
    source: poolFile.source,
    rowId: poolFile.id,
    refKey: poolFile.key,
  };
}

/** A legacy file's entry: its body is already on the project record. */
export function legacyFileEntry(poolFile) {
  const raw = String(poolFile.row?.content || '');
  const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
  let content = base64;
  if (poolFile.dogType === 'text') {
    try { content = atob(base64); } catch { /* already text */ }
  }
  return fileEntry(poolFile, content);
}

// ── Size: the meter (Q8) ────────────────────────────────────────────────────

/** The estimate's ceiling: under the 232,275-token deck that worked (2026-08-03). */
export const REFERENCE_TOKEN_LIMIT = 200000;
export const IMAGE_TOKEN_ESTIMATE = 4000;

export const textTokens = (s) => Math.ceil(String(s || '').length / 4);

/** A file's estimate from its kind and size, before its body is read. */
export function fileTokens(dogType, bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (dogType === 'video') return 0;            // never sent to the AI
  if (dogType === 'image') return IMAGE_TOKEN_ESTIMATE;
  if (dogType === 'pdf') return Math.ceil(n / 20);
  return Math.ceil(n / 4);
}

/** An upload's estimate, from what is in memory (base64 for binaries). */
export function uploadTokens(entry) {
  if (!entry) return 0;
  const c = String(entry.content || '');
  if (entry.type === 'text') return textTokens(c);
  return fileTokens(entry.type, Math.floor((c.length * 3) / 4));
}

/** The bar: fraction of the limit, and whether it is past it (warn, never block). */
export function meterState(tokens, limit = REFERENCE_TOKEN_LIMIT) {
  const t = Math.max(0, Math.round(tokens || 0));
  const ratio = limit > 0 ? t / limit : 0;
  return { tokens: t, limit, ratio, percent: Math.round(ratio * 100), over: t > limit };
}
