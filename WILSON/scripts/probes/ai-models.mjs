// =============================================================================
// ai-models probe — Session 19
//
//   node scripts/probes/ai-models.mjs
//
// Run it from the WILSON folder (the one with package.json) in PowerShell.
// Nothing else to install: Node only, no bash, no jq. It reads the Supabase
// URL and anon key out of .env.local / .env.development, and asks for the
// probe login if PROBE_USERNAME / PROBE_PASSWORD aren't already set.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// It answers, with evidence rather than inference, the questions that decide
// the Sonnet-4 migration. It sends WILSON's OWN request shapes through the real
// `ai-proxy` Edge Function and prints Anthropic's verbatim reply.
//
// The S19 plan assumed the migration was a find-and-replace. Anthropic's
// current API reference says three things that make it not one:
//
//   * adaptive thinking is ON by default on the replacement model, and shares
//     the max_tokens budget with the answer — WILSON asks for big structured
//     JSON and then parses it, so a truncated reply is a parse error;
//   * O.T.T.E.R. sends a web-search tool version and beta header that predate
//     the replacement model;
//   * the Validator's tool_use recursion ends its message list on an assistant
//     turn, which is a prefill, and prefills 400 on everything past Sonnet 4.
//
// Each of those is a theory until this runs. Swapping 17 call sites first and
// reading the tea leaves afterwards is how S17 lost an hour.
//
// `ai-proxy` forwards Anthropic's status verbatim and nests its error JSON
// under `anthropic` (index.ts, the `!upstream.ok` branch), so what prints
// below is Anthropic's own answer, not WILSON's interpretation of it.
//
// Cases 1 and 2 are a control pair and are not optional. Case 1 MUST pass and
// case 2 MUST fail. An instrument that cannot show a presence cannot be
// trusted about an absence.
//
// Costs a few hundred tokens total. Writes WIL-6001 rows to the Logs tab like
// any other AI call, tagged tool="probe".
// =============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m'
const DIM = '\x1b[90m', BOLD = '\x1b[1m', YELLOW = '\x1b[33m'

const die = (msg) => { console.error(`${RED}FAIL${RESET} ${msg}`); process.exit(1) }

// ── Config ───────────────────────────────────────────────────────────────────

function loadEnvFile() {
  for (const name of ['.env.local', '.env.development']) {
    const path = join(ROOT, name)
    if (!existsSync(path)) continue
    const out = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
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

if (!SUPABASE_URL || !ANON_KEY) {
  die('No Supabase URL/anon key. Expected VITE_SUPABASE_URL and '
    + 'VITE_SUPABASE_ANON_KEY in .env.local or .env.development, '
    + 'run from the WILSON folder.')
}

const REASONING = process.env.REASONING_MODEL || 'claude-sonnet-5'
const FAST = process.env.FAST_MODEL || 'claude-haiku-4-5-20251001'
const DEAD = 'claude-sonnet-4-20250514'
const ALT = 'claude-sonnet-4-6'

// ── Prompt for the login if it isn't in the environment ─────────────────────

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    if (!hidden) return rl.question(question, (a) => { rl.close(); resolve(a.trim()) })

    // Mask the password. `_writeToOutput` is the documented seam for this.
    process.stdout.write(question)
    rl._writeToOutput = () => {}
    rl.question('', (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()) })
  })
}

// ── ai-proxy call ────────────────────────────────────────────────────────────

let token = null

async function callProxy(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text }
}

/**
 * Pull the signals that matter out of the reassembled SSE stream: whether the
 * model emitted thinking blocks (they share the max_tokens budget with the
 * answer) and the stop_reason — `max_tokens` means the reply was cut off,
 * which for WILSON means unparseable JSON rather than merely a short answer.
 */
function readStream(text) {
  const thinking = (text.match(/"type":"thinking"/g) || []).length
  const stops = text.match(/"stop_reason":"([a-z_]+)"/g) || []
  const stop = stops.length ? stops[stops.length - 1].split('"')[3] : '?'
  const outs = text.match(/"output_tokens":(\d+)/g) || []
  const out = outs.length ? outs[outs.length - 1].split(':')[1] : '?'
  const searched = /web_search_tool_result/.test(text)
  return { thinking, stop, out, searched }
}

