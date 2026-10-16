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
