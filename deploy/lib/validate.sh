# shellcheck shell=bash
#
# Post-installation verification.
#
# Every check here answers a question the operator would otherwise have to ask
# themselves in the first hour, and each one tests the thing end to end rather
# than testing that a package is installed. "Is PostgreSQL installed" is not
# the question; "can the application sign in to its database" is.
#
# Results are collected rather than fatal: the report should show all twenty
# outcomes, not stop at the first failure.

CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNED=0
declare -a CHECK_RESULTS=()

check::pass() {
  CHECK_RESULTS+=("ok|$1|$2")
  (( CHECKS_PASSED++ )) || true
  printf '  %s✓%s %-34s %s\n' "$C_GREEN" "$C_RESET" "$1" "${C_DIM}$2${C_RESET}"
}

check::fail() {
  CHECK_RESULTS+=("fail|$1|$2")
  (( CHECKS_FAILED++ )) || true
  printf '  %s✗%s %-34s %s\n' "$C_RED" "$C_RESET" "$1" "$2"
}

check::warn() {
  CHECK_RESULTS+=("warn|$1|$2")
  (( CHECKS_WARNED++ )) || true
  printf '  %s!%s %-34s %s\n' "$C_YELLOW" "$C_RESET" "$1" "$2"
}

validate::all() {
  log::step "Prüfung der Installation"

  validate::services
  validate::database
  validate::redis
  validate::api
  validate::frontend
  validate::auth
  validate::content
  validate::nginx
  validate::ssl
  validate::storage
  validate::mail
  validate::scheduler
  validate::backups
  validate::security
}

validate::services() {
  local svc
  for svc in postgresql redis-server nginx; do
    if detect::service_active "$svc"; then
      check::pass "Dienst $svc" "aktiv"
    else
      check::fail "Dienst $svc" "läuft nicht"
    fi
  done

  if as_app "pm2 jlist" 2>/dev/null | grep -q '"status":"online"'; then
    local count
    count="$(as_app "pm2 jlist" 2>/dev/null | grep -c '"status":"online"' || echo 0)"
    check::pass "API-Prozesse" "${count} Worker online"
  else
    check::fail "API-Prozesse" "kein Worker online"
  fi
}

validate::database() {
  if PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; then
    check::pass "Datenbankanmeldung" "als $DB_USER"
  else
    check::fail "Datenbankanmeldung" "fehlgeschlagen"
    return
  fi

  # Tables existing is what separates "migrated" from "connected".
  local tables
  tables="$(PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)"
  if (( tables >= 15 )); then
    check::pass "Schema" "${tables} Tabellen"
  else
    check::fail "Schema" "nur ${tables} Tabellen — Migration unvollständig"
  fi
}

validate::redis() {
  if redis-cli -a "${REDIS_PASSWORD:-}" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
    check::pass "Redis" "antwortet, Passwort gesetzt"
  else
    check::warn "Redis" "nicht erreichbar — API läuft mit einem Worker"
  fi

  # Unauthenticated access must be refused. If this succeeds, `requirepass`
  # did not take effect and anything on the box can read the session state.
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    check::fail "Redis-Authentifizierung" "Zugriff ohne Passwort möglich"
  else
    check::pass "Redis-Authentifizierung" "ohne Passwort abgewiesen"
  fi
}

validate::api() {
  local body
  body="$(curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/api/v1/dashboard/ping" 2>/dev/null || echo "")"
  if [[ "$body" == *'"status":"ok"'* ]]; then
    check::pass "API" "antwortet auf /dashboard/ping"
  else
    check::fail "API" "antwortet nicht"
  fi

  # Through Nginx as well — a working API that Nginx cannot reach is a broken
  # site, and it is a different fault from a broken API.
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Host: $CFG_DOMAIN" "http://127.0.0.1/api/v1/dashboard/ping" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" ]]; then
    check::pass "API über Nginx" "/api wird weitergereicht"
  else
    check::fail "API über Nginx" "HTTP $code"
  fi
}

validate::frontend() {
  local entry code
  for entry in "" "admin.html" "stelle.html"; do
    code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 \
      -H "Host: $CFG_DOMAIN" "http://127.0.0.1/${entry}" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
      check::pass "Seite /${entry:-}" "HTTP 200"
    else
      check::fail "Seite /${entry:-}" "HTTP $code"
    fi
  done
}

