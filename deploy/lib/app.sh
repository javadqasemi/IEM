# shellcheck shell=bash
#
# The application itself: source, dependencies, build, migrate, seed.
#
# Everything from `app::build` onwards runs **as the application user**, not as
# root. That is not ceremony: `npm` runs arbitrary lifecycle scripts from the
# dependency tree, and running those as root on a production server is how a
# compromised package becomes a compromised host.

# Runs a command as the application user, in the application directory.
#
# `env -i` would be cleaner still but breaks node-gyp, which needs PATH and
# HOME. So the environment is pruned rather than emptied.
as_app() {
  log::raw "\$ (as $APP_USER) $*"
  su "$APP_USER" -s /bin/bash -c "cd '$APP_DIR' && $*" >>"$LOG_FILE" 2>&1
}

as_app_in() {
  local dir="$1"; shift
  log::raw "\$ (as $APP_USER in $dir) $*"
  su "$APP_USER" -s /bin/bash -c "cd '$dir' && $*" >>"$LOG_FILE" 2>&1
}

# ---- Source --------------------------------------------------------

app::fetch_source() {
  log::step "Quellcode"

  # Running `bash install.sh` from inside a checkout uses that checkout. This
  # is the path a developer or an air-gapped install takes, and it means the
  # installer needs no repository URL at all.
  if [[ -f "$INSTALLER_ROOT/../package.json" ]] && [[ -d "$INSTALLER_ROOT/../server" ]]; then
    local source_dir
    source_dir="$(cd "$INSTALLER_ROOT/.." && pwd)"
    if [[ "$source_dir" == "$APP_DIR" ]]; then
      log::skip "Quellcode liegt bereits unter $APP_DIR"
    else
      log::info "Lokaler Quellcode: $source_dir"
      # `--delete` so a removed file does not survive an upgrade, with the
      # runtime directories excluded — they are data, not source.
      run rsync -a --delete \
        --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
        --exclude '.env' --exclude '.env.*' --exclude 'var' \
        "$source_dir/" "$APP_DIR/" || die "Quellcode konnte nicht kopiert werden."
      log::ok "Quellcode nach $APP_DIR kopiert"
    fi
  elif [[ -n "$CFG_SOURCE_REPO" ]]; then
    if [[ -d "$APP_DIR/.git" ]]; then
      log::info "Aktualisiere aus $CFG_SOURCE_REPO ($CFG_SOURCE_REF)"
      as_app "git remote set-url origin '$CFG_SOURCE_REPO'" || true
      as_app "git fetch --depth 1 origin '$CFG_SOURCE_REF'" || die "git fetch ist fehlgeschlagen."
      as_app "git reset --hard FETCH_HEAD" || die "git reset ist fehlgeschlagen."
    else
      run git clone --depth 1 --branch "$CFG_SOURCE_REF" "$CFG_SOURCE_REPO" "$APP_DIR" \
        || die "Repository konnte nicht geklont werden: $CFG_SOURCE_REPO"
      chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    fi
    log::ok "Quellcode aus $CFG_SOURCE_REPO"
  else
    die "Kein Quellcode: weder ein lokales Verzeichnis noch --repo angegeben."
  fi

  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  APP_VERSION="$(app::version)"
  log::info "Version: $APP_VERSION"
}

app::version() {
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" describe --tags --always --dirty 2>/dev/null && return
  fi
  node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo "unbekannt"
}

# ---- Dependencies and build ---------------------------------------

app::install_dependencies() {
  log::step "Abhängigkeiten"

  # `npm ci` rather than `npm install`: it installs exactly the lockfile, fails
  # if the lockfile and package.json disagree, and cannot silently pick up a
  # newer minor version on a customer's machine than was tested here.
  log::info "Frontend …"
  as_app "npm ci --no-audit --no-fund" \
    || die "npm ci ist im Frontend fehlgeschlagen. Protokoll prüfen."
  log::ok "Frontend-Abhängigkeiten installiert"

  log::info "API …"
  as_app_in "$APP_DIR/server" "npm ci --no-audit --no-fund" \
    || die "npm ci ist in server/ fehlgeschlagen. Protokoll prüfen."
  log::ok "API-Abhängigkeiten installiert"
}

