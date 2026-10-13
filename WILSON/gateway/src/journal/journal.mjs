// =============================================================================
// The audit journal (design §6 "How it reaches the cloud"; review round 2,
// R14). One line is appended at a viewing's start and one at its end; ended
// rows are posted to gateway-events in batches of at most 200 (every minute
// and at every viewing's end) and deleted as the cloud acknowledges them. A
// start with no end, found when the gateway starts, is a viewing the gateway
// did not see finish: it is written as an end with `incomplete: true` and
// `ended_at: null`, so the admin reads "how much is unknown" rather than
// nothing. A torn last line (a crash mid-append) is skipped, never fatal.
//
// It holds no footage and no ticket, but it does hold who viewed what from
// where: the file is created mode 600 (the container's /data) and lives in the
// service's own folder on Windows, whose ACL the installer sets; it is
// rewritten without the acknowledged lines by write-then-rename, so a crash
// leaves either the old file or the new one, never half of each.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

export const MAX_BATCH = 200;
const MODE = 0o600;

export class Journal {
  /**
   * @param {{ file: string, fsp?: typeof fs.promises, platform?: string }} o
   */
  constructor({ file, fsp = fs.promises, platform = process.platform }) {
    this.file = file;
    this.fsp = fsp;
    this.platform = platform;
    this.entries = new Map(); // viewing_id → { start?: row, end?: row }
    this.order = []; // viewing ids in first-seen order
    this.chain = Promise.resolve();
    this.opened = false;
  }

  #serial(fn) {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  async #chmod() {
    if (this.platform !== 'win32') await this.fsp.chmod(this.file, MODE).catch(() => {});
  }

  /** Reads what is on disk; every start without an end becomes an incomplete end, written now. */
  open() {
    return this.#serial(async () => {
      let text = '';
      try {
        text = await this.fsp.readFile(this.file, 'utf8');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; } // a torn line
        if (!rec || typeof rec.id !== 'string' || !rec.row || (rec.t !== 'start' && rec.t !== 'end')) continue;
        this.#remember(rec.t, rec.id, rec.row);
      }
      const dangling = this.order.filter((id) => this.entries.get(id)?.start && !this.entries.get(id)?.end);
      for (const id of dangling) {
        const row = { ...this.entries.get(id).start, ended_at: null, incomplete: true };
        await this.#append('end', id, row);
      }
      if (text) await this.#chmod();
      this.opened = true;
      return { pending: this.pendingCount(), recovered: dangling.length };
    });
  }

  #remember(t, id, row) {
    if (!this.entries.has(id)) { this.entries.set(id, {}); this.order.push(id); }
    this.entries.get(id)[t] = row;
  }

  async #append(t, id, row) {
    const line = JSON.stringify({ t, id, row }) + '\n';
    await this.fsp.appendFile(this.file, line, { mode: MODE });
    this.#remember(t, id, row);
  }

  /** The viewing began: its first byte was served. */
  start(row) {
    return this.#serial(async () => { await this.#append('start', row.viewing_id, row); await this.#chmod(); });
  }

  /** The viewing ended (60 s idle, five minutes of activity, or the gateway stopping). */
  end(row) {
    return this.#serial(() => this.#append('end', row.viewing_id, { ...row, incomplete: row.incomplete === true }));
  }

  pendingCount() {
    let n = 0;
    for (const id of this.order) if (this.entries.get(id)?.end) n++;
    return n;
  }

  /** Up to `limit` ended rows, oldest first. */
  pending(limit = MAX_BATCH) {
    const out = [];
    for (const id of this.order) {
      const e = this.entries.get(id);
      if (e?.end) out.push(e.end);
      if (out.length >= Math.min(limit, MAX_BATCH)) break;
    }
    return out;
  }

  /** Deletes the acknowledged viewings' lines (accepted or rejected for good) by rewriting the file. */
  ack(ids) {
    return this.#serial(async () => {
      const drop = new Set((ids || []).filter((id) => this.entries.get(id)?.end));
      if (drop.size === 0) return 0;
      for (const id of drop) this.entries.delete(id);
      this.order = this.order.filter((id) => !drop.has(id));
      const lines = [];
      for (const id of this.order) {
        const e = this.entries.get(id);
        if (e.start) lines.push(JSON.stringify({ t: 'start', id, row: e.start }));
        if (e.end) lines.push(JSON.stringify({ t: 'end', id, row: e.end }));
      }
      const tmp = path.join(path.dirname(this.file), `.${path.basename(this.file)}.rewrite`);
      await this.fsp.writeFile(tmp, lines.length ? lines.join('\n') + '\n' : '', { mode: MODE });
      if (this.platform !== 'win32') await this.fsp.chmod(tmp, MODE).catch(() => {});
      await this.fsp.rename(tmp, this.file);
      return drop.size;
    });
  }

  /** Waits for every queued write. */
  flush() {
    return this.#serial(async () => {});
  }
}
