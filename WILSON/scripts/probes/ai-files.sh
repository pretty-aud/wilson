#!/usr/bin/env bash
# =============================================================================
# ai-files smoke probe — FX12 (post-overhaul, 2026-10-25, OUTSTANDING DG1-03)
#
# The deployed ai-files on wilson-dev, called with a REAL sign-in token as the
# probe user (the seeded smoke admin; issue-session.sh's sign-in). It is the
# only way a session can make these calls signed in: the probe user's
# password is a GitHub secret. One tiny text file (a few dozen bytes, no
# content, a neutral name) goes to the AI provider's file store and is
# deleted again before the probe ends; it also asks to expire in an hour, in
# case the probe dies in between.
#
#   1. upload, asking for an expiry          → 200 and an id
#   2. the list (GET) shows it, with its size, an expiry, and no filename
#      anywhere in the answer; the upload row binds to it (the row's time
#      against the store's, measured)
#   3. the sweep (only when the oldest file here is under 20 h, so the probe can
#      never delete anything by it): our fresh file is SKIPPED as recent
#   4. delete it                             → deleted, with a certificate
#   5. delete it again                       → gone (the store's 404), with a
#      certificate
#   5b. a forged upload row naming an absent id → not_found, no certificate
#      (the certificates are in the admin stream, which members cannot write)
#   6. a messages call that references it    → the dead reference's answer,
#      measured (status, error type, whether it names the id) — D.O.G.'s
#      fallback is built to this answer
#   7. an id this workspace never uploaded   → not_found
#   8. no sign-in                            → 401 (the function's own JSON)
#   9. the operator's summary as a member    → 403
#
# What a failure may print (the annotations are public): statuses, error
# codes, outcomes, counts and the probe's own file id. Never a token, never a
# body that could carry anything else.
#
# Required env: SUPABASE_URL, SUPABASE_ANON_KEY, PROBE_USERNAME, PROBE_PASSWORD
# Optional env: AI_FILES_PROBE_MODEL (the dead-reference call's model)
# =============================================================================

set -euo pipefail

err()  { printf '\e[31mFAIL\e[0m %s\n' "$*" >&2; echo "::error title=ai-files probe::$*"; exit 1; }
ok()   { printf '\e[32m OK \e[0m %s\n' "$*"; }
note() { printf '\e[36mMEASURED\e[0m %s\n' "$*"; echo "::notice title=ai-files probe::$*"; }

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY must be set}"
: "${PROBE_USERNAME:?PROBE_USERNAME must be set}"
: "${PROBE_PASSWORD:?PROBE_PASSWORD must be set}"
MODEL="${AI_FILES_PROBE_MODEL:-claude-haiku-4-5-20251001}"
FN="${SUPABASE_URL}/functions/v1/ai-files"

