# shellcheck shell=bash
#
# Secrets, the service account, the directory layout and `.env.production`.
#
# Every secret is generated here from /dev/urandom. Nothing is hardcoded,
# nothing is derived from the domain or the company name, and nothing is
# printed. Two files hold them and both are 0600:
#
#   /opt/iem/server/.env.production   read by the application (owner: iem)
#   /etc/iem/credentials              the operator's copy   (owner: root)
#
# The second exists so a re-run can reuse the same database password instead of
# rotating it, and so an operator can recover the values without reading the
# application's environment.

env::create_user() {
  log::step "Dienstkonto und Verzeichnisse"

  if id -u "$APP_USER" >/dev/null 2>&1; then
    log::skip "Benutzer $APP_USER besteht bereits"
  else
    # A system account: no login shell, no password, no home in /home. The
    # application never needs a shell, and one is the difference between a
    # compromised Node process and a compromised server.
    run useradd --system --create-home --home-dir "$APP_HOME" \
      --shell /usr/sbin/nologin --comment "IEM CMS" "$APP_USER" \
      || die "Benutzer $APP_USER konnte nicht angelegt werden."
    log::ok "Systembenutzer $APP_USER angelegt"
  fi

  local dir
  for dir in "$APP_DIR" "$DATA_DIR" "$DATA_DIR/media" "$DATA_DIR/media/bewerbungen" \
             "$DATA_DIR/tmp" "$DATA_DIR/cache" "$LOG_DIR" "$BACKUP_DIR" "$CONFIG_DIR"; do
    mkdir -p "$dir"
  done

  chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR" "$LOG_DIR"
  chown root:root "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"
  chmod 750 "$DATA_DIR" "$LOG_DIR"

  # Job-application dossiers are personal data and must never be reachable by
  # a URL. They live under the media root but Nginx is configured not to serve
  # this prefix, and the mode keeps everyone but the app user out regardless.
  chmod 700 "$DATA_DIR/media/bewerbungen"

  chown root:root "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  log::ok "Verzeichnisse angelegt"
  log::info "  Anwendung   $APP_DIR"
  log::info "  Daten       $DATA_DIR"
  log::info "  Protokolle  $LOG_DIR"
  log::info "  Sicherungen $BACKUP_DIR"
}

# Reads back the secrets from a previous run, so re-running does not rotate
# them — a rotated database password would lock out the running application,
# and a rotated JWT secret would sign every administrator out.
env::load_existing() {
  [[ -f "$CRED_FILE" ]] || return 0
  # shellcheck disable=SC1090
  . "$CRED_FILE"
  log::info "Bestehende Zugangsdaten übernommen"
}

env::generate_secrets() {
  log::step "Schlüssel und Passwörter"

  DB_PASSWORD="${DB_PASSWORD:-}"        # postgres.sh fills this if empty
  REDIS_PASSWORD="${REDIS_PASSWORD:-}"  # redis.sh fills this if empty
  JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(secret::generate 64)}"
  ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(secret::generate 64)}"
  SESSION_SECRET="${SESSION_SECRET:-$(secret::generate 64)}"
  INTERNAL_API_KEY="${INTERNAL_API_KEY:-$(secret::generate 48)}"

  log::ok "Schlüssel erzeugt (64 Zeichen, /dev/urandom)"
}

env::write_credentials() {
  umask 077
  cat >"$CRED_FILE" <<EOF
# IEM — Zugangsdaten. Von install.sh erzeugt.
#
# Nur für root lesbar. Diese Datei existiert, damit eine erneute Installation
# dieselben Geheimnisse weiterverwendet statt sie zu wechseln — ein gewechseltes
# Datenbankpasswort sperrt die laufende Anwendung aus, ein gewechseltes
# JWT-Geheimnis meldet alle Administratoren ab.
#
# In die Sicherung aufnehmen. Ohne sie sind die Datenbank-Backups nicht
# einspielbar.

DB_NAME='${DB_NAME}'
DB_USER='${DB_USER}'
DB_PASSWORD='${DB_PASSWORD}'
REDIS_PASSWORD='${REDIS_PASSWORD}'
JWT_ACCESS_SECRET='${JWT_ACCESS_SECRET}'
ENCRYPTION_KEY='${ENCRYPTION_KEY}'
SESSION_SECRET='${SESSION_SECRET}'
INTERNAL_API_KEY='${INTERNAL_API_KEY}'
EOF
  chmod 600 "$CRED_FILE"
  chown root:root "$CRED_FILE"
  log::ok "Zugangsdaten unter $CRED_FILE (nur root)"
}

env::write_app_env() {
  log::step "Umgebung der Anwendung"

  local target="$APP_DIR/server/.env"
  umask 077

  cat >"$target" <<EOF
# Produktionsumgebung — von install.sh erzeugt am $(date -Is).
#
# Diese Datei enthält Geheimnisse. Rechte 0600, Eigentümer ${APP_USER}.
# Änderungen überleben eine erneute Installation nicht — dauerhafte Anpassungen
# gehören in ${CONFIG_DIR}/overrides.env, das am Ende eingelesen wird.

NODE_ENV=production

# ---- Datenbank ----
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=10"

# ---- Redis ----
# Koordiniert die Zeitsteuerung zwischen den PM2-Workern und teilt die
# Ratenbegrenzung. Ohne diese Zeile startet der Cluster-Modus nicht.
REDIS_URL="redis://:${REDIS_PASSWORD}@127.0.0.1:6379/0"

# ---- Schlüssel ----
JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET}"
JWT_ACCESS_TTL="15m"
REFRESH_TTL_DAYS="30"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
SESSION_SECRET="${SESSION_SECRET}"

