#!/usr/bin/env bash
# =============================================================================
# gateway-ticket smoke probe — GW1 (post-overhaul, 2026-10-10)
#
# The deployed gateway-ticket on wilson-dev, called with a REAL ES256 sign-in
# token (a local stack signs HS256, so only the hosted project can prove the
# member guard and the as-the-caller predicates on a real token). Signs in as
# the probe user exactly as issue-session.sh does, then:
#
#   1. tickets for [the probe clip, another company's clip, an unknown id]
#      through the probe gateway: ONE ticket (the clip the user may read) in
#      the wire's shape — v1.<payload>.<sig>, ≤ 4096 characters, the claims
#      in order, gw / ws / sub / clip as asked, exp = iat + 120, a 32-hex jti
#      — and the other two answered `missing`, the same way (no oracle)
#   2. the same through a FORGOTTEN gateway: 404 gateway_unavailable
#   3. no sign-in at all: 401
#
# The probe gateway, the forgotten one and the two clips are GW1's fixture on
# wilson-dev (ids beginning 96960001- and the probe gateway's own id; the
# SQL is in GW1's hand-off). If the fixture is gone (dev was reset) the
# first call answers 404 and this prints a warning and passes, rather than
# failing every branch's CI for missing test data.
#
# Required env: SUPABASE_URL, SUPABASE_ANON_KEY, PROBE_USERNAME, PROBE_PASSWORD
# Optional env: GW1_PROBE_GATEWAY, GW1_PROBE_FORGOTTEN, GW1_PROBE_CLIP,
#               GW1_PROBE_OTHER_CLIP (default to the dev fixture)
# =============================================================================

set -euo pipefail

err() { printf '\e[31mFAIL\e[0m %s\n' "$*" >&2; echo "::error title=gateway-ticket probe::$*"; exit 1; }
ok()  { printf '\e[32m OK \e[0m %s\n' "$*"; }

# What a failure may print (GW1 review round 2, finding 7): the annotations
# are public, so never a response body (a ticket is a bearer: two minutes of
# one clip) and never the claims; only the answer's shape, its error code
# and how many tickets, missing and refused it held.
shape() { printf '%s' "$1" | jq -c '{ error: (.error // null), tickets: ((.tickets // {}) | length), missing: ((.missing // []) | length), refused: ((.refused // []) | length) }' 2>/dev/null || printf 'not JSON, %s bytes' "${#1}"; }

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY must be set}"
: "${PROBE_USERNAME:?PROBE_USERNAME must be set}"
: "${PROBE_PASSWORD:?PROBE_PASSWORD must be set}"
GATEWAY="${GW1_PROBE_GATEWAY:-55650240-25c9-45e6-a32e-1888631ad00e}"
FORGOTTEN="${GW1_PROBE_FORGOTTEN:-96960001-0000-4000-8000-00000000aa02}"
CLIP="${GW1_PROBE_CLIP:-96960001-0000-4000-8000-0000000000f1}"
OTHER="${GW1_PROBE_OTHER_CLIP:-96960001-0000-4000-8000-0000000000f2}"
UNKNOWN="96960001-0000-4000-8000-0000000000ff"

command -v jq   >/dev/null || err "jq is required"
command -v curl >/dev/null || err "curl is required"

