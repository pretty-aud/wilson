// =============================================================================
// deck-latency probe — Session 19
//
//   node scripts/probes/deck-latency.mjs --staging
//
// Block E found the real cost of moving to claude-sonnet-5, and it was not
// truncation — D.O.G. already loops on max_tokens. It was wall-clock: one full
// deck call took 150.4s against ai-proxy's own ~150s Edge deadline, and D.O.G.
// makes up to four such calls per deck. A call that overruns that deadline
// loses its stream rather than degrading, so this is a cliff, not a slope.
//
// ai-proxy now forwards `thinking` and `output_config.effort`, which it
// previously dropped, so the call sites can finally ask for less. This probe
// measures which lever actually helps, against the same prompt and the same
// 16384-token budget, in one run so conditions are shared:
//
//   A  no thinking field      — today's behaviour, the 150.4s baseline
//   B  thinking: disabled     — closest to how Sonnet 4 behaved
//   C  adaptive, effort low   — Anthropic's preferred lever over disabling
//   D  adaptive, effort medium
//
// What matters is seconds first, then slides produced. A variant that is fast
// but yields three slides has not helped; the deck still needs the same
// content, just in fewer or quicker continuations.
//
// This runs four full 16k generations. It costs real money and takes several
// minutes. Do not run it casually.
// =============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_FULL_DECK_SYSTEM, DEFAULT_FULL_DECK_OUTPUT_FORMAT, DEFAULT_FULL_DECK_INSTRUCTIONS,
} from '../../src/tools/deck-outline-generator_v0.514/prompts/fullDeckPrompts.js'
import { modelFor } from '../../src/lib/activeModel.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m'
const DIM = '\x1b[90m', BOLD = '\x1b[1m', YELLOW = '\x1b[33m'
const die = (m) => { console.error(`${RED}FAIL${RESET} ${m}`); process.exit(1) }

const ARG_ENV = process.argv.includes('--staging') ? '.env.staging'
  : process.argv.includes('--dev') ? '.env.development' : null

function loadEnv() {
  for (const n of (ARG_ENV ? [ARG_ENV] : ['.env.local', '.env.development'])) {
    const p = join(ROOT, n)
    if (!existsSync(p)) continue
    const out = {}
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
    return { file: n, vars: out }
  }
  return { file: null, vars: {} }
}

const { file: envFile, vars } = loadEnv()
const SUPABASE_URL = process.env.SUPABASE_URL || vars.VITE_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY || vars.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) die('No Supabase URL/anon key. Try --staging.')

function ask(q, { hidden = false } = {}) {
  const stdin = process.stdin
  return new Promise((resolve) => {
    process.stdout.write(q)
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    let buf = ''
    const CR = 13, LF = 10, CTRL_C = 3, CTRL_D = 4, BS = 8, DEL = 127
    const ERASE = String.fromCharCode(BS, 32, BS)
    const finish = (v) => {
      stdin.setRawMode(false); stdin.pause()
      stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(v)
    }
    const onData = (chunk) => {
      for (const ch of chunk) {
        const c = ch.charCodeAt(0)
        if (c === CR || c === LF) return finish(buf.trim())
        if (c === CTRL_C) { process.stdout.write('\n'); process.exit(130) }
        if (c === CTRL_D) return finish(buf.trim())
        if (c === BS || c === DEL) {
          if (buf.length) { buf = buf.slice(0, -1); process.stdout.write(ERASE) }
          continue
        }
        if (c < 32) continue
        buf += ch; process.stdout.write(hidden ? '*' : ch)
      }
    }
    stdin.on('data', onData)
  })
}

let token = null

/** Read a response body whatever its status, so errors are reportable. */
async function res200Text(r) {
  return { status: r.status, body: await r.text() }
}

