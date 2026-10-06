// =============================================================================
// generation-e2e probe — Session 19, Block E
//
//   node scripts/probes/generation-e2e.mjs --staging
//
// Runs one full-size generation per tool through the real ai-proxy, using
// WILSON's OWN system prompts (imported, not retyped) at WILSON's OWN
// max_tokens, and checks each result the way WILSON checks it.
//
// -----------------------------------------------------------------------------
// THE QUESTION THIS EXISTS TO ANSWER
// -----------------------------------------------------------------------------
// `ai-models.mjs` proved the outage and proved `claude-sonnet-5` reachable, but
// it left one thing open and could not close it: sonnet-5 thinks even when not
// asked (`thinking=1`), and thinking spends from the same `max_tokens` budget
// as the answer. Its case 7b was meant to be the control and was not — ai-proxy
// whitelists the upstream body to model/max_tokens/messages/stream/system/tools
// and drops `thinking` silently, so 7a and 7b sent identical requests.
//
// The small task there finished well inside 1024 tokens, which says nothing
// about a 16k-token deck. WILSON does not merely display these responses, it
// PARSES them: D.O.G. reads a SLIDE #n format, O.T.T.E.R. and R.A.B.B.I.T.
// read JSON. A reply truncated by thinking is not a shorter answer, it is an
// unparseable one — the outage would appear to be fixed and the tools would
// still fail, with a new and less obvious error.
//
// So the readings that matter are `stop_reason` (end_turn vs max_tokens) and
// whether the output actually parses. Everything else is decoration.
//
// This costs real tokens — four full-size generations, a few cents. That is
// the price of not guessing.
// =============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// WILSON's real prompts. Imported rather than copied so this cannot drift into
// testing a prompt the app no longer uses.
import {
  DEFAULT_FULL_DECK_SYSTEM, DEFAULT_FULL_DECK_OUTPUT_FORMAT, DEFAULT_FULL_DECK_INSTRUCTIONS,
} from '../../src/tools/deck-outline-generator_v0.514/prompts/fullDeckPrompts.js'
import { FULL_COURSE_OUTLINE_PROMPT } from '../../src/tools/otter_v0.3.1/prompts.js'
// The same resolver the 28 call sites use. Importing it means this probe tests
// whatever the registry currently says, so it cannot drift from the app, and a
// wrong key here fails exactly as it would in production.
import { modelFor, tuningFor } from '../../src/lib/activeModel.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m'
const DIM = '\x1b[90m', BOLD = '\x1b[1m', YELLOW = '\x1b[33m'
const die = (m) => { console.error(`${RED}FAIL${RESET} ${m}`); process.exit(1) }

// ── Config (same selection rules as ai-models.mjs) ───────────────────────────

const ARG_ENV = process.argv.includes('--staging') ? '.env.staging'
  : process.argv.includes('--dev') ? '.env.development'
  : null

function loadEnvFile() {
  for (const name of (ARG_ENV ? [ARG_ENV] : ['.env.local', '.env.development'])) {
    const p = join(ROOT, name)
    if (!existsSync(p)) continue
    const out = {}
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
    return { file: name, vars: out }
  }
  return { file: null, vars: {} }
}

