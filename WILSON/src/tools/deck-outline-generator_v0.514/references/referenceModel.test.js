// referenceModel.test.js — post-overhaul DG1 (2026-10-16).
//
// What D.O.G. may offer as a reference and what each reference sends. The
// privacy cases come first: a Legal or money file must never be offered, by
// any path (the list, a folder's tick, a quick choice, an item's files).

import { describe, it, expect } from 'vitest';
import {
  isDeckReferenceFile, isMoneyFile, buildPool, shownKinds, poolIndex, filesOfItem,
  childFolders, filesInFolder, fileKeysUnderFolder, tickState, folderTrail,
  localDay, coreFileKeys, fileKeysAddedBetween, noteKeysDatedBetween,
  keysKeptOnProjectChange, itemWords, noteWords, referencesText,
  fileEntry, legacyFileEntry, legacyPoolFiles, bareAssetName, coreLabel,
  fileTokens, uploadTokens, textTokens, meterState, REFERENCE_TOKEN_LIMIT,
  refKey, kindOfKey, pdfPagesFromBinary, countPdfPages, PDF_PAGE_TOKENS, readableType,
  notesText, sizeWarning, noteKeysDatedBetween as notesBetween, sendsInline,
} from './referenceModel';
import { deflateSync } from 'node:zlib';

const P = '11111111-2222-3333-4444-555555555555';
const file = (over = {}) => ({
  id: over.id || `f-${Math.random().toString(36).slice(2, 8)}`,
  project_id: P,
  name: 'brief.pdf',
  mime_type: 'application/pdf',
  size_bytes: 40000,
  storage_path: `projects/${P}/DOCUMENTS/brief.pdf`,
  storage_provider: 'supabase',
  is_core_definer: false,
  is_financial: false,
  uploaded_at: '2026-10-16T09:00:00Z',
  ...over,
});

describe('🚨 isDeckReferenceFile — what may be offered', () => {
  it('offers an ordinary project file', () => {
    expect(isDeckReferenceFile(file())).toBe(true);
  });

  it('offers a file filed under a scene (the person chooses each file now)', () => {
    expect(isDeckReferenceFile(file({ scene_id: 'sc1', mime_type: 'image/jpeg', name: 'frame.jpg' }))).toBe(true);
  });

  it('NEVER offers an invoice row (is_financial)', () => {
    expect(isDeckReferenceFile(file({ is_financial: true }))).toBe(false);
  });

  it('NEVER offers a body under a money folder, whatever its row says (0042)', () => {
    expect(isDeckReferenceFile(file({ storage_path: `projects/${P}/INVOICES/inv-12.pdf` }))).toBe(false);
    expect(isDeckReferenceFile(file({ storage_path: `projects/${P}/finance/rates.pdf` }))).toBe(false);
    expect(isMoneyFile(file({ storage_path: `projects/${P}/FINANCE/x.pdf` }))).toBe(true);
  });

  it('NEVER offers a Legal file (its LEGAL folder in the cloud)', () => {
    expect(isDeckReferenceFile(file({ storage_path: `projects/${P}/LEGAL/contract.pdf` }))).toBe(false);
  });

  it('NEVER offers a Legal file on the desktop (its tag)', () => {
    expect(isDeckReferenceFile(file({ storage_path: 'C:/work/contract.pdf', storage_provider: 'local_server', tags: ['legal'] }))).toBe(false);
  });

  it('never offers a trashed row (cloud deletes are soft)', () => {
    expect(isDeckReferenceFile(file({ deleted_at: '2026-10-01T00:00:00Z' }))).toBe(false);
  });

  it('tolerates nothing', () => {
    expect(isDeckReferenceFile(null)).toBe(false);
    expect(isDeckReferenceFile(undefined)).toBe(false);
  });
});

