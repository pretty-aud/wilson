/** @vitest-environment jsdom */
// useReferences.test.jsx — post-overhaul DG1 (2026-10-16), code review round 1.
//
// The hook driven with a fake backend: what is read, when, and what happens
// when a list fails or a reference is gone. Source pins cannot see these
// (review round 1: "a download at tick written as readBody(e).then(…) passes
// unchanged"), so they are measured here by counting calls.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { useReferences } from './useReferences';
import { IMAGE_TOKEN_ESTIMATE } from './referenceModel';
import { u8ToB64 } from '../../../components/Dashboard/noteSync';

const P1 = 'p1';
const P2 = 'p2';
const KEY = 'projects/11111111-2222-3333-4444-555555555555';

function noteState(text) {
  const d = new Y.Doc();
  const frag = d.getXmlFragment('default');
  d.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    frag.push([p]);
    p.push([t]);
    t.insert(0, text);
  });
  return u8ToB64(Y.encodeStateAsUpdate(d));
}

const fileRow = (over = {}) => ({
  project_id: P1, name: 'brief.txt', mime_type: 'text/plain', size_bytes: 20,
  storage_path: `${KEY}/DOCUMENTS/brief.txt`, is_core_definer: true, uploaded_at: '2026-10-16T09:00:00Z',
  ...over,
});

function makeAdapter(files) {
  const adapter = {
    failFiles: false,
    failFolders: false,
    listAssets: async () => [],
    listTasks: async () => [],
    listScenes: async (pid) => (pid === P1 ? [{ id: 'sc1', project_id: P1, name: 'The storm', status: 'in_progress' }] : []),
    listShots: async () => [],
    listLevels: async () => [],
    listExperiences: async () => [],
    listPhases: async () => [],
    listMilestones: async () => [],
    listFolders: async () => { if (adapter.failFolders) throw new Error('folders down'); return []; },
    listTaskItems: async () => [],
    listFiles: vi.fn(async (pid) => {
      if (adapter.failFiles) throw new Error('network down');
      return files.filter(f => f.project_id === pid);
    }),
    downloadFile: vi.fn(async (row) => new Blob([row.body || 'BODY'], { type: row.mime_type })),
    listNotes: async () => [{ id: 'n1', title: 'Animatic review', subject: 'Production', note_date: '2026-09-11' }],
    getNote: async (id) => ({ id, ydoc_state: noteState('Door shot first.') }),
  };
  return adapter;
}

function setup(files = [fileRow({ id: 'f1' })]) {
  const adapter = makeAdapter(files);
  const getAdapter = () => adapter;
  const props = { getAdapter, adapterMode: 'supabase', projectId: P1, project: { id: P1, title: 'Salt Hours' } };
  const hook = renderHook((p) => useReferences(p), { initialProps: props });
  return { hook, adapter, files, props };
}

const now = (hook) => hook.result.current;

describe('useReferences: a body is read for a deck or a preview, never for a tick', () => {
  it('choosing reads nothing; a preview reads once; generations reuse that read', async () => {
    const { hook, adapter } = setup();
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:f1']));
    expect(adapter.downloadFile).toHaveBeenCalledTimes(0);

    let shown;
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(shown.text).toBe('BODY');
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);

    let out;
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(out.files.map(f => f.content)).toEqual(['BODY']);
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: an un-cached body is read at Generate (the count above is not vacuous)', async () => {
    const { hook, adapter } = setup();
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:f1']));
    await act(async () => { await now(hook).resolveForGeneration(); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);
  });
});

