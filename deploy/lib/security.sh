# shellcheck shell=bash
#
# Firewall, intrusion prevention, kernel hardening and unattended updates.
#
# Deliberately conservative. An installer that locks the operator out of their
# own server has done far more damage than one that leaves a port open, so
# every rule here is checked against the risk of that before it is applied —
# SSH in particular is allowed *before* the firewall is enabled, not after.

security::firewall() {
  log::step "Firewall"

  packages::ensure ufw

  # Order matters and this is the whole reason for it: `ufw --force enable`
  # with a default-deny policy and no SSH rule drops the connection the
  # installer is running over, mid-install, with no way back in.
  local ssh_port
  ssh_port="$(security::ssh_port)"
  run ufw allow "${ssh_port}/tcp" comment "SSH"
  log::ok "SSH auf Port ${ssh_port} erlaubt"

  run ufw allow 80/tcp comment "HTTP"
  run ufw allow 443/tcp comment "HTTPS"

  run ufw default deny incoming
  run ufw default allow outgoing

  # PostgreSQL, Redis and the API itself are never opened: all three bind to
  # the loopback, and the firewall is the second line saying so.

  if ufw status 2>/dev/null | grep -q "Status: active"; then
    run ufw reload
    log::skip "Firewall war bereits aktiv, Regeln aktualisiert"
  else
    run bash -c "ufw --force enable" || die "Die Firewall konnte nicht aktiviert werden."
    log::ok "Firewall aktiv (eingehend: SSH, HTTP, HTTPS)"
  fi
}

# Reads the real SSH port rather than assuming 22.
security::ssh_port() {
  local port
  port="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2; exit}' /etc/ssh/sshd_config 2>/dev/null)"
  printf '%s' "${port:-22}"
}

security::fail2ban() {
  log::step "Fail2Ban"

  packages::ensure fail2ban

  # A local jail file, not an edit of jail.conf — package upgrades replace
  # jail.conf and would silently drop these rules.
  cat >/etc/fail2ban/jail.d/iem.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
# Never ban ourselves out of our own server.
ignoreip = 127.0.0.1/8 ::1
backend  = systemd

[sshd]
enabled  = true
port     = $(security::ssh_port)
maxretry = 5
bantime  = 2h

[nginx-http-auth]
enabled = true

[nginx-limit-req]
# Bans a client that keeps tripping Nginx's rate limits. The limits themselves
# only slow an attacker down; this stops them.
enabled  = true
logpath  = ${LOG_DIR}/nginx-error.log
maxretry = 20
findtime = 5m
bantime  = 1h

[iem-auth]
# Failed sign-ins to the dashboard. The application already locks an account
# after five attempts; this bans the *source* after ten, which is what stops
# someone working through a list of addresses.
enabled  = true
filter   = iem-auth
logpath  = ${LOG_DIR}/api-out.log
maxretry = 10
findtime = 10m
bantime  = 2h
EOF

  # The filter matches what AuthService actually logs. It is written against
  # the audit action name, which is stable, rather than against a German
  # message, which is copy and may be edited.
  cat >/etc/fail2ban/filter.d/iem-auth.conf <<'EOF'
# Matches the API's own failed-sign-in records.
[Definition]
failregex = ^.*auth\.login_failed.*<HOST>.*$
            ^.*auth\.login_locked.*<HOST>.*$
ignoreregex =
EOF

  run systemctl enable fail2ban
  run_soft systemctl restart fail2ban
  if detect::service_active fail2ban; then
    log::ok "Fail2Ban aktiv (SSH, Nginx, Dashboard-Anmeldung)"
  else
    log::warn "Fail2Ban läuft nicht. 'systemctl status fail2ban' prüfen."
  fi
}

security::kernel() {
  log::step "Kernel- und Netzwerkhärtung"

  cat >/etc/sysctl.d/60-iem.conf <<'EOF'
# Managed by the IEM installer.

# Ignore source-routed packets and redirects — neither has a legitimate use on
# a server and both can be used to reroute traffic.
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0

# Log packets with impossible source addresses.
net.ipv4.conf.all.log_martians = 1

# Reverse-path filtering: drop packets whose source address could not have
# arrived on that interface.
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# SYN flood protection.
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048

# A larger accept queue, so a burst of connections queues instead of being
# refused. Matters on a single box running Nginx and the API together.
net.core.somaxconn = 1024

# Restrict kernel pointers and dmesg to root.
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1

# More entropy for ASLR.
kernel.randomize_va_space = 2

# Nginx and PostgreSQL both open a lot of files.
fs.file-max = 131072
EOF

  run_soft sysctl --system
  log::ok "sysctl-Einstellungen angewendet"
}

# Security updates, applied automatically; everything else left alone.
#
# The distinction is the point: unattended *security* updates are a clear win,
# unattended *everything* updates are how a working server changes underneath
# you at three in the morning. Reboots are never automatic — that is the
# operator's call.
security::auto_updates() {
  log::step "Sicherheitsaktualisierungen"

  packages::ensure unattended-upgrades apt-listchanges

  cat >/etc/apt/apt.conf.d/51-iem-unattended <<EOF
Unattended-Upgrade::Origins-Pattern {
    "origin=Debian,codename=\${distro_codename},label=Debian-Security";
    "origin=Ubuntu,codename=\${distro_codename},label=Ubuntu";
    "o=Ubuntu,a=\${distro_codename}-security";
};

Unattended-Upgrade::Package-Blacklist {
    // Held back on purpose. A Node or PostgreSQL major upgrade applied
    // unattended can break the application; both belong in a planned window
    // with a backup taken first.
    "nodejs";
    "postgresql*";
};

Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";

// Never. A reboot is the operator's decision — /var/run/reboot-required says
// when one is pending, and the health command reports it.
Unattended-Upgrade::Automatic-Reboot "false";

Unattended-Upgrade::Mail "${CFG_ADMIN_EMAIL}";
Unattended-Upgrade::MailReport "on-change";
EOF

  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  run systemctl enable --now unattended-upgrades 2>/dev/null || true
  log::ok "Sicherheitsaktualisierungen automatisch (ohne Neustart, ohne Node/PostgreSQL)"
}

# Tightens the permissions on everything the installer created.
security::permissions() {
  log::step "Dateirechte"

  chmod 600 "$APP_DIR/server/.env" 2>/dev/null || true
  chown "$APP_USER:$APP_USER" "$APP_DIR/server/.env" 2>/dev/null || true
  chmod 600 "$CRED_FILE" "$APP_STATE_FILE" 2>/dev/null || true
  chmod 700 "$CONFIG_DIR" "$BACKUP_DIR"
  chmod 700 "$DATA_DIR/media/bewerbungen"

  # Nginx needs to traverse into dist/ and the media directory. `o+x` on the
  # directories without `o+r` lets it pass through without listing.
  chmod 755 "$APP_DIR"
  chmod -R a+rX "$APP_DIR/dist" 2>/dev/null || true
  chmod 751 "$DATA_DIR" "$DATA_DIR/media"

  # The installer's own log records every command; it may contain paths and
  # hostnames and should not be world-readable.
  chmod 600 "$LOG_FILE" 2>/dev/null || true

  log::ok "Rechte gesetzt"
}