// A small project: two folders deep, a Legal and a money file hidden among them.
function project() {
  const folders = [
    { id: 'root-docs', parent_id: null, slug: 'documents', label: 'DOCUMENTS', path: 'DOCUMENTS' },
    { id: 'scenes', parent_id: null, slug: 'scenes', label: 'SCENES', path: 'SCENES' },
    { id: 'sc-storm', parent_id: 'scenes', slug: 'sc02', label: 'The storm', path: 'SCENES/sc02' },
    { id: 'sh-rain', parent_id: 'sc-storm', slug: 'sh010', label: 'Rain on the glass', path: 'SCENES/sc02/sh010' },
  ];
  const files = [
    file({ id: 'brief', name: 'brief.pdf', folder_id: 'root-docs', is_core_definer: true, uploaded_at: '2026-10-16T09:00:00Z' }),
    file({ id: 'treat', name: 'treatment.md', mime_type: 'text/markdown', size_bytes: 8000, folder_id: 'root-docs', uploaded_at: '2026-10-10T09:00:00Z' }),
    file({ id: 'frame', name: 'frame.jpg', mime_type: 'image/jpeg', folder_id: 'sh-rain', shot_id: 'sh1', uploaded_at: '2026-10-12T09:00:00Z' }),
    file({ id: 'legal', name: 'location-contract.pdf', folder_id: 'sc-storm', storage_path: `projects/${P}/LEGAL/location-contract.pdf`, is_core_definer: true }),
    file({ id: 'money', name: 'receipt.pdf', folder_id: 'sh-rain', is_financial: true }),
    file({ id: 'gone', name: 'old.pdf', folder_id: 'root-docs', deleted_at: '2026-10-01T00:00:00Z', is_core_definer: true }),
  ];
  const lists = {
    assets: [{ id: 'a1', name: 'Lighthouse Interior', type: 'environment', status: 'in_progress', description: 'The lamp room.' },
      { id: 'a-gone', name: 'Cut', deleted_at: '2026-10-01T00:00:00Z' }],
    scenes: [{ id: 'sc1', name: 'The storm', scene_number: 2, status: 'in_progress', time_of_day: 'night', description: 'Rain.', notes: 'Wind machines.' }],
    shots: [{ id: 'sh1', scene_id: 'sc1', name: 'Rain on the glass', shot_number: 10, status: 'not_started', framing: 'CU', frame_count: 96 }],
    levels: [],
    experiences: [],
    tasks: [{ id: 't1', title: 'Glass and rain rig test', status: 'in_progress', priority: 'high', start_date: '2026-10-01', end_date: '2026-10-03', bid_days: 4, logged_days: 2.5, assigned_position: 'Lead TD', description: 'Test the rig.', notes: 'Use the big tank.', asset_id: 'a1', scene_id: 'sc1' },
      { id: 't-aside', title: 'Parked', set_aside_at: '2026-10-02T00:00:00Z' }],
    phases: [{ id: 'ph1', name: 'Production', start_date: '2026-10-01', end_date: '2026-10-20', description: 'The shoot.' }],
    milestones: [{ id: 'm1', title: 'Picture lock', date: '2026-11-06', phase_id: 'ph1', description: 'No more cuts.' }],
    folders,
    files,
    taskItems: [],
  };
  const notes = [
    { id: 'n1', title: 'Notes from the animatic review', subject: 'Production', note_date: '2026-09-11', body_preview: 'Opening works…' },
    { id: 'n2', title: 'Festival list', subject: 'Festivals', note_date: '2026-08-28' },
  ];
  return buildPool({ lists, notes });
}

