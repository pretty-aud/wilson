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

// `--staging` / `--dev` pick which env file to read. This exists because
// pasting a long anon key into PowerShell loses its quotes, and the shell then
// tries to run the key as a command — a failure that looks nothing like the
// copy/paste problem it is. Choosing a file needs no quoting at all.
const ARG_ENV = process.argv.includes('--staging') ? '.env.staging'
  : process.argv.includes('--dev') ? '.env.development'
  : null

function loadEnvFile() {
  const candidates = ARG_ENV ? [ARG_ENV] : ['.env.local', '.env.development']
  for (const name of candidates) {
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

// Say where each value actually came from. An env var silently beating the
// file, while the banner still names the file, turns a stale override into a
// mystery — and an override is exactly what needs to be visible here.
const urlFrom = process.env.SUPABASE_URL ? '$env:SUPABASE_URL' : envFile
const keyFrom = process.env.SUPABASE_ANON_KEY ? '$env:SUPABASE_ANON_KEY' : envFile

if (!SUPABASE_URL || !ANON_KEY) {
  die('No Supabase URL/anon key. Expected VITE_SUPABASE_URL and '
    + 'VITE_SUPABASE_ANON_KEY in .env.local or .env.development, '
    + 'run from the WILSON folder.')
}

// A key pasted into PowerShell can arrive mangled — quotes stripped, or the
// characters replaced with bullets by whatever it was copied from. Left alone,
// that surfaces from deep inside the HTTP stack as
// "Cannot convert argument to a ByteString", which says nothing about the
// cause. Headers are ASCII-only, so check here and name the real problem.
const badChar = [...ANON_KEY].find((ch) => ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 33)
if (badChar) {
  const code = badChar.charCodeAt(0)
  console.error(`${RED}FAIL${RESET} The anon key from ${keyFrom} is not a usable key.`)
  console.error(`${DIM}It contains character ${code} (${JSON.stringify(badChar)}), and an API key can`)
  console.error('only contain plain ASCII. It was mangled on the way in — copied from')
  console.error('something that displayed it as bullets, or the quotes were stripped.')
  console.error('')
  console.error('Fix: stop pasting keys. Open a NEW PowerShell window (which clears the')
  console.error('bad variable) and run:')
  console.error(`  node scripts/probes/ai-models.mjs --staging${RESET}`)
  process.exit(1)
}
if (!/^ey[A-Za-z0-9_.-]+$/.test(ANON_KEY) && !ANON_KEY.startsWith('sb_publishable_')) {
  console.error(`${RED}FAIL${RESET} The anon key from ${keyFrom} doesn't look like a Supabase key.`)
  console.error(`${DIM}Expected a JWT starting "ey" or an "sb_publishable_" key; got `
    + `${ANON_KEY.length} chars starting "${ANON_KEY.slice(0, 6)}".`)
  console.error('Open a new PowerShell window and use: node scripts/probes/ai-models.mjs --staging')
  console.error(RESET)
  process.exit(1)
}

const REASONING = process.env.REASONING_MODEL || 'claude-sonnet-5'
const FAST = process.env.FAST_MODEL || 'claude-haiku-4-5-20251001'
const DEAD = 'claude-sonnet-4-20250514'
const ALT = 'claude-sonnet-4-6'

// ── Prompt for the login if it isn't in the environment ─────────────────────

let pipedLines = null

async function nextPipedLine() {
  if (pipedLines === null) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    pipedLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
  }
  return (pipedLines.shift() ?? '').trim()
}

/**
 * Read one line from the terminal, optionally masked.
 *
 * Deliberately does NOT use `readline`. The first version of this opened a
 * fresh readline interface per question and masked by stubbing
 * `_writeToOutput`; the second interface immediately consumed the newline the
 * first one left in the buffer and resolved with an empty string, so the
 * password prompt never appeared and an empty password went to GoTrue. It
 * looked exactly like a wrong password.
 *
 * Raw stdin, one listener at a time, is boring and does not have that failure
 * mode. Falls back to a plain line read when stdin isn't a TTY (CI, pipes).
 */
function ask(question, { hidden = false } = {}) {
  const stdin = process.stdin

  // Piped input (CI, `printf ... | node ...`): drain stdin once into a queue
  // and serve from it. Opening a readline per question has the same defect as
  // the version this replaces — the second one races the first one's close.
  if (!stdin.isTTY) return nextPipedLine()

  return new Promise((resolve) => {
    process.stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let buf = ''
    const finish = (value) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      resolve(value)
    }

    // Compared by code point, not by literal: control characters do not
    // survive every editor and copy path, and a silently-eaten one here is
    // how the previous version submitted an empty password.
    const CR = 13, LF = 10, CTRL_C = 3, CTRL_D = 4, BACKSPACE = 8, DEL = 127
    // backspace, space, backspace — rubs the last * off the screen
    const ERASE = String.fromCharCode(BACKSPACE, 32, BACKSPACE)

    const onData = (chunk) => {
      // A paste arrives as one chunk, so walk it a character at a time.
      for (const ch of chunk) {
        const code = ch.charCodeAt(0)
        if (code === CR || code === LF) return finish(buf.trim())
        if (code === CTRL_C) { process.stdout.write(String.fromCharCode(LF)); process.exit(130) }
        if (code === CTRL_D) return finish(buf.trim())
        if (code === BACKSPACE || code === DEL) {
          if (buf.length) { buf = buf.slice(0, -1); process.stdout.write(ERASE) }
          continue
        }
        if (code < 32) continue // ignore any other control character
        buf += ch
        process.stdout.write(hidden ? '*' : ch)
      }
    }

    stdin.on('data', onData)
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
  console.log(`${DIM}Project: ${ref}  (url from ${urlFrom}, key from ${keyFrom})${RESET}`)
  console.log(`${DIM}To switch: node scripts/probes/ai-models.mjs --staging  (or --dev)${RESET}`)

  // Escape hatch: paste an access token from a browser session that is already
  // signed in, and skip the login entirely. Passwords are per-project and it
  // is easy to have a working session without knowing which password goes with
  // which environment. In WILSON, devtools -> Application -> Local Storage ->
  // the `sb-…-auth-token` entry -> `access_token`.
  if (process.env.PROBE_ACCESS_TOKEN) {
    token = process.env.PROBE_ACCESS_TOKEN.trim()
    console.log(`${DIM}using PROBE_ACCESS_TOKEN (${token.length} chars) — skipping sign-in${RESET}`)
    return runCases()
  }

  const username = process.env.PROBE_USERNAME || await ask('WILSON username: ')
  const password = process.env.PROBE_PASSWORD || await ask('WILSON password: ', { hidden: true })
  if (!username) die('No username entered.')
  if (!password) {
    die('No password was captured, so nothing was sent. This is a probe bug, '
      + 'not a wrong password — tell Claude the prompt returned empty.')
  }

  // resolve-login -> email, then GoTrue -> access_token. Same two steps as
  // scripts/probes/issue-session.sh.
  const rl = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ username }),
  })
  const rlJson = await rl.json().catch(() => ({}))
  if (!rlJson.email) die(`resolve-login (${rl.status}) gave no email: ${JSON.stringify(rlJson)}`)
  // Printed before the password is used, so an `invalid_credentials` further
  // down can be read as "wrong password for THIS account" rather than a
  // mystery. The account is whichever one exists on the project named above.
  console.log(`${DIM}username resolved to ${rlJson.email}${RESET}`)
  console.log()

  const si = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: rlJson.email, password }),
  })
  const siJson = await si.json().catch(() => ({}))
  token = siJson.access_token
  if (!token) {
    const why = siJson.error_description || siJson.msg || JSON.stringify(siJson)
    if (siJson.error_code === 'invalid_credentials') {
      console.error(`${RED}FAIL${RESET} sign-in rejected the password for ${rlJson.email}.`)
      console.error(`${DIM}The account exists on project ${ref} — resolve-login found it — so this`)
      console.error('is the password, not the username. Passwords are per-project: if you set')
      console.error('this one up on staging, it will not work here. To probe staging instead:')
      console.error(`  $env:SUPABASE_URL="https://rzkirvkotslbovzbsdfh.supabase.co"`)
      console.error(`  $env:SUPABASE_ANON_KEY="<staging anon key>"${RESET}`)
      process.exit(1)
    }
    die(`sign-in (${si.status}) gave no token: ${why}`)
  }
  console.log(`${DIM}signed in as ${rlJson.email}${RESET}`)
  return runCases()
}

