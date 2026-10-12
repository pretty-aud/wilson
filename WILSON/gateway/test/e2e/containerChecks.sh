# shellcheck shell=bash
# =============================================================================
# containerChecks.sh — sourced by .github/workflows/gateway.yml's container
# job (FX5, 2026-10-12), at the top of each step, after `set -euo pipefail`:
#
#     . WILSON/gateway/test/e2e/containerChecks.sh <label> [<container>]
#
#   has <text>        the container's log holds <text>. The log is written to
#                     a file and grep reads the file: never `docker logs | grep
#                     -q` (below, why).
#   fail <why>        ends the step; its first annotation is <why>.
#   annotate <title>  standard input as ONE error annotation.
#
# On any failure — `fail`, or a command that fails under `set -e`, in a
# function or a command substitution too (`set -E`) — the step leaves its
# error annotations: what failed (the check's sentence, or the command and its
# line), the step's own last 25 lines, the container's last 40, and, when the
# step started a fake cloud in /tmp/fc, its last 10.
#
# Why a file. Under `set -o pipefail`, `docker logs gw-host | grep -q X` fails
# when grep exits at its first match while docker logs is still writing: docker
# logs dies of SIGPIPE (exit 141), the pipeline's status is that 141, and the
# check reads "X is not in the log" with X in the log. FX5's suspect for the
# failure at 3a17a5ec (the GW5 merge), measured on the runner by the job's
# probe: a check of that shape, `… || { echo …; exit 1; }`, takes a bare exit,
# which an ERR trap never sees, so nothing reached the annotations. rls.yml met
# the same with `echo | grep -q` (C2).
#
# Why one annotation of many lines. A job's log needs admin rights; its
# annotations are public (GW2's trap 3), but GitHub keeps ten error
# annotations per step, so one line per annotation would show only the first
# ten. The lines go in one annotation, %, CR and LF escaped as workflow
# commands require.
# =============================================================================

gw_label=$1
gw_name=${2:-}
gw_log="/tmp/${gw_name:-$gw_label}.log"
gw_out="${RUNNER_TEMP:-/tmp}/$gw_label.step.log"
gw_why=''

# The step's own output, kept in a file for the annotations and still shown.
: > "$gw_out"
exec > >(tee -a "$gw_out") 2>&1

has() { docker logs "$gw_name" > "$gw_log" 2>&1 && grep -q -- "$1" "$gw_log"; }

fail() { gw_why=$1; exit 1; }

annotate() {
  local body
  body=$(cat)
  [ -n "$body" ] || return 0
  body=${body//'%'/'%25'}
  body=${body//$'\r'/'%0D'}
  body=${body//$'\n'/'%0A'}
  printf '::error title=%s::%s\n' "$1" "$body"
}

gw_report() {
  local status=$1 step
  [ "$status" -eq 0 ] && return 0
  sleep 0.3 # tee writes what it has read, the step's last line included
  step=$(tail -n 25 "$gw_out") # before this report's own lines reach the file
  printf '%s\n' "${gw_why:-exit $status}" | annotate "$gw_label failed"
  printf '%s\n' "$step" | annotate "$gw_label step (last 25 lines)"
  if [ -n "$gw_name" ]; then
    docker logs "$gw_name" > "$gw_log" 2>&1 || true
    tail -n 40 "$gw_log" | annotate "$gw_name log (last 40 lines)"
  fi
  if [ -s /tmp/fc/out.json ]; then
    { cat /tmp/fc/out.json; cat /tmp/fc/err.log 2>/dev/null || true; } | tail -n 10 | annotate 'fake cloud (last 10 lines)'
  fi
  return 0
}

set -E
trap 'gw_why="line $LINENO: $BASH_COMMAND (exit $?)"' ERR
trap 'gw_report $?' EXIT