describe('buildPool', () => {
  const pool = project();

  it('offers every readable file and NONE of the Legal, money or trashed ones', () => {
    expect(pool.files.map(f => f.id).sort()).toEqual(['brief', 'frame', 'treat']);
  });

  it('drops deleted items and set-aside tasks', () => {
    expect(pool.items.asset.map(a => a.id)).toEqual(['a1']);
    expect(pool.items.task.map(t => t.id)).toEqual(['t1']);
  });

  it('names a shot with its scene, as the task window does', () => {
    expect(pool.items.shot[0].name).toBe('The storm › Rain on the glass');
  });

  it('shows assets and tasks always, other kinds only when the project holds one', () => {
    expect(shownKinds(pool)).toEqual(['asset', 'scene', 'shot', 'task', 'phase', 'milestone']);
    expect(shownKinds(buildPool({ lists: {} }))).toEqual(['asset', 'task']);
  });

  it('shows a kind whose list failed, so the failure can be said', () => {
    expect(shownKinds(buildPool({ lists: {}, errors: { level: 'refused' } }))).toContain('level');
  });

  it('keeps the notes null on a backend without them (the Local Server)', () => {
    expect(buildPool({ lists: {} }).notes).toBeNull();
    expect(pool.notes.map(n => n.key)).toEqual(['note:n1', 'note:n2']);
  });

  it('reads the stored Core mark strictly from the column', () => {
    const byId = Object.fromEntries(pool.files.map(f => [f.id, f.isCore]));
    expect(byId).toEqual({ brief: true, treat: false, frame: false });
  });

  it('🚨 a stored row with NO mark is not Core (never the legacy default-true idiom)', () => {
    const row = file({ id: 'bare' });
    delete row.is_core_definer;
    const p = buildPool({ lists: { files: [row, file({ id: 'nul', is_core_definer: null })] } });
    expect(p.files.map(f => f.isCore)).toEqual([false, false]);
    expect(coreFileKeys(p)).toEqual([]);
  });

  it('indexes every entry by key', () => {
    const idx = poolIndex(pool);
    expect(idx.get('scene:sc1').name).toBe('The storm');
    expect(idx.get('file:brief').name).toBe('brief.pdf');
    expect(idx.get('note:n1').name).toBe('Notes from the animatic review');
    expect(idx.has('file:legal')).toBe(false);
  });
});

describe('the legacy arrays keep their own polarity (§6 #31 trap (b))', () => {
  const legacy = legacyPoolFiles({
    documents: [
      { id: 'd1', name: 'old-brief.pdf', type: 'application/pdf', content: 'data:application/pdf;base64,JVBERi0=' },
      { id: 'd2', name: 'notes.txt', type: 'text/plain', content: 'data:text/plain;base64,aGVsbG8=', isCore: false },
      { id: 'd3', name: 'empty.txt', type: 'text/plain' },
    ],
    visualAssets: [{ id: 'v1', name: 'plate.mov', type: '', content: 'data:video/quicktime;base64,AAAA' }],
  });

  it('defaults a legacy file to CORE unless it says otherwise', () => {
    expect(legacy.map(f => [f.id, f.isCore])).toEqual([['d1', true], ['d2', false], ['v1', true]]);
  });

  it('skips a legacy row with no body, as before', () => {
    expect(legacy.some(f => f.id === 'd3')).toBe(false);
  });

  it('reads a nameless-type .mov in visualAssets as video', () => {
    expect(legacy.find(f => f.id === 'v1').dogType).toBe('video');
  });

  it('decodes a legacy text body to text', () => {
    expect(legacyFileEntry(legacy.find(f => f.id === 'd2')).content).toBe('hello');
  });
});

