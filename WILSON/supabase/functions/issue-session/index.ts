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
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}

type Body = { workspace_id?: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  // The Edge gateway's built-in verify_jwt is disabled for this function in
  // config.toml — it only supports HS256 and this project's JWTs are ES256,
  // which the gateway rejects with UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM
  // before our code runs. We validate the token ourselves via
  // admin.auth.getUser(token), which routes through GoTrue and handles ES256.
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : ''
  if (!token) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Resolve (and verify) the user via the service-role admin client with the
  // token passed as an explicit argument. This hits GoTrue's user-by-JWT
  // endpoint, which correctly validates ES256 JWTs in the Edge runtime.
  const { data: me, error: meErr } = await admin.auth.getUser(token)
  if (meErr || !me.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  // Collect the user's memberships.
  const { data: memberships, error: memErr } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', me.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (memErr || !memberships || memberships.length === 0) {
    return new Response(JSON.stringify({ error: 'no_workspaces' }), {
      status: 403,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
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
  const { error: updateErr } = await admin.auth.admin.updateUserById(me.user.id, {
    app_metadata: {
      ...me.user.app_metadata,
      workspace_id: active,
    },
  })
  if (updateErr) {
    return new Response(JSON.stringify({ error: 'update_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  // Client is responsible for calling supabase.auth.refreshSession() after
  // a 200 response; that refresh re-runs the hook and the new token carries
  // the correct workspace_id.
  return new Response(
    JSON.stringify({ workspace_id: active, workspace_ids: ids }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } }
  )
})
