# shellcheck shell=bash
#
# PM2: the API process, its supervision and its logs.
#
# PM2 rather than a plain systemd unit because of what it adds here: cluster
# mode across cores, zero-downtime reloads (`pm2 reload` starts the new worker
# before stopping the old one, which is what makes the update manager
# downtime-free), and log rotation. It is itself started by systemd, so a
# reboot brings everything back.

process::configure() {
  log::step "Prozessverwaltung"

  # One worker per core, capped at 4.
  #
  # Capped because this is an I/O-bound API in front of one PostgreSQL: past
  # four workers the database connection pool becomes the constraint and more
  # processes only add memory and context switching. `connection_limit=10` in
  # DATABASE_URL times four workers is 40 connections, comfortably inside
  # PostgreSQL's default max_connections of 100 with room for backups and psql.
  local cores workers
  cores="$(nproc 2>/dev/null || echo 1)"
  workers=$(( cores > 4 ? 4 : cores ))

  # Clustering is only safe with Redis, because the scheduler's leader lock
  # lives there. The application refuses to start clustered without it; this
  # keeps the two decisions consistent rather than letting the app fail.
  if [[ -z "${REDIS_PASSWORD:-}" ]]; then
    workers=1
    log::warn "Ohne Redis läuft die API mit einem einzelnen Worker."
  fi

  cat >"$APP_DIR/ecosystem.config.cjs" <<EOF
// Von install.sh erzeugt. Änderungen werden beim nächsten Lauf überschrieben.
module.exports = {
  apps: [
    {
      name: "${PM2_APP_NAME}",
      script: "server/dist/main.js",
      cwd: "${APP_DIR}",

      // Cluster mode across ${workers} worker(s). Coordinated through Redis —
      // see server/src/common/redis.ts for why that is required.
      instances: ${workers},
      exec_mode: "cluster",

      // The API reads its own .env; nothing sensitive belongs in this file,
      // which is world-readable.
      env: { NODE_ENV: "production" },

      // Restart on a leak rather than letting the box swap. sharp holds image
      // buffers, so a worker that has processed a lot of uploads legitimately
      // grows; 512 MB is well above steady state and well below trouble.
      max_memory_restart: "512M",

      // Back off rather than hammering: a worker that cannot reach PostgreSQL
      // would otherwise restart in a tight loop and fill the disk with logs.
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      restart_delay: 4000,
      exp_backoff_restart_delay: 200,

      // Zero-downtime reloads need the process to say when it is ready, and
      // to be given time to finish in-flight requests on the way out.
      wait_ready: false,
      listen_timeout: 20000,
      kill_timeout: 10000,

      error_file: "${LOG_DIR}/api-error.log",
      out_file: "${LOG_DIR}/api-out.log",
      merge_logs: true,
      time: true,

      watch: false,
    },
  ],
};
EOF

  chown "$APP_USER:$APP_USER" "$APP_DIR/ecosystem.config.cjs"
  log::ok "PM2-Konfiguration: ${workers} Worker im Cluster-Modus"
}

process::start() {
  # `startOrReload` is the idempotent form: it starts the app if it is not
  # running and performs a rolling reload if it is. That single call is what
  # makes re-running the installer safe on a live system.
  if as_app "pm2 startOrReload ecosystem.config.cjs --update-env"; then
    log::ok "API gestartet"
  else
    log::error "PM2 konnte die Anwendung nicht starten. Letzte Ausgaben:"
    as_app "pm2 logs ${PM2_APP_NAME} --lines 30 --nostream" || true
    tail -n 30 "$LOG_DIR/api-error.log" 2>/dev/null | sed 's/^/    /' || true
    die "Die API läuft nicht."
  fi

  as_app "pm2 save --force" || log::warn "Der PM2-Prozesszustand konnte nicht gespeichert werden."
}

# Brings PM2 — and therefore the API — back after a reboot.
process::enable_boot() {
  local unit="pm2-${APP_USER}"

  if systemctl list-unit-files 2>/dev/null | grep -q "^${unit}\.service"; then
    log::skip "Autostart bereits eingerichtet"
  else
    # `pm2 startup` prints the command to run rather than running it. Capture
    # and execute it, because the exact unit it generates differs by init
    # system and by how PM2 was installed.
    local cmd
    cmd="$(pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" 2>/dev/null | grep -E '^sudo ' | tail -n 1)"
    if [[ -n "$cmd" ]]; then
      log::raw "\$ ${cmd#sudo }"
      eval "${cmd#sudo }" >>"$LOG_FILE" 2>&1 || log::warn "Autostart konnte nicht eingerichtet werden."
    fi
  fi

  run_soft systemctl enable "$unit"
  detect::service_active "$unit" && log::ok "Autostart nach Neustart aktiv" \
    || log::ok "Autostart eingerichtet"
}

process::logrotate() {
  # pm2-logrotate handles PM2's own files; logrotate handles Nginx's, which
  # were redirected into the same directory.
  as_app "pm2 install pm2-logrotate" >/dev/null 2>&1 || true
  as_app "pm2 set pm2-logrotate:max_size 20M" >/dev/null 2>&1 || true
  as_app "pm2 set pm2-logrotate:retain 14" >/dev/null 2>&1 || true
  as_app "pm2 set pm2-logrotate:compress true" >/dev/null 2>&1 || true
  as_app "pm2 set pm2-logrotate:rotateInterval '0 0 * * *'" >/dev/null 2>&1 || true

  cat >/etc/logrotate.d/iem <<EOF
${LOG_DIR}/nginx-*.log {
    daily
    rotate 14
    missingok
    notifempty
    compress
    delaycompress
    sharedscripts
    postrotate
        # USR1 makes Nginx reopen its files. Without it, Nginx keeps writing
        # to the rotated inode and the new file stays empty forever.
        [ -f /run/nginx.pid ] && kill -USR1 \$(cat /run/nginx.pid)
    endscript
}
EOF
  chmod 644 /etc/logrotate.d/iem
  log::ok "Protokollrotation eingerichtet (14 Tage)"
}

process::health() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/api/v1/dashboard/ping" >/dev/null 2>&1; then
      log::ok "API antwortet auf dem Health-Endpunkt"
      return 0
    fi
    sleep 1
  done
  log::error "Die API antwortet nach 30 Sekunden nicht. Letzte Ausgaben:"
  tail -n 30 "$LOG_DIR/api-error.log" 2>/dev/null | sed 's/^/    /' || true
  return 1
}