const results = []

async function probe(label, body) {
  process.stdout.write(`${DIM} ..  ${label}${RESET}\r`)
  let status, text
  try {
    ({ status, text } = await callProxy(body))
  } catch (err) {
    console.log(`${RED} FAIL ${RESET} ${label.padEnd(44)} network  ${err.message}`)
    results.push({ label, ok: false })
    return { ok: false }
  }

  if (status === 200) {
    const s = readStream(text)
    const flags = [
      `stop=${s.stop}`,
      `out=${s.out}`,
      s.thinking ? `${YELLOW}thinking=${s.thinking}${RESET}` : 'thinking=0',
      s.searched ? 'websearch=yes' : null,
    ].filter(Boolean).join('  ')
    console.log(`${GREEN} PASS ${RESET} ${label.padEnd(44)} 200  ${flags}`)
    results.push({ label, ok: true, ...s })
    return { ok: true, ...s }
  }

  let type = '?', message = ''
  try {
    const j = JSON.parse(text)
    type = j?.anthropic?.error?.type || j?.error || '?'
    message = j?.anthropic?.error?.message || ''
  } catch { message = text.slice(0, 200) }
  console.log(`${RED} FAIL ${RESET} ${label.padEnd(44)} ${status}  ${type}`)
  if (message) console.log(`        ${DIM}${message}${RESET}`)
  results.push({ label, ok: false, status, type, message })
  return { ok: false, status, type }
}

