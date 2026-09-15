# shellcheck shell=bash
#
# The installation wizard.
#
# Asks only for what the installer genuinely cannot work out: the company's
# own details, the domain, and the first administrator. Everything else —
# database names, passwords, secrets, paths, ports, certificate settings — is
# derived or generated.
#
# Every answer can also come from a flag or an environment variable, so the
# same script drives an unattended install. That is not a nicety: a wizard
# that only works interactively cannot be used from cloud-init, Ansible or a
# CI pipeline, which is where production installs actually come from.

# ---- Answers -------------------------------------------------------

CFG_COMPANY=""
CFG_DOMAIN=""
CFG_ADMIN_NAME=""
CFG_ADMIN_EMAIL=""
CFG_ADMIN_PASSWORD=""
CFG_SSL_EMAIL=""
CFG_TIMEZONE=""
CFG_LOCALE=""
CFG_SMTP_HOST=""
CFG_SMTP_PORT="587"
CFG_SMTP_USER=""
CFG_SMTP_PASSWORD=""
CFG_SMTP_FROM=""
CFG_ENABLE_SSL="1"
CFG_SOURCE_REPO=""
CFG_SOURCE_REF="main"

wizard::usage() {
  cat <<'EOF'
IEM Enterprise Installer

  bash install.sh [Optionen]
  curl -fsSL <url>/install.sh | bash -s -- [Optionen]

Ohne Optionen fragt der Installer interaktiv nach. Für eine unbeaufsichtigte
Installation müssen mindestens --domain, --admin-email und --admin-password
gesetzt sein.

Pflicht (unbeaufsichtigt):
  --domain <fqdn>              Domain der Website, z. B. www.example.ch
  --admin-email <mail>         E-Mail des ersten Super Admins
  --admin-password <pw>        Passwort (min. 12 Zeichen)

Optional:
  --company <name>             Firmenname                    [IEM AG]
  --admin-name <name>          Name des Administrators       [Administrator]
  --ssl-email <mail>           Kontakt für Let's Encrypt     [--admin-email]
  --timezone <tz>              Zeitzone                      [Europe/Zurich]
  --locale <locale>            Sprache                       [de_CH.UTF-8]
  --no-ssl                     Kein Zertifikat anfordern (nur HTTP)
  --smtp-host <host>           SMTP-Server für E-Mail-Versand
  --smtp-port <port>           SMTP-Port                     [587]
  --smtp-user <user>           SMTP-Benutzer
  --smtp-password <pw>         SMTP-Passwort
  --smtp-from <mail>           Absenderadresse               [noreply@<domain>]
  --repo <url>                 Git-Repository der Anwendung
  --ref <branch|tag>           Branch oder Tag               [main]
  --log <pfad>                 Protokolldatei                [/var/log/iem-install.log]
  -y, --yes                    Alle Rückfragen bejahen
  -h, --help                   Diese Hilfe

Umgebungsvariablen entsprechen den Optionen in Grossschreibung mit Präfix IEM_,
z. B. IEM_DOMAIN, IEM_ADMIN_PASSWORD. Flags haben Vorrang.

Ein Passwort auf der Kommandozeile ist in der Prozessliste und in der History
sichtbar. IEM_ADMIN_PASSWORD aus einer Datei mit 0600 ist der sicherere Weg.
EOF
}

wizard::parse_args() {
  while (( $# )); do
    case "$1" in
      --company)        CFG_COMPANY="${2:-}"; shift 2 ;;
      --domain)         CFG_DOMAIN="${2:-}"; shift 2 ;;
      --admin-name)     CFG_ADMIN_NAME="${2:-}"; shift 2 ;;
      --admin-email)    CFG_ADMIN_EMAIL="${2:-}"; shift 2 ;;
      --admin-password) CFG_ADMIN_PASSWORD="${2:-}"; shift 2 ;;
      --ssl-email)      CFG_SSL_EMAIL="${2:-}"; shift 2 ;;
      --timezone)       CFG_TIMEZONE="${2:-}"; shift 2 ;;
      --locale)         CFG_LOCALE="${2:-}"; shift 2 ;;
      --no-ssl)         CFG_ENABLE_SSL="0"; shift ;;
      --smtp-host)      CFG_SMTP_HOST="${2:-}"; shift 2 ;;
      --smtp-port)      CFG_SMTP_PORT="${2:-}"; shift 2 ;;
      --smtp-user)      CFG_SMTP_USER="${2:-}"; shift 2 ;;
      --smtp-password)  CFG_SMTP_PASSWORD="${2:-}"; shift 2 ;;
      --smtp-from)      CFG_SMTP_FROM="${2:-}"; shift 2 ;;
      --repo)           CFG_SOURCE_REPO="${2:-}"; shift 2 ;;
      --ref)            CFG_SOURCE_REF="${2:-}"; shift 2 ;;
      --log)            LOG_FILE="${2:-}"; shift 2 ;;
      -y | --yes)       IEM_ASSUME_YES=1; shift ;;
      -h | --help)      wizard::usage; exit 0 ;;
      *)                printf 'Unbekannte Option: %s\n\n' "$1" >&2; wizard::usage >&2; exit 2 ;;
    esac
  done
}