describe('useReferences: a preview lists first when nothing has been listed', () => {
  it('a file the New project window added previews, not "no longer available"', async () => {
    const { hook } = setup([fileRow({ id: 'f2' })]);
    act(() => now(hook).adoptUploadedFiles([fileRow({ id: 'f2' })]));
    expect(now(hook).pool).toBeNull();
    let shown;
    await act(async () => { shown = await now(hook).preview('file:f2'); });
    expect(shown.text).toBe('BODY');
  });

  it('references set aside and brought back preview too, and the notes stay throughout', async () => {
    const { hook, props } = setup();
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:f1', 'scene:sc1', 'note:n1']));
    hook.rerender({ ...props, projectId: P2, project: { id: P2, title: 'Lighthouse' } });
    await waitFor(() => expect([...now(hook).chosen]).toEqual(['note:n1']));
    expect(now(hook).notice).toMatch(/2 references from Salt Hours are set aside; they come back when you choose Salt Hours again\. Your 1 note stays\./);

    hook.rerender(props);
    await waitFor(() => expect(now(hook).chosen.has('scene:sc1')).toBe(true));
    expect(now(hook).notice).toMatch(/2 references from Salt Hours are back\./);
    let shown;
    await act(async () => { shown = await now(hook).preview('scene:sc1'); });
    expect(shown.text).toMatch(/^\[Scene\] The storm/);
  });
});

describe('useReferences: a failed list is not a missing reference (design review round 2)', () => {
  it('a list that fails stops the generation and greys nothing', async () => {
    const { hook, adapter } = setup();
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:f1']));
    adapter.failFiles = true;
    let err;
    await act(async () => { await now(hook).resolveForGeneration().catch(e => { err = e; }); });
    expect(err?.code).toBe('DOG_LIST_FAILED');
    expect(now(hook).unavailable.size).toBe(0);
  });

  it('a list that succeeds without the reference greys it and does not send it', async () => {
    const { hook, files } = setup();
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:f1']));
    files.length = 0;
    let out;
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(out.files).toEqual([]);
    expect(out.unreadable).toEqual(['brief.txt (no longer in the project)']);
    expect(now(hook).unavailable.has('file:f1')).toBe(true);
  });
});

describe('useReferences: what travels how', () => {
  it('the notes travel inline-only; a video is read only to be placed, and never when too large', async () => {
    const files = [
      fileRow({ id: 'v1', name: 'plate.mp4', mime_type: 'video/mp4', size_bytes: 1000 }),
      fileRow({ id: 'v2', name: 'master.mov', mime_type: 'video/quicktime', size_bytes: 300 * 1024 * 1024 }),
    ];
    const { hook, adapter } = setup(files);
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['note:n1', 'file:v1', 'file:v2']));

    let out;
    await act(async () => { out = await now(hook).resolveForGeneration({ includeVideo: false }); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(0);
    expect(out.notesSource).toMatchObject({ inlineOnly: true, type: 'text' });
    expect(out.notesSource.content).toMatch(/Door shot first\./);
    expect(out.referencesSource).toBeNull();

    await act(async () => { out = await now(hook).resolveForGeneration({ includeVideo: true }); });
    expect(adapter.downloadFile.mock.calls.map(([row]) => row.id)).toEqual(['v1']);
    expect(out.unreadable).toEqual(['master.mov (300 MB: too large to place)']);
  });

  it('Remove all keeps what it removed for one Undo', async () => {
    const { hook } = setup();
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:f1', 'scene:sc1']));
    act(() => now(hook).removeAll());
    expect(now(hook).chosen.size).toBe(0);
    expect(now(hook).undoable).toBe(true);
    act(() => now(hook).undoRemoveAll());
    expect([...now(hook).chosen].sort()).toEqual(['file:f1', 'scene:sc1']);
  });
});