# ---- HTTP ----
# Nur auf dem Loopback: Nginx ist das einzige, was die API erreichen darf.
PORT="${APP_PORT}"
HOST="127.0.0.1"

# Die API liegt hinter derselben Domain unter /api, also gibt es keine
# fremde Herkunft — und damit auch kein CORS-Thema im Betrieb.
CORS_ORIGINS="https://${CFG_DOMAIN}"
ADMIN_URL="https://${CFG_DOMAIN}/admin.html"
PUBLIC_URL="https://${CFG_DOMAIN}"

# ---- Medien ----
MEDIA_ROOT="${DATA_DIR}/media"
MEDIA_PUBLIC_PATH="/media"

# ---- E-Mail ----
SMTP_HOST="${CFG_SMTP_HOST}"
SMTP_PORT="${CFG_SMTP_PORT}"
SMTP_SECURE="$([[ "$CFG_SMTP_PORT" == "465" ]] && echo true || echo false)"
SMTP_USER="${CFG_SMTP_USER}"
SMTP_PASSWORD="${CFG_SMTP_PASSWORD}"
MAIL_FROM="${CFG_SMTP_FROM}"
MAIL_FROM_NAME="${CFG_COMPANY}"

# ---- Erstinstallation ----
# Wird einmal von 'npm run seed' gelesen. Das Passwort wird danach aus dieser
# Datei entfernt — siehe env::scrub_seed_password.
SEED_ADMIN_EMAIL="${CFG_ADMIN_EMAIL}"
SEED_ADMIN_NAME="${CFG_ADMIN_NAME}"
SEED_ADMIN_PASSWORD="${CFG_ADMIN_PASSWORD}"
EOF

  # Operator overrides, appended so they win. This is what makes the file
  # above safe to regenerate on every run.
  if [[ -f "$CONFIG_DIR/overrides.env" ]]; then
    printf '\n# ---- Lokale Anpassungen aus %s/overrides.env ----\n' "$CONFIG_DIR" >>"$target"
    cat "$CONFIG_DIR/overrides.env" >>"$target"
    log::info "Lokale Anpassungen übernommen"
  fi

  chmod 600 "$target"
  chown "$APP_USER:$APP_USER" "$target"
  log::ok "server/.env geschrieben (0600, $APP_USER)"
}

# The frontend's build-time environment.
#
# `VITE_CMS_API` is deliberately **empty**: Nginx proxies `/api` on the same
# domain, so the browser uses a relative URL, which removes CORS, removes the
# preflight on every request, and removes one thing to misconfigure.
#
# `VITE_ACCESS_CODE` is left unset, so the preview gate is off — a public site
# behind a code the owner does not know is a support call on day one.
env::write_frontend_env() {
  local target="$APP_DIR/.env.production"
  cat >"$target" <<EOF
# Frontend-Build — von install.sh erzeugt.
#
# Alle VITE_*-Werte landen im ausgelieferten Bundle und sind öffentlich.
# Hier gehören deshalb Adressen hinein und niemals Schlüssel.

# Leer: Nginx reicht /api auf derselben Domain an die API weiter, die Seite
# verwendet also eine relative Adresse. Kein CORS, kein Preflight.
VITE_CMS_API=""

VITE_BEWERBUNG_ENDPOINT="/api/v1/applications"

# Keine Zugangsschranke vor der öffentlichen Seite.
VITE_ACCESS_CODE=""
EOF
  chown "$APP_USER:$APP_USER" "$target"
  log::ok ".env.production für den Frontend-Build geschrieben"
}

# Removes the administrator's password from the environment file once the seed
# has used it.
#
# It has to be in the file for the seed to read, and it has no business
# surviving there: the account exists by then, and a plaintext password in a
# file that stays on disk for years is exactly the thing an installer should
# not leave behind.
env::scrub_seed_password() {
  local target="$APP_DIR/server/.env"
  [[ -f "$target" ]] || return 0
  run sed -i 's/^SEED_ADMIN_PASSWORD=.*/SEED_ADMIN_PASSWORD=""  # von install.sh nach dem Seed entfernt/' "$target"
  log::ok "Administrator-Passwort aus der Umgebungsdatei entfernt"
}

# Records what was installed, so a second run detects and repairs.
env::write_state() {
  cat >"$APP_STATE_FILE" <<EOF
# Zustand der Installation. Von install.sh geschrieben — nicht von Hand ändern.
IEM_INSTALLED_AT='$(date -Is)'
IEM_INSTALLER_VERSION='${INSTALLER_VERSION}'
IEM_DOMAIN='${CFG_DOMAIN}'
IEM_COMPANY='${CFG_COMPANY}'
IEM_APP_DIR='${APP_DIR}'
IEM_APP_USER='${APP_USER}'
IEM_APP_PORT='${APP_PORT}'
IEM_DATA_DIR='${DATA_DIR}'
IEM_SSL_ENABLED='${SSL_ACTIVE:-0}'
EOF
  chmod 600 "$APP_STATE_FILE"
  log::ok "Installationszustand gespeichert"
}
