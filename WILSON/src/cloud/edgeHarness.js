// =============================================================================
// edgeHarness.js — F8 (wave 2, 2026-11-13): an Edge Function, run in vitest.
//
// The functions under supabase/functions/ import supabase-js by its esm.sh URL
// and read `Deno.env`, so until now a test could import only their pure
// modules, or read an index.ts as text. This runs the real thing: the test
// file mocks the one URL import with `createClient` below, `loadFunction`
// stands in for `Deno` (the environment and `Deno.serve`, which hands back the
// handler), and the handler is called with ordinary Request objects. What it
// answers (status, code, body, headers) is the function's own.
//
// In the test file, once, at the top (vi.mock is hoisted there):
//
//   vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => ({
//     createClient: (await import('./edgeHarness.js')).createClient,
//   }))
//
// The database is a WORLD the test scripts: `world.table(name, fn)` answers
// every statement on a table, `world.rpc(name, fn)` every call of a function,
// `world.auth` the GoTrue calls. Each fn is given what was asked (the columns,
// the filters, the rows, and WHICH client asked: the service role's or the
// caller's own token), so a test can pin not only the answer but who read
// what, and count the round trips. Nothing here is a secret: every key is a
// word made up below.
// =============================================================================

export const SUPABASE_URL = 'https://edge-harness.supabase.co'
export const SERVICE_KEY = 'harness-service-role-key'
export const ANON_KEY = 'harness-anon-key'

// The world lives on globalThis, not in this module: `loadFunction` resets the
// module registry so a function's top-level code runs again, and vitest may
// then hand the mocked import a SECOND copy of this file. Both copies must see
// the one world the test scripted.
const WORLD = Symbol.for('wilson.edgeHarness.world')
const current = () => globalThis[WORLD] ?? null

/** A fresh world. Unscripted tables answer no rows; unscripted functions answer null. */
export function newWorld() {
  const w = {
    tables: new Map(),
    rpcs: new Map(),
    /** Every statement and call, in order: { kind: 'table' | 'rpc' | 'auth', name, op, by, ... }. */
    calls: [],
    /** Every client made: { key, by, options }. */
    clients: [],
    auth: {
      /** token → user object, or null for a token GoTrue refuses. */
      users: new Map(),
      /** user id → factors array, or an Error to fail the read. */
      factors: new Map(),
      /** user id → the admin API's user, for getUserById. */
      byId: new Map(),
      /** Overrides for the admin calls a test cares about. */
      admin: {},
    },
    table(name, fn) { w.tables.set(name, fn); return w },
    rpc(name, fn) { w.rpcs.set(name, fn); return w },
    count(pred) { return w.calls.filter(pred).length },
  }
  globalThis[WORLD] = w
  return w
}

function builder(client, table) {
  const q = { table, op: 'select', columns: null, filters: [], values: null, options: null, terminal: null, by: client.by, order: [], range: null, limit: null }
  const run = async () => {
    const world = current()
    world.calls.push({ kind: 'table', name: table, ...q })
    const fn = world.tables.get(table)
    const out = fn ? await fn(q) : { data: q.terminal ? null : [], error: null }
    return { data: null, error: null, count: null, ...out }
  }
  const b = {
    select(columns = '*', options = null) { if (q.op === 'select') { q.columns = columns; q.options = options } else { q.returning = columns }; return b },
    insert(values) { q.op = 'insert'; q.values = values; return b },
    upsert(values, options = null) { q.op = 'upsert'; q.values = values; q.options = options; return b },
    update(values) { q.op = 'update'; q.values = values; return b },
    delete() { q.op = 'delete'; return b },
    order(column, options = null) { q.order.push({ column, options }); return b },
    limit(n) { q.limit = n; return b },
    range(from, to) { q.range = [from, to]; return b },
    maybeSingle() { q.terminal = 'maybeSingle'; return run() },
    single() { q.terminal = 'single'; return run() },
    then(resolve, reject) { return run().then(resolve, reject) },
  }
  for (const f of ['eq', 'neq', 'is', 'like', 'ilike', 'gt', 'gte', 'lt', 'lte', 'in']) {
    b[f] = (column, value) => { q.filters.push({ f, column, value }); return b }
  }
  b.not = (column, f, value) => { q.filters.push({ f: `not.${f}`, column, value }); return b }
  return b
}

