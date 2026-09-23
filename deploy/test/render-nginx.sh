# shellcheck shell=bash
#
# Renders the nginx configuration the installer would write, into a scratch
# directory, without root and without touching /etc.
#
#   bash deploy/test/render-nginx.sh <out-dir> <app-dir> <data-dir>
#
# Used by deploy/test/nginx-headers.mjs, which checks the result statically and
# — when an nginx binary is available — serves it and reads the real response
# headers. The functions rendered are the installer's own
# (`nginx::write_header_snippets`, `nginx::site_config`, `ssl::write_hsts`);
# only logging and file-system helpers are stubbed, so what is tested is what
# ships.
#
# Deliberately free of coreutils (`cat`, `mkdir`, `sed`): it has to run in the
# minimal bash that ships with Git for Windows as well as on a server.

# Bash invoked as `sh` (Git for Windows' usr/bin/sh.exe) starts in POSIX mode,
# where the installer's `module::function` names are not valid identifiers.
set +o posix
set -o errexit
set -o nounset
set -o pipefail

OUT="$1"
APP_DIR="$2"
DATA_DIR="$3"
HERE="$(cd -P "${BASH_SOURCE[0]%/*}" && pwd)"

# ---- Stubs for what the installer's other modules provide ----------------
log::ok() { :; }
log::step() { :; }
log::info() { :; }
log::skip() { :; }
log::warn() { :; }
die() { printf 'render-nginx: %s\n' "$*" >&2; exit 1; }
# The caller creates the directories; `mkdir` may not exist here.
mkdir() { :; }
# `cat` for heredocs, in pure bash, where the real one is missing.
if ! command -v cat >/dev/null 2>&1; then
  cat() {
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do printf '%s\n' "$line"; done
  }
fi

# ---- The installer's variables, pointed at the scratch directory ---------
CFG_COMPANY="IEM AG"
CFG_DOMAIN="iem.test"
NGINX_ALT_NAMES=""
APP_PORT="3100"
LOG_DIR="$OUT/logs"
CONFIG_DIR="$OUT"
NGINX_SITE="iem"
NGINX_SNIPPETS_DIR="$OUT/snippets"

# shellcheck source=../lib/nginx.sh
. "$HERE/../lib/nginx.sh"
# shellcheck source=../lib/ssl.sh
. "$HERE/../lib/ssl.sh"

nginx::write_header_snippets
# As on an installation with a certificate, so HSTS is part of what is checked.
ssl::write_hsts
nginx::site_config >"$OUT/site.conf"