describe('folders (Q11)', () => {
  const pool = project();

  it('a folder\'s tick reaches every offered file at every depth', () => {
    expect(fileKeysUnderFolder(pool, 'scenes').sort()).toEqual(['file:frame']);
  });

  it('🚨 and never the Legal or money file sitting in the same folders', () => {
    const keys = fileKeysUnderFolder(pool, 'scenes');
    expect(keys).not.toContain('file:legal');
    expect(keys).not.toContain('file:money');
  });

  it('lists a level of the tree at a time, folders by name', () => {
    expect(childFolders(pool).map(f => f.name)).toEqual(['DOCUMENTS', 'SCENES']);
    expect(childFolders(pool, 'scenes').map(f => f.name)).toEqual(['The storm']);
    expect(filesInFolder(pool, 'root-docs').map(f => f.name)).toEqual(['brief.pdf', 'treatment.md']);
  });

  it('says where a file sits', () => {
    expect(folderTrail(pool, 'sh-rain')).toEqual(['SCENES', 'The storm', 'Rain on the glass']);
  });

  it('reports all, some and none', () => {
    expect(tickState(['a', 'b'], new Set(['a', 'b']))).toBe('all');
    expect(tickState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(tickState(['a', 'b'], new Set())).toBe('none');
    expect(tickState([], new Set(['a']))).toBe('none');
  });

  it('puts a file whose folder it cannot see at the top level', () => {
    const p = buildPool({ lists: { folders: [], files: [file({ id: 'x', folder_id: 'hidden' })] } });
    expect(filesInFolder(p, null).map(f => f.id)).toEqual(['x']);
  });
});

describe("what D.O.G. can read (the upload button's kinds)", () => {
  it('takes PDFs, text, the four pictures the AI looks at, and videos to place', () => {
    expect(readableType('application/pdf', 'a.pdf', 'pdf')).toBe('pdf');
    expect(readableType('text/plain', 'a.txt', 'text')).toBe('text');
    expect(readableType('', 'brief.md', 'text')).toBe('text');
    expect(readableType('image/jpeg', 'a.jpg', 'image')).toBe('image');
    expect(readableType('image/webp', 'a.webp', 'image')).toBe('image');
    expect(readableType('video/mp4', 'a.mp4', 'video')).toBe('video');
  });

  it('🚨 refuses what the AI would reject or read as garbage', () => {
    expect(readableType('image/vnd.adobe.photoshop', 'prop.psd', 'image')).toBeNull();
    expect(readableType('image/tiff', 'scan.tif', 'image')).toBeNull();
    expect(readableType('image/svg+xml', 'logo.svg', 'image')).toBeNull();
    expect(readableType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'notes.docx', 'text')).toBeNull();
    expect(readableType('application/zip', 'plates.zip', 'text')).toBeNull();
  });

  it('lists such a file, greyed, and lets no tick, folder or quick choice reach it', () => {
    const psd = file({ id: 'psd', name: 'prop.psd', mime_type: 'image/vnd.adobe.photoshop', folder_id: 'f1', is_core_definer: true });
    const pdf = file({ id: 'pdf', name: 'brief.pdf', folder_id: 'f1', is_core_definer: true });
    const p = buildPool({ lists: { folders: [{ id: 'f1', parent_id: null, label: 'DOCS', path: 'DOCS' }], files: [psd, pdf] } });
    expect(p.files.map(f => [f.id, f.readable])).toEqual([['psd', false], ['pdf', true]]);
    expect(coreFileKeys(p)).toEqual(['file:pdf']);
    expect(fileKeysUnderFolder(p, 'f1')).toEqual(['file:pdf']);
    expect(fileKeysAddedBetween(p, '2000-01-01', '2100-01-01')).toEqual(['file:pdf']);
    expect(poolIndex(p).has('file:psd')).toBe(false);
  });
});

describe('an item\'s files (Q3)', () => {
  it('lists the files filed against the item, never a gated one', () => {
    const pool = project();
    expect(filesOfItem(pool, 'shot', 'sh1').map(f => f.id)).toEqual(['frame']);
    expect(filesOfItem(pool, 'milestone', 'm1')).toEqual([]);
  });
});

describe('quick choices (Q2, Q18)', () => {
  const pool = project();

  it('All Core files ticks the files whose own mark is Core, never a gated one', () => {
    expect(coreFileKeys(pool)).toEqual(['file:brief']);
  });

  it('picks files by the day they were added, inclusive, either order', () => {
    const day = localDay('2026-10-12T09:00:00Z');
    expect(fileKeysAddedBetween(pool, day, day)).toEqual(['file:frame']);
    expect(fileKeysAddedBetween(pool, localDay('2026-10-16T09:00:00Z'), localDay('2026-10-10T09:00:00Z')).sort())
      .toEqual(['file:brief', 'file:frame', 'file:treat']);
    // Review round 2: a range may be open at one end (everything up to a day).
    expect(fileKeysAddedBetween(pool, null, '2026-10-16').sort()).toEqual(['file:brief', 'file:frame', 'file:treat']);
  });

  it('picks notes by the date each note carries', () => {
    expect(noteKeysDatedBetween(pool, '2026-09-01', '2026-09-30')).toEqual(['note:n1']);
  });
});

describe('changing project', () => {
  it('keeps the notes and drops the project\'s items and files', () => {
    const kept = keysKeptOnProjectChange(new Set(['scene:sc1', 'file:brief', 'legacy:documents:d1', 'note:n1']));
    expect([...kept]).toEqual(['note:n1']);
  });

  it('reads each key\'s kind', () => {
    expect(kindOfKey(refKey('shot', 'x'))).toBe('shot');
    expect(kindOfKey('legacy:documents:d1')).toBe('file');
  });
});