validate::auth() {
  # A deliberately wrong password must be refused with 401, not 500. A 500
  # here means the database or the argon2 binding is broken, which would
  # otherwise only be discovered by the administrator at their first sign-in.
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "http://127.0.0.1:${APP_PORT}/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d '{"email":"nobody@invalid.test","password":"definitely-not-the-password"}' 2>/dev/null || echo 000)"

  case "$code" in
    401) check::pass "Anmeldung" "falsche Daten korrekt abgewiesen" ;;
    429) check::pass "Anmeldung" "Ratenbegrenzung greift" ;;
    500) check::fail "Anmeldung" "Serverfehler statt Abweisung" ;;
    *)   check::warn "Anmeldung" "unerwartet HTTP $code" ;;
  esac

  # A protected route without a token must be 401, never 200. This is the one
  # check that would catch a guard accidentally left off.
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 \
    "http://127.0.0.1:${APP_PORT}/api/v1/users" 2>/dev/null || echo 000)"
  if [[ "$code" == "401" ]]; then
    check::pass "Zugriffsschutz" "geschützte Route ohne Token abgewiesen"
  else
    check::fail "Zugriffsschutz" "/users antwortet ohne Token mit HTTP $code"
  fi
}

validate::content() {
  local body
  body="$(curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/api/v1/content/published" 2>/dev/null || echo "")"
  if [[ -z "$body" ]]; then
    check::fail "Veröffentlichte Inhalte" "Endpunkt liefert nichts"
    return
  fi

  local version projects team
  version="$(printf '%s' "$body" | jq -r '.data.version // empty' 2>/dev/null)"
  projects="$(printf '%s' "$body" | jq -r '.data.content.projects | length' 2>/dev/null || echo 0)"
  team="$(printf '%s' "$body" | jq -r '.data.content.team | length' 2>/dev/null || echo 0)"

  if [[ -n "$version" ]]; then
    check::pass "Veröffentlichte Inhalte" "Stand $version"
  else
    check::fail "Veröffentlichte Inhalte" "kein Snapshot"
  fi

  if (( projects > 0 && team > 0 )); then
    check::pass "Grunddaten" "${projects} Referenzen, ${team} Personen"
  else
    check::fail "Grunddaten" "Inhalte fehlen (${projects} Referenzen, ${team} Personen)"
  fi

  # The permission catalogue in the database must match the one in the code,
  # or roles grant keys no guard checks.
  local seed
  seed="$(PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc \
    'SELECT count(*) FROM "Permission"' 2>/dev/null || echo 0)"
  if (( seed > 40 )); then
    check::pass "Berechtigungen" "${seed} im Katalog"
  else
    check::fail "Berechtigungen" "nur ${seed} — Seed unvollständig"
  fi
}

validate::nginx() {
  if nginx -t >/dev/null 2>&1; then
    check::pass "Nginx-Konfiguration" "gültig"
  else
    check::fail "Nginx-Konfiguration" "fehlerhaft"
  fi

  local headers
  headers="$(curl -fsSI --max-time 10 -H "Host: $CFG_DOMAIN" "http://127.0.0.1/" 2>/dev/null || echo "")"
  if printf '%s' "$headers" | grep -qi "x-content-type-options"; then
    check::pass "Sicherheits-Header" "gesetzt"
  else
    check::warn "Sicherheits-Header" "nicht gefunden"
  fi
  if printf '%s' "$headers" | grep -qi "content-security-policy"; then
    check::pass "Content-Security-Policy" "gesetzt"
  else
    check::warn "Content-Security-Policy" "nicht gefunden"
  fi

  # Dossiers must not be reachable by URL.
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Host: $CFG_DOMAIN" "http://127.0.0.1/media/bewerbungen/" 2>/dev/null || echo 000)"
  if [[ "$code" == "403" || "$code" == "404" ]]; then
    check::pass "Bewerbungsunterlagen" "nicht öffentlich erreichbar"
  else
    check::fail "Bewerbungsunterlagen" "über /media erreichbar (HTTP $code)"
  fi
}

validate::ssl() {
  if [[ "$CFG_ENABLE_SSL" != "1" ]]; then
    check::warn "HTTPS" "abgewählt — die Seite läuft unverschlüsselt"
    return
  fi
  if [[ "${SSL_ACTIVE:-0}" == "1" ]]; then
    check::pass "HTTPS" "Zertifikat aktiv${SSL_EXPIRY:+, gültig bis $SSL_EXPIRY}"
    if systemctl is-enabled --quiet certbot.timer 2>/dev/null || [[ -f /etc/cron.d/iem-certbot ]]; then
      check::pass "Zertifikatserneuerung" "eingerichtet"
    else
      check::fail "Zertifikatserneuerung" "nicht eingerichtet"
    fi
  else
    check::fail "HTTPS" "kein Zertifikat — 'certbot --nginx -d $CFG_DOMAIN' nachholen"
  fi
}