/** What the mocked import hands the function: a client over the current world. */
export function createClient(url, key, options = undefined) {
  const world = current()
  if (!world) throw new Error('edgeHarness: newWorld() first')
  const bearer = options?.global?.headers?.Authorization ?? null
  const by = key === SERVICE_KEY ? 'service' : (bearer ? 'caller' : 'anon')
  const client = { url, key, by, options, bearer }
  world.clients.push({ key, by, options })
  const authCall = async (name, args, fallback) => {
    world.calls.push({ kind: 'auth', name, by, args })
    const over = world.auth.admin[name]
    return over ? await over(...args) : await fallback()
  }
  client.from = (table) => builder(client, table)
  client.rpc = (name, args = undefined) => {
    const call = { kind: 'rpc', name, args, by, range: null }
    const run = async () => {
      world.calls.push(call)
      const fn = world.rpcs.get(name)
      const out = fn ? await fn(args, call) : { data: null, error: null }
      return { data: null, error: null, ...out }
    }
    const r = { range(from, to) { call.range = [from, to]; return r }, then(resolve, reject) { return run().then(resolve, reject) } }
    return r
  }
  client.auth = {
    getUser: (token) => authCall('getUser', [token], () => {
      const user = world.auth.users.get(token) ?? null
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
    }),
    admin: {
      getUserById: (id) => authCall('getUserById', [id], () => {
        const user = world.auth.byId.get(id) ?? null
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'User not found' } }
      }),
      updateUserById: (id, attrs) => authCall('updateUserById', [id, attrs], () => ({ data: { user: { id } }, error: null })),
      createUser: (attrs) => authCall('createUser', [attrs], () => ({ data: { user: { id: 'new-user-id', email: attrs.email } }, error: null })),
      inviteUserByEmail: (email, opts) => authCall('inviteUserByEmail', [email, opts], () => ({ data: { user: { id: 'invited-user-id', email } }, error: null })),
      deleteUser: (id) => authCall('deleteUser', [id], () => ({ data: {}, error: null })),
      mfa: {
        listFactors: ({ userId }) => authCall('listFactors', [userId], () => {
          const f = world.auth.factors.get(userId)
          if (f instanceof Error) return { data: null, error: f }
          return { data: { factors: f ?? [] }, error: null }
        }),
      },
    },
  }
  return client
}

/** The round trips of a world, in order, as words: 'auth:getUser', 'table:workspace_members', 'rpc:fn_rate_limit_hit'. */
export const trips = (w) => w.calls.map((c) => `${c.kind}:${c.name}`)

/** A sign-in token as GoTrue mints one: only its payload is read (the claims), never verified here. */
export function tokenFor(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}.harness-signature`
}

/** Seat a caller in the world: GoTrue knows the token, and (unless told not to) the membership row is live. */
export function seatCaller(w, { userId = 'user-1', workspaceId = 'ws-1', role = 'admin', aal = 'aal1', active = true, member = true, factors = [], email = 'caller@example.test' } = {}) {
  const token = tokenFor({ sub: userId, aal, app_metadata: { workspace_id: workspaceId, app_role: role } })
  w.auth.users.set(token, { id: userId, email, app_metadata: { workspace_id: workspaceId } })
  w.auth.factors.set(userId, factors)
  if (!w.tables.has('workspace_members')) {
    w.table('workspace_members', (q) => {
      const ws = q.filters.find((f) => f.column === 'workspace_id')?.value
      const uid = q.filters.find((f) => f.column === 'user_id')?.value
      const hit = member && uid === userId && (ws === undefined || ws === workspaceId)
      const row = hit ? { app_role: role, is_active: active, username: 'caller', workspace_id: workspaceId, user_id: userId } : null
      return { data: q.terminal ? row : (row ? [row] : []), error: null }
    })
  }
  return { token, userId, workspaceId }
}

export const VERIFIED_TOTP = [{ factor_type: 'totp', status: 'verified' }]

/**
 * Import a function's index.ts with `Deno` stood in, and hand back its handler.
 * `vi` is the test's own (this file imports nothing from vitest, so it stays a plain module).
 */
export async function loadFunction(vi, name, env = {}) {
  const values = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY, ...env }
  let handler = null
  vi.stubGlobal('Deno', {
    env: { get: (n) => values[n] },
    serve: (h) => { handler = h },
  })
  vi.resetModules()
  await import(/* @vite-ignore */ `../../supabase/functions/${name}/index.ts`)
  if (!handler) throw new Error(`edgeHarness: ${name}/index.ts did not call Deno.serve`)
  return { handler, env: values }
}

/** A POST with a JSON body (or `raw` bytes/text as they are), signed in when a token is given. */
export function post(body, { token = null, raw = undefined, headers = {}, method = 'POST' } = {}) {
  const h = { 'content-type': 'application/json', ...headers }
  if (token) h.authorization = `Bearer ${token}`
  const init = { method, headers: h }
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    init.body = raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body))
    if (init.body && typeof init.body === 'object' && typeof init.body.getReader === 'function') init.duplex = 'half'
  }
  return new Request('https://edge-harness.test/functions/v1/x', init)
}

/** The parts of an answer a pin compares: status, the JSON body, and the headers that are the function's own. */
export async function answerOf(res) {
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = undefined }
  const headers = {}
  for (const k of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'content-type', 'cache-control']) {
    const v = res.headers.get(k)
    if (v !== null) headers[k] = v
  }
  return { status: res.status, json, text, headers }
}

/** A body that never ends: `chunkBytes` at a time, forever, counting what was pulled and whether it was cancelled. */
export function endlessBody(chunkBytes = 1024) {
  const state = { pulled: 0, cancelled: false }
  const chunk = new Uint8Array(chunkBytes).fill(0x20)
  const stream = new ReadableStream({
    pull(controller) { state.pulled += chunkBytes; controller.enqueue(chunk) },
    cancel() { state.cancelled = true },
  }, { highWaterMark: 0 })
  return { stream, state }
}
