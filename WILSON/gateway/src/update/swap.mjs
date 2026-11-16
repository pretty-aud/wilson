// =============================================================================
// The updater's swap (design §8; review round 2, R7; §10 row 24). Pure over an
// injected environment, so the whole state machine is proven over a fake file
// system (swap.test.mjs) and nothing here ever runs against this computer's
// Program Files in a test.
//
// The updater service (LocalSystem) takes one authenticated message from the
// gateway (pipe.mjs) naming ONE artefact file in the gateway's download folder
// (C:\ProgramData\WILSON Gateway\updates), with the signed manifest. Then:
//
//   1  copy the artefact into C:\Program Files\WILSON Gateway (writable by
//      Administrators and SYSTEM only) and read that copy back;
//   2  verify the manifest's signature with the compiled-in release keys and
//      the artefact's SHA-256 ON THAT COPY, immediately before the swap (the
//      gap between the gateway's own check at download and this one is where a
//      planted file would go; nothing else in the download folder is read);
//   3  extract the verified bytes (from memory) into staged\;
//   4  swap.json, stop the gateway service;
//   5  swap.json, current → previous (the old previous deleted: one kept);
//   6  swap.json, staged → current;
//   7  swap.json, start the service, wait up to 90 s for the healthy marker
//      naming the new version (the new version writes it after reading its
//      config, binding the inside door and completing one sync);
//   8  healthy: done. Otherwise stop, current → failed, previous → current,
//      start, write update-failed.json (reported at the next sync).
//
// At the updater's own start, an unfinished swap is completed or reverted
// before the gateway service runs (recoverSwap). `rollback` swaps current and
// previous by the same journal of steps.
//
// The healthy marker lives in ProgramData, not in current\: the gateway's
// virtual service account cannot write under Program Files (dated line in the
// design's review history, 2026-10-10).
// =============================================================================

import path from 'node:path';

const ARTEFACT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function swapPaths(programDir, stateDir) {
  const p = path.win32;
  return {
    program: programDir,
    current: p.join(programDir, 'current'),
    previous: p.join(programDir, 'previous'),
    staged: p.join(programDir, 'staged'),
    failed: p.join(programDir, 'failed'),
    rollbackTmp: p.join(programDir, 'rollback-tmp'),
    stagedArchive: p.join(programDir, 'staged.archive'),
    swapJson: p.join(programDir, 'swap.json'),
    lastManifest: p.join(programDir, 'last-manifest.json'),
    updateFailed: p.join(stateDir, 'update-failed.json'),
    downloads: p.join(stateDir, 'updates'),
    healthy: p.join(stateDir, 'healthy'),
  };
}

async function exists(fsp, p) {
  try { await fsp.stat(p); return true; } catch { return false; }
}
async function readJson(fsp, p) {
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; }
}
const writeJson = (fsp, p, v) => fsp.writeFile(p, JSON.stringify(v, null, 2));

async function waitHealthy(env, paths, version, sinceMs, { healthWaitMs, pollMs }) {
  const deadline = env.now() + healthWaitMs;
  while (env.now() <= deadline) {
    const h = await readJson(env.fsp, paths.healthy);
    if (h && h.version === version && Date.parse(h.at) >= sinceMs) return true;
    await env.sleep(pollMs);
  }
  return false;
}

async function journal(env, paths, step, extra) {
  await writeJson(env.fsp, paths.swapJson, { step, at: new Date(env.now()).toISOString(), ...extra });
}

async function revert(env, paths, { version, reason, running }) {
  await journal(env, paths, 'reverting', { version, reason, running });
  await env.service.stop().catch(() => {});
  if (await exists(env.fsp, paths.previous)) {
    await env.fsp.rm(paths.failed, { recursive: true, force: true });
    if (await exists(env.fsp, paths.current)) await env.fsp.rename(paths.current, paths.failed);
    await env.fsp.rename(paths.previous, paths.current);
  }
  await env.service.start().catch(() => {});
  await writeJson(env.fsp, paths.updateFailed, { version, reason, running: running ?? null, at: new Date(env.now()).toISOString() });
  await env.fsp.rm(paths.swapJson, { force: true });
  return { ok: false, reverted: true, reason };
}