// Everything past authentication. Split out so PROBE_ACCESS_TOKEN can jump
// straight here without going through resolve-login and GoTrue.
async function runCases() {

  console.log(`\n${BOLD}Controls — case 1 MUST pass, case 2 MUST fail${RESET}`)
  const c1 = await probe(`1. FAST alive (${FAST})`,
    { model: FAST, max_tokens: 16, messages: userMsg(OK_PROMPT), tool: 'probe' })
  const c2 = await probe(`2. Sonnet 4 retired (${DEAD})`,
    { model: DEAD, max_tokens: 16, messages: userMsg(OK_PROMPT), tool: 'probe' })

  if (!c1.ok) {
    console.log(`\n${RED}${BOLD}STOP.${RESET} Case 1 failed, so the probe is broken — not the models.`)
    console.log('Every other reading would be meaningless. What to fix depends on why:')
    if (c1.status === 401) {
      console.log(`  ${DIM}401 — the token was rejected. Expired, or minted for a different`)
      console.log(`  project than ${SUPABASE_URL}. Sign in again, or drop PROBE_ACCESS_TOKEN.${RESET}`)
    } else if (c1.status === 403) {
      console.log(`  ${DIM}403 — the account authenticated but is not active in a workspace.${RESET}`)
    } else if (c1.type === 'ai_not_configured') {
      console.log(`  ${DIM}This workspace has no Anthropic key. Set one in the operator console,`)
      console.log(`  or point the probe at an environment that has one.${RESET}`)
    } else {
      console.log(`  ${DIM}Status ${c1.status}, ${c1.type}. Anthropic's own message is above.${RESET}`)
    }
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
  console.log('  2 FAIL      -> EXPECTED. The retired model must 404; that is the control')
  console.log('                proving a dead model is distinguishable from a live one.')
  console.log('                Case 2 PASSING would be the alarming result.')
  console.log('  5a/5b FAIL  -> O.T.T.E.R. needs its web-search tool version and/or beta')
  console.log('                header changed too. A model swap alone leaves the five')
  console.log('                research paths broken.')
  console.log('                (Measured PASSING on sonnet-5 in S19 and again 2026-08-03 —')
  console.log('                 five call sites were nearly rewritten for nothing.)')
  console.log('  6 FAIL      -> STALE CASE as of S19, not a live defect. This sends a TEXT')
  console.log('                assistant prefill, which sonnet-5 rejects — correctly. The')
  console.log('                Validator no longer sends that shape: Validator.jsx:52')
  console.log('                branches on `pause_turn` (the server-tool signal) and appends')
  console.log('                an assistant turn ending in server_tool_use, which is the')
  console.log('                documented resume. The old branch keyed on `tool_use`, a')
  console.log('                CLIENT-tool signal the Validator never emits. Rewrite this')
  console.log('                case to the pause_turn shape or drop it.')
  if (t1.ok && t2.ok) {
    console.log(`  7a stop=${t1.stop} thinking=${t1.thinking}, `
      + `7b stop=${t2.stop} thinking=${t2.thinking}`)
    if (t1.thinking !== t2.thinking) {
      console.log(`                ${YELLOW}-> THE FIELD IS FORWARDED. 7a and 7b differ, and the ONLY`)
      console.log('                   difference between them is the `thinking` field — so it')
      console.log('                   reached Anthropic. ai-proxy\'s whitelist now includes it')
      console.log(`                   (ai-proxy/index.ts:239, :251-254).${RESET}`)
    } else {
      console.log(`                ${YELLOW}-> INCONCLUSIVE. 7a and 7b came back identical, which is`)
      console.log('                   what you would see if `thinking` never reached Anthropic.')
      console.log('                   Check that the DEPLOYED ai-proxy carries the forwarding —')
      console.log('                   diff the downloaded source, do NOT read the deploy version')
      console.log(`                   number, which counts per project and is not comparable.${RESET}`)
    }
  }
  console.log('\nPaste this whole output back into the session.')
}

main().catch((err) => die(err?.stack || String(err)))