describe('useReferences: code review round 2', () => {
  it('a folders-only failure still lists the files, and the deck is made from them', async () => {
    const { hook, adapter } = setup();
    adapter.failFolders = true;
    await act(async () => { await now(hook).loadPool(); });
    expect(now(hook).pool.errors.files).toBeUndefined();
    expect(now(hook).pool.errors.folders).toBe('folders down');
    act(() => now(hook).tick(['file:f1']));
    let out;
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(out.files.map(f => f.content)).toEqual(['BODY']);
  });

  it('files stored for a project not yet chosen wait for it, then are chosen', async () => {
    const { hook, props } = setup([fileRow({ id: 'f9', project_id: P2 })]);
    act(() => now(hook).adoptUploadedFiles([fileRow({ id: 'f9', project_id: P2 })]));
    expect(now(hook).chosen.size).toBe(0);
    hook.rerender({ ...props, projectId: P2, project: { id: P2, title: 'Lighthouse' } });
    await waitFor(() => expect(now(hook).chosen.has('file:f9')).toBe(true));
  });

  it("a read in flight when the project changes never lands on the new project", async () => {
    const { hook, adapter, props } = setup();
    let release;
    const gate = new Promise((r) => { release = r; });
    adapter.listFiles.mockImplementationOnce(async () => { await gate; return [fileRow({ id: 'f1' })]; });
    let pending;
    act(() => { pending = now(hook).loadPool(); });
    hook.rerender({ ...props, projectId: P2, project: { id: P2, title: 'Lighthouse' } });
    await act(async () => { release(); await pending; });
    expect(now(hook).pool).toBeNull();
    expect(now(hook).unavailable.size).toBe(0);
  });
});

// Post-overhaul FX13 (OUTSTANDING DG1b-02): the preview said "Reading it here
// is recorded" on every read, but a body kept for the session is neither
// downloaded nor recorded again. Each case counts the downloads beside the
// line, so the line is checked against what happened.
describe('useReferences: the preview says "recorded" only when this preview downloads (FX13, DG1b-02)', () => {
  const RECORDED = 'Reading it here is recorded in the file’s activity, as any download is.';
  const KEPT = 'Already read while WILSON is open, so showing it here is not recorded again.';

  it('the first preview downloads and says it is recorded; the second downloads nothing and says so', async () => {
    const { hook, adapter } = setup();
    await act(async () => { await now(hook).loadPool(); });
    let shown;
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);
    expect(shown.line).toBe(RECORDED);
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);
    expect(shown.line).toBe(KEPT);
  });

  it('a body read at Generate is not downloaded again by a later preview, which says so', async () => {
    const { hook, adapter } = setup();
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:f1']));
    await act(async () => { await now(hook).resolveForGeneration(); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);
    let shown;
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);
    expect(shown.line).toBe(KEPT);
  });

  it('CONTROL: a file changed since its read is downloaded again, and that preview says it is recorded', async () => {
    const { hook, adapter, files } = setup([fileRow({ id: 'f1', updated_at: '2026-10-16T09:00:00Z' })]);
    await act(async () => { await now(hook).loadPool(); });
    let shown;
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(shown.line).toBe(RECORDED);
    files[0] = { ...files[0], updated_at: '2026-10-26T12:00:00Z' };
    await act(async () => { await now(hook).loadPool(); });
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(2);
    expect(shown.line).toBe(RECORDED);
  });

  it('a PDF\'s line says it the same way, after what it says about its pages', async () => {
    const { hook, adapter } = setup([fileRow({ id: 'p1', name: 'brief.pdf', mime_type: 'application/pdf' })]);
    await act(async () => { await now(hook).loadPool(); });
    let shown;
    await act(async () => { shown = await now(hook).preview('file:p1'); });
    expect(shown.line.endsWith(` ${RECORDED}`)).toBe(true);
    await act(async () => { shown = await now(hook).preview('file:p1'); });
    expect(adapter.downloadFile).toHaveBeenCalledTimes(1);
    expect(shown.line.endsWith(` ${KEPT}`)).toBe(true);
    expect(shown.line).not.toContain(RECORDED);
  });

  it('a backend that records no downloads says neither line', async () => {
    const { hook, props } = setup();
    hook.rerender({ ...props, adapterMode: 'google_drive' });
    await act(async () => { await now(hook).loadPool(); });
    let shown;
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(shown.line).toBe(null);
    await act(async () => { shown = await now(hook).preview('file:f1'); });
    expect(shown.line).toBe(null);
  });
});

