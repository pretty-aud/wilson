// electron/authCheck.cjs — MO1 (MOTH PS-7): who a bearer token really belongs to, asked of the auth server.
//
// The main process does not otherwise know the auth server: the renderer's URL and anon key are compile-time
// constants (env.cjs). So the build writes them, both public and both already in the renderer's bundle, to
// dist/auth-public.json (vite.config.js), which sits read-only in the packaged app; a dev run reads
// .env.development's. A value from the page would not do: script on the page could name its own server.
//
// Answers { userId } (null for a token the server refuses) or { unreachable: true }. A good answer is kept a
// minute under the token's hash, so a batch of adds does not ask once per file.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KEEP_MS = 60000;
const WAIT_MS = 8000;

function readAuthPublic({ distDir, env = process.env, fsImpl = fs } = {}) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(path.join(distDir, 'auth-public.json'), 'utf8'));
    if (parsed.url && parsed.anonKey) return { url: parsed.url, anonKey: parsed.anonKey };
  } catch { /* a dev run has no build */ }
  return env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
    ? { url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY }
    : null;
}

function makeVerifyBearer({ getAuthPublic, fetchImpl = fetch, now = () => Date.now() }) {
  const known = new Map();
  return async function verifyBearer(header) {
    const token = /^Bearer ([^\s]+)$/.exec(String(header ?? ''))?.[1];
    if (!token) return { userId: null };
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const kept = known.get(key);
    if (kept && now() - kept.at < KEEP_MS) return { userId: kept.userId };
    const pub = getAuthPublic();
    if (!pub) return { unreachable: true };
    let answer;
    try {
      answer = await fetchImpl(`${pub.url.replace(/\/+$/, '')}/auth/v1/user`, {
        headers: { apikey: pub.anonKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(WAIT_MS),
      });
    } catch {
      return { unreachable: true };
    }
    if (answer.status === 401 || answer.status === 403) return { userId: null };
    if (!answer.ok) return { unreachable: true };
    const userId = (await answer.json().catch(() => null))?.id ?? null;
    if (userId) {
      if (known.size > 16) known.clear();
      known.set(key, { userId, at: now() });
    }
    return { userId };
  };
}

module.exports = { readAuthPublic, makeVerifyBearer };
