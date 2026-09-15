# shellcheck shell=bash
#
# Backups, and the restore that makes them worth taking.
#
# What is backed up, and why each part is necessary:
#
#   · the database        — content, users, versions, audit log
#   · the media directory — uploads and job-application dossiers
#   · /etc/iem            — the credentials, without which a database dump
#                           cannot be restored into a working application
#
# The last one is the one people forget. A `pg_dump` is useless on its own if
# the `JWT_ACCESS_SECRET` is gone: everyone is signed out, and if the database
# password is gone too the application cannot connect at all.

backup::install() {
  log::step "Sicherungen"

  install -d -m 700 "$BACKUP_DIR"/{daily,weekly,monthly}
  backup::write_script
  backup::write_restore
  backup::schedule

  log::ok "Täglich 02:15, wöchentlich So, monatlich am 1."
  log::info "  Aufbewahrung: 7 täglich, 4 wöchentlich, 6 monatlich"
  log::info "  Sichern mit:  iem backup"
  log::info "  Einspielen:   iem restore <datei>"
}

backup::write_script() {
  cat >"$BIN_DIR/iem-backup" <<EOF
#!/usr/bin/env bash
# IEM — Sicherung. Von install.sh erzeugt.
set -euo pipefail

TIER="\${1:-daily}"
CREDENTIALS="${CRED_FILE}"
BACKUP_ROOT="${BACKUP_DIR}"
DATA_DIR="${DATA_DIR}"
CONFIG_DIR="${CONFIG_DIR}"
LOG="${LOG_DIR}/backup.log"

# Retention per tier. Keeping only dailies would mean a corruption noticed
# after a week has already aged out of every copy.
case "\$TIER" in
  daily)   KEEP=7  ;;
  weekly)  KEEP=4  ;;
  monthly) KEEP=6  ;;
  *) echo "Unbekannte Stufe: \$TIER (daily|weekly|monthly)" >&2; exit 2 ;;
esac

# shellcheck disable=SC1090
. "\$CREDENTIALS"

STAMP="\$(date +%Y%m%d-%H%M%S)"
DEST="\$BACKUP_ROOT/\$TIER"
WORK="\$(mktemp -d)"
trap 'rm -rf "\$WORK"' EXIT

log() { printf '%s  %s\n' "\$(date -Is)" "\$1" >>"\$LOG"; }

log "Sicherung (\$TIER) gestartet"

# --- Datenbank ---
# --clean --if-exists so the dump can be replayed into a database that still
# has the old objects in it. Custom format, because it restores selectively
# and in parallel; a plain SQL file cannot.
if ! PGPASSWORD="\$DB_PASSWORD" pg_dump \\
      -h 127.0.0.1 -U "\$DB_USER" -d "\$DB_NAME" \\
      --format=custom --compress=9 --clean --if-exists \\
      --file="\$WORK/database.dump" 2>>"\$LOG"; then
  log "FEHLER: pg_dump fehlgeschlagen"
  exit 1
fi

# --- Medien ---
if [ -d "\$DATA_DIR/media" ]; then
  tar -czf "\$WORK/media.tar.gz" -C "\$DATA_DIR" media 2>>"\$LOG" || {
    log "FEHLER: Medien konnten nicht gepackt werden"; exit 1; }
fi

# --- Konfiguration und Geheimnisse ---
# Without these the dump cannot be restored into a working system.
tar -czf "\$WORK/config.tar.gz" -C "\$(dirname "\$CONFIG_DIR")" "\$(basename "\$CONFIG_DIR")" 2>>"\$LOG" || true

# The application version is read **now**, not baked in when the installer
# wrote this script — otherwise every backup taken over the next year would
# claim the version that was current on installation day.
APP_VERSION="\$(cd "${APP_DIR}" 2>/dev/null && git describe --tags --always 2>/dev/null \\
  || node -p "require('${APP_DIR}/package.json').version" 2>/dev/null \\
  || echo unbekannt)"

cat >"\$WORK/manifest.txt" <<MANIFEST
IEM-Sicherung
Zeitpunkt:   \$(date -Is)
Stufe:       \$TIER
Host:        \$(hostname -f 2>/dev/null || hostname)
Datenbank:   \$DB_NAME
Anwendung:   \$APP_VERSION
Enthält:     database.dump, media.tar.gz, config.tar.gz
MANIFEST

ARCHIVE="\$DEST/iem-\$STAMP.tar"
tar -cf "\$ARCHIVE" -C "\$WORK" . || { log "FEHLER: Archiv konnte nicht erstellt werden"; exit 1; }
chmod 600 "\$ARCHIVE"

# Verify rather than assume. A backup that was never read back is a hope.
if ! tar -tf "\$ARCHIVE" >/dev/null 2>&1; then
  log "FEHLER: Archiv ist nicht lesbar — verworfen"
  rm -f "\$ARCHIVE"
  exit 1
fi

SIZE="\$(du -h "\$ARCHIVE" | cut -f1)"
log "Fertig: \$ARCHIVE (\$SIZE)"

# --- Alte Stände entfernen ---
# shellcheck disable=SC2012
ls -1t "\$DEST"/iem-*.tar 2>/dev/null | tail -n +\$((KEEP + 1)) | while read -r old; do
  rm -f "\$old"
  log "Entfernt: \$old"
done

printf '%s\n' "\$ARCHIVE"
EOF
  chmod 700 "$BIN_DIR/iem-backup"
}

