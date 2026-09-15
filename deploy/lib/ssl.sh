# shellcheck shell=bash
#
# Let's Encrypt via Certbot.
#
# The order matters and is the reason this runs after Nginx rather than before:
# the ACME HTTP-01 challenge is served by the site that already exists on port
# 80. Asking for a certificate first would require Nginx to be configured for a
# certificate it does not have, which is a configuration that will not start.
#
# **A failure here does not fail the installation.** The site works over HTTP,
# and the usual causes — DNS not yet propagated, port 80 closed upstream, a
# rate limit already hit — are all things the operator fixes in a minute and
# then re-runs. Losing a completed install over it would be the wrong trade.

SSL_ACTIVE=0

ssl::install() {
  if [[ "$CFG_ENABLE_SSL" != "1" ]]; then
    log::skip "HTTPS wurde abgewählt (--no-ssl)"
    return 0
  fi

  log::step "HTTPS-Zertifikat"

  if [[ "${HTTPS_LIKELY_TO_FAIL:-0}" == "1" ]]; then
    log::warn "Die DNS-Prüfung war nicht eindeutig — die Anforderung kann fehlschlagen."
  fi

  ssl::install_certbot || return 0

  if ssl::has_certificate; then
    log::skip "Zertifikat für $CFG_DOMAIN besteht bereits"
    SSL_ACTIVE=1
    ssl::verify
    ssl::configure_renewal
    return 0
  fi

  ssl::request
}

ssl::install_certbot() {
  if detect::has_command certbot; then
    log::skip "Certbot bereits vorhanden"
    return 0
  fi
  # The distribution packages are current enough and, unlike snap, do not pull
  # in a second package manager on a server that has no other use for one.
  if packages::ensure certbot python3-certbot-nginx; then
    log::ok "Certbot installiert"
    return 0
  fi
  log::warn "Certbot konnte nicht installiert werden — HTTPS wird übersprungen."
  return 1
}

ssl::has_certificate() {
  [[ -d "/etc/letsencrypt/live/$CFG_DOMAIN" ]] && [[ -f "/etc/letsencrypt/live/$CFG_DOMAIN/fullchain.pem" ]]
}

ssl::request() {
  local -a domains=(-d "$CFG_DOMAIN")

  # Include the apex alongside www (or the other way round) when both resolve
  # here. A certificate that covers only one of them means half the visitors
  # meet a warning, and finding that out later costs a second renewal.
  local sibling=""
  if [[ "$CFG_DOMAIN" == www.* ]]; then
    sibling="${CFG_DOMAIN#www.}"
  elif [[ "$CFG_DOMAIN" != *.*.* ]]; then
    sibling="www.$CFG_DOMAIN"
  fi
  if [[ -n "$sibling" ]] && getent ahostsv4 "$sibling" >/dev/null 2>&1; then
    domains+=(-d "$sibling")
    log::info "Zertifikat deckt auch $sibling ab"
  fi

  log::info "Fordere Zertifikat an …"
  if run certbot --nginx \
      "${domains[@]}" \
      --non-interactive \
      --agree-tos \
      --email "$CFG_SSL_EMAIL" \
      --redirect \
      --no-eff-email \
      --keep-until-expiring; then
    SSL_ACTIVE=1
    log::ok "Zertifikat ausgestellt und Nginx umgestellt"
    ssl::harden
    ssl::verify
    ssl::configure_renewal
  else
    # Say what to do, not just that it failed. These three causes account for
    # nearly every failure and each has a different fix.
    log::warn "Die Zertifikatsanforderung ist fehlgeschlagen. Die Seite läuft über HTTP."
    log::info "  Häufigste Ursachen:"
    log::info "    · $CFG_DOMAIN zeigt (noch) nicht auf diesen Server"
    log::info "    · Port 80 ist von aussen nicht erreichbar (Firewall beim Anbieter)"
    log::info "    · Let's-Encrypt-Limit erreicht (5 Versuche pro Domain und Stunde)"
    log::info "  Nach dem Beheben genügt:  certbot --nginx -d $CFG_DOMAIN"
    SSL_ACTIVE=0
  fi
}