// =============================================================================
// DG4 (Audrey, 2026-10-28, note 4, verbatim): "lets also add a way for the
// user to just press a checkbox to bypass selecting files and letting the
// generator just reference the files marked as core project files. since
// these core project files have the core details of what the project is,
// this is enough references for decks." With `coreOnly` on, what is listed,
// counted and read is the project's readable Core files (coreFileKeys over
// the pool: the window's own All Core files test); the window's set steps
// aside untouched. Every name here is made up.
// =============================================================================
const CORE_FILES = () => [
  fileRow({ id: 'c1', name: 'core-brief.txt', body: 'CORE BRIEF', size_bytes: 40 }),
  fileRow({ id: 'c2', name: 'core-board.png', mime_type: 'image/png', size_bytes: 2048, storage_path: `${KEY}/DOCUMENTS/core-board.png` }),
  // Core, and D.O.G. cannot read it: never listed (a Photoshop file).
  fileRow({ id: 'c3', name: 'core-prop.psd', mime_type: 'image/vnd.adobe.photoshop', size_bytes: 9000, storage_path: `${KEY}/DOCUMENTS/core-prop.psd` }),
  // Core, and never offered: a money file and a trashed one (the pool's gate).
  fileRow({ id: 'c4', name: 'core-invoice.pdf', mime_type: 'application/pdf', storage_path: `${KEY}/INVOICES/core-invoice.pdf` }),
  fileRow({ id: 'c5', name: 'core-old.txt', deleted_at: '2026-10-20T09:00:00Z' }),
  // Readable, not Core.
  fileRow({ id: 'r1', name: 'ref-notes.txt', body: 'REF NOTES', is_core_definer: false }),
];

