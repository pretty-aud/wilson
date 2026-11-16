// =============================================================================
// aiFilesProbe.test.js — post-overhaul FX15 (2026-10-26): the ai-files CI probe
// (scripts/probes/ai-files.sh) tries an upstream failure again before it
// fails. Run 40373721907 on 129aab10 stopped at "upload returned 502" while
// the pull_request run on the same commit had passed a minute before.
//
// No network: bash runs the REAL probe with a stub `curl` and a stub `sleep`
// first on PATH (checked before anything runs), answering from a plan the
// test writes, and logging every call. The helper is reached by sourcing the
// probe (it stops after its helpers when sourced); the whole probe runs where
// jq is (the probe needs it from its first request): CI's runner has it, and
// on CI its absence fails here rather than skipping.
// =============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PROBE = resolve(here, '../../scripts/probes/ai-files.sh')
const probeText = () => readFileSync(PROBE, 'utf8').replace(/\r\n/g, '\n')

// Git Bash on Windows (never WSL's bash, which `bash` may find there); bash on
// Linux and macOS.
function findBash() {
  if (process.platform !== 'win32') return 'bash'
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']
  return roots.filter(Boolean).map((r) => join(r, 'Git', 'bin', 'bash.exe')).find((p) => existsSync(p)) || null
}
const BASH = findBash()
// A path as bash reads it (Git Bash: /c/Users/...).
const posix = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p)

// The stub curl: the kind of request from its arguments, the next answer of
// that kind's plan (the last answer repeats), one line in calls.log each.
// An answer is "<status> <body>", or "exit <n>" for a request curl could not
// complete (nothing printed).
const STUB_CURL = `#!/usr/bin/env bash
method=GET; url=; data=; form=0; w=0; o=
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2;;
    -w) w=1; shift 2;;
    -o) o="$2"; shift 2;;
    -H) shift 2;;
    -F) form=1; shift 2;;
    --data) data="$2"; method=\${method/GET/POST}; shift 2;;
    -*) shift;;
    *) url="$1"; shift;;
  esac
done
case "$url" in
  */functions/v1/resolve-login) kind=resolve;;
  */auth/v1/token*) kind=token;;
  */functions/v1/ai-files) if [ "$form" = 1 ]; then kind=upload; else kind=$(printf '%s' "$method" | tr 'A-Z' 'a-z'); fi;;
  *) kind=other;;
esac
printf '%s %s\\n' "$kind" "$data" >> "$STUB_DIR/calls.log"
plan="$STUB_DIR/plan.$kind"
line=$(head -n 1 "$plan" 2>/dev/null || true)
[ -n "$line" ] || line='418 {"error":"stub: no plan"}'
if [ "$(wc -l < "$plan" 2>/dev/null || echo 0)" -gt 1 ]; then tail -n +2 "$plan" > "$plan.next" && mv "$plan.next" "$plan"; fi
case "$line" in "exit "*) exit "\${line#exit }";; esac
code="\${line%% *}"; body="\${line#* }"; [ "$body" = "$line" ] && body=
if [ -n "$o" ]; then [ "$w" = 1 ] && printf '%s' "$code"; exit 0; fi
if [ "$w" = 1 ]; then printf '%s\\n%s' "$body" "$code"; else printf '%s' "$body"; fi
`
const STUB_SLEEP = `#!/usr/bin/env bash
printf 'sleep %s\\n' "$*" >> "$STUB_DIR/calls.log"
`

let dir = null
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wilson-ai-files-probe-'))
  writeFileSync(join(dir, 'curl'), STUB_CURL, { mode: 0o755 })
  writeFileSync(join(dir, 'sleep'), STUB_SLEEP, { mode: 0o755 })
  writeFileSync(join(dir, 'calls.log'), '')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }); dir = null })

const plan = (kind, ...answers) => writeFileSync(join(dir, `plan.${kind}`), answers.map((a) => `${a}\n`).join(''))
const calls = () => readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean)

/** Runs `body` in bash with the stubs first on PATH (refused otherwise). */
function bash(body, env = {}) {
  const stub = posix(dir)
  const script = [
    `export STUB_DIR='${stub}'`,
    `export PATH='${stub}':"$PATH"`,
    `[ "$(command -v curl)" = '${stub}/curl' ] || { echo "STUB NOT FIRST: $(command -v curl)"; exit 97; }`,
    `[ "$(command -v sleep)" = '${stub}/sleep' ] || { echo "STUB NOT FIRST: $(command -v sleep)"; exit 98; }`,
    body,
  ].join('\n')
  const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 })
  if (r.error) throw r.error
  // The probe colours its labels (ok, FAIL, MEASURED): read as the log reads.
  const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
  return { code: r.status, out: plain(r.stdout), err: plain(r.stderr) }
}
/** The helper alone: the probe sourced, one request through `attempts`. */
const attempt = () => bash(`source '${posix(PROBE)}'\nup=$(attempts upload -X POST 'http://127.0.0.1:9/functions/v1/ai-files' -F 'file=@/dev/null')\nprintf 'ANSWER<%s>\\n' "$up"`)
const answer = (out) => /ANSWER<([\s\S]*)>\n?$/.exec(out)?.[1]