async function finish(env, paths, { version, publishedAt }) {
  if (publishedAt) await writeJson(env.fsp, paths.lastManifest, { version, published_at: publishedAt });
  await env.fsp.rm(paths.stagedArchive, { force: true });
  await env.fsp.rm(paths.swapJson, { force: true });
  await env.fsp.rm(paths.updateFailed, { force: true });
  return { ok: true, version };
}

/**
 * @param env { fsp, service: { stop, start }, verify({ manifestBytes, signatureText, archiveBytes, runningVersion, lastPublishedAt }) → { ok, version, publishedAt, reason }, extract(bytes, dir), runningVersion(), now(), sleep(ms) }
 * @param request { artefact, manifest (base64 of stable.json), signature }
 */
export async function runSwap(env, paths, request, { healthWaitMs = 90_000, pollMs = 1_000 } = {}) {
  const r = request || {};
  if (typeof r.artefact !== 'string' || !ARTEFACT_NAME_RE.test(r.artefact) || r.artefact.includes('..')) return { ok: false, reason: 'bad_request' };
  if (typeof r.manifest !== 'string' || typeof r.signature !== 'string') return { ok: false, reason: 'bad_request' };
  if (await exists(env.fsp, paths.swapJson)) return { ok: false, reason: 'swap_in_progress' };

  const running = await env.runningVersion();
  let bytes;
  try { bytes = await env.fsp.readFile(path.win32.join(paths.downloads, r.artefact)); } catch { return { ok: false, reason: 'artefact_missing' }; }
  // 1: our own copy, in the admin-only folder, read back.
  await env.fsp.writeFile(paths.stagedArchive, bytes);
  const copy = await env.fsp.readFile(paths.stagedArchive);
  // 2: verified on that copy.
  const lastPublishedAt = (await readJson(env.fsp, paths.lastManifest))?.published_at ?? null;
  const v = await env.verify({ manifestBytes: Buffer.from(r.manifest, 'base64'), signatureText: r.signature, archiveBytes: copy, runningVersion: running, lastPublishedAt });
  if (!v || !v.ok) {
    await env.fsp.rm(paths.stagedArchive, { force: true });
    await writeJson(env.fsp, paths.updateFailed, { version: v?.version ?? null, reason: `verification failed (${v?.reason || 'unknown'})`, running, at: new Date(env.now()).toISOString() });
    return { ok: false, reason: 'verification', detail: v?.reason };
  }
  // 3: the verified bytes, from memory, into a fresh staged\.
  await env.fsp.rm(paths.staged, { recursive: true, force: true });
  await env.fsp.mkdir(paths.staged, { recursive: true });
  try {
    await env.extract(copy, paths.staged);
  } catch (e) {
    await env.fsp.rm(paths.staged, { recursive: true, force: true });
    await env.fsp.rm(paths.stagedArchive, { force: true });
    await writeJson(env.fsp, paths.updateFailed, { version: v.version, reason: `the archive could not be unpacked (${e.message})`, running, at: new Date(env.now()).toISOString() });
    return { ok: false, reason: 'extract' };
  }
  const meta = { version: v.version, publishedAt: v.publishedAt, running };
  // 4–6: the swap, journalled before each step.
  await journal(env, paths, 'stopping', meta);
  await env.service.stop();
  await journal(env, paths, 'renaming_current', meta);
  await env.fsp.rm(paths.previous, { recursive: true, force: true });
  if (await exists(env.fsp, paths.current)) await env.fsp.rename(paths.current, paths.previous);
  await journal(env, paths, 'renaming_staged', meta);
  await env.fsp.rename(paths.staged, paths.current);
  // 7: start and wait.
  await journal(env, paths, 'starting', meta);
  await env.fsp.rm(paths.healthy, { force: true });
  const since = env.now();
  await env.service.start().catch(() => {});
  if (await waitHealthy(env, paths, v.version, since, { healthWaitMs, pollMs })) return finish(env, paths, meta);
  return revert(env, paths, { version: v.version, reason: 'the new version did not report healthy within 90 s', running });
}