# Environment variables fill anything a flag did not.
wizard::from_env() {
  CFG_COMPANY="${CFG_COMPANY:-${IEM_COMPANY:-}}"
  CFG_DOMAIN="${CFG_DOMAIN:-${IEM_DOMAIN:-}}"
  CFG_ADMIN_NAME="${CFG_ADMIN_NAME:-${IEM_ADMIN_NAME:-}}"
  CFG_ADMIN_EMAIL="${CFG_ADMIN_EMAIL:-${IEM_ADMIN_EMAIL:-}}"
  CFG_ADMIN_PASSWORD="${CFG_ADMIN_PASSWORD:-${IEM_ADMIN_PASSWORD:-}}"
  CFG_SSL_EMAIL="${CFG_SSL_EMAIL:-${IEM_SSL_EMAIL:-}}"
  CFG_TIMEZONE="${CFG_TIMEZONE:-${IEM_TIMEZONE:-}}"
  CFG_LOCALE="${CFG_LOCALE:-${IEM_LOCALE:-}}"
  CFG_SMTP_HOST="${CFG_SMTP_HOST:-${IEM_SMTP_HOST:-}}"
  CFG_SMTP_PORT="${CFG_SMTP_PORT:-${IEM_SMTP_PORT:-587}}"
  CFG_SMTP_USER="${CFG_SMTP_USER:-${IEM_SMTP_USER:-}}"
  CFG_SMTP_PASSWORD="${CFG_SMTP_PASSWORD:-${IEM_SMTP_PASSWORD:-}}"
  CFG_SMTP_FROM="${CFG_SMTP_FROM:-${IEM_SMTP_FROM:-}}"
  CFG_SOURCE_REPO="${CFG_SOURCE_REPO:-${IEM_REPO:-}}"
  CFG_SOURCE_REF="${CFG_SOURCE_REF:-${IEM_REF:-main}}"
  [[ -n "${IEM_NO_SSL:-}" ]] && CFG_ENABLE_SSL="0"
}

# ---- Validation ----------------------------------------------------

# Deliberately loose. The only thing worth checking is that the address could
# plausibly be delivered to — stricter patterns reject valid addresses, and
# the real check is whether the reset mail arrives.
wizard::valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

# A hostname, not a URL. Rejecting the scheme early is worth it: a domain
# entered as "https://example.ch" produces an Nginx `server_name` that matches
# nothing and a certificate request that fails with an opaque error.
wizard::valid_domain() {
  [[ "$1" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$ ]]
}

