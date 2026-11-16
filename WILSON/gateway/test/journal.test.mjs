// =============================================================================
// journal.test.mjs — the audit journal (§6, R14) on a real temp folder:
// append at start and end, batches of at most 200, delete on acknowledgement,
// a start with no end becomes incomplete at the next start, a torn line is
// skipped, the file is mode 600 where the platform has modes.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Journal, MAX_BATCH } from '../src/journal/journal.mjs';

let dir;
let file;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-journal-')); file = path.join(dir, 'journal'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const startRow = (id, over = {}) => ({ viewing_id: id, clip: '00000000-0000-4000-8000-000000000004', sub: '00000000-0000-4000-8000-000000000003', started_at: '2026-10-10T09:00:00.000Z', source_address: '203.0.113.7', via: 'direct', user_agent: 'Chrome 142 on Windows', ticket_jti: 'a'.repeat(32), ...over });
const endRow = (id, over = {}) => ({ ...startRow(id), ended_at: '2026-10-10T09:01:00.000Z', bytes: 1000, clip_bytes: 4000, fraction: 0.25, read_in_full: false, range_count: 3, first_offset: 0, last_offset: 999, source_addresses: ['203.0.113.7'], shared_url: false, ...over });

describe('the journal', () => {
  it('a started viewing is not pending; an ended one is, with incomplete false', async () => {
    const j = new Journal({ file });
    await j.open();
    await j.start(startRow('v1'));
    expect(j.pending()).toEqual([]);
    await j.end(endRow('v1'));
    expect(j.pending()).toEqual([{ ...endRow('v1'), incomplete: false }]);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.t)).toEqual(['start', 'end']);
  });

  it('delete on acknowledgement: the acked viewings leave the file, the others stay', async () => {
    const j = new Journal({ file });
    await j.open();
    for (const id of ['v1', 'v2', 'v3']) { await j.start(startRow(id)); await j.end(endRow(id)); }
    await j.start(startRow('v4'));
    expect(await j.ack(['v1', 'v3', 'nope', 'v4'])).toBe(2); // v4 has not ended: not acked
    expect(j.pending().map((r) => r.viewing_id)).toEqual(['v2']);
    const reopened = new Journal({ file });
    await reopened.open();
    expect(reopened.pending().map((r) => r.viewing_id)).toEqual(['v2', 'v4']); // v4 came back incomplete
    expect(fs.readdirSync(dir)).toEqual(['journal']); // no leftover rewrite file
  });

  it('a start with no end, found at the next start, is written incomplete with ended_at null', async () => {
    const j = new Journal({ file });
    await j.open();
    await j.start(startRow('v9'));
    const after = new Journal({ file });
    expect(await after.open()).toEqual({ pending: 1, recovered: 1 });
    expect(after.pending()).toEqual([{ ...startRow('v9'), ended_at: null, incomplete: true }]);
    // and it is not recovered twice
    const again = new Journal({ file });
    expect(await again.open()).toEqual({ pending: 1, recovered: 0 });
  });

  it('a torn last line (a crash mid-append) is skipped, never fatal', async () => {
    fs.writeFileSync(file, JSON.stringify({ t: 'start', id: 'v1', row: startRow('v1') }) + '\n' + JSON.stringify({ t: 'end', id: 'v1', row: endRow('v1') }) + '\n{"t":"end","id":"v2","ro');
    const j = new Journal({ file });
    await j.open();
    expect(j.pending().map((r) => r.viewing_id)).toEqual(['v1']);
  });

  it('a batch is at most 200 rows, oldest first', async () => {
    const j = new Journal({ file });
    await j.open();
    for (let i = 0; i < 250; i++) await j.end(endRow(`v${String(i).padStart(3, '0')}`));
    const batch = j.pending(1000);
    expect(batch).toHaveLength(MAX_BATCH);
    expect(batch[0].viewing_id).toBe('v000');
    await j.ack(batch.map((r) => r.viewing_id));
    expect(j.pending()).toHaveLength(50);
  });

  it('holds no ticket: only the rows it is given, and a row carries the jti, never a ticket', async () => {
    const j = new Journal({ file });
    await j.open();
    await j.end(endRow('v1'));
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/v1\.[A-Za-z0-9_-]{20,}\./);
  });

  it.runIf(process.platform !== 'win32')('the file and its rewrites are mode 600', async () => {
    const j = new Journal({ file });
    await j.open();
    await j.end(endRow('v1'));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    await j.end(endRow('v2'));
    await j.ack(['v1']);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('concurrent writes are serialised: none lost', async () => {
    const j = new Journal({ file });
    await j.open();
    await Promise.all(Array.from({ length: 50 }, (_, i) => j.end(endRow(`c${i}`))));
    await j.flush();
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(50);
    expect(new Set(lines.map((l) => JSON.parse(l).id)).size).toBe(50);
  });
});