describe('what an item sends (Q3)', () => {
  const pool = project();
  const idx = poolIndex(pool);

  it('a scene sends its words, never its thumbnail', () => {
    const w = itemWords(idx.get('scene:sc1'), pool);
    expect(w).toBe([
      '[Scene] The storm',
      'Scene number: 2',
      'Status: In progress',
      'Time of day: Night',
      'Description: Rain.',
      'Notes: Wind machines.',
    ].join('\n'));
  });

  it('🚨 a task sends what it is about, and NOT its bid or logged days (money)', () => {
    const w = itemWords(idx.get('task:t1'), pool);
    expect(w).toContain('About: Asset Lighthouse Interior; Scene The storm');
    expect(w).toContain('Role: Lead TD');
    expect(w).not.toMatch(/bid|logged|\b4\b|2\.5/i);
  });

  it('a task names its items from task_items when it has them (0096)', () => {
    const p = buildPool({
      lists: {
        ...{ assets: [{ id: 'a1', name: 'Lamp' }], shots: [{ id: 's9', name: 'Wide' }] },
        tasks: [{ id: 't1', title: 'Rig', asset_id: 'a1' }],
        taskItems: [{ task_id: 't1', entity_type: 'shot', entity_id: 's9', position: 1 }, { task_id: 't1', entity_type: 'asset', entity_id: 'a1', position: 0 }],
      },
    });
    expect(itemWords(poolIndex(p).get('task:t1'), p)).toContain('About: Asset Lamp; Shot Wide');
  });

  it('a milestone names its phase', () => {
    expect(itemWords(idx.get('milestone:m1'), pool)).toContain('Phase: Production');
  });

  it('a note sends its title, subject, date and whole text', () => {
    expect(noteWords(poolIndex(pool).get('note:n1'), 'Door shot first.'))
      .toBe('[Note] Notes from the animatic review\nSubject: Production\nDate: 2026-09-11\n\nDoor shot first.');
  });

  it('the references text is empty when nothing is chosen, so the message is unchanged', () => {
    expect(referencesText([], [])).toBe('');
    expect(referencesText(['[Scene] A'], [])).toMatch(/^CHOSEN REFERENCES\n/);
  });
});

describe('files as D.O.G.\'s own source entries', () => {
  const pool = project();
  const brief = poolIndex(pool).get('file:brief');

  it('labels a chosen file CORE or REF from its own mark, as before', () => {
    const e = fileEntry(brief, 'BASE64');
    expect(e.file.name).toBe('[Project · CORE] brief.pdf');
    expect(e).toMatchObject({ id: 'file-brief', type: 'pdf', mediaType: 'application/pdf', isCore: true, source: 'stored', rowId: 'brief' });
    expect(coreLabel(false)).toBe('[Project · REF]');
  });

  it('a placed file is found by its bare name, old label or new', () => {
    expect(bareAssetName('[Project · CORE] hero.jpg')).toBe('hero.jpg');
    expect(bareAssetName('[Project · REF] hero.jpg')).toBe('hero.jpg');
    expect(bareAssetName('[Project] hero.jpg')).toBe('hero.jpg');
    expect(bareAssetName('hero.jpg')).toBe('hero.jpg');
  });
});

describe('the meter (Q8): it warns, it never blocks', () => {
  it('estimates by kind; a PDF by its pages, never its bytes', () => {
    expect(fileTokens('video', 9e9)).toBe(0);
    expect(fileTokens('image', 10)).toBe(4000);
    // Design review round 1 (HIGH): bytes are not pages.
    expect(fileTokens('pdf', 180000, 40)).toBe(40 * PDF_PAGE_TOKENS);
    expect(fileTokens('pdf', 24e6, 12)).toBe(12 * PDF_PAGE_TOKENS);
    expect(fileTokens('pdf', 400000)).toBeNull();
    expect(fileTokens('text', 4000)).toBe(1000);
    expect(textTokens('abcd')).toBe(1);
    expect(uploadTokens({ type: 'text', content: 'x'.repeat(40) })).toBe(10);
    expect(uploadTokens({ type: 'pdf', content: 'A'.repeat(800) })).toBeNull();
    expect(uploadTokens({ type: 'pdf', content: 'A'.repeat(800) }, 3)).toBe(3 * PDF_PAGE_TOKENS);
  });

  it('says past the limit, at the limit it is not past, and what it has not counted', () => {
    expect(meterState(REFERENCE_TOKEN_LIMIT).over).toBe(false);
    expect(meterState(REFERENCE_TOKEN_LIMIT + 1).over).toBe(true);
    expect(meterState(50000).percent).toBe(25);
    expect(meterState(10, undefined, 2).uncounted).toBe(2);
  });
});