command -v jq   >/dev/null || err "jq is required"
command -v curl >/dev/null || err "curl is required"

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
b64url_json() {
  local s="${1//-/+}"; s="${s//_//}"
  while [ $(( ${#s} % 4 )) -ne 0 ]; do s="${s}="; done
  printf '%s' "$s" | base64 -d
}
ws=$(b64url_json "$(printf '%s' "$token" | cut -d. -f2)" | jq -r '.app_metadata.workspace_id // empty')
[ -n "$ws" ] || err "the probe user's token names no workspace"
ok "signed in (${#token}-character token)"

# $1 method, $2 body (or empty) -> "<json>\n<status>"
call() {
  if [ -n "${2:-}" ]; then
    curl -sS -w '\n%{http_code}' -X "$1" "$FN" -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}" \
      -H 'content-type: application/json' --data "$2"
  else
    curl -sS -w '\n%{http_code}' -X "$1" "$FN" -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}"
  fi
}
status_of() { printf '%s\n' "$1" | tail -n1; }
json_of()   { printf '%s\n' "$1" | sed '$d'; }

# ── 1. Upload a few bytes, asking to expire in an hour ───────────────────────
tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT
printf 'WILSON CI probe. This file has no content.\n' > "$tmp/probe.txt"
bytes=$(wc -c < "$tmp/probe.txt" | tr -d ' ')
up=$(curl -sS -w '\n%{http_code}' -X POST "$FN" -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}" \
  -F 'expires_in_seconds=3600' -F "file=@$tmp/probe.txt;type=text/plain;filename=wilson-ci-probe.txt")
code=$(status_of "$up"); json=$(json_of "$up")
expiry_asked=1
if [ "$code" = "400" ]; then
  note "an upload asking expires_in_seconds was refused (400, $(printf '%s' "$json" | jq -r '.anthropic.error.type // .error // "?"')); uploading without it"
  expiry_asked=0
  up=$(curl -sS -w '\n%{http_code}' -X POST "$FN" -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}" \
    -F "file=@$tmp/probe.txt;type=text/plain;filename=wilson-ci-probe.txt")
  code=$(status_of "$up"); json=$(json_of "$up")
fi
[ "$code" = "200" ] || err "upload returned $code ($(printf '%s' "$json" | jq -r '.error // "?"'))"
fid=$(printf '%s' "$json" | jq -r '.id // empty')
[[ "$fid" =~ ^file_[A-Za-z0-9]+$ ]] || err "upload answered no file id"
ok "uploaded ${bytes} bytes as ${fid}"

# Whatever happens next, the probe's file does not outlive the probe.
cleanup() {
  if [ -n "${fid:-}" ] && [ "${deleted:-0}" != "1" ]; then
    curl -sS -o /dev/null -X DELETE "$FN" -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}" \
      -H 'content-type: application/json' --data "$(jq -cn --arg f "$fid" '{ file_id: $f }')" || true
  fi
  rm -rf "$tmp"
}

# ── 2. The list shows it, and no filename anywhere ───────────────────────────
resp=$(call GET); code=$(status_of "$resp"); json=$(json_of "$resp")
[ "$code" = "200" ] || err "list returned $code ($(printf '%s' "$json" | jq -r '.error // "?"'))"
printf '%s' "$json" | grep -q -i 'filename\|wilson-ci-probe' && err "the list answered a filename"
mine=$(printf '%s' "$json" | jq -c --arg f "$fid" '[.files[] | select(.id == $f)] | first // empty')
[ -n "$mine" ] || err "the list does not show the file just uploaded (the row did not bind?): scope $(printf '%s' "$json" | jq -r '.scope'), count $(printf '%s' "$json" | jq -r '.count')"
[ "$(printf '%s' "$mine" | jq -r '.size_bytes')" = "$bytes" ] || err "the list's size is not the upload's"
[ "$(printf '%s' "$json" | jq -r '.scope')" = "workspace" ] || err "the probe user is the workspace's admin; the list's scope should be the workspace"
expires_at=$(printf '%s' "$mine" | jq -r '.expires_at // empty')
created_at=$(printf '%s' "$mine" | jq -r '.created_at')
if [ -n "$expires_at" ]; then
  life=$(( $(date -d "$expires_at" +%s) - $(date -d "$created_at" +%s) ))
  note "the store set expires_at ${life}s after created_at (asked: $([ "$expiry_asked" = 1 ] && echo 3600 || echo none))"
else
  note "the store answered no expires_at (asked: $([ "$expiry_asked" = 1 ] && echo 3600 || echo none))"
fi
# The upload row's own time against the store's: the binding's window.
row=$(curl -sS "${SUPABASE_URL}/rest/v1/app_events?select=created_at,context&code=eq.WIL-6001&context->>file_id=eq.${fid}&context->>tool=eq.ai-files" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}")
row_at=$(printf '%s' "$row" | jq -r '[.[] | select(.context.stage == null)] | first | .created_at // empty')
if [ -n "$row_at" ]; then
  skew_ms=$(( ( $(date -d "$row_at" +%s%3N) - $(date -d "$created_at" +%s%3N) ) ))
  note "the upload row was written ${skew_ms} ms after the store's created_at"
fi
ok "the list shows it ($(printf '%s' "$json" | jq -r '.count') file(s) in this workspace, no filename)"

# ── 3. The sweep never takes a fresh file (run only when it cannot delete) ──
# Only when the OLDEST file here is under 20 hours old (review round 1,
# finding 8): a file at 23 h 59 m would cross the sweep's 24 h between the
# list and the sweep, and a CI job must never be the one that deletes by it.
sweepable=$(printf '%s' "$json" | jq -r '.sweepable')
oldest=$(printf '%s' "$json" | jq -r '.oldest // empty')
oldest_h=0
[ -n "$oldest" ] && oldest_h=$(( ( $(date +%s) - $(date -d "$oldest" +%s) ) / 3600 ))
if [ "$sweepable" = "0" ] && [ "$oldest_h" -lt 20 ]; then
  resp=$(call DELETE '{"sweep":true}'); code=$(status_of "$resp"); json=$(json_of "$resp")
  [ "$code" = "200" ] || err "the sweep returned $code ($(printf '%s' "$json" | jq -r '.error // "?"'))"
  [ "$(printf '%s' "$json" | jq -r '.counts.deleted')" = "0" ] || err "the sweep deleted something"
  [ "$(printf '%s' "$json" | jq -r '.counts.skipped_recent')" -ge 1 ] || err "the sweep did not count the fresh file as recent"
  ok "the sweep skipped the fresh file ($(printf '%s' "$json" | jq -c '.counts | {deleted, skipped_recent, truncated}'))"
else
  echo "::warning title=ai-files probe::the probe workspace holds a file ${oldest_h} h old (${sweepable} past the sweep's age); the probe does not sweep near the age (a person does)"
fi
resp=$(call DELETE '{"sweep":true,"older_than_hours":0}'); code=$(status_of "$resp")
[ "$code" = "400" ] || err "a sweep with another field must be 400, got $code"
ok "a sweep cannot be given its own age (400)"

# ── 4–5. Delete it, then again ───────────────────────────────────────────────
resp=$(call DELETE "$(jq -cn --arg f "$fid" '{ file_id: $f }')"); code=$(status_of "$resp"); json=$(json_of "$resp")
[ "$code" = "200" ] || err "delete returned $code ($(printf '%s' "$json" | jq -r '.error // "?"'))"
[ "$(printf '%s' "$json" | jq -r '.results[0].outcome')" = "deleted" ] || err "delete answered $(printf '%s' "$json" | jq -c '.results')"
deleted=1
ok "deleted"
resp=$(call DELETE "$(jq -cn --arg f "$fid" '{ file_ids: [$f] }')"); code=$(status_of "$resp"); json=$(json_of "$resp")
[ "$code" = "200" ] && [ "$(printf '%s' "$json" | jq -r '.results[0].outcome')" = "gone" ] \
  || err "a second delete must be gone, got $code $(printf '%s' "$json" | jq -c '.results // .error')"
ok "a second delete is gone (the store's 404)"
certs=$(curl -sS "${SUPABASE_URL}/rest/v1/app_events?select=code,context&context->>file_id=eq.${fid}&context->>stage=eq.delete" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}")
[ "$(printf '%s' "$certs" | jq -r '[.[] | .context.outcome] | sort | join(",")')" = "deleted,gone" ] \
  || err "the certificates are not one deleted and one gone: $(printf '%s' "$certs" | jq -c '[.[] | .context.outcome]')"
certs_et=$(curl -sS "${SUPABASE_URL}/rest/v1/app_events?select=event_type&context->>file_id=eq.${fid}&context->>stage=eq.delete" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}")
[ "$(printf '%s' "$certs_et" | jq -r '[.[] | .event_type] | unique | join(",")')" = "admin" ] \
  || err "certificates must be in the admin stream, which members cannot write"
ok "two certificates (deleted, gone), both in the admin stream"

# ── 5b. A forged upload row is no key (review round 1, finding 1) ───────────
# A member may insert app_events rows (0021). One naming an id the store does
# not hold must get `not_found` (not `gone`) and leave no `gone` certificate:
# otherwise the route tells a forger which ids exist, and certifies a
# deletion that never was.
forged="file_011CIprobeForged$(date +%s)"
ins=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${SUPABASE_URL}/rest/v1/app_events" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg f "$forged" --arg w "$ws" '{ workspace_id: $w, event_type: "system", code: "WIL-6001", message: "fx12 probe: a forged upload row", context: { tool: "ai-files", file_id: $f, size_bytes: 1, mime_type: "text/plain", key_source: "platform", probe: "fx12-forged" } }')")
[ "$ins" = "201" ] || err "the probe could not write its forged row ($ins); 0021's policy changed?"
# The other half of the premise: a member can NOT write the admin stream the
# certificates live in (0021's insert policy), so a certificate is unforgeable.
ins_admin=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${SUPABASE_URL}/rest/v1/app_events" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg f "$forged" --arg w "$ws" '{ workspace_id: $w, event_type: "admin", code: "WIL-6001", message: "fx12 probe: a forged certificate", context: { tool: "ai-files", stage: "delete", file_id: $f, outcome: "deleted", probe: "fx12-forged" } }')")
[ "$ins_admin" != "201" ] || err "a member could write an admin-stream certificate: certificates are forgeable"
ok "a member can write a forged upload row ($ins) and cannot write a certificate ($ins_admin)"
resp=$(call DELETE "$(jq -cn --arg f "$forged" '{ file_id: $f }')"); code=$(status_of "$resp"); json=$(json_of "$resp")
[ "$code" = "200" ] && [ "$(printf '%s' "$json" | jq -r '.results[0].outcome')" = "not_found" ] \
  || err "a forged row naming an absent id must be not_found, got $code $(printf '%s' "$json" | jq -c '.results // .error')"
