# shellcheck shell=bash
# =============================================================================
# containerChecks.sh — sourced by .github/workflows/gateway.yml (FX5,
# 2026-10-12) at the top of each step of the container job, after
# `set -euo pipefail`:
#
#     . WILSON/gateway/test/e2e/containerChecks.sh <label> [<container> [<fake cloud's dir>]]
#
#   has <text>        the container's log holds <text>. The log is written to
#                     /tmp/<container>.log and grep reads that file, never a
#                     pipe from `docker logs` (below, why).
#   fail <why>        ends the step; its first annotation is <why>.
#   annotate <title>  standard input as ONE error annotation.
#
# On any failure — `fail`, or a command that fails under `set -e`, in a
# function or a command substitution too (`set -E`) — the step leaves its
# error annotations: what failed (the check's sentence, or the command and its
# line), the step's own last 25 lines, the container's last 40 and the fake
# cloud's last 10, when the step names them.
#
# Why a file. Under `set -o pipefail`, `docker logs gw-host | grep -q X` fails
# when grep exits at its first match while docker logs is still writing: docker
# logs dies of SIGPIPE (exit 141), that is the pipeline's status, and the check
# says X is not in the log with X in the log. That failed the job at 3a17a5ec
# (the GW5 merge, run 38288856199): `… | grep -q 'outside_open' || { echo …;
# exit 1; }` took its bare exit, which an ERR trap never sees, so nothing
# reached the annotations. Measured on the runner (cbf83d88, run 38303866949):
# that check, run 200 times against a log holding its line, said it was missing
# twice; through a file, never. rls.yml met the same with `echo | grep -q`.
#
# Why one annotation of many lines, and its last 4,000 characters. A job's
# log needs admin rights; its annotations are public (GW2's trap 3). The
# runner (actions/runner, ExecutionContext.cs) keeps the FIRST ten error
# annotations of a step (_maxCountPerIssueType) and the FIRST 4,096
# characters of each message (_maxIssueMessageLength): one line each showed
# the oldest ten of forty (the ACME job's Pebble log, 2026-10-12), and forty
# gateway lines in one message would lose the newest. So the lines go in one
# annotation, cut from the FRONT to the newest 4,000 characters at a line
# boundary, then %, CR and LF escaped (and, in the title, : and , too) as
# workflow commands require.
# =============================================================================

gw_label=$1
gw_name=${2:-}
gw_cloud=${3:-}
gw_log="/tmp/${gw_name:-$gw_label}.log"
gw_out="${RUNNER_TEMP:-/tmp}/$gw_label.step.log"
gw_why=''

# The step's own output, kept in a file for the annotations and still shown.
: > "$gw_out"
exec > >(tee -a "$gw_out") 2>&1

has() { docker logs "$gw_name" > "$gw_log" 2>&1 && grep -q -- "$1" "$gw_log"; }

fail() { gw_why=$1; exit 1; }

annotate() {
  local body title=$1 cut
  body=$(cat)
  [ -n "$body" ] || return 0
  if [ "${#body}" -gt 4000 ]; then
    cut=${body: -4000}
    body="[earlier lines cut: the runner keeps 4,096 characters]"$'\n'"${cut#*$'\n'}"
  fi
  body=${body//'%'/'%25'}
  body=${body//$'\r'/'%0D'}
  body=${body//$'\n'/'%0A'}
  title=${title//'%'/'%25'}
  title=${title//$'\r'/'%0D'}
  title=${title//$'\n'/'%0A'}
  title=${title//':'/'%3A'}
  title=${title//','/'%2C'}
  printf '::error title=%s::%s\n' "$title" "$body"
}

gw_report() {
  local status=$1 step mark i
  [ "$status" -eq 0 ] && return 0
  # The step's lines are read once tee has written them all: this mark is the
  # last line the step prints before its report, so up to 5 s are given for it
  # to reach the file, and the lines before it are the step's.
  mark="--- $gw_label: the step failed (exit $status); its annotations follow"
  printf '%s\n' "$mark"
  for i in $(seq 1 50); do grep -qxF -- "$mark" "$gw_out" && break; sleep 0.1; done
  step=$(awk -v m="$mark" '$0 == m { exit } { print }' "$gw_out" | tail -n 25)
  printf '%s\n' "${gw_why:-exit $status}" | annotate "$gw_label failed"
  printf '%s\n' "$step" | annotate "$gw_label step (last 25 lines)"
  if [ -n "$gw_name" ]; then
    docker logs "$gw_name" > "$gw_log" 2>&1 || true
    tail -n 40 "$gw_log" | annotate "$gw_name log (last 40 lines)"
  fi
  if [ -n "$gw_cloud" ]; then
    { cat "$gw_cloud/out.json" "$gw_cloud/err.log" 2>/dev/null || true; } | tail -n 10 | annotate 'fake cloud (last 10 lines)'
  fi
  return 0
}

set -E
trap 'gw_why="line $LINENO: $BASH_COMMAND (exit $?)"' ERR
trap 'gw_report $?' EXIT