const { file: envFile, vars: envVars } = loadEnvFile()
const SUPABASE_URL = process.env.SUPABASE_URL || envVars.VITE_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY || envVars.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) die('No Supabase URL/anon key. Try --staging.')
if ([...ANON_KEY].some((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 33)) {
  die('The anon key contains non-ASCII characters — it was mangled by a paste. '
    + 'Open a new terminal and use --staging.')
}

// ── Terminal input (raw stdin; see ai-models.mjs for why not readline) ───────

function ask(question, { hidden = false } = {}) {
  const stdin = process.stdin
  return new Promise((resolve) => {
    process.stdout.write(question)
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    let buf = ''
    const CR = 13, LF = 10, CTRL_C = 3, CTRL_D = 4, BACKSPACE = 8, DEL = 127
    const ERASE = String.fromCharCode(BACKSPACE, 32, BACKSPACE)
    const finish = (v) => {
      stdin.setRawMode(false); stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n'); resolve(v)
    }
    const onData = (chunk) => {
      for (const ch of chunk) {
        const c = ch.charCodeAt(0)
        if (c === CR || c === LF) return finish(buf.trim())
        if (c === CTRL_C) { process.stdout.write('\n'); process.exit(130) }
        if (c === CTRL_D) return finish(buf.trim())
        if (c === BACKSPACE || c === DEL) {
          if (buf.length) { buf = buf.slice(0, -1); process.stdout.write(ERASE) }
          continue
        }
        if (c < 32) continue
        buf += ch
        process.stdout.write(hidden ? '*' : ch)
      }
    }
    stdin.on('data', onData)
  })
}

// ── ai-proxy ─────────────────────────────────────────────────────────────────

let token = null

// Hard ceiling per generation. `fetch` has no default timeout, so without this
// a stalled connection hangs the probe forever with no way to tell that from a
// slow deck. 240s is above ai-proxy's own ~150s Edge deadline on purpose: if
// the Edge function gives up first, that is itself the finding.
const TIMEOUT_MS = 240_000

/** Reassemble the SSE stream the way src/cloud/anthropicStream.js does. */
async function generate(body, label = '') {
  const started = Date.now()
  const elapsed = () => ((Date.now() - started) / 1000).toFixed(0)

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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const why = err?.name === 'TimeoutError'
      ? `no response in ${TIMEOUT_MS / 1000}s`
      : (err?.message || String(err))
    return { ok: false, status: 0, type: 'timeout', message: why, seconds: elapsed() }
  }

  // Read the stream as it arrives and show it moving. A 16k-token generation
  // with thinking on runs for minutes; a probe that prints nothing until it
  // finishes is indistinguishable from one that has hung, which is how the
  // first Block E run looked.
  let raw = ''
  if (res.status === 200 && res.body) {
    const decoder = new TextDecoder()
    let lastTick = 0
    for await (const chunk of res.body) {
      raw += decoder.decode(chunk, { stream: true })
      const now = Date.now()
      if (now - lastTick > 1000) {
        lastTick = now
        const thinkingNow = raw.includes('"type":"thinking"')
        process.stdout.write(
          `${DIM} ..  ${label} — ${elapsed()}s, ${(raw.length / 1024).toFixed(0)}kb`
          + `${thinkingNow ? ', thinking' : ''}          ${RESET}\r`,
        )
      }
    }
    raw += decoder.decode()
  } else {
    raw = await res.text()
  }
  process.stdout.write(`${' '.repeat(72)}\r`)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  if (res.status !== 200) {
    let type = '?', message = ''
    try {
      const j = JSON.parse(raw)
      type = j?.anthropic?.error?.type || j?.error || '?'
      message = j?.anthropic?.error?.message || ''
      // ai-proxy's own validator says exactly which field it rejected. Not
      // reading it cost a run: four cases failed `validation_failed` and the
      // answer "field: model, required" was in the response the whole time.
      if (Array.isArray(j?.errors) && j.errors.length) {
        message = j.errors.map((e) => `${e.field}: ${e.error}`).join(', ')
      }
    } catch { message = raw.slice(0, 300) }
    return { ok: false, status: res.status, type, message, seconds }
  }

  let text = ''
  let stop = null, outTokens = null, thinking = 0
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let ev
    try { ev = JSON.parse(line.slice(6)) } catch { continue }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') thinking += 1
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text
    if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stop = ev.delta.stop_reason
      if (ev.usage?.output_tokens != null) outTokens = ev.usage.output_tokens
    }
  }
  return { ok: true, status: 200, text, stop, outTokens, thinking, seconds }
}

// ── Cases: WILSON's real shapes ──────────────────────────────────────────────

const BRIEF = `PROJECT: "Northlight" — a 6-part documentary series about deep-sea
bioluminescence, aimed at a streaming commissioner.
Budget tier: mid. Delivery: 6 x 45min. Target audience: adults 25-54.
Key talent: Dr. Maren Ostlund (marine biologist), archive from NOAA.
The deck is for a funding pitch and must stand alone without a presenter.`

const SCRIPT_CHUNK = `INT. RESEARCH VESSEL - WET LAB - NIGHT

Banks of monitors glow. MAREN (40s) hunches over a tank where a
siphonophore pulses cold blue light.

MAREN
Three hundred metres and it still knows we're here.

She taps the glass. The creature retracts.

EXT. OPEN OCEAN - CONTINUOUS

The submersible ALVIN-II breaks the surface in heavy swell. A crane
swings out. Deck crew in survival suits fight the line.

CREW CHIEF (O.S.)
Winch is fouled! Hold her off!

INT. SUBMERSIBLE - CONTINUOUS

Cramped. Condensation. PILOT DESSA (30s) works the thrusters while
Maren films through the port with a low-light rig.`

