# shellcheck shell=bash
#
# Logging, error handling and user interaction.
#
# Loaded first by every other module. Two things it establishes that the rest
# of the installer relies on:
#
#   1. Everything is written to a log file as well as the terminal. An
#      installer that fails on someone else's server is debugged from that
#      file, so it records the raw output of every command, not a summary.
#   2. `die` is the only way this script exits non-zero. It prints the failing
#      step, where the log is, and what to do next — an installer that stops
#      with "error" and a stack trace has told the operator nothing.

set -o errexit
set -o nounset
set -o pipefail

# Colour only when attached to a terminal. Piping through `| bash` or into a
# file must not fill it with escape sequences.
if [[ -t 1 ]] && [[ "${TERM:-dumb}" != "dumb" ]] && [[ -z "${NO_COLOR:-}" ]]; then
  readonly C_RESET=$'\033[0m'
  readonly C_DIM=$'\033[2m'
  readonly C_BOLD=$'\033[1m'
  readonly C_RED=$'\033[31m'
  readonly C_GREEN=$'\033[32m'
  readonly C_YELLOW=$'\033[33m'
  readonly C_BLUE=$'\033[34m'
else
  readonly C_RESET="" C_DIM="" C_BOLD="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE=""
fi

LOG_FILE="${LOG_FILE:-/var/log/iem-install.log}"
CURRENT_STEP="Start"

log::init() {
  local dir
  dir="$(dirname "$LOG_FILE")"
  mkdir -p "$dir" 2>/dev/null || LOG_FILE="/tmp/iem-install.log"
  : >"$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/iem-install.log"
  chmod 600 "$LOG_FILE" 2>/dev/null || true
  log::raw "=== IEM installer — $(date -Is) ==="
  log::raw "argv: $*"
}

# Straight to the log, never to the terminal.
log::raw() { printf '%s\n' "$*" >>"$LOG_FILE" 2>/dev/null || true; }

log::step() {
  CURRENT_STEP="$1"
  printf '\n%s▸ %s%s\n' "$C_BOLD$C_BLUE" "$1" "$C_RESET"
  log::raw ""
  log::raw "--- $1 ---"
}

log::info() {
  printf '  %s\n' "$1"
  log::raw "INFO  $1"
}

log::ok() {
  printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"
  log::raw "OK    $1"
}

log::skip() {
  printf '  %s· %s%s\n' "$C_DIM" "$1" "$C_RESET"
  log::raw "SKIP  $1"
}

log::warn() {
  printf '  %s! %s%s\n' "$C_YELLOW" "$1" "$C_RESET"
  log::raw "WARN  $1"
  WARNINGS+=("$1")
}

log::error() {
  printf '  %s✗ %s%s\n' "$C_RED" "$1" "$C_RESET"
  log::raw "ERROR $1"
}

# The only exit path. Prints what failed and where to look.
die() {
  printf '\n%s%s Installation abgebrochen%s\n' "$C_BOLD$C_RED" "✗" "$C_RESET"
  printf '  Schritt:   %s\n' "$CURRENT_STEP"
  printf '  Grund:     %s\n' "$1"
  printf '  Protokoll: %s\n\n' "$LOG_FILE"
  printf '  Die letzten Zeilen des Protokolls:\n'
  tail -n 15 "$LOG_FILE" 2>/dev/null | sed 's/^/    /' || true
  printf '\n  Die Installation ist idempotent — nach dem Beheben der Ursache\n'
  printf '  kann derselbe Befehl erneut ausgeführt werden.\n\n'
  log::raw "FATAL $1"
  exit 1
}

# Runs a command, sending all of its output to the log.
#
# The installer's terminal output is a readable summary; the log is the
# evidence. `run` is what keeps those two apart — apt alone would otherwise
# produce several hundred lines nobody reads.
run() {
  log::raw "\$ $*"
  if ! "$@" >>"$LOG_FILE" 2>&1; then
    local status=$?
    log::error "Befehl fehlgeschlagen: $*"
    return "$status"
  fi
}

# Same, but a failure is not fatal — for the steps where a failure degrades
# the install rather than ending it.
run_soft() {
  log::raw "\$ $* (soft)"
  "$@" >>"$LOG_FILE" 2>&1 || {
    log::raw "      (nicht kritisch, fortgesetzt)"
    return 0
  }
}

# ---- Interaction ---------------------------------------------------

# Whether we can prompt at all.
#
# `curl … | bash` gives the script a pipe on stdin, so `read` would consume
# the script itself. The installer therefore reads from /dev/tty when it can
# and refuses to prompt when it cannot — in that case every answer has to come
# from a flag or an environment variable, which `--help` documents.
IS_INTERACTIVE=0
if [[ -r /dev/tty ]] && [[ -z "${IEM_NONINTERACTIVE:-}" ]]; then
  IS_INTERACTIVE=1
fi

ask() {
  local prompt="$1" default="${2:-}" answer=""
  if (( ! IS_INTERACTIVE )); then
    [[ -n "$default" ]] && { printf '%s' "$default"; return 0; }
    die "Für „$prompt“ wurde kein Wert übergeben und es ist keine Eingabe möglich. Siehe --help."
  fi
  if [[ -n "$default" ]]; then
    printf '  %s [%s]: ' "$prompt" "$default" >/dev/tty
  else
    printf '  %s: ' "$prompt" >/dev/tty
  fi
  IFS= read -r answer </dev/tty || true
  printf '%s' "${answer:-$default}"
}

ask_secret() {
  local prompt="$1" answer=""
  if (( ! IS_INTERACTIVE )); then
    die "Für „$prompt“ wurde kein Wert übergeben und es ist keine Eingabe möglich. Siehe --help."
  fi
  printf '  %s: ' "$prompt" >/dev/tty
  # No echo. The terminal state is restored even if the read is interrupted.
  stty -echo </dev/tty 2>/dev/null || true
  IFS= read -r answer </dev/tty || true
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
  printf '%s' "$answer"
}

confirm() {
  local prompt="$1" default="${2:-n}" answer
  if (( ! IS_INTERACTIVE )); then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  answer="$(ask "$prompt (j/n)" "$default")"
  [[ "${answer,,}" =~ ^(j|y|ja|yes)$ ]]
}

# ---- Secrets -------------------------------------------------------

# Cryptographically secure random, URL-safe.
#
# Reads /dev/urandom directly rather than shelling out to openssl, so it works
# before the package step has run. `tr -dc` drops anything outside the set,
# which is why it reads far more bytes than it needs.
secret::generate() {
  local length="${1:-48}"
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "$length" || {
    die "Konnte keine Zufallsdaten aus /dev/urandom lesen."
  }
}

# A password safe to embed in a URL and in a psql string literal — no quotes,
# no backslashes, and nothing the shell or a connection string would reinterpret.
secret::password() {
  LC_ALL=C tr -dc 'A-Za-z0-9._~-' </dev/urandom 2>/dev/null | head -c "${1:-32}"
}