validate::storage() {
  local dir
  for dir in "$DATA_DIR/media" "$LOG_DIR" "$BACKUP_DIR"; do
    if [[ -d "$dir" ]]; then
      check::pass "Verzeichnis $(basename "$dir")" "$dir"
    else
      check::fail "Verzeichnis $(basename "$dir")" "fehlt"
    fi
  done

  # Writable by the application, tested by actually writing.
  if su "$APP_USER" -s /bin/bash -c "touch '$DATA_DIR/media/.writetest' && rm -f '$DATA_DIR/media/.writetest'" 2>/dev/null; then
    check::pass "Schreibrechte Medien" "$APP_USER darf schreiben"
  else
    check::fail "Schreibrechte Medien" "$APP_USER darf nicht schreiben"
  fi

  local free
  free="$(df -Ph "$DATA_DIR" | awk 'NR==2 {print $4}')"
  check::pass "Freier Speicherplatz" "$free"
}

validate::mail() {
  if [[ -z "$CFG_SMTP_HOST" ]]; then
    check::warn "E-Mail-Versand" "kein SMTP — Passwort-Links landen nur im Protokoll"
    return
  fi
  # A TCP connect, not a full SMTP handshake: it distinguishes "the host is
  # wrong or blocked" from "the credentials are wrong", and only the first is
  # something the installer can sensibly check.
  if timeout 5 bash -c "</dev/tcp/${CFG_SMTP_HOST}/${CFG_SMTP_PORT}" 2>/dev/null; then
    check::pass "SMTP" "${CFG_SMTP_HOST}:${CFG_SMTP_PORT} erreichbar"
  else
    check::warn "SMTP" "${CFG_SMTP_HOST}:${CFG_SMTP_PORT} nicht erreichbar"
  fi
}

validate::scheduler() {
  # The scheduler runs inside the API; what is verifiable from outside is that
  # its coordination primitive works. Without it, clustered workers would
  # duplicate scheduled publishing.
  if [[ -n "${REDIS_PASSWORD:-}" ]] && redis-cli -a "$REDIS_PASSWORD" --no-auth-warning \
       set "iem:lock:installcheck" "probe" NX PX 2000 2>/dev/null | grep -q OK; then
    redis-cli -a "$REDIS_PASSWORD" --no-auth-warning del "iem:lock:installcheck" >/dev/null 2>&1 || true
    check::pass "Zeitsteuerung" "Sperre über Redis funktioniert"
  elif [[ -z "${REDIS_PASSWORD:-}" ]]; then
    check::warn "Zeitsteuerung" "ohne Redis nur mit einem Worker zulässig"
  else
    check::fail "Zeitsteuerung" "Sperre lässt sich nicht setzen"
  fi
}

validate::backups() {
  local tier ok=1
  for tier in daily weekly monthly; do
    systemctl is-enabled --quiet "iem-backup-${tier}.timer" 2>/dev/null || ok=0
  done
  if (( ok )); then
    check::pass "Sicherungs-Zeitpläne" "täglich, wöchentlich, monatlich aktiv"
  else
    check::fail "Sicherungs-Zeitpläne" "nicht vollständig aktiviert"
  fi

  local latest
  latest="$(ls -1t "$BACKUP_DIR"/daily/iem-*.tar 2>/dev/null | head -1)"
  if [[ -n "$latest" ]]; then
    check::pass "Erste Sicherung" "$(du -h "$latest" | cut -f1) — $(basename "$latest")"
  else
    check::warn "Erste Sicherung" "noch keine vorhanden"
  fi
}

validate::security() {
  if ufw status 2>/dev/null | grep -q "Status: active"; then
    check::pass "Firewall" "aktiv"
  else
    check::fail "Firewall" "nicht aktiv"
  fi

  if detect::service_active fail2ban; then
    local jails
    jails="$(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/ {print $2}' | tr -d ' \t' || echo "")"
    check::pass "Fail2Ban" "${jails:-aktiv}"
  else
    check::warn "Fail2Ban" "nicht aktiv"
  fi

  # The environment file holds every secret. World-readable would be a finding.
  local mode
  mode="$(stat -c '%a' "$APP_DIR/server/.env" 2>/dev/null || echo "?")"
  if [[ "$mode" == "600" ]]; then
    check::pass "Rechte auf .env" "0600"
  else
    check::fail "Rechte auf .env" "$mode statt 600"
  fi

  # PostgreSQL and Redis must not be listening on a public interface.
  if ss -ltn 2>/dev/null | grep -qE '0\.0\.0\.0:(5432|6379)'; then
    check::fail "Datenbank-Bindung" "PostgreSQL oder Redis lauscht öffentlich"
  else
    check::pass "Datenbank-Bindung" "nur localhost"
  fi

  if [[ -f /var/run/reboot-required ]]; then
    check::warn "Neustart" "durch Systemaktualisierung ausstehend"
  fi
}