describe("a PDF's pages", () => {
  it("reads the page tree's count, the root's being the largest", () => {
    const pdf = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'
      + '2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 12 >> endobj\n'
      + '3 0 obj << /Type /Pages /Parent 2 0 R /Kids [5 0 R] /Count 5 >> endobj\n';
    expect(pdfPagesFromBinary(pdf)).toBe(12);
  });

  it('a page object is not an answer: with no page-tree root the count is unknown', () => {
    const pdf = '<< /Type /Page /Parent 2 0 R >> << /Type /Page >> << /Type/Page >> << /Type /Pages /Parent 9 0 R /Kids [] /Count 3 >>';
    expect(pdfPagesFromBinary(pdf)).toBeNull();
    expect(pdfPagesFromBinary('%PDF-1.7 nothing here')).toBeNull();
  });

  it('looks inside a compressed object stream (PDF 1.5 and later)', async () => {
    const inner = '2 0 3 40 << /Type /Pages /Kids [3 0 R] /Count 7 >> << /Type /Page /Parent 2 0 R >>';
    const z = deflateSync(Buffer.from(inner, 'latin1'));
    const head = Buffer.from(`%PDF-1.7\n9 0 obj\n<< /Type /ObjStm /N 2 /First 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, 'latin1');
    const tail = Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1');
    const whole = Buffer.concat([head, z, tail]);
    expect(pdfPagesFromBinary(whole.toString('latin1'))).toBeNull();
    expect(await countPdfPages(whole.toString('base64'))).toBe(7);
  });

  it('says it cannot tell rather than guessing, and never throws', async () => {
    expect(await countPdfPages(Buffer.from('%PDF-1.7 opaque').toString('base64'))).toBeNull();
    expect(await countPdfPages('%%% not base64 %%%')).toBeNull();
  });
});

describe('a PDF\'s pages, on the shapes real files take (design review round 2)', () => {
  const z = (text) => deflateSync(Buffer.from(text, 'latin1'));
  const objStm = (inner) => {
    const body = z(inner);
    return Buffer.concat([
      Buffer.from(`7 0 obj\n<< /Type /ObjStm /N 3 /First 12 /Filter /FlateDecode /Length ${body.length} >>\nstream\n`, 'latin1'),
      body,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]);
  };

  it('an incremental save left ONE page in the clear; the tree is compressed: 120, not 1', async () => {
    const whole = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      objStm('1 0 2 60 << /Type /Catalog /Pages 2 0 R >> << /Type /Pages /Kids [3 0 R] /Count 120 >>'),
      Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /Annots [9 0 R] >>\nendobj\n%%EOF', 'latin1'),
    ]);
    expect(await countPdfPages(whole.toString('base64'))).toBe(120);
  });

  it('a root with nested dictionaries before its /Count, and stale page objects: 12, not 24', async () => {
    const stale = Array.from({ length: 24 }, (_, i) => `${10 + i} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`).join('');
    const pdf = '%PDF-1.4\n2 0 obj << /Type /Pages /Resources << /Font << /F1 5 0 R >> /ProcSet [/PDF /Text] >> /Kids [3 0 R] /Count 12 >> endobj\n' + stale;
    expect(pdfPagesFromBinary(pdf)).toBe(12);
    expect(await countPdfPages(Buffer.from(pdf, 'latin1').toString('base64'))).toBe(12);
  });

  it("the bookmarks' /Count never stands in for the page tree's: 12, not 300", async () => {
    const whole = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      objStm('4 0 2 40 << /Type /Outlines /First 8 0 R /Count 300 >> << /Type /Pages /Kids [3 0 R] /Count 12 >>'),
    ]);
    expect(await countPdfPages(whole.toString('base64'))).toBe(12);
  });

  it('a linearized file states its pages in its first dictionary', () => {
    const pdf = '%PDF-1.7\n1 0 obj << /Linearized 1 /L 99999 /H [ 600 150 ] /O 4 /E 5000 /N 7 /T 99000 >> endobj\n';
    expect(pdfPagesFromBinary(pdf)).toBe(7);
  });
});

describe('a picture whose type is blank, open-ended dates, size warnings, the notes block', () => {
  it('a .jpg with no type is a picture by its name, not text to grey', () => {
    const p = buildPool({ lists: { files: [file({ id: 'j', name: 'still.jpg', mime_type: '' })] } });
    expect(p.files[0]).toMatchObject({ dogType: 'image', readable: true });
  });

  it('a date range may be open at either end, and not both', () => {
    const pool = project();
    expect(fileKeysAddedBetween(pool, '2026-10-12', '').sort()).toEqual(['file:brief', 'file:frame']);
    expect(fileKeysAddedBetween(pool, '', '2026-10-11')).toEqual(['file:treat']);
    expect(fileKeysAddedBetween(pool, '', '')).toEqual([]);
    expect(notesBetween(pool, '2026-09-01', '')).toEqual(['note:n1']);
  });

  it("says when a file is over the AI's caps, and nothing otherwise", () => {
    expect(sizeWarning('pdf', 1e6, 140)).toMatch(/^140 pages: the AI may refuse a PDF over 100$/);
    expect(sizeWarning('pdf', 40 * 1024 * 1024, 10)).toMatch(/^40 MB: the AI may refuse a PDF over 32 MB$/);
    expect(sizeWarning('image', 12 * 1024 * 1024)).toMatch(/^12 MB: the AI may refuse a picture over 10 MB$/);
    expect(sizeWarning('video', 300 * 1024 * 1024)).toMatch(/^300 MB: too large to place in a slide$/);
    expect(sizeWarning('pdf', 1e6, 12)).toBeNull();
    expect(sizeWarning('text', 9e9)).toBeNull();
  });

  it('the notes travel in their own block', () => {
    expect(notesText([])).toBe('');
    expect(notesText(['[Note] A'])).toMatch(/^CHOSEN NOTES\n/);
  });
});

describe('code review round 2', () => {
  it('a /Count that is an indirect reference, zero or absurd is unknown, not a number', () => {
    expect(pdfPagesFromBinary('<< /Type /Pages /Kids [3 0 R] /Count 12 0 R >>')).toBeNull();
    expect(pdfPagesFromBinary('<< /Type /Pages /Kids [] /Count 0 >>')).toBeNull();
    expect(pdfPagesFromBinary('<< /Type /Pages /Kids [3 0 R] /Count 999999999999999999999 >>')).toBeNull();
    expect(pdfPagesFromBinary('<< /Type /Pages /Kids [3 0 R] /Count 12 >>')).toBe(12);
  });

  it('a size at the cap never contradicts it', () => {
    expect(sizeWarning('pdf', 32.4 * 1024 * 1024)).toBe('33 MB: the AI may refuse a PDF over 32 MB');
    expect(sizeWarning('image', 10.3 * 1024 * 1024)).toBe('11 MB: the AI may refuse a picture over 10 MB');
  });

  it('🚨 the notes stay in the request whatever their length; other text past the limit does not', () => {
    const long = 'x'.repeat(300 * 1024);
    expect(sendsInline({ type: 'text', content: long, inlineOnly: true }, 256 * 1024)).toBe(true);
    expect(sendsInline({ type: 'text', content: long }, 256 * 1024)).toBe(false);
    expect(sendsInline({ type: 'text', content: 'short' }, 256 * 1024)).toBe(true);
    expect(sendsInline({ type: 'pdf', content: 'JVBER', inlineOnly: true }, 256 * 1024)).toBe(false);
  });

  it('JPEG under the names some systems write is a picture the AI looks at', () => {
    expect(readableType('image/jpg', 'a.jpg', 'image')).toBe('image');
    expect(readableType('image/pjpeg', 'a.jpg', 'image')).toBe('image');
    const p = buildPool({ lists: { files: [file({ id: 'j', name: 'a.jpg', mime_type: 'image/jpg' })] } });
    expect(fileEntry(p.files[0], 'B64').mediaType).toBe('image/jpeg');
  });
});
