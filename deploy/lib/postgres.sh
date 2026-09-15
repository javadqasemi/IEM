# shellcheck shell=bash
#
# PostgreSQL: install, role, database, tuning and access rules.
#
# The role and database are created idempotently — a second run finds them and
# moves on rather than failing. The password is generated here and written
# only into the application's `.env.production` (mode 0600) and the root-only
# credentials file; it is never printed, never passed on a command line where
# the process list would show it, and never stored in the installer's log.

postgres::install() {
  log::step "PostgreSQL"

  if detect::has_command psql && detect::service_active postgresql; then
    log::skip "PostgreSQL läuft bereits ($(postgres::version))"
  else
    packages::ensure postgresql postgresql-contrib
    run systemctl enable --now postgresql || die "PostgreSQL konnte nicht gestartet werden."
    log::ok "PostgreSQL $(postgres::version) installiert"
  fi

  # A cluster that is installed but not accepting connections is a different
  # failure from one that is not installed, and it needs saying so.
  postgres::wait_ready || die "PostgreSQL nimmt keine Verbindungen an. 'systemctl status postgresql' prüfen."
}

postgres::version() {
  psql --version 2>/dev/null | awk '{print $3}' || echo "?"
}

postgres::wait_ready() {
  local i
  for i in $(seq 1 30); do
    if su - postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Runs SQL as the `postgres` superuser.
#
# Via `su - postgres` and peer authentication, so no superuser password is
# needed or created. Input comes on stdin rather than as `-c "$sql"`, which
# keeps any generated password out of the process list.
postgres::psql() {
  su - postgres -c "psql -v ON_ERROR_STOP=1 -tA" >>"$LOG_FILE" 2>&1
}

postgres::psql_query() {
  su - postgres -c "psql -v ON_ERROR_STOP=1 -tAc \"$1\"" 2>/dev/null
}

postgres::setup() {
  log::step "Datenbank"

  local exists
  exists="$(postgres::psql_query "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")"

  if [[ "$exists" == "1" ]]; then
    # The role exists from an earlier run, and its password is in the existing
    # `.env.production`. Rotating it here would break that file, so the
    # password is only reset when we could not read the old one.
    if [[ -n "${DB_PASSWORD:-}" ]]; then
      log::skip "Datenbankbenutzer ${DB_USER} besteht bereits"
    else
      log::info "Benutzer ${DB_USER} besteht, Passwort unbekannt — wird neu gesetzt"
      DB_PASSWORD="$(secret::password 32)"
      printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$DB_USER" "$DB_PASSWORD" | postgres::psql \
        || die "Passwort für ${DB_USER} konnte nicht gesetzt werden."
      log::ok "Passwort für ${DB_USER} neu gesetzt"
    fi
  else
    DB_PASSWORD="${DB_PASSWORD:-$(secret::password 32)}"
    printf "CREATE ROLE %s WITH LOGIN PASSWORD '%s';\n" "$DB_USER" "$DB_PASSWORD" | postgres::psql \
      || die "Datenbankbenutzer ${DB_USER} konnte nicht angelegt werden."
    log::ok "Datenbankbenutzer ${DB_USER} angelegt"
  fi

  exists="$(postgres::psql_query "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")"
  if [[ "$exists" == "1" ]]; then
    log::skip "Datenbank ${DB_NAME} besteht bereits"
  else
    printf "CREATE DATABASE %s OWNER %s ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;\n" \
      "$DB_NAME" "$DB_USER" | postgres::psql \
      || die "Datenbank ${DB_NAME} konnte nicht angelegt werden."
    log::ok "Datenbank ${DB_NAME} angelegt"
  fi

  # `CREATE DATABASE ... OWNER` already grants what Prisma needs. The explicit
  # schema grant is for the case where the database predates this installer
  # and is owned by someone else.
  {
    printf "GRANT ALL PRIVILEGES ON DATABASE %s TO %s;\n" "$DB_NAME" "$DB_USER"
    printf "\\connect %s\n" "$DB_NAME"
    printf "GRANT ALL ON SCHEMA public TO %s;\n" "$DB_USER"
    printf "ALTER SCHEMA public OWNER TO %s;\n" "$DB_USER"
  } | postgres::psql || log::warn "Rechte auf ${DB_NAME} konnten nicht vollständig gesetzt werden."

  log::ok "Rechte vergeben"
}

# Modest, safe tuning.
#
# Deliberately conservative: this writes into a conf.d drop-in rather than
# editing postgresql.conf, and it sizes buffers from actual RAM instead of
# applying numbers from a blog post. A box running the database *and* the
# application *and* Nginx cannot give a quarter of its memory to shared
# buffers the way a dedicated database server can.
postgres::tune() {
  local conf_dir mem_mb shared_mb cache_mb work_mb maint_mb
  conf_dir="$(su - postgres -c "psql -tAc 'SHOW config_file'" 2>/dev/null | xargs dirname 2>/dev/null)"
  [[ -d "$conf_dir" ]] || { log::warn "PostgreSQL-Konfigurationsverzeichnis nicht gefunden, Tuning übersprungen."; return 0; }

  mem_mb="$(free -m | awk '/^Mem:/ {print $2}')"
  shared_mb=$(( mem_mb / 8 ))   # 12.5 %, not 25 % — see above
  cache_mb=$(( mem_mb / 2 ))
  maint_mb=$(( mem_mb / 16 ))
  work_mb=8

  (( shared_mb < 128 )) && shared_mb=128
  (( shared_mb > 2048 )) && shared_mb=2048
  (( maint_mb < 64 )) && maint_mb=64
  (( maint_mb > 512 )) && maint_mb=512

  mkdir -p "$conf_dir/conf.d"
  cat >"$conf_dir/conf.d/10-iem.conf" <<EOF
# Managed by the IEM installer. Edits are overwritten on the next run —
# put local overrides in a file that sorts after this one, e.g. 20-local.conf.

shared_buffers = ${shared_mb}MB
effective_cache_size = ${cache_mb}MB
maintenance_work_mem = ${maint_mb}MB
work_mem = ${work_mb}MB

# The workload is a content database: small, read-heavy, with one large JSON
# document per published snapshot. Nothing here is write-throughput bound.
random_page_cost = 1.1
effective_io_concurrency = 200

# Autovacuum matters more than usual: content_version and audit_log are
# append-only and grow steadily, so the defaults leave dead tuples too long.
autovacuum = on
autovacuum_naptime = 30s
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.025

# Log anything slower than a second. Below that is noise; above it is either a
# missing index or the snapshot query, and both are worth seeing.
log_min_duration_statement = 1000
log_line_prefix = '%m [%p] %q%u@%d '
log_checkpoints = on
log_autovacuum_min_duration = 0

# Loopback only. The application is on this host; nothing else may connect.
listen_addresses = 'localhost'
EOF

  run systemctl restart postgresql || die "PostgreSQL konnte nach dem Tuning nicht neu gestartet werden."
  postgres::wait_ready || die "PostgreSQL ist nach dem Neustart nicht erreichbar."
  log::ok "Tuning angewendet (shared_buffers ${shared_mb} MB)"
}

# Verifies the application can actually log in with the credentials we wrote.
#
# Worth its own step: every failure after this point would otherwise surface
# as an opaque Prisma P1000 several minutes later, during the migration.
postgres::verify_login() {
  if PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; then
    log::ok "Anmeldung als ${DB_USER} erfolgreich"
    return 0
  fi
  die "Die Anwendung kann sich nicht an der Datenbank anmelden. pg_hba.conf und das Passwort prüfen."
}
