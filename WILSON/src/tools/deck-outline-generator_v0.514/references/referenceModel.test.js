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
  refKey, kindOfKey,
} from './referenceModel';

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
    expect(fileKeysAddedBetween(pool, null, '2026-10-16')).toEqual([]);
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
  it('estimates by kind', () => {
    expect(fileTokens('video', 9e9)).toBe(0);
    expect(fileTokens('image', 10)).toBe(4000);
    expect(fileTokens('pdf', 400000)).toBe(20000);
    expect(fileTokens('text', 4000)).toBe(1000);
    expect(textTokens('abcd')).toBe(1);
    expect(uploadTokens({ type: 'text', content: 'x'.repeat(40) })).toBe(10);
    expect(uploadTokens({ type: 'pdf', content: 'A'.repeat(800) })).toBe(30);
  });

  it('says past the limit, at the limit it is not past', () => {
    expect(meterState(REFERENCE_TOKEN_LIMIT).over).toBe(false);
    expect(meterState(REFERENCE_TOKEN_LIMIT + 1).over).toBe(true);
    expect(meterState(50000).percent).toBe(25);
  });
});
