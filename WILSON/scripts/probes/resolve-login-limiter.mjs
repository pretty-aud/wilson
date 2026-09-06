// =============================================================================
// resolve-login limiter probe — Track B, bundle B1 (2026-09-06)
//
// Exercises the deployed resolve-login Edge Function end to end and prints
// ONLY statuses, booleans and millisecond timings — never the project URL,
// the anon key, or any resolved email. Safe to paste into a hand-off.
//
// What it checks, in order:
//   1. the company path answers contract v2 for a real, a nonsense and an
//      empty company;
//   2. known vs unknown username take the same time (the constant-time
//      floor) and the smoke-probe shape (username, no slug) still resolves;
//   3. GoTrue's own timing for a real email + wrong password vs a fake email
//      (recorded, not asserted — it is Supabase's behaviour);
//   4. with `burst`: 22 company checks from this address — the 21st must be
//      429 (RESOLVE_LOGIN_COMPANY_RPM defaults to 20) and the user bucket
//      must still answer 200 afterwards. That is the FAILING CONTROL: on the
//      first B1 deploy every request landed in a different limiter row and
//      this printed "LIMITER DID NOT FIRE".
//
// Usage (from WILSON/):
//   node scripts/probes/resolve-login-limiter.mjs .env.local          # dev
//   node scripts/probes/resolve-login-limiter.mjs .env.local burst    # + limiter
// The env file must hold VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the
// project under test. For staging, point it at a file holding staging's pair
// (never commit one). PROBE_WORKSPACE / PROBE_USERNAME default to the smoke
// fixture (`smoke` / `smoke_admin`), which exists on wilson-dev only.
//
// ⚠️ `burst` spends this address's company bucket for the rest of the minute.
// =============================================================================
import { readFileSync } from 'node:fs'

const envPath = process.argv[2]
const doBurst = process.argv[3] === 'burst'
if (!envPath) { console.error('usage: node resolve-login-limiter.mjs <env-file> [burst]'); process.exit(2) }

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const URL = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
if (!URL || !ANON) { console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(2) }

const WORKSPACE = process.env.PROBE_WORKSPACE || 'smoke'
const USER = process.env.PROBE_USERNAME || 'smoke_admin'

async function resolve(body) {
  const t0 = performance.now()
  const res = await fetch(`${URL}/functions/v1/resolve-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON },
    body: JSON.stringify(body),
  })
  const ms = Math.round(performance.now() - t0)
  let json = null
  try { json = await res.json() } catch { json = null }
  return {
    status: res.status, ms,
    exists: json?.exists ?? null, v: json?.v ?? null,
    hasSlug: typeof json?.slug === 'string',
    hasEmail: typeof json?.email === 'string' && json.email.length > 0,
    email: json?.email ?? null,
  }
}

async function gotrue(email, password) {
  const t0 = performance.now()
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }),
  })
  return { status: res.status, ms: Math.round(performance.now() - t0) }
}

// Never let the resolved email reach stdout.
const strip = ({ email, ...rest }) => rest

console.log('--- company path ---')
console.log('real workspace           ', strip(await resolve({ company: WORKSPACE })))
console.log('nonsense company         ', strip(await resolve({ company: `zz-no-such-${Date.now()}` })))
console.log('empty company            ', strip(await resolve({ company: '' })))

console.log('--- username path (timing: known vs unknown, 3 each) ---')
const known = [], unknown = []
let resolvedEmail = null
for (let i = 0; i < 3; i++) {
  const k = await resolve({ username: USER, workspace_slug: WORKSPACE })
  if (k.email) resolvedEmail = k.email
  known.push(strip(k))
  unknown.push(strip(await resolve({ username: `nobody_${Date.now()}_${i}`, workspace_slug: WORKSPACE })))
}
console.log('known   ', known.map((r) => `${r.status}/${r.exists}/${r.ms}ms`).join('  '))
console.log('unknown ', unknown.map((r) => `${r.status}/${r.exists}/${r.ms}ms`).join('  '))
console.log('no-slug (smoke probe shape)', strip(await resolve({ username: USER })))
console.log('malformed body            ', strip(await resolve('not json')))

console.log('--- GoTrue timing: real email + wrong password vs fake email (3 each) ---')
if (resolvedEmail) {
  const real = [], fake = []
  for (let i = 0; i < 3; i++) {
    real.push(await gotrue(resolvedEmail, `wrong-password-${Date.now()}`))
    fake.push(await gotrue(`__miss+${crypto.randomUUID()}@invalid.local`, `wrong-password-${Date.now()}`))
  }
  console.log('real/wrong-pw ', real.map((r) => `${r.status}/${r.ms}ms`).join('  '))
  console.log('fake-email    ', fake.map((r) => `${r.status}/${r.ms}ms`).join('  '))
} else {
  console.log('(username did not resolve — check PROBE_WORKSPACE / PROBE_USERNAME for this project)')
}

if (doBurst) {
  console.log('--- burst: 22 company checks from this address; expect 429 from the 21st ---')
  const statuses = []
  for (let i = 0; i < 22; i++) statuses.push((await resolve({ company: `burst-${i}` })).status)
  console.log(statuses.join(' '))
  const first429 = statuses.indexOf(429)
  console.log(first429 === -1 ? 'LIMITER DID NOT FIRE' : `first 429 at request #${first429 + 1}`)
  const after = await resolve({ username: `nobody_${Date.now()}`, workspace_slug: WORKSPACE })
  console.log('user bucket still open after the company burst:', after.status === 200 ? 'yes (200)' : `NO (${after.status})`)
  if (first429 === -1 || after.status !== 200) process.exit(1)
}