app::build() {
  log::step "Build"

  log::info "Prisma-Client …"
  as_app_in "$APP_DIR/server" "npx prisma generate" \
    || die "prisma generate ist fehlgeschlagen."
  log::ok "Prisma-Client erzeugt"

  log::info "API …"
  as_app_in "$APP_DIR/server" "npm run build" \
    || die "Der API-Build ist fehlgeschlagen."
  [[ -f "$APP_DIR/server/dist/main.js" ]] \
    || die "Der API-Build meldete Erfolg, aber dist/main.js fehlt."
  log::ok "API gebaut"

  log::info "Frontend … (das dauert einen Moment)"
  # The frontend build is the memory-hungry step — Rollup holds the whole
  # module graph, and the 3D scene is a 656 KB JSON asset. 2 GB is where it
  # starts failing on small instances, hence the swap check in detect.sh.
  as_app "NODE_OPTIONS=--max-old-space-size=2048 npm run build" \
    || die "Der Frontend-Build ist fehlgeschlagen. Häufigste Ursache: zu wenig Arbeitsspeicher."

  local entry
  for entry in index.html stelle.html admin.html; do
    [[ -f "$APP_DIR/dist/$entry" ]] \
      || die "Der Frontend-Build ist unvollständig: dist/$entry fehlt."
  done
  log::ok "Frontend gebaut (Website, Stelleninserat, Dashboard)"
}

# ---- Database ------------------------------------------------------

app::migrate() {
  log::step "Datenbankschema"

  # `migrate deploy`, never `migrate dev`: it applies committed migrations and
  # nothing else. `dev` would try to generate new ones from a schema drift and
  # can offer to reset the database, which on a production box is catastrophic.
  as_app_in "$APP_DIR/server" "npx prisma migrate deploy" \
    || die "Die Migration ist fehlgeschlagen. Protokoll prüfen."
  log::ok "Schema aktuell"
}

app::seed() {
  log::step "Grunddaten"

  # Idempotent by construction: the seeder upserts permissions, roles, content
  # types and settings, and only creates content when the table is empty.
  # Re-running reconciles rather than duplicates.
  as_app_in "$APP_DIR/server" "npm run seed" \
    || die "Das Anlegen der Grunddaten ist fehlgeschlagen. Protokoll prüfen."

  log::ok "Berechtigungen, Rollen, Inhaltstypen und Einstellungen abgeglichen"
  log::ok "Website-Inhalte angelegt (Referenzen, Team, Stellen, Texte)"
  log::ok "Erster Super Admin: $CFG_ADMIN_EMAIL"

  env::scrub_seed_password
}

# Confirms the administrator account really exists with the expected role,
# rather than trusting that the seed printed something reassuring.
app::verify_admin() {
  local count
  count="$(PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM \"User\" u
       JOIN \"UserRole\" ur ON ur.\"userId\" = u.id
       JOIN \"Role\" r ON r.id = ur.\"roleId\"
      WHERE u.email = '${CFG_ADMIN_EMAIL}'
        AND r.key = 'super_admin'
        AND u.status = 'ACTIVE'" 2>/dev/null || echo 0)"

  if [[ "$count" == "1" ]]; then
    log::ok "Super Admin bestätigt (aktiv, volle Rechte)"
  else
    die "Der Super Admin wurde nicht korrekt angelegt. Protokoll prüfen."
  fi
}

# Publishes the seeded content, so the site is live rather than sitting in
# draft behind an approval step nobody has been told about yet.
#
# The seeder already writes snapshot version 1 from the site's own defaults, so
# this only reports — but it verifies that the snapshot exists, which is the
# difference between a working site and one serving its embedded fallback.
app::verify_published() {
  local version
  version="$(PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT max(version) FROM \"ContentSnapshot\"" 2>/dev/null || echo "")"

  if [[ -n "$version" && "$version" != "" ]]; then
    log::ok "Website veröffentlicht (Stand $version)"
  else
    log::warn "Es ist noch kein Stand veröffentlicht. Die Website zeigt ihren eingebauten Inhalt."
  fi
}