describe('useReferences: Core files only (DG4)', () => {
  it('lists the readable Core files by name and nothing a person may not read; the window\'s set steps aside and comes back as it was', async () => {
    const { hook } = setup(CORE_FILES());
    await act(async () => { await now(hook).loadPool(); });
    // CONTROL: the data has a Core file D.O.G. cannot read, and two the pool never offers.
    const psd = now(hook).pool.files.find(f => f.id === 'c3');
    expect(psd.isCore && !psd.readable).toBe(true);
    expect(now(hook).pool.files.some(f => f.id === 'c4' || f.id === 'c5')).toBe(false);
    expect(now(hook).core).toEqual({ state: 'ready', count: 2, legacy: 0 });
    act(() => now(hook).tick(['file:r1', 'note:n1']));
    expect(now(hook).coreOnly).toBe(false);
    act(() => now(hook).setCoreOnly(true));
    expect(now(hook).chosenList.map(s => s.key)).toEqual(['file:c2', 'file:c1']);
    expect(now(hook).chosenList.every(s => s.isCore)).toBe(true);
    expect([...now(hook).listedKeys]).toEqual(['file:c2', 'file:c1']);
    expect([...now(hook).chosen]).toEqual(['file:r1', 'note:n1']);
    act(() => now(hook).setCoreOnly(false));
    expect(now(hook).chosenList.map(s => s.key)).toEqual(['file:r1', 'note:n1']);
    expect([...now(hook).listedKeys]).toEqual(['file:r1', 'note:n1']);
  });

  it('Generate reads exactly the readable Core files, now; cleared, the window\'s set again', async () => {
    const { hook, adapter } = setup(CORE_FILES());
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:r1']));
    act(() => now(hook).setCoreOnly(true));
    let out;
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(out.files.map(f => f.file.name)).toEqual(['[Project · CORE] core-board.png', '[Project · CORE] core-brief.txt']);
    expect(out.files.map(f => f.refKey)).toEqual(['file:c2', 'file:c1']);
    expect(adapter.downloadFile.mock.calls.map(([row]) => row.id).sort()).toEqual(['c1', 'c2']);
    expect(out.unreadable).toEqual([]);
    act(() => now(hook).setCoreOnly(false));
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(out.files.map(f => f.file.name)).toEqual(['[Project · REF] ref-notes.txt']);
    expect(out.files[0].content).toBe('REF NOTES');
  });

  it('a file marked Core since the card listed is read, and the card follows the same fresh list', async () => {
    const { hook, files } = setup(CORE_FILES());
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).setCoreOnly(true));
    files[5] = { ...files[5], is_core_definer: true };
    let out;
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(out.files.map(f => f.refKey)).toEqual(['file:c2', 'file:c1', 'file:r1']);
    expect(now(hook).chosenList.map(s => s.key)).toEqual(['file:c2', 'file:c1', 'file:r1']);
  });

  it('the meter counts what is listed: the Core files while ticked, the window\'s set when cleared', async () => {
    const { hook } = setup(CORE_FILES());
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).tick(['file:r1']));
    const window = { tokens: now(hook).chosenTokens, bytes: now(hook).chosenBytes };
    expect(window).toEqual({ tokens: Math.ceil(20 / 4), bytes: 20 });
    act(() => now(hook).setCoreOnly(true));
    expect(now(hook).chosenTokens).toBe(Math.ceil(40 / 4) + IMAGE_TOKEN_ESTIMATE);
    expect(now(hook).chosenBytes).toBe(40 + 2048);
    expect(now(hook).chosenUncounted).toBe(0);
    act(() => now(hook).setCoreOnly(false));
    expect({ tokens: now(hook).chosenTokens, bytes: now(hook).chosenBytes }).toEqual(window);
  });

  it('its states: no project, not listed yet, a failed list, no Core file D.O.G. can read', async () => {
    const none = setup([CORE_FILES()[2], CORE_FILES()[5]]);
    expect(now(none.hook).core.state).toBe('listing');
    await act(async () => { await now(none.hook).loadPool(); });
    expect(now(none.hook).core).toEqual({ state: 'none', count: 0, legacy: 0 });
    const failed = setup(CORE_FILES());
    failed.adapter.failFiles = true;
    await act(async () => { await now(failed.hook).loadPool(); });
    expect(now(failed.hook).core.state).toBe('failed');
    const noProject = setup(CORE_FILES());
    noProject.hook.rerender({ ...noProject.props, projectId: '', project: null });
    expect(now(noProject.hook).core.state).toBe('no-project');
    act(() => now(noProject.hook).setCoreOnly(true));
    let out;
    await act(async () => { out = await now(noProject.hook).resolveForGeneration(); });
    expect(out.files).toEqual([]);
    expect(noProject.adapter.listFiles).not.toHaveBeenCalled();
  });

  it('a files list that fails at Generate stops it, as a chosen file\'s does', async () => {
    const { hook, adapter } = setup(CORE_FILES());
    await act(async () => { await now(hook).loadPool(); });
    act(() => now(hook).setCoreOnly(true));
    adapter.failFiles = true;
    let err;
    await act(async () => { await now(hook).resolveForGeneration().catch(e => { err = e; }); });
    expect(err?.code).toBe('DOG_LIST_FAILED');
    expect(err?.lists).toEqual(['files']);
    expect(adapter.downloadFile).not.toHaveBeenCalled();
  });

  it('a legacy project on the Local Server: an older attachment counts as Core unless it was marked otherwise (isCore defaults to true there)', async () => {
    const project = {
      id: P1, title: 'Salt Hours',
      // As the Local Server stored them before C3: data URLs on the record.
      documents: [
        { id: 'd1', name: 'old-brief.txt', type: 'text/plain', content: `data:text/plain;base64,${btoa('OLD BRIEF')}` },
        { id: 'd2', name: 'old-ref.txt', type: 'text/plain', content: `data:text/plain;base64,${btoa('OLD REF')}`, isCore: false },
      ],
    };
    const adapter = { loadProject: vi.fn(async () => ({ files: [], folders: [] })), downloadFile: vi.fn() };
    const hook = renderHook((p) => useReferences(p), { initialProps: { getAdapter: () => adapter, adapterMode: 'local_server', projectId: P1, project } });
    await act(async () => { await now(hook).loadPool(); });
    expect(now(hook).core).toEqual({ state: 'ready', count: 1, legacy: 1 });
    act(() => now(hook).setCoreOnly(true));
    let out;
    await act(async () => { out = await now(hook).resolveForGeneration(); });
    expect(out.files.map(f => f.content)).toEqual(['OLD BRIEF']);
    expect(adapter.downloadFile).not.toHaveBeenCalled();
  });
});
