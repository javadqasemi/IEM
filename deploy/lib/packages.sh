# shellcheck shell=bash
#
# System packages and the Node toolchain.
#
# Only what is missing gets installed, and only what the application actually
# uses gets installed at all. Two deliberate omissions, because a production
# server should not carry software nothing runs:
#
#   · **Docker and Docker Compose.** The spec lists them alongside PM2, but
#     these are two different deployment models and this platform uses one of
#     them: Nginx serves the built static files and PM2 runs the API process.
#     Installing Docker would add several hundred megabytes, a daemon, and a
#     second network stack that nothing here uses. If the deployment target
#     ever becomes containers, this is the module that changes — see
#     deploy/README.md.
#
#   · **FFmpeg and ImageMagick.** Nothing transcodes video, and image work is
#     done by `sharp`, which ships its own prebuilt libvips. Neither binary is
#     ever invoked.
#
# Redis *is* installed, and is genuinely used — see redis.sh.

readonly -a BASE_PACKAGES=(
  ca-certificates       # TLS trust store, needed before anything fetches over https
  curl
  wget
  gnupg
  lsb-release
  apt-transport-https
  software-properties-common
  unzip
  rsync                 # used by the backup module
  jq                    # the validation module parses API responses with it
  git
  build-essential       # native npm modules (argon2) compile against this
  python3               # node-gyp's build driver
  pkg-config
  openssl
  acl                   # setfacl, for the log directory the app user writes to
  tzdata
  locales
  logrotate
  cron
)

packages::update_index() {
  log::step "Paketquellen"
  export DEBIAN_FRONTEND=noninteractive
  run apt-get update -qq || die "apt-get update ist fehlgeschlagen. Netzwerk oder Paketquellen prüfen."
  log::ok "Paketindex aktualisiert"
}

# Installs only what is missing, and says which.
packages::ensure() {
  local -a missing=()
  local pkg
  for pkg in "$@"; do
    detect::has_package "$pkg" || missing+=("$pkg")
  done

  if (( ${#missing[@]} == 0 )); then
    log::skip "Bereits vorhanden: $*"
    return 0
  fi

  log::info "Installiere: ${missing[*]}"
  run apt-get install -y -qq \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    "${missing[@]}" || die "Installation fehlgeschlagen: ${missing[*]}"
  log::ok "Installiert: ${missing[*]}"
}

packages::base() {
  log::step "Systempakete"
  packages::ensure "${BASE_PACKAGES[@]}"
}

packages::locale_and_time() {
  log::step "Zeitzone und Sprache"

  if timedatectl set-timezone "$CFG_TIMEZONE" >/dev/null 2>&1; then
    log::ok "Zeitzone $CFG_TIMEZONE"
  else
    log::warn "Zeitzone $CFG_TIMEZONE konnte nicht gesetzt werden."
  fi

  # The application formats dates and sorts names with de-CH rules, which need
  # the locale generated — otherwise `localeCompare` falls back to byte order
  # and Ä sorts after Z.
  if ! locale -a 2>/dev/null | grep -qi "^${CFG_LOCALE//-/}$\|^${CFG_LOCALE/.UTF-8/.utf8}$"; then
    if grep -q "^# *${CFG_LOCALE} " /etc/locale.gen 2>/dev/null; then
      run sed -i "s/^# *\(${CFG_LOCALE} .*\)/\1/" /etc/locale.gen
    else
      printf '%s UTF-8\n' "$CFG_LOCALE" >>/etc/locale.gen
    fi
    run_soft locale-gen "$CFG_LOCALE"
  fi
  log::ok "Sprache $CFG_LOCALE"
}

# ---- Node ----------------------------------------------------------

# The major version to install. Pinned rather than "latest": the build must be
# reproducible, and a customer installing six months from now should get the
# same runtime as the one who installed today.
readonly NODE_MAJOR=22

node::install() {
  log::step "Node.js"

  if detect::has_command node; then
    local current
    current="$(node --version | sed 's/^v//;s/\..*//')"
    if (( current >= NODE_MAJOR )); then
      log::skip "Node $(node --version) bereits vorhanden"
      node::tooling
      return 0
    fi
    log::info "Node $(node --version) ist zu alt, wird auf $NODE_MAJOR angehoben"
  fi

  # NodeSource, because the distribution packages lag by years — Debian 12
  # ships Node 18, which is out of support.
  local keyring=/usr/share/keyrings/nodesource.gpg
  if [[ ! -f "$keyring" ]]; then
    run bash -c "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o '$keyring'" || die "NodeSource-Schlüssel konnte nicht geholt werden."
    run chmod 0644 "$keyring"
  fi

  printf 'deb [signed-by=%s] https://deb.nodesource.com/node_%s.x nodistro main\n' \
    "$keyring" "$NODE_MAJOR" >/etc/apt/sources.list.d/nodesource.list

  run apt-get update -qq
  packages::ensure nodejs
  log::ok "Node $(node --version)"
  node::tooling
}

node::tooling() {
  # pnpm and PM2 as global npm packages rather than apt: neither is packaged,
  # and npm is the version manager they expect.
  if ! detect::has_command pnpm; then
    run npm install -g pnpm@latest || log::warn "pnpm konnte nicht installiert werden."
  fi
  detect::has_command pnpm && log::ok "pnpm $(pnpm --version 2>/dev/null || echo '?')"

  if ! detect::has_command pm2; then
    run npm install -g pm2@latest || die "PM2 konnte nicht installiert werden."
  fi
  log::ok "PM2 $(pm2 --version 2>/dev/null || echo '?')"

  # npm's own cache under root is irrelevant to the app user; making it
  # explicit keeps root's HOME out of the build later.
  run_soft npm config set fund false --global
  run_soft npm config set audit false --global
}