async function run(extra, label) {
  const started = Date.now()
  const el = () => ((Date.now() - started) / 1000).toFixed(0)
  const body = {
    model: modelFor('dog.fullDeck'),
    max_tokens: 16384,
    system: `${DEFAULT_FULL_DECK_SYSTEM}\n\n${DEFAULT_FULL_DECK_OUTPUT_FORMAT}`,
    messages: [{ role: 'user', content: `${DEFAULT_FULL_DECK_INSTRUCTIONS}\n\n${BRIEF}` }],
    tool: 'dog',
    ...extra,
  }

  let res
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON_KEY,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    })
  } catch (e) {
    return { label, error: e?.name === 'TimeoutError' ? 'timed out at 300s' : e.message }
  }

  if (res.status !== 200) {
    const t = await res.text()
    let msg = t.slice(0, 200)
    try {
      const j = JSON.parse(t)
      msg = j?.anthropic?.error?.message
        || (Array.isArray(j?.errors) ? j.errors.map((e) => `${e.field}: ${e.error}`).join(', ') : '')
        || j?.error || msg
    } catch { /* keep raw */ }
    return { label, error: `${res.status} ${msg}` }
  }

  let raw = '', lastTick = 0
  const dec = new TextDecoder()
  for await (const chunk of res.body) {
    raw += dec.decode(chunk, { stream: true })
    if (Date.now() - lastTick > 1000) {
      lastTick = Date.now()
      process.stdout.write(`${DIM} ..  ${label} — ${el()}s, ${(raw.length / 1024).toFixed(0)}kb     ${RESET}\r`)
    }
  }
  raw += dec.decode()
  process.stdout.write(`${' '.repeat(70)}\r`)

  let text = '', stop = null, out = null, thinking = 0
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let ev
    try { ev = JSON.parse(line.slice(6)) } catch { continue }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') thinking += 1
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text
    if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stop = ev.delta.stop_reason
      if (ev.usage?.output_tokens != null) out = ev.usage.output_tokens
    }
  }
  return {
    label,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    stop, out, thinking,
    slides: (text.match(/^SLIDE #\d+/gm) || []).length,
  }
}

const BRIEF = `PROJECT: "Northlight" — a 6-part documentary series about deep-sea
bioluminescence, aimed at a streaming commissioner.
Budget tier: mid. Delivery: 6 x 45min. Target audience: adults 25-54.
Key talent: Dr. Maren Ostlund (marine biologist), archive from NOAA.
The deck is for a funding pitch and must stand alone without a presenter.`

const VARIANTS = [
  { label: 'A  no thinking field (today)', extra: {} },
  { label: 'B  thinking: disabled', extra: { thinking: { type: 'disabled' } } },
  { label: 'C  adaptive, effort low', extra: { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } } },
  { label: 'D  adaptive, effort medium', extra: { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } } },
]