# Length over composition. Twelve characters with no class rules produces
# better passwords than eight with four; the second reliably yields
# "Passwort1!". The same rule the application itself enforces.
wizard::valid_password() {
  local pw="$1" lower
  (( ${#pw} >= 12 )) || { printf 'Mindestens 12 Zeichen.'; return 1; }
  (( ${#pw} <= 256 )) || { printf 'Höchstens 256 Zeichen.'; return 1; }
  lower="${pw,,}"
  local bad
  for bad in passwort password 12345678 qwertz admin123 iemag; do
    [[ "$lower" == *"$bad"* ]] && { printf 'Zu leicht zu erraten (enthält „%s“).' "$bad"; return 1; }
  done
  return 0
}

# ---- The wizard ----------------------------------------------------

wizard::run() {
  log::step "Konfiguration"

  if (( IS_INTERACTIVE )) && [[ -z "$CFG_DOMAIN" ]]; then
    cat <<EOF

  Der Installer richtet die komplette Umgebung ein. Er fragt nur nach dem,
  was er nicht selbst wissen kann. Datenbank, Passwörter, Schlüssel und
  Zertifikate werden automatisch erzeugt.

EOF
  fi

  CFG_COMPANY="${CFG_COMPANY:-$(ask "Firmenname" "IEM AG")}"

  while :; do
    [[ -z "$CFG_DOMAIN" ]] && CFG_DOMAIN="$(ask "Domain (ohne https://)" "")"
    CFG_DOMAIN="${CFG_DOMAIN#http://}"
    CFG_DOMAIN="${CFG_DOMAIN#https://}"
    CFG_DOMAIN="${CFG_DOMAIN%%/*}"
    if wizard::valid_domain "$CFG_DOMAIN"; then break; fi
    log::error "„$CFG_DOMAIN“ ist kein gültiger Hostname."
    CFG_DOMAIN=""
    (( IS_INTERACTIVE )) || die "Ungültige Domain."
  done

  CFG_ADMIN_NAME="${CFG_ADMIN_NAME:-$(ask "Name des Administrators" "Administrator")}"

  while :; do
    [[ -z "$CFG_ADMIN_EMAIL" ]] && CFG_ADMIN_EMAIL="$(ask "E-Mail des Administrators" "")"
    if wizard::valid_email "$CFG_ADMIN_EMAIL"; then break; fi
    log::error "„$CFG_ADMIN_EMAIL“ ist keine gültige E-Mail-Adresse."
    CFG_ADMIN_EMAIL=""
    (( IS_INTERACTIVE )) || die "Ungültige Administrator-Adresse."
  done

  while :; do
    if [[ -z "$CFG_ADMIN_PASSWORD" ]]; then
      local first second
      first="$(ask_secret "Passwort des Administrators (min. 12 Zeichen)")"
      second="$(ask_secret "Passwort wiederholen")"
      if [[ "$first" != "$second" ]]; then
        log::error "Die Passwörter stimmen nicht überein."
        continue
      fi
      CFG_ADMIN_PASSWORD="$first"
    fi
    local reason
    if reason="$(wizard::valid_password "$CFG_ADMIN_PASSWORD")"; then break; fi
    log::error "Passwort abgelehnt: $reason"
    CFG_ADMIN_PASSWORD=""
    (( IS_INTERACTIVE )) || die "Passwort zu schwach: $reason"
  done

  CFG_TIMEZONE="${CFG_TIMEZONE:-$(ask "Zeitzone" "Europe/Zurich")}"
  CFG_LOCALE="${CFG_LOCALE:-$(ask "Sprache" "de_CH.UTF-8")}"

  if [[ "$CFG_ENABLE_SSL" == "1" ]]; then
    CFG_SSL_EMAIL="${CFG_SSL_EMAIL:-$(ask "E-Mail für Let's Encrypt" "$CFG_ADMIN_EMAIL")}"
    wizard::valid_email "$CFG_SSL_EMAIL" || die "„$CFG_SSL_EMAIL“ ist keine gültige E-Mail-Adresse."
  fi

  # SMTP is genuinely optional: the application logs mail it cannot send
  # rather than failing, so an install without it is complete and usable.
  # What it costs is the password-reset link and the application
  # confirmation, so the prompt says that instead of just asking.
  if [[ -z "$CFG_SMTP_HOST" ]] && (( IS_INTERACTIVE )); then
    printf '\n  %sE-Mail-Versand (optional)%s\n' "$C_BOLD" "$C_RESET"
    printf '  Ohne SMTP funktioniert alles, ausser dem Versand: Passwort-Links und\n'
    printf '  Bewerbungsbestätigungen landen dann nur im Protokoll. Später im\n'
    printf '  Dashboard unter Einstellungen nachtragbar.\n\n'
    if confirm "SMTP jetzt einrichten?" "n"; then
      CFG_SMTP_HOST="$(ask "SMTP-Server" "")"
      CFG_SMTP_PORT="$(ask "SMTP-Port" "587")"
      CFG_SMTP_USER="$(ask "SMTP-Benutzer" "")"
      CFG_SMTP_PASSWORD="$(ask_secret "SMTP-Passwort")"
    fi
  fi
  CFG_SMTP_FROM="${CFG_SMTP_FROM:-noreply@$CFG_DOMAIN}"

  wizard::summary
}

wizard::summary() {
  cat <<EOF

  ${C_BOLD}Zusammenfassung${C_RESET}
    Firma          $CFG_COMPANY
    Domain         https://$CFG_DOMAIN
    Administrator  $CFG_ADMIN_NAME <$CFG_ADMIN_EMAIL>
    Zeitzone       $CFG_TIMEZONE
    Sprache        $CFG_LOCALE
    HTTPS          $([[ "$CFG_ENABLE_SSL" == "1" ]] && echo "Let's Encrypt ($CFG_SSL_EMAIL)" || echo "aus")
    SMTP           ${CFG_SMTP_HOST:-nicht konfiguriert}
    Installation   $APP_DIR
    Protokoll      $LOG_FILE

EOF

  if (( IS_INTERACTIVE )) && [[ -z "${IEM_ASSUME_YES:-}" ]]; then
    confirm "So installieren?" "y" || die "Abgebrochen."
  fi
}

# Warns when the domain does not point here.
#
# A warning, not a refusal: the DNS record may be propagating, the server may
# sit behind a proxy or a load balancer, and refusing would block a legitimate
# install. But issuing a certificate will fail, and finding out *here* is far
# better than finding out inside Certbot's rate-limited retry.
wizard::check_dns() {
  [[ "$CFG_ENABLE_SSL" == "1" ]] || return 0
  local public resolved
  public="$(detect::public_ip)"
  resolved="$(getent ahostsv4 "$CFG_DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}')"

  if [[ -z "$resolved" ]]; then
    log::warn "$CFG_DOMAIN löst nicht auf. Ohne DNS-Eintrag schlägt die Zertifikatsanforderung fehl."
    HTTPS_LIKELY_TO_FAIL=1
  elif [[ -n "$public" && "$resolved" != "$public" ]]; then
    log::warn "$CFG_DOMAIN zeigt auf $resolved, dieser Server ist $public."
    HTTPS_LIKELY_TO_FAIL=1
  else
    log::ok "DNS: $CFG_DOMAIN → $resolved"
  fi
}