gone_rows=$(curl -sS "${SUPABASE_URL}/rest/v1/app_events?select=id&context->>file_id=eq.${forged}&context->>stage=eq.delete" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "authorization: Bearer ${token}" | jq 'length')
[ "$gone_rows" = "0" ] || err "a forged row's delete wrote a certificate"
ok "a forged upload row gets not_found and no certificate"

# ── 6. A messages call that references the deleted file ─────────────────────
body=$(jq -cn --arg m "$MODEL" --arg f "$fid" '{
  model: $m, max_tokens: 1, tool: "ci-probe", betas: "files-api-2025-04-14",
  messages: [{ role: "user", content: [
    { type: "document", source: { type: "file", file_id: $f } },
    { type: "text", text: "." } ] }] }')
dead=$(curl -sS -w '\n%{http_code}' -X POST "${SUPABASE_URL}/functions/v1/ai-proxy" -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "authorization: Bearer ${token}" -H 'content-type: application/json' --data "$body")
dcode=$(status_of "$dead"); djson=$(json_of "$dead")
dtype=$(printf '%s' "$djson" | jq -r '.anthropic.error.type // .error // "none"' 2>/dev/null || echo "not JSON")
names=$(printf '%s' "$djson" | jq -r --arg f "$fid" '(.anthropic.error.message // "") | contains($f)' 2>/dev/null || echo false)
note "a messages call referencing the deleted file answered HTTP ${dcode}, error type ${dtype}, message names the id: ${names}"
case "$dcode" in 400|404) ;; *) err "a dead reference must be refused before inference (400 or 404), got ${dcode} (${dtype})";; esac
[ "$names" = "true" ] || err "the dead reference's message must name the id (D.O.G.'s fallback finds the file by it)"
ok "a dead reference is refused, naming the id (D.O.G.'s fallback reads exactly this)"

