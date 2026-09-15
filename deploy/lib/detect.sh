# shellcheck shell=bash
#
# Platform detection and pre-flight checks.
#
# Everything here runs before a single package is installed. The point is that
# an unsupported or unsuitable machine is rejected in the first five seconds,
# not half way through when Nginx is already configured and PostgreSQL is not.

# Filled by detect::os
OS_ID=""
OS_VERSION=""
OS_CODENAME=""
OS_PRETTY=""
PKG_MANAGER=""
ARCH=""

# Distributions this installer is known to work on. Adding one means adding a
# line here and checking the package names in packages.sh — nothing else is
# version-specific.
readonly -a SUPPORTED=(
  "ubuntu:24.04"
  "ubuntu:22.04"
  "debian:12"
)

detect::os() {
  [[ -r /etc/os-release ]] || die "/etc/os-release fehlt — dieses System lässt sich nicht identifizieren."

  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_VERSION="${VERSION_ID:-unknown}"
  OS_CODENAME="${VERSION_CODENAME:-unknown}"
  OS_PRETTY="${PRETTY_NAME:-$OS_ID $OS_VERSION}"
  ARCH="$(uname -m)"

  if command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt"
  else
    die "Kein unterstützter Paketmanager gefunden (erwartet: apt). Erkannt: $OS_PRETTY"
  fi

  log::info "System:    $OS_PRETTY ($ARCH)"
  log::info "Pakete:    $PKG_MANAGER"
}

detect::supported() {
  local candidate="$OS_ID:$OS_VERSION" entry
  for entry in "${SUPPORTED[@]}"; do
    [[ "$candidate" == "$entry" ]] && { log::ok "Unterstützte Distribution"; return 0; }
  done

  # A near miss — same distribution, different release — is a warning rather
  # than a refusal. Ubuntu 26.04 will almost certainly work, and refusing
  # outright would send the operator to edit this file, which is worse than
  # letting them decide with the facts in front of them.
  local family
  for entry in "${SUPPORTED[@]}"; do
    family="${entry%%:*}"
    if [[ "$OS_ID" == "$family" ]]; then
      log::warn "$OS_PRETTY ist nicht getestet (getestet: ${SUPPORTED[*]})."
      confirm "Trotzdem fortfahren?" "n" || die "Abgebrochen."
      return 0
    fi
  done

  die "$OS_PRETTY wird nicht unterstützt. Getestet: ${SUPPORTED[*]}"
}

detect::architecture() {
  case "$ARCH" in
    x86_64 | aarch64) log::ok "Architektur $ARCH" ;;
    *) die "Architektur $ARCH wird nicht unterstützt (erwartet: x86_64 oder aarch64)." ;;
  esac
}

detect::root() {
  [[ "$(id -u)" -eq 0 ]] || die "Der Installer muss als root laufen. Mit 'sudo' erneut ausführen."
}

# Refuses to start on a box that cannot finish.
#
# Disk and memory are checked because both failures are expensive and
# confusing: `npm ci` on 512 MB dies inside a V8 out-of-memory trace that says
# nothing about memory, and a full disk corrupts a PostgreSQL cluster mid-init.
detect::resources() {
  local free_mb swap_mb disk_mb
  free_mb="$(free -m | awk '/^Mem:/ {print $2}')"
  swap_mb="$(free -m | awk '/^Swap:/ {print $2}')"
  disk_mb="$(df -Pm /var 2>/dev/null | awk 'NR==2 {print $4}')"

  log::info "Arbeitsspeicher: ${free_mb} MB (Swap ${swap_mb} MB)"
  log::info "Freier Platz:    ${disk_mb} MB unter /var"

  if (( disk_mb < 5000 )); then
    die "Zu wenig freier Speicherplatz: ${disk_mb} MB. Mindestens 5 GB werden benötigt."
  fi

  if (( free_mb + swap_mb < 1700 )); then
    log::warn "Weniger als 2 GB RAM+Swap. Der Frontend-Build schlägt dort häufig fehl."
    if (( swap_mb < 512 )); then
      if confirm "2 GB Auslagerungsdatei anlegen?" "y"; then
        detect::create_swap
      fi
    fi
  fi
}

detect::create_swap() {
  local file=/swapfile
  if [[ -f "$file" ]]; then
    log::skip "Auslagerungsdatei besteht bereits"
    return 0
  fi
  run fallocate -l 2G "$file" || run dd if=/dev/zero of="$file" bs=1M count=2048
  run chmod 600 "$file"
  run mkswap "$file"
  run swapon "$file"
  grep -q "^$file" /etc/fstab 2>/dev/null || printf '%s none swap sw 0 0\n' "$file" >>/etc/fstab
  log::ok "2 GB Auslagerungsdatei eingerichtet"
}

detect::network() {
  # Any one of these responding is enough; all three being unreachable means
  # apt and certbot will fail later in a much less obvious way.
  local host
  for host in deb.debian.org archive.ubuntu.com registry.npmjs.org; do
    if getent hosts "$host" >/dev/null 2>&1; then
      log::ok "Netzwerk und DNS erreichbar"
      return 0
    fi
  done
  die "Keine DNS-Auflösung. Der Installer braucht Internetzugang."
}

# Detects an existing installation so a second run repairs instead of clobbers.
detect::existing() {
  INSTALL_MODE="install"
  if [[ -f "${APP_STATE_FILE}" ]]; then
    INSTALL_MODE="upgrade"
    log::info "Bestehende Installation gefunden — Modus: Aktualisieren/Reparieren"
    # shellcheck disable=SC1090
    . "${APP_STATE_FILE}"
  fi
  export INSTALL_MODE
}

# True when a package is already present, so packages.sh can install only what
# is missing — one of the spec's explicit requirements.
detect::has_package() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "ok installed"
}

detect::has_command() { command -v "$1" >/dev/null 2>&1; }

detect::service_active() { systemctl is-active --quiet "$1" 2>/dev/null; }

# Resolves the public address, used to sanity-check the DNS record before
# Certbot is asked for a certificate that would fail.
detect::public_ip() {
  local ip=""
  if detect::has_command curl; then
    ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
    [[ -z "$ip" ]] && ip="$(curl -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)"
  fi
  printf '%s' "$ip"
}