const userMsg = (text) => [{ role: 'user', content: text }]
const OK_PROMPT = 'Reply with the single word: ok'

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  // Which project this runs through only decides whose Anthropic key pays and
  // where the WIL-6001 rows land. The answers about models are Anthropic's and
  // are the same everywhere — so if case 1 fails here, switching environments
  // is the fix, not a reason to distrust the readings.
  const ref = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./) || [])[1] || '?'
  console.log(`${DIM}Project: ${ref}${envFile ? `  (from ${envFile})` : ''}${RESET}`)
  console.log(`${DIM}To use a different one: $env:SUPABASE_URL / $env:SUPABASE_ANON_KEY${RESET}`)

  const username = process.env.PROBE_USERNAME || await ask('WILSON username: ')
  const password = process.env.PROBE_PASSWORD || await ask('WILSON password: ', { hidden: true })
  if (!username || !password) die('Need a username and password to get a token.')

  // resolve-login -> email, then GoTrue -> access_token. Same two steps as
  // scripts/probes/issue-session.sh.
  const rl = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ username }),
  })
  const rlJson = await rl.json().catch(() => ({}))
  if (!rlJson.email) die(`resolve-login (${rl.status}) gave no email: ${JSON.stringify(rlJson)}`)

  const si = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: rlJson.email, password }),
  })
  const siJson = await si.json().catch(() => ({}))
  token = siJson.access_token
  if (!token) die(`sign-in (${si.status}) gave no token: ${siJson.error_description || JSON.stringify(siJson)}`)
  console.log(`${DIM}signed in as ${rlJson.email}${RESET}`)

  console.log(`\n${BOLD}Controls — case 1 MUST pass, case 2 MUST fail${RESET}`)
  const c1 = await probe(`1. FAST alive (${FAST})`,
    { model: FAST, max_tokens: 16, messages: userMsg(OK_PROMPT), tool: 'probe' })
  const c2 = await probe(`2. Sonnet 4 retired (${DEAD})`,
    { model: DEAD, max_tokens: 16, messages: userMsg(OK_PROMPT), tool: 'probe' })

  if (!c1.ok) {
    console.log(`\n${RED}${BOLD}STOP.${RESET} Case 1 failed, so the probe is broken — not the models.`)
    console.log('Every other reading would be meaningless. Check the workspace AI key first.')
    process.exit(1)
  }
  if (c2.ok) {
    console.log(`\n${YELLOW}${BOLD}STOP.${RESET} Case 2 PASSED — Sonnet 4 still answers.`)
    console.log('The retirement diagnosis is wrong and S19 needs rebuilding before any fix.')
    process.exit(1)
  }

  console.log(`\n${BOLD}Candidate replacement models${RESET}`)
  const c3 = await probe(`3. Candidate (${REASONING})`,
    { model: REASONING, max_tokens: 16, messages: userMsg(OK_PROMPT), tool: 'probe' })
  await probe(`4. Fallback candidate (${ALT})`,
    { model: ALT, max_tokens: 16, messages: userMsg(OK_PROMPT), tool: 'probe' })

  if (!c3.ok) {
    console.log(`\n${RED}${BOLD}STOP.${RESET} The replacement model id is wrong. Do not migrate to it.`)
    process.exit(1)
  }

  console.log(`\n${BOLD}WILSON's own request shapes on ${REASONING}${RESET}`)

  // O.T.T.E.R. sends this tool version at four sites, and this beta header.
  // Both predate the target model. ai-proxy turns `betas` into the
  // anthropic-beta header verbatim.
  const websearch = (type) => [{ type, name: 'web_search', max_uses: 1 }]
  await probe('5a. web_search_20250305 + beta header',
    { model: REASONING, max_tokens: 64, messages: userMsg(OK_PROMPT), tool: 'probe',
      tools: websearch('web_search_20250305'), betas: 'web-search-2025-03-05' })
  await probe('5b. web_search_20250305, no beta header',
    { model: REASONING, max_tokens: 64, messages: userMsg(OK_PROMPT), tool: 'probe',
      tools: websearch('web_search_20250305') })
  await probe('5c. web_search_20260209, no beta header',
    { model: REASONING, max_tokens: 64, messages: userMsg(OK_PROMPT), tool: 'probe',
      tools: websearch('web_search_20260209') })

  // Validator.jsx: on stop_reason === 'tool_use' it appends the assistant turn
  // and re-sends with no trailing user turn. That is an assistant prefill.
  await probe('6. trailing assistant turn (Validator)',
    { model: REASONING, max_tokens: 32, tool: 'probe',
      messages: [
        { role: 'user', content: 'Name one colour.' },
        { role: 'assistant', content: 'The colour is' },
      ] })

  // WILSON omits `thinking` everywhere and asks for large structured JSON,
  // then parses it. If thinking is on by default it eats the same budget.
  const JSON_TASK = 'Output ONLY a JSON array of 8 objects, each '
    + '{"name":string,"summary":string} about the planets. No prose.'
  const t1 = await probe('7a. JSON task, thinking omitted (max_tokens=1024)',
    { model: REASONING, max_tokens: 1024, messages: userMsg(JSON_TASK), tool: 'probe' })
  const t2 = await probe('7b. JSON task, thinking disabled (max_tokens=1024)',
    { model: REASONING, max_tokens: 1024, messages: userMsg(JSON_TASK), tool: 'probe',
      thinking: { type: 'disabled' } })

  // ── Readout ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${BOLD}${passed} passed, ${results.length - passed} failed${RESET}\n`)
  console.log('What each answer means:')
  console.log('  5a/5b FAIL  -> O.T.T.E.R. needs its web-search tool version and/or beta')
  console.log('                header changed too. A model swap alone leaves the five')
  console.log('                research paths broken.')
  console.log('  6 FAIL      -> the Validator\'s tool_use recursion cannot work as written')
  console.log('                on the new model and has to be restructured.')
  if (t1.ok && t2.ok) {
    const bad = t1.stop === 'max_tokens' && t2.stop !== 'max_tokens'
    console.log(`  7a stop=${t1.stop}, 7b stop=${t2.stop}`)
    console.log(bad
      ? `                ${YELLOW}-> thinking is eating the output budget. Every REASONING call\n                   site needs thinking pinned, or WILSON trades a 404 for a\n                   JSON parse error.${RESET}`
      : '                -> no truncation difference; thinking is not eating the budget.')
  }
  console.log('\nPaste this whole output back into the session.')
}

main().catch((err) => die(err?.stack || String(err)))