# ── 7. An id this workspace never uploaded ───────────────────────────────────
resp=$(call DELETE '{"file_id":"file_011CIprobeNeverUploaded01"}'); code=$(status_of "$resp"); json=$(json_of "$resp")
[ "$code" = "200" ] && [ "$(printf '%s' "$json" | jq -r '.results[0].outcome')" = "not_found" ] \
  || err "an id never uploaded must be not_found, got $code $(printf '%s' "$json" | jq -c '.results // .error')"
ok "an id this workspace never uploaded is not_found"

# ── 8. No sign-in ────────────────────────────────────────────────────────────
resp=$(curl -sS -w '\n%{http_code}' -X DELETE "$FN" -H "apikey: ${SUPABASE_ANON_KEY}" -H 'content-type: application/json' --data '{"file_id":"file_011CIprobeNeverUploaded01"}')
[ "$(status_of "$resp")" = "401" ] && [ "$(json_of "$resp" | jq -r '.error')" = "unauthorized" ] \
  || err "no sign-in must be 401 unauthorized, got $(status_of "$resp")"
ok "no sign-in, no delete (401, the function's own refusal)"

# ── 9. The operator's summary is not a member's ──────────────────────────────
resp=$(curl -sS -w '\n%{http_code}' -X POST "${SUPABASE_URL}/functions/v1/operator-ai-files" -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "authorization: Bearer ${token}" -H 'content-type: application/json' --data '{"action":"summary"}')
[ "$(status_of "$resp")" = "403" ] || err "a member asking the operator's summary must be 403, got $(status_of "$resp")"
ok "the operator's summary refuses a member (403)"

printf '\n\e[32mPASS\e[0m ai-files smoke probe\n'