const CASES = [
  {
    name: 'D.O.G. full deck',
    key: 'dog.fullDeck',
    // generateFullDeck wraps this call in a loop that retries on max_tokens up
    // to 3 times, appending the partial output plus a "continue" USER turn.
    // Truncation here is the design, not a fault.
    continues: true,
    body: {
      max_tokens: 16384,
      system: `${DEFAULT_FULL_DECK_SYSTEM}\n\n${DEFAULT_FULL_DECK_OUTPUT_FORMAT}`,
      messages: [{ role: 'user', content: `${DEFAULT_FULL_DECK_INSTRUCTIONS}\n\n${BRIEF}` }],
      tool: 'dog',
    },
    // WILSON's parser reads a "SLIDE #n" format; anything else is a failed deck.
    check: (t) => {
      if (!/^\s*SLIDE #1/.test(t)) return { ok: false, why: 'output does not start with "SLIDE #1"' }
      const slides = (t.match(/^SLIDE #\d+/gm) || []).length
      if (slides < 3) return { ok: false, why: `only ${slides} slide(s) parsed` }
      return { ok: true, detail: `${slides} slides parsed` }
    },
  },
  {
    name: 'O.T.T.E.R. course outline',
    key: 'otter.course',
    body: {
      max_tokens: 12000,
      system: FULL_COURSE_OUTLINE_PROMPT,
      messages: [{ role: 'user', content: 'Software: Blender 4.2. Build a course outline for an intermediate 3D artist moving into geometry nodes.' }],
      tool: 'otter',
    },
    check: (t) => parseJson(t, (o) => {
      const subjects = o.subjects || o.course?.subjects
      if (!Array.isArray(subjects)) return { ok: false, why: 'no `subjects` array in the JSON' }
      return { ok: true, detail: `${subjects.length} subjects` }
    }),
  },
  {
    name: 'O.T.T.E.R. course + web search',
    key: 'otter.subjectContent',
    body: {
      max_tokens: 12000,
      system: FULL_COURSE_OUTLINE_PROMPT,
      messages: [{ role: 'user', content: 'Software: Blender 4.2. Outline a short course on the geometry nodes added in recent releases. Use web search to confirm what is current.' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      betas: 'web-search-2025-03-05',
      tool: 'otter',
    },
    check: (t) => parseJson(t, () => ({ ok: true, detail: 'JSON parsed' })),
  },
  {
    name: 'R.A.B.B.I.T. intake chunk',
    key: 'rabbit.intake.script',
    body: {
      max_tokens: 4096,
      system: 'You are a line producer breaking down a script into a production plan.',
      messages: [{ role: 'user', content: `${RABBIT_SCHEMA()}\n\nChunk text:\n\n${SCRIPT_CHUNK}` }],
      tool: 'rabbit',
    },
    check: (t) => parseJson(t, (o) => {
      const missing = ['phases', 'assets', 'tasks', 'budget_lines', 'risks', 'open_questions']
        .filter((k) => !Array.isArray(o[k]))
      if (missing.length) return { ok: false, why: `envelope missing arrays: ${missing.join(', ')}` }
      return { ok: true, detail: `${o.assets.length} assets, ${o.tasks.length} tasks` }
    }),
  },
]

function parseJson(text, then) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let obj
  try { obj = JSON.parse(cleaned) } catch (e) {
    return { ok: false, why: `JSON.parse failed: ${e.message.slice(0, 80)}` }
  }
  return then(obj)
}

function RABBIT_SCHEMA() {
  // Lifted from pipeline.js RESPONSE_SCHEMA_BLOCK — the shape reducers.merge expects.
  return `Return ONLY a single valid JSON object — no prose, no markdown fences.
The object MUST conform to this exact shape:
{
  "phases":  [{ "name": string, "rationale": string, "approx_start_offset_days": number | null }],
  "assets":  [{ "name": string, "type": string, "phase_hint": string | null, "rationale": string }],
  "tasks":   [{ "asset_hint": string | null, "title": string, "role": string | null, "bid_days": number | null, "priority": "low" | "med" | "high" | "crit", "rationale": string }],
  "budget_lines": [{ "category": string, "label": string, "amount": number | null, "role_hint": string | null }],
  "risks":   [{ "label": string, "severity": "low" | "med" | "high" | "crit", "mitigation": string }],
  "open_questions": [string]
}`
}


// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  const ref = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./) || [])[1] || '?'
  console.log(`${DIM}Project: ${ref}  (from ${envFile || 'env vars'})${RESET}`)
  console.log(`${DIM}Four full-size generations. This costs real tokens and takes a minute or two.${RESET}\n`)

  if (process.env.PROBE_ACCESS_TOKEN) {
    token = process.env.PROBE_ACCESS_TOKEN.trim()
  } else {
    const username = process.env.PROBE_USERNAME || await ask('WILSON username: ')
    const password = process.env.PROBE_PASSWORD || await ask('WILSON password: ', { hidden: true })
    if (!username || !password) die('Need a username and password.')
    const r = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ username }),
    })
    const rj = await r.json().catch(() => ({}))
    if (!rj.email) die(`resolve-login gave no email: ${JSON.stringify(rj)}`)
    const s = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ email: rj.email, password }),
    })
    const sj = await s.json().catch(() => ({}))
    token = sj.access_token
    if (!token) die(`sign-in rejected: ${sj.error_description || sj.msg || s.status}`)
    console.log(`${DIM}signed in as ${rj.email}${RESET}\n`)
  }

  const rows = []
  for (const c of CASES) {
    process.stdout.write(`${DIM} ..  ${c.name}${RESET}\r`)
    // Resolve the model here, from the registry, exactly as the call site does.
    // Mirror the call site exactly: model AND tuning both come from the
    // registry, so this measures what the app sends, not an approximation.
    const r = await generate(
      { ...c.body, model: modelFor(c.key), ...tuningFor(c.key) }, c.name,
    )

    if (!r.ok) {
      console.log(`${RED} FAIL ${RESET} ${c.name.padEnd(30)} ${r.status} ${r.type}`)
      if (r.message) console.log(`        ${DIM}${r.message.slice(0, 160)}${RESET}`)
      rows.push({ c, r, verdict: { ok: false, why: `${r.status} ${r.type}` } })
      continue
    }

    const verdict = c.check(r.text)
    const truncated = r.stop === 'max_tokens'
    // D.O.G.'s full-deck call runs inside a continuation loop (up to 3 retries,
    // each ending on a user turn, so not the prefill shape that 400s). For that
    // call site max_tokens is designed behaviour, not failure — judging a single
    // request by criteria the app does not use would report a false alarm.
    const truncationIsFatal = truncated && !c.continues
    const label = verdict.ok && !truncationIsFatal ? `${GREEN} PASS ${RESET}` : `${RED} FAIL ${RESET}`
    const think = r.thinking ? `${YELLOW}thinking=${r.thinking}${RESET}` : 'thinking=0'
    console.log(`${label} ${c.name.padEnd(30)} stop=${String(r.stop).padEnd(10)} `
      + `out=${String(r.outTokens).padEnd(6)} ${think}  ${r.seconds}s`)
    const note = truncated
      ? (c.continues
        ? ' — truncated at max_tokens, as designed; the app continues (up to 3x)'
        : ' — TRUNCATED at max_tokens')
      : ''
    console.log(`        ${DIM}${verdict.ok ? verdict.detail : verdict.why}${note}${RESET}`)
    // ai-proxy streams through a Supabase Edge Function with a ~150s deadline.
    // A single call near that is fragile, and D.O.G. makes up to four of them.
    if (Number(r.seconds) > 120) {
      console.log(`        ${YELLOW}${r.seconds}s — near ai-proxy's ~150s Edge deadline${RESET}`)
    }
    rows.push({ c, r, verdict, truncationIsFatal })
  }

  // ── Readout ────────────────────────────────────────────────────────────────
  const failed = rows.filter((x) => !x.verdict.ok || x.truncationIsFatal)
  const truncated = rows.filter((x) => x.truncationIsFatal)
  const slow = rows.filter((x) => Number(x.r?.seconds) > 120)
  const thought = rows.filter((x) => x.r?.thinking > 0)

  console.log(`\n${BOLD}${rows.length - failed.length}/${rows.length} generations usable${RESET}\n`)

  if (failed.length === 0) {
    console.log(`${GREEN}Block E passes.${RESET} Every tool produced output WILSON can parse, at`)
    console.log('its real max_tokens, on the replacement model. The outage is over.')
  }
  if (truncated.length) {
    console.log(`${YELLOW}${truncated.length} generation(s) hit max_tokens.${RESET} This is the open question from`)
    console.log('ai-models.mjs showing up for real: sonnet-5 thinks unasked, thinking spends')
    console.log('from the same budget as the answer, and WILSON cannot switch it off because')
    console.log('ai-proxy drops the `thinking` field. Fix is one of:')
    console.log('  a) forward `thinking` in ai-proxy and send {type:"disabled"} — smallest,')
    console.log('     restores exactly the Sonnet-4 behaviour these max_tokens were sized for;')
    console.log('  b) raise max_tokens at the affected call sites — guesswork without a')
    console.log('     measured ceiling, and it raises cost on every call.')
  }
  if (thought.length && !truncated.length) {
    console.log(`${DIM}${thought.length} generation(s) emitted thinking blocks and still produced`)
    console.log(`output WILSON can parse, so thinking is not costing an answer.${RESET}`)
  }
  if (slow.length) {
    console.log(`\n${YELLOW}${slow.length} generation(s) ran over 120s${RESET} against ai-proxy's ~150s Edge`)
    console.log('deadline. That is the real cost of thinking here, not truncation: D.O.G.')
    console.log('makes up to four of these calls per deck, and a call that overruns the')
    console.log('deadline loses the stream rather than degrading. Worth forwarding')
    console.log('`thinking` in ai-proxy so the heavy call sites can switch it off.')
  }
}

main().catch((e) => die(e?.stack || String(e)))
