// =============================================================================
// issue-session Edge Function
//
// Called by the client AFTER signInWithPassword succeeds, to (re-)issue a JWT
// with a specific workspace_id baked into app_metadata. Used for two cases:
//
//   1. Multi-workspace users choosing which workspace to enter at login.
//   2. Switching workspaces mid-session.
//
// Implementation: we update the user's app_metadata.workspace_id via the admin
// API, then force a session refresh on the client (which re-runs the
// custom_access_token_hook and picks up the new workspace_id).
//
// The custom_access_token_hook itself is the load-bearing piece — this
// function is the trigger. Never trust client-supplied workspace_id without
// verifying membership.
//
// F8 (wave 2, 2026-11-13): the token check (the bearer, sliced and never
// trimmed, then GoTrue) is adminGuard.authenticate, and the answers are
// adminGuard's corsHeaders and reply: the same four headers, byte for byte,
// that this file used to build by hand. Everything after the token is its own.
//
// F8 (e): the body is read under a cap (gatewayWire.SIGN_IN_JSON_MAX_BYTES,
// 4 KiB; the real body is 55 bytes). Past it, 413 too_large, after the token
// is checked and BEFORE the memberships are read or anything is updated.
// Nothing sent, or text that is not JSON, is still read as {} (the oldest
// membership), and a JSON null is still handed on as it is.
// =============================================================================

import { authenticate, corsHeaders, reply } from '../_shared/adminGuard.ts'
import { readBodyJson, SIGN_IN_JSON_MAX_BYTES, TOO_LARGE } from '../_shared/gatewayWire.ts'

type Body = { workspace_id?: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return reply({ error: 'method_not_allowed' }, 405)
  }

  // The Edge gateway's built-in verify_jwt is disabled for this function in
  // config.toml — it only supports HS256 and this project's JWTs are ES256,
  // which the gateway rejects with UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM
  // before our code runs. We validate the token ourselves via
  // admin.auth.getUser(token), which routes through GoTrue and handles ES256:
  // the service-role client, made only once a token is found, with the token
  // passed as an explicit argument.
  const who = await authenticate(req)
  if (!who.ok) {
    return reply({ error: 'unauthorized' }, 401)
  }
  const { admin, user } = who.caller

  let body: Body
  const sent = await readBodyJson(req, SIGN_IN_JSON_MAX_BYTES)
  if (sent.kind === 'too_large') return reply({ ...TOO_LARGE }, 413)
  // not_json is what the old `catch` read as {}; a parsed value goes on untouched.
  body = (sent.kind === 'json' ? sent.value : {}) as Body

  // Collect the user's memberships.
  const { data: memberships, error: memErr } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (memErr || !memberships || memberships.length === 0) {
    return reply({ error: 'no_workspaces' }, 403)
  }

  const ids = memberships.map((m) => m.workspace_id as string)

  // Pick the requested workspace if provided AND the user belongs to it;
  // otherwise the oldest membership.
  let active = body.workspace_id && ids.includes(body.workspace_id)
    ? body.workspace_id
    : ids[0]

  // Persist to app_metadata so the custom_access_token_hook picks it up on the
  // next token issuance. Supabase merges what we send; we set the full shape
  // for safety.
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...user.app_metadata,
      workspace_id: active,
    },
  })
  if (updateErr) {
    return reply({ error: 'update_failed' }, 500)
  }

  // Client is responsible for calling supabase.auth.refreshSession() after
  // a 200 response; that refresh re-runs the hook and the new token carries
  // the correct workspace_id.
  return reply({ workspace_id: active, workspace_ids: ids }, 200)
})