describe.skipIf(!BASH)('the probe\'s retry (FX15; the helper, sourced)', () => {
  it('502, 502, then 200: three attempts, each retry noted, 2 s then 4 s apart; the answer is the third', () => {
    plan('upload', '502 {"error":"bad gateway"}', '502 {"error":"bad gateway"}', '200 {"id":"file_stub01"}')
    const r = attempt()
    expect([r.code, r.err]).toEqual([0, ''])
    expect(calls()).toEqual(['upload ', 'sleep 2', 'upload ', 'sleep 4', 'upload '])
    expect(answer(r.out)).toBe('{"id":"file_stub01"}\n200')
    expect(r.out).toContain('MEASURED upload: attempt 1 of 3 answered 502; trying again in 2 s')
    expect(r.out).toContain('::notice title=ai-files probe::upload: attempt 2 of 3 answered 502; trying again in 4 s')
    // The notes reach the step's output, never the caller's variable.
    expect(answer(r.out)).not.toContain('MEASURED')
  })
  it('CONTROL: a 401 is the answer at once (a refusal is a finding): one attempt, no note, no pause', () => {
    plan('upload', '401 {"error":"unauthorized"}', '200 {"id":"file_never"}')
    const r = attempt()
    expect(calls()).toEqual(['upload '])
    expect(answer(r.out)).toBe('{"error":"unauthorized"}\n401')
    expect(r.out).not.toContain('MEASURED')
  })
  it('CONTROL: a 500 (the function\'s own failure) and a 404 are answers too, not retried', () => {
    for (const status of ['500', '404', '400']) {
      writeFileSync(join(dir, 'calls.log'), '')
      plan('upload', `${status} {"error":"x"}`, '200 {"id":"file_never"}')
      expect([status, calls().length, answer(attempt().out)]).toEqual([status, 0, `{"error":"x"}\n${status}`].map((v, i) => (i === 1 ? 0 : v)))
      expect([status, calls()]).toEqual([status, ['upload ']])
    }
  })
  it('three 502s: bounded, three attempts and two pauses, and the last answer goes back to be failed on', () => {
    plan('upload', '502 {"error":"bad gateway"}')
    const r = attempt()
    expect(calls()).toEqual(['upload ', 'sleep 2', 'upload ', 'sleep 4', 'upload '])
    expect(answer(r.out)).toBe('{"error":"bad gateway"}\n502')
    expect(r.out.match(/MEASURED upload: attempt/g)).toHaveLength(2)
  })
  it('a request curl could not complete (exit 7, nothing printed), then 503, then 200: tried again, each said', () => {
    plan('upload', 'exit 7', '503 {"error":"unavailable"}', '200 {"id":"file_stub02"}')
    const r = attempt()
    expect(calls()).toEqual(['upload ', 'sleep 2', 'upload ', 'sleep 4', 'upload '])
    expect(r.out).toContain('upload: attempt 1 of 3 did not complete (curl exit 7); trying again in 2 s')
    expect(r.out).toContain('upload: attempt 2 of 3 answered 503; trying again in 4 s')
    expect(answer(r.out)).toBe('{"id":"file_stub02"}\n200')
  })
  it('never completing: the answer is status 000, for the caller to fail on', () => {
    plan('upload', 'exit 28')
    const r = attempt()
    expect(calls().filter((c) => c.startsWith('upload'))).toHaveLength(3)
    expect(answer(r.out)).toBe('\n000')
  })
  it('a 504 is tried again', () => {
    plan('upload', '504 {"error":"timeout"}', '200 {"id":"file_stub03"}')
    expect(answer(attempt().out)).toBe('{"id":"file_stub03"}\n200')
    expect(calls()).toEqual(['upload ', 'sleep 2', 'upload '])
  })
})