b64url_json() {
  local s="${1//-/+}"; s="${s//_//}"
  while [ $(( ${#s} % 4 )) -ne 0 ]; do s="${s}="; done
  printf '%s' "$s" | base64 -d
}

# ── Sign in as the probe user (issue-session.sh's steps 1–2) ─────────────────
resolve_json=$(curl -sS -X POST "${SUPABASE_URL}/functions/v1/resolve-login" \
  -H 'content-type: application/json' -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -cn --arg u "$PROBE_USERNAME" '{ username: $u }')")
email=$(printf '%s' "$resolve_json" | jq -r '.email // empty')
[ -n "$email" ] || err "resolve-login found no probe user"
token=$(curl -sS -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H 'content-type: application/json' -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -cn --arg e "$email" --arg p "$PROBE_PASSWORD" '{ email: $e, password: $p }')" | jq -r '.access_token // empty')
[ -n "$token" ] || err "the probe user could not sign in"
claims=$(b64url_json "$(printf '%s' "$token" | cut -d. -f2)")
sub=$(printf '%s' "$claims" | jq -r '.sub')
ws=$(printf '%s' "$claims" | jq -r '.app_metadata.workspace_id // empty')
ok "signed in (${#token}-character token)"

call() { # $1 body, $2 bearer (or empty) -> "<json>\n<status>"
  if [ -n "$2" ]; then
    curl -sS -w '\n%{http_code}' -X POST "${SUPABASE_URL}/functions/v1/gateway-ticket" \
      -H 'content-type: application/json' -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer $2" --data "$1"
  else
    curl -sS -w '\n%{http_code}' -X POST "${SUPABASE_URL}/functions/v1/gateway-ticket" \
      -H 'content-type: application/json' --data "$1"
  fi
}

# ── 1. One ticket, two missing ───────────────────────────────────────────────
resp=$(call "$(jq -cn --arg g "$GATEWAY" --arg a "$CLIP" --arg b "$OTHER" --arg c "$UNKNOWN" '{ gateway_id: $g, bin_file_ids: [$a, $b, $c] }')" "$token")
code=$(printf '%s\n' "$resp" | tail -n1); json=$(printf '%s\n' "$resp" | sed '$d')
if [ "$code" = "404" ]; then
  echo "::warning title=gateway-ticket probe::GW1's probe fixture is not on this database (the probe gateway answered 404); skipped"
  exit 0
fi
[ "$code" = "200" ] || err "gateway-ticket returned $code: $(shape "$json")"
ticket=$(printf '%s' "$json" | jq -r --arg c "$CLIP" '.tickets[$c] // empty')
[ -n "$ticket" ] || err "no ticket for the clip the probe user may read: $(shape "$json")"
[ "$(printf '%s' "$json" | jq -r '.tickets | length')" = "1" ] || err "more than one ticket: $(shape "$json")"
[ "$(printf '%s' "$json" | jq -c '.missing | sort')" = "$(jq -cn --arg b "$OTHER" --arg c "$UNKNOWN" '[$b, $c] | sort')" ] \
  || err "another company's clip and an unknown id must both be missing: $(shape "$json")"
[ "${#ticket}" -le 4096 ] || err "the ticket is ${#ticket} characters"
[[ "$ticket" =~ ^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$ ]] || err "the ticket is not v1.<payload>.<sig>"
payload=$(b64url_json "$(printf '%s' "$ticket" | cut -d. -f2)")
keys=$(printf '%s' "$payload" | jq -c 'keys_unsorted')
[ "$keys" = '["v","kid","gw","ws","sub","clip","loc","path","seq","mt","rv","iat","exp","jti"]' ] || err "claims out of order: $keys"
printf '%s' "$payload" | jq -e --arg g "$GATEWAY" --arg w "$ws" --arg s "$sub" --arg c "$CLIP" \
  '.v == 1 and .gw == $g and .ws == $w and .sub == $s and .clip == $c and (.exp - .iat) == 120 and (.jti | test("^[0-9a-f]{32}$")) and (.rv | type) == "boolean"' >/dev/null \
  || err "the claims are not the wire's (their keys: $keys)"
ok "one ticket for the readable clip (${#ticket} characters, claims in order); two missing"

# ── 2. A forgotten gateway ───────────────────────────────────────────────────
resp=$(call "$(jq -cn --arg g "$FORGOTTEN" --arg a "$CLIP" '{ gateway_id: $g, bin_file_ids: [$a] }')" "$token")
code=$(printf '%s\n' "$resp" | tail -n1); json=$(printf '%s\n' "$resp" | sed '$d')
[ "$code" = "404" ] && [ "$(printf '%s' "$json" | jq -r '.error')" = "gateway_unavailable" ] \
  || err "a forgotten gateway must be 404 gateway_unavailable, got $code: $(shape "$json")"
ok "a forgotten gateway mints nothing (404)"

# ── 3. No sign-in ────────────────────────────────────────────────────────────
resp=$(call "$(jq -cn --arg g "$GATEWAY" --arg a "$CLIP" '{ gateway_id: $g, bin_file_ids: [$a] }')" "")
code=$(printf '%s\n' "$resp" | tail -n1)
[ "$code" = "401" ] || err "no sign-in must be 401, got $code"
ok "no sign-in, no ticket (401)"

printf '\n\e[32mPASS\e[0m gateway-ticket smoke probe\n'
echo "::notice title=gateway-ticket probe::one ticket in the wire's shape, two missing, a forgotten gateway 404, no sign-in 401"