# TLS settings Certbot's defaults leave out.
ssl::harden() {
  local conf="/etc/nginx/sites-available/${NGINX_SITE}"

  # HSTS is deliberately **not** set by Certbot and deliberately set here —
  # with a conservative max-age and no `preload`.
  #
  # The reason for the caution: HSTS is not revocable. A browser that has seen
  # this header refuses plain HTTP for the stated duration, and `preload` bakes
  # the domain into the browsers themselves. Six months is long enough to be
  # meaningful and short enough to recover from. Add `preload` only once the
  # certificate has renewed unattended at least twice.
  if ! grep -q "Strict-Transport-Security" "$conf" 2>/dev/null; then
    run sed -i "/listen 443 ssl/a\\    add_header Strict-Transport-Security \"max-age=15552000; includeSubDomains\" always;" "$conf"
  fi

  # HTTP/2. Certbot writes `listen 443 ssl` and leaves it at that.
  if ! grep -q "http2" "$conf" 2>/dev/null; then
    if nginx -v 2>&1 | grep -qE '1\.(2[5-9]|[3-9][0-9])'; then
      run sed -i "/listen 443 ssl/a\\    http2 on;" "$conf"
    else
      run sed -i "s/listen 443 ssl;/listen 443 ssl http2;/" "$conf"
    fi
  fi

  # OCSP stapling: the server fetches the revocation proof itself, so the
  # browser does not have to make a request to the CA on every connection.
  if ! grep -q "ssl_stapling" "$conf" 2>/dev/null; then
    run sed -i "/listen 443 ssl/a\\    ssl_stapling on;\\n    ssl_stapling_verify on;\\n    resolver 1.1.1.1 8.8.8.8 valid=300s;\\n    resolver_timeout 5s;" "$conf"
  fi

  nginx::test_and_reload
  log::ok "HTTP/2, HSTS (180 Tage) und OCSP-Stapling aktiviert"
}

# Renewal, and the reload that makes a renewed certificate actually take effect.
#
# The second half is the part people miss: Certbot renews the files, but Nginx
# goes on serving the certificate it loaded at startup. Without a deploy hook
# the site presents an expired certificate despite a successful renewal —
# ninety days later, with nobody watching.
ssl::configure_renewal() {
  local hook=/etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx.sh
  mkdir -p "$(dirname "$hook")"
  cat >"$hook" <<'EOF'
#!/bin/sh
# Installed by the IEM installer.
# Nginx keeps the certificate it read at startup, so a renewal without this
# reload changes the files and nothing else.
systemctl reload nginx
EOF
  chmod 700 "$hook"

  # Modern Certbot packages ship a systemd timer. Only fall back to cron when
  # there isn't one, rather than ending up with both.
  if systemctl list-unit-files 2>/dev/null | grep -q '^certbot\.timer'; then
    run systemctl enable --now certbot.timer
    log::ok "Automatische Erneuerung über systemd-Timer"
  else
    printf '0 3,15 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"\n' \
      >/etc/cron.d/iem-certbot
    chmod 644 /etc/cron.d/iem-certbot
    log::ok "Automatische Erneuerung über cron"
  fi

  # A dry run proves the whole chain works *now* rather than in ninety days.
  if run_soft certbot renew --dry-run; then
    log::ok "Erneuerung erfolgreich getestet (Probelauf)"
  else
    log::warn "Der Probelauf der Erneuerung ist fehlgeschlagen — vor Ablauf prüfen."
  fi
}

ssl::verify() {
  local expiry
  expiry="$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$CFG_DOMAIN/fullchain.pem" 2>/dev/null | cut -d= -f2)"
  if [[ -n "$expiry" ]]; then
    SSL_EXPIRY="$expiry"
    log::ok "Zertifikat gültig bis $expiry"
  fi
}