backup::write_restore() {
  cat >"$BIN_DIR/iem-restore" <<EOF
#!/usr/bin/env bash
# IEM — Sicherung einspielen. Von install.sh erzeugt.
#
# Spielt Datenbank und Medien aus einem Archiv zurück. Die Anwendung wird
# dafür angehalten und danach wieder gestartet.
set -euo pipefail

ARCHIVE="\${1:-}"
CREDENTIALS="${CRED_FILE}"
DATA_DIR="${DATA_DIR}"
APP_USER="${APP_USER}"
APP_DIR="${APP_DIR}"
PM2_APP="${PM2_APP_NAME}"

if [ -z "\$ARCHIVE" ] || [ ! -f "\$ARCHIVE" ]; then
  echo "Aufruf: iem restore <archiv.tar>" >&2
  echo "" >&2
  echo "Verfügbare Sicherungen:" >&2
  ls -1t ${BACKUP_DIR}/*/iem-*.tar 2>/dev/null | head -20 >&2 || echo "  keine" >&2
  exit 2
fi

# shellcheck disable=SC1090
. "\$CREDENTIALS"

WORK="\$(mktemp -d)"
trap 'rm -rf "\$WORK"' EXIT
tar -xf "\$ARCHIVE" -C "\$WORK"

[ -f "\$WORK/manifest.txt" ] && cat "\$WORK/manifest.txt"
echo ""
echo "Dies überschreibt die aktuelle Datenbank und die Medien."
printf "Fortfahren? (ja/nein) "
read -r answer
[ "\$answer" = "ja" ] || { echo "Abgebrochen."; exit 1; }

echo "→ Anwendung anhalten"
su "\$APP_USER" -s /bin/bash -c "cd '\$APP_DIR' && pm2 stop \$PM2_APP" || true

echo "→ Datenbank einspielen"
# --clean --if-exists is in the dump; a non-zero exit from pg_restore is
# common and benign (ownership notices), so failure is judged by the
# verification query below rather than by the exit code.
PGPASSWORD="\$DB_PASSWORD" pg_restore \\
  -h 127.0.0.1 -U "\$DB_USER" -d "\$DB_NAME" \\
  --clean --if-exists --no-owner --no-privileges \\
  "\$WORK/database.dump" 2>&1 | grep -v "^pg_restore: warning" || true

if ! PGPASSWORD="\$DB_PASSWORD" psql -h 127.0.0.1 -U "\$DB_USER" -d "\$DB_NAME" \\
     -tAc 'SELECT count(*) FROM "ContentSnapshot"' >/dev/null 2>&1; then
  echo "FEHLER: Die Datenbank ist nach dem Einspielen nicht benutzbar." >&2
  exit 1
fi

if [ -f "\$WORK/media.tar.gz" ]; then
  echo "→ Medien einspielen"
  tar -xzf "\$WORK/media.tar.gz" -C "\$DATA_DIR"
  chown -R "\$APP_USER:\$APP_USER" "\$DATA_DIR/media"
  chmod 700 "\$DATA_DIR/media/bewerbungen" 2>/dev/null || true
fi

echo "→ Anwendung starten"
su "\$APP_USER" -s /bin/bash -c "cd '\$APP_DIR' && pm2 restart \$PM2_APP --update-env"

echo ""
echo "Eingespielt. Die Konfiguration in config.tar.gz wurde NICHT automatisch"
echo "zurückgeschrieben — bei Bedarf von Hand aus \$WORK entpacken."
EOF
  chmod 700 "$BIN_DIR/iem-restore"
}

backup::schedule() {
  # systemd timers rather than cron: they survive a missed window
  # (`Persistent=true` runs a job the machine was off for), and their state is
  # visible with `systemctl list-timers`.
  local tier spec
  for tier in daily weekly monthly; do
    case "$tier" in
      daily)   spec="*-*-* 02:15:00" ;;
      weekly)  spec="Sun *-*-* 03:15:00" ;;
      monthly) spec="*-*-01 04:15:00" ;;
    esac

    cat >"/etc/systemd/system/iem-backup-${tier}.service" <<EOF
[Unit]
Description=IEM Sicherung (${tier})
After=postgresql.service

[Service]
Type=oneshot
ExecStart=${BIN_DIR}/iem-backup ${tier}
User=root
Nice=10
IOSchedulingClass=idle
EOF

    cat >"/etc/systemd/system/iem-backup-${tier}.timer" <<EOF
[Unit]
Description=IEM Sicherung (${tier})

[Timer]
OnCalendar=${spec}
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

    run systemctl enable "iem-backup-${tier}.timer"
    run_soft systemctl start "iem-backup-${tier}.timer"
  done

  run systemctl daemon-reload
}

# Takes one immediately, so the install ends with a restorable copy on disk
# rather than with a promise of one at 02:15.
backup::initial() {
  log::info "Erste Sicherung wird erstellt …"
  if "$BIN_DIR/iem-backup" daily >>"$LOG_FILE" 2>&1; then
    local latest
    latest="$(ls -1t "$BACKUP_DIR"/daily/iem-*.tar 2>/dev/null | head -1)"
    log::ok "Erste Sicherung: $latest ($(du -h "$latest" 2>/dev/null | cut -f1))"
  else
    log::warn "Die erste Sicherung ist fehlgeschlagen — 'iem backup' manuell prüfen."
  fi
}