async function main() {
  const ref = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./) || [])[1] || '?'
  console.log(`${DIM}Project: ${ref}  (from ${envFile || 'env vars'})${RESET}`)
  console.log(`${DIM}Four full 16k deck generations. Several minutes, real money.${RESET}\n`)

  if (process.env.PROBE_ACCESS_TOKEN) {
    token = process.env.PROBE_ACCESS_TOKEN.trim()
  } else {
    const u = process.env.PROBE_USERNAME || await ask('WILSON username: ')
    const p = process.env.PROBE_PASSWORD || await ask('WILSON password: ', { hidden: true })
    if (!u || !p) die('Need a username and password.')
    const r = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ username: u }),
    })
    const rj = await r.json().catch(() => ({}))
    if (!rj.email) die(`resolve-login gave no email: ${JSON.stringify(rj)}`)
    const s = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ email: rj.email, password: p }),
    })
    const sj = await s.json().catch(() => ({}))
    token = sj.access_token
    if (!token) die(`sign-in rejected: ${sj.error_description || sj.msg || s.status}`)
    console.log(`${DIM}signed in as ${rj.email}${RESET}\n`)
  }

  // ── Pre-flight: prove ai-proxy actually forwards the new fields ────────────
  //
  // The deployed function is the thing being trusted here, and four 16k
  // generations is an expensive way to discover a typo in its whitelist. These
  // two small calls settle it for a few hundred tokens.
  //
  // The pair is the point: a request that reliably thinks, and the same request
  // with thinking disabled. If the first thinks and the second does not, the
  // field is arriving. If NEITHER thinks, the check proves nothing — that is a
  // task too small to trigger thinking, not a working switch — so it is treated
  // as inconclusive rather than as success.
  const PRE_TASK = 'Output ONLY a JSON array of 8 objects, each '
    + '{"name":string,"summary":string} about the planets. No prose.'
  const preflight = async (extra) => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON_KEY,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: modelFor('dog.fullDeck'),
        max_tokens: 1024,
        messages: [{ role: 'user', content: PRE_TASK }],
        tool: 'probe',
        ...extra,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    const raw = await res200Text(r)
    if (raw.status !== 200) return { error: `${raw.status} ${raw.body.slice(0, 160)}` }
    return { thinking: (raw.body.match(/"type":"thinking"/g) || []).length }
  }

  process.stdout.write(`${DIM} ..  pre-flight${RESET}\r`)
  const on = await preflight({})
  const off = await preflight({ thinking: { type: 'disabled' } })
  const eff = await preflight({ thinking: { type: 'adaptive' }, output_config: { effort: 'low' } })
  process.stdout.write(`${' '.repeat(40)}\r`)

  for (const [name, r] of [['default', on], ['disabled', off], ['effort low', eff]]) {
    if (r.error) die(`pre-flight (${name}) failed: ${r.error}\n`
      + 'ai-proxy rejected the request. Not spending four deck generations on that.')
  }
  if (on.thinking === 0) {
    console.log(`${YELLOW}Pre-flight inconclusive:${RESET} the control request did not think either,`)
    console.log('so "thinking=0 when disabled" proves nothing. Continuing, but treat any')
    console.log('improvement below as unexplained rather than caused by the switch.\n')
  } else if (off.thinking > 0) {
    die(`pre-flight: thinking still occurred (${off.thinking} block(s)) with `
      + 'thinking:{type:"disabled"}.\nai-proxy is not forwarding the field — redeploy it '
      + 'before spending four deck generations.')
  } else {
    console.log(`${GREEN}Pre-flight OK${RESET} ${DIM}— control thought (${on.thinking}), `
      + `disabled did not (0). ai-proxy is forwarding \`thinking\`; effort accepted.${RESET}\n`)
  }

  const results = []
  for (const v of VARIANTS) {
    const r = await run(v.extra, v.label)
    results.push(r)
    if (r.error) {
      console.log(`${RED} ERR  ${RESET} ${v.label.padEnd(30)} ${r.error}`)
      continue
    }
    const risky = r.seconds > 120
    const secs = `${risky ? YELLOW : GREEN}${String(r.seconds).padStart(6)}s${RESET}`
    console.log(` ${secs}  ${v.label.padEnd(30)} stop=${String(r.stop).padEnd(11)}`
      + ` out=${String(r.out).padEnd(6)} thinking=${r.thinking}  ${r.slides} slides`)
  }

  // ── Readout ────────────────────────────────────────────────────────────────
  const ok = results.filter((r) => !r.error)
  if (ok.length < 2) { console.log('\nNot enough results to compare.'); return }

  const base = ok.find((r) => r.label.startsWith('A'))
  console.log(`\n${BOLD}Against ai-proxy's ~150s Edge deadline${RESET}`)
  for (const r of ok) {
    const delta = base && r !== base
      ? ` (${r.seconds < base.seconds ? '' : '+'}${(r.seconds - base.seconds).toFixed(1)}s vs A)` : ''
    const verdict = r.seconds > 140 ? `${RED}at the cliff${RESET}`
      : r.seconds > 120 ? `${YELLOW}close${RESET}`
      : `${GREEN}clear${RESET}`
    console.log(`  ${r.label.padEnd(30)} ${String(r.seconds).padStart(6)}s  ${verdict}`
      + `${DIM}${delta}, ${r.slides} slides${RESET}`)
  }

  const safe = ok.filter((r) => r.seconds <= 120 && r.slides >= 8)
    .sort((a, b) => b.slides - a.slides || a.seconds - b.seconds)
  console.log('')
  if (safe.length) {
    console.log(`${GREEN}Recommend: ${safe[0].label.trim()}${RESET} — clears the deadline with`)
    console.log(`${safe[0].slides} slides in ${safe[0].seconds}s.`)
    console.log(`${DIM}Slides matter as much as seconds: a variant that is fast because it`)
    console.log(`gave up early has not helped — the deck still needs the same content,`)
    console.log(`just in fewer continuations.${RESET}`)
  } else {
    console.log(`${YELLOW}No variant both clears 120s and produces 8+ slides.${RESET}`)
    console.log('The deck may simply be too big for one call on this model. The next')
    console.log('lever is lowering max_tokens per call and leaning on the continuation')
    console.log('loop — more calls, each safely under the deadline.')
  }
}

main().catch((e) => die(e?.stack || String(e)))
