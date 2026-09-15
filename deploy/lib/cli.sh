# shellcheck shell=bash
#
# The `iem` command and the update manager.
#
# Installed into the path so day-to-day operation does not require knowing
# where anything lives. The update manager is the substantial part: back up,
# fetch, build *beside* the running version, migrate, reload without dropping
# a request, and roll back on any failure.

cli::install() {
  log::step "Verwaltungsbefehle"

  cli::write_update
  cli::write_main

  ln -sfn "$BIN_DIR/iem" /usr/local/bin/iem
  log::ok "'iem' installiert (status, health, logs, backup, restore, update)"
}

# ---- The update manager --------------------------------------------

cli::write_update() {
  cat >"$BIN_DIR/iem-update" <<EOF
#!/usr/bin/env bash
# IEM — Aktualisierung. Von install.sh erzeugt.
#
# Ablauf, und warum in dieser Reihenfolge:
#
#   1. Sicherung  — vor jeder Änderung, damit es immer einen Weg zurück gibt.
#   2. Holen      — neuer Quellcode in einem Arbeitsbaum daneben.
#   3. Bauen      — dort, nicht im laufenden Verzeichnis. Ein fehlgeschlagener
#                   Build lässt die laufende Version damit unberührt.
#   4. Migrieren  — erst wenn der Build steht.
#   5. Umschalten — Verzeichnisse tauschen, dann 'pm2 reload': der neue Worker
#                   nimmt Verbindungen an, bevor der alte beendet wird.
#   6. Prüfen     — antwortet die API? Wenn nicht: zurückrollen.
set -euo pipefail

APP_DIR="${APP_DIR}"
APP_USER="${APP_USER}"
PM2_APP="${PM2_APP_NAME}"
BACKUP_BIN="${BIN_DIR}/iem-backup"
LOG="${LOG_DIR}/update.log"
PORT="${APP_PORT}"
REF="\${1:-}"

RELEASES="\$(dirname "\$APP_DIR")/iem-releases"
PREVIOUS="\$RELEASES/previous"
STAGING="\$RELEASES/staging"

log() { printf '%s  %s\n' "\$(date -Is)" "\$1" | tee -a "\$LOG"; }
as_app() { su "\$APP_USER" -s /bin/bash -c "\$1"; }

trap 'log "FEHLGESCHLAGEN in Zeile \$LINENO"; rollback' ERR

rollback() {
  if [ -d "\$PREVIOUS" ]; then
    log "→ Rollback auf die vorherige Version"
    rm -rf "\$APP_DIR.failed"
    mv "\$APP_DIR" "\$APP_DIR.failed" 2>/dev/null || true
    mv "\$PREVIOUS" "\$APP_DIR"
    as_app "cd '\$APP_DIR' && pm2 reload \$PM2_APP --update-env" || true
    log "→ Zurückgerollt. Die fehlgeschlagene Version liegt unter \$APP_DIR.failed"
  else
    log "→ Kein Rollback möglich: keine vorherige Version gesichert."
  fi
  exit 1
}

log "=== Aktualisierung gestartet ==="

# --- 1. Sicherung ---
log "→ Sicherung"
"\$BACKUP_BIN" daily >/dev/null || { log "Sicherung fehlgeschlagen — Abbruch."; exit 1; }

# --- 2. Quellcode ---
if [ ! -d "\$APP_DIR/.git" ]; then
  log "Kein Git-Repository unter \$APP_DIR — automatische Aktualisierung nicht möglich."
  log "Quellcode von Hand einspielen und danach 'iem rebuild' ausführen."
  exit 1
fi

rm -rf "\$STAGING"
mkdir -p "\$RELEASES"
cp -a "\$APP_DIR" "\$STAGING"
chown -R "\$APP_USER:\$APP_USER" "\$STAGING"

log "→ Neuen Stand holen"
as_app "cd '\$STAGING' && git fetch --all --tags --prune"

CURRENT="\$(as_app "cd '\$STAGING' && git rev-parse --short HEAD")"
if [ -n "\$REF" ]; then
  as_app "cd '\$STAGING' && git checkout --force '\$REF'"
else
  BRANCH="\$(as_app "cd '\$STAGING' && git rev-parse --abbrev-ref HEAD")"
  as_app "cd '\$STAGING' && git reset --hard origin/\$BRANCH"
fi
TARGET="\$(as_app "cd '\$STAGING' && git rev-parse --short HEAD")"

if [ "\$CURRENT" = "\$TARGET" ]; then
  log "Bereits aktuell (\$CURRENT). Nichts zu tun."
  rm -rf "\$STAGING"
  exit 0
fi
log "→ \$CURRENT → \$TARGET"

# --- 3. Bauen ---
log "→ Abhängigkeiten"
as_app "cd '\$STAGING' && npm ci --no-audit --no-fund"
as_app "cd '\$STAGING/server' && npm ci --no-audit --no-fund"

log "→ Bauen"
as_app "cd '\$STAGING/server' && npx prisma generate"
as_app "cd '\$STAGING/server' && npm run build"
as_app "cd '\$STAGING' && NODE_OPTIONS=--max-old-space-size=2048 npm run build"

[ -f "\$STAGING/server/dist/main.js" ] || { log "API-Build unvollständig."; rollback; }
[ -f "\$STAGING/dist/index.html" ]     || { log "Frontend-Build unvollständig."; rollback; }
[ -f "\$STAGING/dist/admin.html" ]     || { log "Dashboard-Build unvollständig."; rollback; }

# --- 4. Migrationen ---
# After the build, so a broken build never touches the schema. Migrations are
# forward-only: a rollback restores the code, and the database from the backup
# if the migration itself was the problem.
log "→ Datenbankschema"
as_app "cd '\$STAGING/server' && npx prisma migrate deploy"

# --- 5. Umschalten ---
log "→ Umschalten"
rm -rf "\$PREVIOUS"
mv "\$APP_DIR" "\$PREVIOUS"
mv "\$STAGING" "\$APP_DIR"
chown -R "\$APP_USER:\$APP_USER" "\$APP_DIR"

# reload, not restart: in cluster mode PM2 starts each new worker and waits
# for it before stopping the one it replaces. Requests in flight finish.
as_app "cd '\$APP_DIR' && pm2 reload \$PM2_APP --update-env"

# --- 6. Prüfen ---
log "→ Prüfen"
ok=0
for i in \$(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:\$PORT/api/v1/dashboard/ping" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 1
done
[ "\$ok" = "1" ] || { log "Die API antwortet nach der Aktualisierung nicht."; rollback; }

systemctl reload nginx || true

trap - ERR
log "=== Aktualisiert auf \$TARGET ==="
log "Die vorherige Version liegt unter \$PREVIOUS und kann verworfen werden."
EOF
  chmod 700 "$BIN_DIR/iem-update"
}

# ---- The operator command ------------------------------------------

cli::write_main() {
  cat >"$BIN_DIR/iem" <<EOF
#!/usr/bin/env bash
# IEM — Verwaltung. Von install.sh erzeugt.
set -euo pipefail

APP_DIR="${APP_DIR}"
APP_USER="${APP_USER}"
PM2_APP="${PM2_APP_NAME}"
DATA_DIR="${DATA_DIR}"
LOG_DIR="${LOG_DIR}"
BACKUP_DIR="${BACKUP_DIR}"
CONFIG_DIR="${CONFIG_DIR}"
BIN_DIR="${BIN_DIR}"
PORT="${APP_PORT}"
DOMAIN="${CFG_DOMAIN}"

as_app() { su "\$APP_USER" -s /bin/bash -c "cd '\$APP_DIR' && \$1"; }
need_root() { [ "\$(id -u)" -eq 0 ] || { echo "Dieser Befehl braucht root." >&2; exit 1; }; }

case "\${1:-help}" in

  status)
    printf '\n  IEM — Zustand\n\n'
    for s in postgresql redis-server nginx; do
      printf '    %-16s %s\n' "\$s" "\$(systemctl is-active "\$s" 2>/dev/null || echo inaktiv)"
    done
    printf '\n'
    as_app "pm2 list" || true
    printf '\n    Website    https://%s\n' "\$DOMAIN"
    printf '    Dashboard  https://%s/admin.html\n\n' "\$DOMAIN"
    ;;

  health)
    need_root
    printf '\n  Prüfung …\n\n'
    printf '    %-24s %s\n' "API" "\$(curl -fsS --max-time 5 "http://127.0.0.1:\$PORT/api/v1/dashboard/ping" >/dev/null 2>&1 && echo "antwortet" || echo "ANTWORTET NICHT")"
    printf '    %-24s %s\n' "Website" "\$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: \$DOMAIN" http://127.0.0.1/ 2>/dev/null || echo "-")"
    printf '    %-24s %s\n' "Datenbank" "\$(systemctl is-active postgresql 2>/dev/null)"
    printf '    %-24s %s\n' "Redis" "\$(systemctl is-active redis-server 2>/dev/null)"
    printf '    %-24s %s\n' "Firewall" "\$(ufw status 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo '-')"
    printf '    %-24s %s\n' "Freier Platz" "\$(df -Ph "\$DATA_DIR" | awk 'NR==2 {print \$4" ("\$5" belegt)"}')"
    printf '    %-24s %s\n' "Arbeitsspeicher" "\$(free -h | awk '/^Mem:/ {print \$7" frei von "\$2}')"
    printf '    %-24s %s\n' "Letzte Sicherung" "\$(ls -1t "\$BACKUP_DIR"/daily/iem-*.tar 2>/dev/null | head -1 | xargs -r basename || echo 'keine')"
    if [ -d /etc/letsencrypt/live/"\$DOMAIN" ]; then
      printf '    %-24s %s\n' "Zertifikat bis" "\$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/"\$DOMAIN"/fullchain.pem | cut -d= -f2)"
    else
      printf '    %-24s %s\n' "Zertifikat" "keines"
    fi
    [ -f /var/run/reboot-required ] && printf '\n    Hinweis: ein Neustart ist ausstehend.\n'
    printf '\n'
    ;;

  logs)
    as_app "pm2 logs \$PM2_APP --lines \${2:-100}"
    ;;

  errors)
    tail -n "\${2:-100}" "\$LOG_DIR/api-error.log"
    ;;

  restart)  need_root; as_app "pm2 restart \$PM2_APP --update-env"; echo "Neu gestartet." ;;
  reload)   need_root; as_app "pm2 reload  \$PM2_APP --update-env"; echo "Ohne Unterbrechung neu geladen." ;;
  stop)     need_root; as_app "pm2 stop    \$PM2_APP"; echo "Angehalten." ;;
  start)    need_root; as_app "pm2 start   \$PM2_APP"; echo "Gestartet." ;;

  backup)   need_root; "\$BIN_DIR/iem-backup" "\${2:-daily}" ;;
  restore)  need_root; "\$BIN_DIR/iem-restore" "\${2:-}" ;;
  update)   need_root; "\$BIN_DIR/iem-update" "\${2:-}" ;;

  rebuild)
    need_root
    echo "→ Neu bauen"
    as_app "cd '\$APP_DIR/server' && npm run build"
    as_app "NODE_OPTIONS=--max-old-space-size=2048 npm run build"
    as_app "pm2 reload \$PM2_APP --update-env"
    echo "Fertig."
    ;;

  backups)
    printf '\n  Vorhandene Sicherungen\n\n'
    for tier in daily weekly monthly; do
      printf '    %s\n' "\$tier"
      ls -1sht "\$BACKUP_DIR/\$tier"/iem-*.tar 2>/dev/null | head -10 | sed 's/^/      /' || echo "      keine"
    done
    printf '\n'
    ;;

  report)
    cat "\$CONFIG_DIR/installation-report.txt" 2>/dev/null || echo "Kein Bericht vorhanden."
    ;;

  *)
    cat <<'HELP'

  iem — Verwaltung der IEM-Plattform

    status              Zustand aller Dienste
    health              Vollständige Prüfung
    logs [n]            Protokoll der API verfolgen
    errors [n]          Nur Fehlerausgaben
    report              Installationsbericht

    start | stop | restart | reload
    rebuild             Anwendung neu bauen und neu laden

    backup [stufe]      Sicherung erstellen (daily|weekly|monthly)
    backups             Vorhandene Sicherungen auflisten
    restore <datei>     Sicherung einspielen

    update [ref]        Aktualisieren — mit Sicherung, Prüfung und Rollback

HELP
    ;;
esac
EOF
  chmod 750 "$BIN_DIR/iem"
}
