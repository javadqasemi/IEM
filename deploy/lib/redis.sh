# shellcheck shell=bash
#
# Redis.
#
# **What it is actually for**, because installing a service nothing uses is
# worse than not installing it. Two jobs, both of which fix a real limitation:
#
#   1. **Rate-limit storage.** Nest's throttler defaults to per-process memory.
#      PM2 runs the API in cluster mode, so four workers would each grant the
#      full allowance and the effective limit would be four times what the
#      configuration says. Shared storage makes the number mean what it says.
#
#   2. **A leader lock for the scheduler.** The background jobs — scheduled
#      publishing, dossier retention, token pruning — are in-process timers.
#      Without a lock, every worker would run them, and scheduled publishing is
#      not idempotent: four workers would produce four snapshots. The lock is a
#      `SET NX PX`, which is the correct primitive for a single Redis instance.
#
# If Redis is absent the application still runs: it falls back to in-memory
# throttling and refuses to start more than one API worker. That fallback is in
# the application, not here — see `server/src/common/redis.ts`.

redis::install() {
  log::step "Redis"

  if detect::has_command redis-server && detect::service_active redis-server; then
    log::skip "Redis läuft bereits ($(redis-server --version | awk '{print $3}' | sed 's/v=//'))"
  else
    packages::ensure redis-server
    log::ok "Redis installiert"
  fi

  redis::configure
}

redis::configure() {
  local conf_dir=/etc/redis/redis.conf.d
  local drop_in="$conf_dir/10-iem.conf"

  REDIS_PASSWORD="${REDIS_PASSWORD:-$(secret::password 40)}"

  # Debian's redis.conf has no include directory by default, so create one and
  # make sure it is included — rather than rewriting the shipped config, which
  # a package upgrade would then prompt about on every apt run.
  mkdir -p "$conf_dir"
  if ! grep -q "^include ${conf_dir}/\*.conf" /etc/redis/redis.conf 2>/dev/null; then
    printf '\n# Added by the IEM installer\ninclude %s/*.conf\n' "$conf_dir" >>/etc/redis/redis.conf
  fi

  cat >"$drop_in" <<EOF
# Managed by the IEM installer. Overwritten on the next run.

# Loopback only. Nothing outside this host has any business reaching Redis,
# and the default bind is the single most common way Redis ends up on the
# public internet.
bind 127.0.0.1 -::1
protected-mode yes
port 6379

requirepass ${REDIS_PASSWORD}

# The data here is a rate-limit window and a scheduler lock — both are
# reconstructible and neither is worth an fsync. Persistence is on anyway, at
# its cheapest setting, so a restart does not reset every visitor's rate limit
# at once.
save 900 1
appendonly no

# A hard ceiling, so a runaway key pattern cannot take the box down. The
# eviction policy matters: allkeys-lru would silently drop the scheduler lock
# under pressure and let two workers publish. volatile-lru only evicts keys
# that were given an expiry — which the throttler's are and the lock's is,
# but the lock's TTL is seconds, so it is never the LRU victim.
maxmemory 256mb
maxmemory-policy volatile-lru

# Renamed rather than disabled: an operator with the password can still use
# them by name, a stray library cannot call them by accident.
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG "CONFIG_${REDIS_PASSWORD:0:8}"
EOF

  chmod 640 "$drop_in"
  chown root:redis "$drop_in" 2>/dev/null || true

  run systemctl enable redis-server
  run systemctl restart redis-server || die "Redis konnte nicht gestartet werden."

  redis::wait_ready || die "Redis antwortet nicht. 'systemctl status redis-server' prüfen."
  log::ok "Redis konfiguriert (nur localhost, Passwort gesetzt)"
}

redis::wait_ready() {
  local i
  for i in $(seq 1 20); do
    if redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
      return 0
    fi
    sleep 1
  done
  return 1
}
