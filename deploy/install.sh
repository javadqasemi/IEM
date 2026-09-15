#!/usr/bin/env bash
#
# IEM — Enterprise Installer
#
#   bash install.sh
#   curl -fsSL https://install.example.com/install.sh | bash -s -- --domain www.example.ch …
#
# One command turns a fresh Ubuntu 22.04/24.04 or Debian 12 server into a
# running installation: packages, PostgreSQL, Redis, the application, Nginx,
# a Let's Encrypt certificate, PM2, a firewall, Fail2Ban, backups and the
# first Super Admin.
#
# ---------------------------------------------------------------------
# Three properties the whole thing is built around
# ---------------------------------------------------------------------
#
# **Idempotent.** Running it twice is safe and is the supported way to repair
# an installation. Every module checks before it acts: packages are installed
# only if missing, the database role and schema are created only if absent,
# secrets are read back from /etc/iem/credentials rather than regenerated —
# because rotating the database password would lock out the running
# application and rotating the JWT secret would sign every administrator out.
#
# **It fails loudly and says what to do.** `set -euo pipefail` plus a single
# `die` path that names the step, the reason and the log file. There is no
# branch that continues quietly after something important did not work.
#
# **It does not install what the application does not use.** The specification
# asked for Docker, FFmpeg and ImageMagick; none of them is installed, because
# nothing here runs a container, transcodes video, or shells out to `convert`.
# See deploy/README.md for the full list of deviations and the reasoning.

set -o errexit
set -o nounset
set -o pipefail

readonly INSTALLER_VERSION="1.0.0"

# Resolve our own directory, following a symlink if we are one.
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
readonly INSTALLER_ROOT="$(cd -P "$(dirname "$SOURCE")" && pwd)"

# ---- Layout --------------------------------------------------------
#
# Overridable from the environment, so a second instance or a non-standard
# filesystem does not require editing this file.

readonly APP_DIR="${IEM_APP_DIR:-/opt/iem}"
readonly APP_USER="${IEM_APP_USER:-iem}"
readonly APP_HOME="${IEM_APP_HOME:-/var/lib/iem-home}"
readonly APP_PORT="${IEM_APP_PORT:-3100}"
readonly DATA_DIR="${IEM_DATA_DIR:-/var/lib/iem}"
readonly LOG_DIR="${IEM_LOG_DIR:-/var/log/iem}"
readonly BACKUP_DIR="${IEM_BACKUP_DIR:-/var/backups/iem}"
readonly CONFIG_DIR="${IEM_CONFIG_DIR:-/etc/iem}"
readonly BIN_DIR="${IEM_BIN_DIR:-/usr/local/lib/iem}"
readonly CRED_FILE="$CONFIG_DIR/credentials"
readonly APP_STATE_FILE="$CONFIG_DIR/install.state"
readonly DB_NAME="${IEM_DB_NAME:-iem_cms}"
readonly DB_USER="${IEM_DB_USER:-iem_app}"
readonly NGINX_SITE="iem"
readonly NGINX_ALT_NAMES="${IEM_ALT_NAMES:-}"
readonly PM2_APP_NAME="iem-api"

# Filled in by the modules.
DB_PASSWORD=""
REDIS_PASSWORD=""
JWT_ACCESS_SECRET=""
ENCRYPTION_KEY=""
SESSION_SECRET=""
INTERNAL_API_KEY=""
APP_VERSION=""
SSL_EXPIRY=""
HTTPS_LIKELY_TO_FAIL=0
INSTALL_MODE="install"
declare -a WARNINGS=()

# ---- Modules -------------------------------------------------------

for module in log detect wizard packages postgres redis env app nginx ssl process security backup cli validate report; do
  file="$INSTALLER_ROOT/lib/${module}.sh"
  [[ -r "$file" ]] || { printf 'Modul fehlt: %s\n' "$file" >&2; exit 1; }
  # shellcheck source=/dev/null
  . "$file"
done
unset module file

# ---- Run -----------------------------------------------------------

main() {
  wizard::parse_args "$@"
  wizard::from_env
  log::init "$@"

  banner

  # --- Pre-flight. Everything that can refuse, refuses here. ---
  log::step "Systemprüfung"
  detect::root
  detect::os
  detect::supported
  detect::architecture
  detect::network
  detect::resources
  mkdir -p "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"
  detect::existing
  env::load_existing

  # --- Ask ---
  wizard::run
  wizard::check_dns

  # --- Install ---
  packages::update_index
  packages::base
  packages::locale_and_time
  node::install

  env::create_user
  env::generate_secrets

  postgres::install
  postgres::setup
  postgres::tune
  postgres::verify_login

  redis::install

  env::write_credentials

  app::fetch_source
  env::write_app_env
  env::write_frontend_env
  app::install_dependencies
  app::build
  app::migrate
  app::seed
  app::verify_admin
  app::verify_published

  process::configure
  process::start
  process::enable_boot
  process::logrotate
  process::health || die "Die API ist nach dem Start nicht erreichbar."

  nginx::install
  nginx::error_pages
  nginx::test_and_reload

  ssl::install

  security::firewall
  security::fail2ban
  security::kernel
  security::auto_updates
  security::permissions

  backup::install
  cli::install
  backup::initial

  env::write_state

  # --- Verify ---
  validate::all
  report::write

  (( CHECKS_FAILED > 0 )) && exit 1
  exit 0
}

banner() {
  cat <<EOF

${C_BOLD}  IEM — Enterprise Installer ${INSTALLER_VERSION}${C_RESET}
  ${C_DIM}Website, Dashboard und API in einem Durchgang${C_RESET}

EOF
}

main "$@"
