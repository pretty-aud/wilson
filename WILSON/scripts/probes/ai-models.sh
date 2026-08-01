#!/usr/bin/env bash
# =============================================================================
# ai-models probe — Session 19
#
# Answers, with evidence rather than inference, the questions that decide the
# Sonnet-4 migration. It sends WILSON's OWN request shapes through the real
# `ai-proxy` Edge Function and prints Anthropic's verbatim reply.
#
# Why a probe and not "swap the string and see": the S19 plan assumed the
# migration was a find-and-replace. Reading Anthropic's current API reference
# turned up three ways that is not true (adaptive thinking is on by default on
# Sonnet 5 and shares the max_tokens budget with the answer; the web-search
# tool version and beta header WILSON sends predate the target model; and the
# Validator's tool_use recursion ends its message list on an assistant turn,
# which is a prefill and 400s on every model past Sonnet 4). Each is a *theory*
# until this script runs. Swapping 17 call sites first and reading the tea
# leaves afterwards is how S17 lost an hour.
#
# `ai-proxy` forwards Anthropic's status verbatim and nests its error JSON
# under `anthropic` (index.ts, the `!upstream.ok` branch), so what you see
# below is Anthropic's own answer, not WILSON's interpretation of it.
#
# Cases 1 and 2 are the control pair, and they are not optional. Case 1 must
# PASS and case 2 must FAIL. If case 1 fails, the probe is broken (bad key,
# bad token, no workspace AI key) and every other reading is worthless. If
# case 2 *passes*, the retirement diagnosis is wrong and S19 should stop.
# An instrument that cannot show a presence cannot be trusted about an absence.
#
# Required env (same names as issue-session.sh — reuse that setup):
#   SUPABASE_URL             e.g. https://<ref>.supabase.co
#   SUPABASE_ANON_KEY        project anon key
#   PROBE_USERNAME           workspace-scoped username of the test user
#   PROBE_PASSWORD           test user's password
#
# Usage:
#   scripts/probes/ai-models.sh
#
# Requires `jq` and `curl`. Costs a handful of tokens per case (max_tokens is
# tiny everywhere except case 7, which has to be big enough to observe
# truncation). Never exits non-zero on a case failing — a failing case IS the
# measurement. It exits non-zero only if the probe itself could not run.
# =============================================================================

set -uo pipefail

err()  { printf '\e[31mFAIL\e[0m %s\n' "$*" >&2; exit 1; }
note() { printf '\e[90m ·  \e[0m %s\n' "$*"; }
head2(){ printf '\n\e[1m%s\e[0m\n' "$*"; }

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY must be set}"
: "${PROBE_USERNAME:?PROBE_USERNAME must be set}"
: "${PROBE_PASSWORD:?PROBE_PASSWORD must be set}"

command -v jq   >/dev/null || err "jq is required"
command -v curl >/dev/null || err "curl is required"

REASONING="${REASONING_MODEL:-claude-sonnet-5}"
FAST="${FAST_MODEL:-claude-haiku-4-5-20251001}"
DEAD="claude-sonnet-4-20250514"
ALT="claude-sonnet-4-6"

# ── Auth (steps 1-2 of issue-session.sh) ─────────────────────────────────────
note "resolve-login + signInWithPassword as ${PROBE_USERNAME}"
resolve_json=$(curl -sS -X POST "${SUPABASE_URL}/functions/v1/resolve-login" \
  -H 'content-type: application/json' -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -cn --arg u "$PROBE_USERNAME" '{username:$u}')")
email=$(printf '%s' "$resolve_json" | jq -r '.email // empty')
[ -n "$email" ] || err "resolve-login gave no email: $resolve_json"

signin_json=$(curl -sS -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H 'content-type: application/json' -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -cn --arg e "$email" --arg p "$PROBE_PASSWORD" '{email:$e,password:$p}')")
TOKEN=$(printf '%s' "$signin_json" | jq -r '.access_token // empty')
[ -n "$TOKEN" ] || err "sign-in produced no access_token: $signin_json"
note "token acquired (${#TOKEN} chars)"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
pass_count=0; fail_count=0

# probe <label> <json-body>
#
# Prints the HTTP status and, on success, the signals that matter: whether the
# model emitted thinking blocks (they share the max_tokens budget with the
# answer), and the stop_reason (`max_tokens` means the reply was cut off —
# which for WILSON means unparseable JSON, not merely a short answer).
probe() {
  local label="$1" body="$2" out="$TMP/out.$$"
  local code
  code=$(curl -sS -o "$out" -w '%{http_code}' --max-time 120 \
    -X POST "${SUPABASE_URL}/functions/v1/ai-proxy" \
    -H 'content-type: application/json' \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "authorization: Bearer ${TOKEN}" \
    --data "$body" 2>/dev/null) || code="000"

  if [ "$code" = "200" ]; then
    local thinking stop otok
    thinking=$(grep -c '"type":"thinking"' "$out" 2>/dev/null || true)
    stop=$(grep -o '"stop_reason":"[a-z_]*"' "$out" | tail -n1 | cut -d'"' -f4)
    otok=$(grep -o '"output_tokens":[0-9]*' "$out" | tail -n1 | cut -d: -f2)
    printf '\e[32m PASS \e[0m %-46s 200  stop=%-12s out_tokens=%-6s thinking_blocks=%s\n' \
      "$label" "${stop:-?}" "${otok:-?}" "${thinking:-0}"
    pass_count=$((pass_count+1))
  else
    local etype emsg
    etype=$(jq -r '.anthropic.error.type // .error // "?"' "$out" 2>/dev/null)
    emsg=$(jq -r '.anthropic.error.message // ""' "$out" 2>/dev/null)
    printf '\e[31m FAIL \e[0m %-46s %s  %s\n' "$label" "$code" "$etype"
    [ -n "$emsg" ] && printf '        \e[90m%s\e[0m\n' "$emsg"
    fail_count=$((fail_count+1))
  fi
}