describe('the probe as written (FX15 text pins)', () => {
  it('step 1\'s two uploads and call() go through `attempts`; no other request to ai-files is a bare curl with a status', () => {
    const sh = probeText()
    expect(sh.match(/up=\$\(attempts upload -X POST "\$FN"/g)).toHaveLength(2)
    expect(sh).toMatch(/call\(\) \{\n  if \[ -n "\$\{2:-\}" \]; then\n    attempts "\$1 ai-files"[^\n]*\n[^\n]*\n  else\n    attempts "\$1 ai-files"/)
    expect(sh).not.toMatch(/curl -sS -w '\\n%\{http_code\}' -X (POST|"\$1") "\$FN"/)
    // CONTROL: the helper itself is the one curl with a status line it sends.
    expect(sh.match(/curl -sS -w '\\n%\{http_code\}' "\$@"/g)).toHaveLength(1)
  })
  it('DG2-03: every other request to a function whose status the probe reads goes through `attempts` too (the messages call, no sign-in, the operator\'s summary); the helper\'s curl is the only one with a status line', () => {
    const sh = probeText()
    expect(sh).toContain('dead=$(attempts "the messages call" -X POST "${SUPABASE_URL}/functions/v1/ai-proxy"')
    expect(sh).toContain('resp=$(attempts "no sign-in" -X DELETE "$FN"')
    expect(sh).toContain('resp=$(attempts "the operator\'s summary" -X POST "${SUPABASE_URL}/functions/v1/operator-ai-files"')
    expect(sh.match(/-w '\\n%\{http_code\}'/g)).toHaveLength(1)
    // CONTROL: the forged rows' inserts read a bare status (`-o /dev/null`), not a body, and stay as they were.
    expect(sh.match(/curl -sS -o \/dev\/null -w '%\{http_code\}' -X POST "\$\{SUPABASE_URL\}\/rest\/v1\/app_events"/g)).toHaveLength(3)
  })
  it('one file id, from the answer that succeeded; the clean-up deletes that one', () => {
    const sh = probeText()
    expect(sh.match(/^fid=/gm)).toHaveLength(1)
    const fidAt = sh.indexOf('fid=$(printf \'%s\' "$json" | jq -r \'.id // empty\')')
    expect(fidAt).toBeGreaterThan(sh.indexOf('[ "$code" = "200" ] || err "upload returned $code'))
    expect(sh).toMatch(/cleanup\(\) \{\n  if \[ -n "\$\{fid:-\}" \] && \[ "\$\{deleted:-0\}" != "1" \]; then/)
  })
  it('a retry is a note, never an error (err prints ::error and exits); the notes go to fd 3', () => {
    const helper = probeText().slice(probeText().indexOf('attempts() {'), probeText().indexOf('# Sourced'))
    expect(helper).not.toMatch(/\berr\b/)
    expect(helper).toMatch(/note "[^\n]*" >&3/)
    expect(probeText()).toMatch(/^exec 3>&1$/m)
  })
})

// The whole probe, as CI runs it, against the stubs: needs jq.
const hasJq = BASH ? spawnSync(BASH, ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0 : false
const ENV = {
  SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_ANON_KEY: 'stub-anon-key',
  PROBE_USERNAME: 'stub-user',
  PROBE_PASSWORD: 'stub-password',
}
// A token whose payload names a workspace (the probe reads it), signed by nobody.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const TOKEN = `${b64url({ alg: 'none' })}.${b64url({ app_metadata: { workspace_id: '00000000-0000-4000-8000-000000000001' } })}.stub`
const signIn = () => {
  plan('resolve', '200 {"email":"probe@example.invalid"}')
  plan('token', `200 {"access_token":"${TOKEN}"}`)
}
const runProbe = () => bash(`bash '${posix(PROBE)}'`, ENV)

describe.skipIf(!BASH)('the whole probe with the stubs (FX15)', () => {
  it('jq is there on CI (the whole-probe runs below would otherwise skip unseen)', () => {
    if (process.env.CI) expect(hasJq).toBe(true)
  })
  it.skipIf(!hasJq)('step 1 answered 502 twice, then 200: the probe goes on, and the file it deletes is the one it was given', () => {
    signIn()
    plan('upload', '502 {"error":"bad gateway"}', '502 {"error":"bad gateway"}', '200 {"id":"file_stub01"}')
    plan('get', '400 {"error":"stub_stops_here"}')
    const r = runProbe()
    // It stops where the stub makes it (step 2's list: a 400, not retried)…
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error title=ai-files probe::list returned 400 (stub_stops_here)')
    expect(r.out).toContain('uploaded ')
    expect(r.out).toContain('::notice title=ai-files probe::upload: attempt 1 of 3 answered 502; trying again in 2 s')
    // …and its clean-up deletes the file of the attempt that succeeded, once.
    const seen = calls()
    expect(seen.filter((c) => c.startsWith('upload'))).toHaveLength(3)
    expect(seen.filter((c) => c.startsWith('get'))).toHaveLength(1)
    expect(seen.filter((c) => c.startsWith('delete'))).toEqual(['delete {"file_id":"file_stub01"}'])
    expect(seen.filter((c) => c.startsWith('sleep'))).toEqual(['sleep 2', 'sleep 4'])
  })
  it.skipIf(!hasJq)('CONTROL: step 1 answered 401: one attempt, the probe fails there, nothing to delete', () => {
    signIn()
    plan('upload', '401 {"error":"unauthorized"}', '200 {"id":"file_never"}')
    const r = runProbe()
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error title=ai-files probe::upload returned 401 (unauthorized)')
    expect(r.out).not.toContain('::notice')
    expect(calls().filter((c) => /^(upload|delete|sleep)/.test(c))).toEqual(['upload '])
  })
  it.skipIf(!hasJq)('three 502s: the probe fails with the status after the third attempt', () => {
    signIn()
    plan('upload', '502 {"error":"bad gateway"}')
    const r = runProbe()
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error title=ai-files probe::upload returned 502 (bad gateway)')
    expect(calls().filter((c) => c.startsWith('upload'))).toHaveLength(3)
    expect(calls().filter((c) => c.startsWith('delete'))).toEqual([])
  })
})
