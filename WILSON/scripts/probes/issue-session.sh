#!/usr/bin/env bash
# =============================================================================
# issue-session smoke probe
#
# Exercises the full pre-auth + auth + workspace-switch path end-to-end:
#   1. resolve-login:   username  -> { exists, email }
#   2. signInWithPassword (GoTrue): email + password  -> access_token
#   3. issue-session:   access_token  -> { workspace_id, workspace_ids }
#
# Guards the Session 3 exit criterion "issue-session returns 200 on a valid
# JWT; CI guard in place so the next 401 regression fails a push".
#
# Runs locally (reads .env.development via caller's shell) and in CI (reads
# GitHub Actions secrets). Fails fast on the first non-2xx response.
#
# Required env:
#   SUPABASE_URL             e.g. https://<ref>.supabase.co
#   SUPABASE_ANON_KEY        project anon key
#   PROBE_USERNAME           workspace-scoped username of the test user
#   PROBE_PASSWORD           test user's password
#
# Optional env:
#   PROBE_WORKSPACE_ID       if set, passed to issue-session and asserted on
#                            the response; otherwise the Edge Function picks
#                            the oldest membership
#
# Usage:
#   scripts/probes/issue-session.sh
#
# Local-dev note: requires `jq` and `curl`. CI (ubuntu-latest) installs jq
# in the workflow step. For local use on Windows: `scoop install jq`
# (or `choco install jq`). macOS: `brew install jq`.
#
# Exits non-zero on any failure. Prints the failing step + HTTP status to
# stderr. Prints a one-line success summary on the happy path.
# =============================================================================

set -euo pipefail

err() { printf '\e[31mFAIL\e[0m %s\n' "$*" >&2; exit 1; }
ok()  { printf '\e[32m OK \e[0m %s\n' "$*"; }
note(){ printf '\e[90m ·  \e[0m %s\n' "$*"; }

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY must be set}"
: "${PROBE_USERNAME:?PROBE_USERNAME must be set}"
: "${PROBE_PASSWORD:?PROBE_PASSWORD must be set}"

command -v jq   >/dev/null || err "jq is required"
command -v curl >/dev/null || err "curl is required"

# ── Step 1: resolve-login ────────────────────────────────────────────────────
note "POST ${SUPABASE_URL}/functions/v1/resolve-login"
resolve_body=$(jq -cn --arg u "$PROBE_USERNAME" '{ username: $u }')
resolve_resp=$(curl -sS -w '\n%{http_code}' \
  -X POST "${SUPABASE_URL}/functions/v1/resolve-login" \
  -H 'content-type: application/json' \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$resolve_body")
resolve_code=$(printf '%s\n' "$resolve_resp" | tail -n1)
resolve_json=$(printf '%s\n' "$resolve_resp" | sed '$d')
[ "$resolve_code" = "200" ] || err "resolve-login returned $resolve_code: $resolve_json"

exists=$(printf '%s' "$resolve_json" | jq -r '.exists // false')
email=$(printf '%s'  "$resolve_json" | jq -r '.email  // empty')
[ "$exists" = "true" ] && [ -n "$email" ] || err "resolve-login says user missing: $resolve_json"
ok "resolve-login  -> $email"

# ── Step 2: signInWithPassword via GoTrue REST ───────────────────────────────
note "POST ${SUPABASE_URL}/auth/v1/token?grant_type=password"
signin_body=$(jq -cn --arg e "$email" --arg p "$PROBE_PASSWORD" '{ email: $e, password: $p }')
signin_resp=$(curl -sS -w '\n%{http_code}' \
  -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H 'content-type: application/json' \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$signin_body")
signin_code=$(printf '%s\n' "$signin_resp" | tail -n1)
signin_json=$(printf '%s\n' "$signin_resp" | sed '$d')
[ "$signin_code" = "200" ] || err "signIn returned $signin_code: $signin_json"

access_token=$(printf '%s' "$signin_json" | jq -r '.access_token // empty')
[ -n "$access_token" ] || err "signIn produced no access_token: $signin_json"
ok "signInWithPassword  -> token ${#access_token} chars"

# ── Step 3: issue-session (the thing we're actually testing) ────────────────
note "POST ${SUPABASE_URL}/functions/v1/issue-session"
if [ -n "${PROBE_WORKSPACE_ID:-}" ]; then
  issue_body=$(jq -cn --arg w "$PROBE_WORKSPACE_ID" '{ workspace_id: $w }')
else
  issue_body='{}'
fi
issue_resp=$(curl -sS -w '\n%{http_code}' \
  -X POST "${SUPABASE_URL}/functions/v1/issue-session" \
  -H 'content-type: application/json' \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "authorization: Bearer ${access_token}" \
  --data "$issue_body")
issue_code=$(printf '%s\n' "$issue_resp" | tail -n1)
issue_json=$(printf '%s\n' "$issue_resp" | sed '$d')
[ "$issue_code" = "200" ] || err "issue-session returned $issue_code: $issue_json"

got_ws=$(printf  '%s' "$issue_json" | jq -r '.workspace_id  // empty')
got_ids=$(printf '%s' "$issue_json" | jq -r '.workspace_ids // empty | length')
[ -n "$got_ws" ] || err "issue-session missing workspace_id: $issue_json"
[ "$got_ids" -ge 1 ] || err "issue-session returned empty workspace_ids: $issue_json"

if [ -n "${PROBE_WORKSPACE_ID:-}" ]; then
  [ "$got_ws" = "$PROBE_WORKSPACE_ID" ] \
    || err "issue-session returned workspace_id=$got_ws, expected $PROBE_WORKSPACE_ID"
fi
ok "issue-session  -> workspace_id=$got_ws (memberships: $got_ids)"

printf '\n\e[32mPASS\e[0m issue-session smoke probe\n'