/** At the updater's own start: complete or revert an unfinished swap (or rollback). */
export async function recoverSwap(env, paths, { healthWaitMs = 90_000, pollMs = 1_000 } = {}) {
  const s = await readJson(env.fsp, paths.swapJson);
  if (!s) return { action: 'none' };
  const meta = { version: s.version, publishedAt: s.publishedAt, running: s.running };
  const hasCurrent = await exists(env.fsp, paths.current);
  const hasPrevious = await exists(env.fsp, paths.previous);
  const hasStaged = await exists(env.fsp, paths.staged);
  switch (s.step) {
    case 'stopping':
      await env.service.start().catch(() => {});
      await env.fsp.rm(paths.swapJson, { force: true });
      return { action: 'reverted', step: s.step };
    case 'renaming_current':
    case 'renaming_staged': {
      if (s.step === 'renaming_staged' && hasCurrent && !hasStaged) break; // both renames happened: as 'starting'
      if (!hasCurrent && hasPrevious) await env.fsp.rename(paths.previous, paths.current);
      await env.service.start().catch(() => {});
      await env.fsp.rm(paths.swapJson, { force: true });
      return { action: 'reverted', step: s.step };
    }
    case 'starting':
      break;
    case 'reverting':
      return { action: 'reverted', step: s.step, ...(await revert(env, paths, { version: s.version, reason: s.reason || 'the updater stopped while reverting', running: s.running })) };
    case 'rollback_1':
    case 'rollback_2':
    case 'rollback_3':
      return { action: 'rolled_back', step: s.step, ...(await finishRollback(env, paths, s.step)) };
    default:
      await env.fsp.rm(paths.swapJson, { force: true });
      return { action: 'none', step: s.step };
  }
  // 'starting', or 'renaming_staged' found complete: the new version gets its 90 s.
  await journal(env, paths, 'starting', meta);
  await env.fsp.rm(paths.healthy, { force: true });
  const since = env.now();
  await env.service.start().catch(() => {});
  if (await waitHealthy(env, paths, s.version, since, { healthWaitMs, pollMs })) return { action: 'completed', step: s.step, ...(await finish(env, paths, meta)) };
  return { action: 'reverted', step: s.step, ...(await revert(env, paths, { version: s.version, reason: 'the new version did not report healthy within 90 s', running: s.running })) };
}

async function finishRollback(env, paths, from) {
  const order = ['rollback_1', 'rollback_2', 'rollback_3'];
  const at = order.indexOf(from);
  // rollback_1: current → rollback-tmp; rollback_2: previous → current; rollback_3: rollback-tmp → previous.
  if (at <= 0 && (await exists(env.fsp, paths.current)) && !(await exists(env.fsp, paths.rollbackTmp))) {
    await journal(env, paths, 'rollback_1', {});
    await env.fsp.rename(paths.current, paths.rollbackTmp);
  }
  if (at <= 1 && !(await exists(env.fsp, paths.current)) && (await exists(env.fsp, paths.previous))) {
    await journal(env, paths, 'rollback_2', {});
    await env.fsp.rename(paths.previous, paths.current);
  }
  if (at <= 2 && (await exists(env.fsp, paths.rollbackTmp)) && !(await exists(env.fsp, paths.previous))) {
    await journal(env, paths, 'rollback_3', {});
    await env.fsp.rename(paths.rollbackTmp, paths.previous);
  }
  await env.service.start().catch(() => {});
  await env.fsp.rm(paths.swapJson, { force: true });
  return { ok: true };
}

/** `wilson-gateway rollback`: the previous version back in place, and the current one kept as previous. */
export async function runRollback(env, paths) {
  if (await exists(env.fsp, paths.swapJson)) return { ok: false, reason: 'swap_in_progress' };
  if (!(await exists(env.fsp, paths.previous))) return { ok: false, reason: 'no_previous_version' };
  await env.service.stop();
  await env.fsp.rm(paths.rollbackTmp, { recursive: true, force: true });
  await journal(env, paths, 'rollback_1', {});
  return finishRollback(env, paths, 'rollback_1');
}
