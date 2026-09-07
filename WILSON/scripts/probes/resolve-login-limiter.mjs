// =============================================================================
// resolve-login limiter probe — Track B, bundle B1 (2026-09-06)
//
// Exercises the deployed resolve-login Edge Function end to end and prints
// ONLY statuses, booleans and millisecond timings — never the project URL,
// the anon key, or any resolved email. Safe to paste into a hand-off.
//
// What it checks, in order:
//   1. the company path answers contract v2 for a real, a nonsense and an
//      empty company — and refuses the real one's DISPLAY NAME minus its last
//      character plus `*` (`Smoke Workspac*`), and a three-letter prefix plus
//      `*`. That is a second FAILING CONTROL (B1 review rounds R1 + R2):
//      PostgREST reads `*` in an ilike pattern as `%`, and on dev v8 `smo*`
//      printed exists:true with the real slug. The name-minus-one form is the
//      one that matters — it still matches at the database and only the
//      resolver's equality re-check turns it into a miss. The control is
//      INERT unless the real workspace resolved (the fixture is dev-only) and
//      "not run" on a 429 — never a pass by default;
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
const real = strip(await resolve({ company: WORKSPACE }))
console.log('real workspace           ', real)
console.log('nonsense company         ', strip(await resolve({ company: `zz-no-such-${Date.now()}` })))
console.log('empty company            ', strip(await resolve({ company: '' })))
// A star is not a search — two forms, and the SECOND is the one that matters:
//   prefix + `*`          `smo*` → pattern `smo_`: four characters, matches
//                         nothing fifteen long, never reaches the re-check;
//   name minus one + `*`  `Smoke Workspac*` → `Smoke Workspac_`: ILIKE matches
//                         the row, and only the equality re-check makes it a
//                         miss. Delete that re-check and THIS line goes red.
// PROBE_WORKSPACE_NAME is the fixture's display name (dev: "Smoke Workspace").
const NAME = process.env.PROBE_WORKSPACE_NAME || 'Smoke Workspace'
const w1 = strip(await resolve({ company: `${WORKSPACE.slice(0, 3)}*` }))
const w2 = strip(await resolve({ company: `${NAME.slice(0, -1)}*` }))
console.log('prefix + * (must miss)   ', w1)
console.log('name-1 + * (must miss)   ', w2)
if (!real.exists) {
  console.log('(wildcard control INERT: the real workspace did not resolve on this project — set PROBE_WORKSPACE / PROBE_WORKSPACE_NAME)')
} else if (w1.status !== 200 || w2.status !== 200) {
  console.log('(wildcard control NOT RUN: throttled — wait a minute and re-run without `burst`)')
} else if (w1.exists || w2.exists) {
  console.log('WILDCARD MATCHED — `*` is acting as a search at the company step; do not ship this build')
  process.exit(1)
} else {
  console.log('wildcard control passed: both forms answered 200 / exists:false')
}

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