msg() { jq -cn --arg t "$1" '[{role:"user",content:$t}]'; }

# ── The control pair — read these before anything else ───────────────────────
head2 "Controls (case 1 MUST pass, case 2 MUST fail)"

probe "1. FAST alive           ($FAST)" \
  "$(jq -cn --arg m "$FAST" --argjson ms "$(msg 'Reply with the single word: ok')" \
     '{model:$m,max_tokens:16,messages:$ms,tool:"probe"}')"

probe "2. Sonnet 4 retired     ($DEAD)" \
  "$(jq -cn --arg m "$DEAD" --argjson ms "$(msg 'Reply with the single word: ok')" \
     '{model:$m,max_tokens:16,messages:$ms,tool:"probe"}')"

# ── Candidate replacements ───────────────────────────────────────────────────
head2 "Candidate REASONING models"

probe "3. Candidate            ($REASONING)" \
  "$(jq -cn --arg m "$REASONING" --argjson ms "$(msg 'Reply with the single word: ok')" \
     '{model:$m,max_tokens:16,messages:$ms,tool:"probe"}')"

probe "4. Fallback candidate   ($ALT)" \
  "$(jq -cn --arg m "$ALT" --argjson ms "$(msg 'Reply with the single word: ok')" \
     '{model:$m,max_tokens:16,messages:$ms,tool:"probe"}')"

# ── WILSON's actual request shapes, unchanged except for the model ───────────
head2 "WILSON's own request shapes on $REASONING"

# O.T.T.E.R. — generateSubjectContent / generateSingleSubject / agentGenerateSingleSubject
# and the Validator all send this tool version, and Otter also sends the beta
# header. Both predate the target model. ai-proxy turns `betas` into the
# anthropic-beta header verbatim (index.ts).
probe "5a. web_search_20250305 + beta header" \
  "$(jq -cn --arg m "$REASONING" --argjson ms "$(msg 'Reply with the single word: ok')" \
     '{model:$m,max_tokens:64,messages:$ms,tool:"probe",
       tools:[{type:"web_search_20250305",name:"web_search",max_uses:1}],
       betas:"web-search-2025-03-05"}')"

probe "5b. web_search_20250305, no beta header" \
  "$(jq -cn --arg m "$REASONING" --argjson ms "$(msg 'Reply with the single word: ok')" \
     '{model:$m,max_tokens:64,messages:$ms,tool:"probe",
       tools:[{type:"web_search_20250305",name:"web_search",max_uses:1}]}')"

probe "5c. web_search_20260209, no beta header" \
  "$(jq -cn --arg m "$REASONING" --argjson ms "$(msg 'Reply with the single word: ok')" \
     '{model:$m,max_tokens:64,messages:$ms,tool:"probe",
       tools:[{type:"web_search_20260209",name:"web_search",max_uses:1}]}')"

# Validator.jsx: on stop_reason === 'tool_use' it appends the assistant turn
# and re-sends with NO trailing user turn. That is an assistant prefill.
probe "6. trailing assistant turn (Validator)" \
  "$(jq -cn --arg m "$REASONING" \
     '{model:$m,max_tokens:32,tool:"probe",
       messages:[{role:"user",content:"Name one colour."},
                 {role:"assistant",content:"The colour is"}]}')"

# Sonnet 5 runs adaptive thinking when `thinking` is omitted, and thinking
# shares the max_tokens budget with the answer. WILSON omits `thinking`
# everywhere and asks for large structured JSON, then parses it. A truncated
# reply is a parse error, not a short answer.
JSON_TASK='Output ONLY a JSON array of 8 objects, each {"name":string,"summary":string} about the planets. No prose.'

probe "7a. JSON task, thinking omitted, max_tokens=1024" \
  "$(jq -cn --arg m "$REASONING" --argjson ms "$(msg "$JSON_TASK")" \
     '{model:$m,max_tokens:1024,messages:$ms,tool:"probe"}')"

probe "7b. JSON task, thinking disabled, max_tokens=1024" \
  "$(jq -cn --arg m "$REASONING" --argjson ms "$(msg "$JSON_TASK")" \
     '{model:$m,max_tokens:1024,messages:$ms,tool:"probe",
       thinking:{type:"disabled"}}')"

# ── Readout ──────────────────────────────────────────────────────────────────
head2 "Summary: ${pass_count} passed, ${fail_count} failed"
cat <<'EOS'
How to read this:

  Case 1 FAILED      -> the probe is broken, not the models. Stop; every other
                        line is meaningless. Check the workspace AI key first.
  Case 2 PASSED      -> Sonnet 4 still answers. The retirement diagnosis is
                        WRONG and S19's premise needs rebuilding before any fix.
  Case 3 FAILED      -> the replacement model ID is wrong. Do not migrate to it.
  Case 5a/5b FAILED  -> O.T.T.E.R. needs its web-search tool version (and/or
                        beta header) changed too. A model swap alone leaves the
                        five research paths broken.
  Case 6 FAILED      -> the Validator's tool_use recursion must be fixed; it
                        cannot work on the new model as written.
  Case 7a stop=max_tokens while 7b stop=end_turn
                     -> thinking is eating the output budget. Every REASONING
                        call site needs thinking pinned explicitly, or WILSON
                        trades a 404 for a JSON parse error.
EOS
