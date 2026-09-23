# shellcheck shell=bash
#
# Nginx: static delivery, reverse proxy, security headers, rate limiting.
#
# The shape of this deployment, which explains every choice below:
#
#   /                 → static files from dist/ (the built site)
#   /admin.html       → static (the dashboard SPA, hash-routed)
#   /stelle.html      → static (one job advert per ?id=)
#   /assets/*         → static, content-hashed, immutable
#   /media/*          → uploaded files from the data directory
#   /api/*            → proxied to the Node process on 127.0.0.1
#
# Because the API sits on the same origin under `/api`, the browser never makes
# a cross-origin request: no CORS, no preflight on every call, and one fewer
# thing to misconfigure.

nginx::install() {
  log::step "Nginx"

  if detect::has_command nginx; then
    log::skip "Nginx bereits vorhanden ($(nginx -v 2>&1 | awk -F/ '{print $2}'))"
  else
    packages::ensure nginx
    log::ok "Nginx installiert"
  fi

  run systemctl enable nginx
  nginx::harden_defaults
  nginx::write_header_snippets
  nginx::write_site
}

# Where the header snippets live. A variable so the verification harness in
# deploy/test can render the configuration into a scratch directory.
NGINX_SNIPPETS_DIR="${NGINX_SNIPPETS_DIR:-/etc/nginx/snippets}"

# The security headers, written once and included everywhere.
#
# **Why snippets rather than `add_header` at server level.** nginx inherits
# `add_header` from the enclosing block *only if the inner block declares none
# of its own*. Every location below that sets `Cache-Control` therefore used to
# drop the whole set — and those locations are exactly `/index.html`,
# `/admin.html` and `/stelle.html`, so the documents themselves were served with
# no CSP, no frame protection, no nosniff and no referrer policy, while the
# server-level block read as though they had them. `docs/COMPLETE_APPLICATION_AUDIT.md`
# SEC-R5. The rule now is: **every block that says `add_header` also says
# `include`**, and `deploy/test/nginx-headers.test.mjs` fails if one does not.
#
# Three files, because two kinds of response need different policies:
#
#   iem-headers-base.conf   nosniff, frame, referrer, permissions, COOP, HSTS
#   iem-headers-site.conf   base + the site's CSP          (documents, assets)
#   iem-headers-media.conf  base + a sandboxing CSP        (uploaded files)
nginx::write_header_snippets() {
  mkdir -p "$NGINX_SNIPPETS_DIR"

  cat >"$NGINX_SNIPPETS_DIR/iem-headers-base.conf" <<'EOF'
# Managed by the IEM installer — see deploy/lib/nginx.sh. Do not edit here.
#
# `always` so the headers are present on error responses too: a 404 or a 502
# without frame protection is still a framable page.
add_header X-Content-Type-Options "nosniff" always;
# Kept beside `frame-ancestors` for browsers that predate CSP level 2; the CSP
# is the authoritative control. SAMEORIGIN, not DENY, because the dashboard's
# "Website bearbeiten" embeds the public site from the same origin.
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
# HSTS, once a certificate exists — ssl.sh writes this file. A glob, so the
# include is a no-op on an HTTP-only installation rather than an error.
include /etc/nginx/snippets/iem-hsts.conf*;
EOF

  cat >"$NGINX_SNIPPETS_DIR/iem-headers-site.conf" <<'EOF'
# Managed by the IEM installer — see deploy/lib/nginx.sh. Do not edit here.
include /etc/nginx/snippets/iem-headers-base.conf;

# Content-Security-Policy for the site and the dashboard.
#
# 'unsafe-inline' for styles is required: React sets inline styles, and the
# site uses them for the social buttons' brand colours and the 3D canvas.
# Scripts do NOT get it — every script is a bundled file.
#
# fonts.googleapis.com / fonts.gstatic.com are needed by index.html. Both can
# be dropped once the fonts are self-hosted, which is worth doing for privacy
# under the revDSG as well as for this header.
#
# blob: and data: in img-src are for the 3D scene's canvas readback and the
# dashboard's image previews. `frame-ancestors 'self'` is what keeps the
# dashboard out of an attacker's frame.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
EOF

  cat >"$NGINX_SNIPPETS_DIR/iem-headers-media.conf" <<'EOF'
# Managed by the IEM installer — see deploy/lib/nginx.sh. Do not edit here.
include /etc/nginx/snippets/iem-headers-base.conf;

# Uploaded files are rendered inline (the site shows them as images), so what
# neutralises an SVG carrying <script> is this policy, not a download header:
# `sandbox` puts the document in an opaque origin, away from the refresh
# cookie, and `default-src 'none'` stops script running at all. The same
# header `server/src/main.ts` sends when the API serves media itself.
add_header Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; sandbox" always;
EOF

  # The snippets name each other by absolute path; keep that true when the
  # harness renders elsewhere.
  if [[ "$NGINX_SNIPPETS_DIR" != "/etc/nginx/snippets" ]]; then
    local f
    for f in "$NGINX_SNIPPETS_DIR"/iem-headers-*.conf; do
      nginx::rewrite_snippet_paths "$f"
    done
  fi

  log::ok "Sicherheits-Header als Snippets geschrieben"
}

# Pure-bash replacement of the snippet directory inside a file, so the harness
# does not depend on sed being present.
nginx::rewrite_snippet_paths() {
  local file="$1" content line out=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    out+="${line//\/etc\/nginx\/snippets/$NGINX_SNIPPETS_DIR}"$'\n'
  done <"$file"
  printf '%s' "$out" >"$file"
}

# Global settings that belong to the server rather than to this site.
nginx::harden_defaults() {
  cat >/etc/nginx/conf.d/10-iem-global.conf <<'EOF'
# Managed by the IEM installer.

# Don't advertise the exact version in responses or error pages — it saves an
# attacker the trouble of looking up which CVEs apply.
server_tokens off;

# Upload ceiling. The dashboard accepts media up to 25 MB and the public
# application form up to 20 MB in total; 32 MB leaves room for the multipart
# overhead without letting anyone stream gigabytes into the box.
client_max_body_size 32m;
client_body_timeout 30s;
client_header_timeout 30s;
send_timeout 30s;

# Rate-limit zones. Defined globally because a zone is shared state; the site
# config decides which location uses which.
#
#   api    — 30 requests/second/IP with a burst, which is generous for a person
#            using the dashboard and useless for a scraper.
#   login  — 5/minute/IP. Deliberately harsh: this is the one endpoint where
#            volume means guessing. It works alongside the per-account lockout
#            in the application, not instead of it.
#   upload — 2/second, because each one costs image processing.
limit_req_zone $binary_remote_addr zone=iem_api:10m   rate=30r/s;
limit_req_zone $binary_remote_addr zone=iem_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=iem_upload:10m rate=2r/s;
limit_conn_zone $binary_remote_addr zone=iem_conn:10m;

limit_req_status 429;
limit_conn_status 429;

# Compression. `gzip_vary` matters behind a CDN — without it a cache can serve
# a compressed body to a client that did not ask for one.
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_types
  text/plain text/css text/xml text/javascript
  application/javascript application/json application/xml
  application/rss+xml application/manifest+json
  image/svg+xml font/woff font/woff2;

# Brotli if the distribution ships the module; ignored silently if not.
# (Debian/Ubuntu do not package it by default — hence no hard dependency.)
EOF

  # Ubuntu and Debian ship a default site that answers on port 80 for any
  # hostname. Left in place it shadows nothing here, but it does serve the
  # "Welcome to nginx" page for every name that is not ours — which is a
  # confusing thing to leave pointing at a customer's server.
  if [[ -L /etc/nginx/sites-enabled/default ]]; then
    run rm -f /etc/nginx/sites-enabled/default
    log::info "Standard-Site von Nginx deaktiviert"
  fi

  log::ok "Globale Nginx-Einstellungen geschrieben"
}

nginx::write_site() {
  local conf="/etc/nginx/sites-available/${NGINX_SITE}"

  nginx::site_config >"$conf"

  ln -sfn "$conf" "/etc/nginx/sites-enabled/${NGINX_SITE}"
  mkdir -p /var/www/html

  nginx::test_and_reload
  log::ok "Site ${CFG_DOMAIN} konfiguriert (HTTP)"
}

# The site's server block, printed rather than written, so the verification
# harness in deploy/test can render exactly what an installation gets.
nginx::site_config() {
  # HTTP only at this stage. Certbot rewrites this file to add the TLS server
  # block once it has a certificate — asking for HTTPS config before the
  # certificate exists gives an Nginx that cannot start, which then prevents
  # the ACME challenge from being served at all.
  cat <<EOF
# ${CFG_COMPANY} — von install.sh erzeugt. Änderungen werden überschrieben.
# Dauerhafte Anpassungen gehören nach ${CONFIG_DIR}/nginx-extra.conf.

server {
    listen 80;
    listen [::]:80;
    server_name ${CFG_DOMAIN}${NGINX_ALT_NAMES};

    root ${APP_DIR}/dist;
    index index.html;

    access_log ${LOG_DIR}/nginx-access.log;
    error_log  ${LOG_DIR}/nginx-error.log warn;

    # Let's Encrypt writes its challenge here. It must stay reachable over
    # plain HTTP and must not be redirected, or renewal fails in ninety days
    # when nobody is watching.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        allow all;
    }

$(nginx::common_body)
}
EOF
}

# The parts shared by the HTTP and HTTPS server blocks.
nginx::common_body() {
  cat <<EOF
    limit_conn iem_conn 50;

    # ---- Security headers ----
    # From the snippet, here AND in every location below that sets a header of
    # its own — nginx drops inherited add_header lines in any block that
    # declares one. See nginx::write_header_snippets.
    include ${NGINX_SNIPPETS_DIR}/iem-headers-site.conf;

    # ---- API ----
    location /api/ {
        limit_req zone=iem_api burst=60 nodelay;

        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;

        # Off, so a slow client cannot make Nginx hold a whole upload in memory
        # before the application sees a byte of it.
        proxy_request_buffering off;
    }

    # Sign-in gets its own, much tighter limit.
    location = /api/v1/auth/login {
        limit_req zone=iem_login burst=3 nodelay;
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^/api/v1/(media/upload|media/[^/]+/replace|applications)$ {
        limit_req zone=iem_upload burst=5 nodelay;
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_request_buffering off;
    }

    # ---- Uploaded media ----
    #
    # **`^~`, and it is load-bearing.** A plain prefix location loses to any
    # matching regex location, and the image regex further down matches every
    # upload (`/media/2026/x.jpg` ends in `.jpg`) — so nginx served uploads from
    # `dist/` instead of the data directory, and every uploaded image was a 404
    # in production. `^~` makes this prefix final.
    #
    # **A positive allowlist, the same shape `server/src/main.ts` allows:**
    # `/media/<year>/<name>.<ext>` and nothing else. Job-application dossiers
    # live under the same root (`bewerbungen/<year>/…`) and must never be
    # served; they do not match, so they are a 404 here as they are in Node —
    # matching the one legitimate shape leaves no prefix to walk around. nginx
    # matches against the decoded, normalised URI, so `%62ewerbungen` is
    # `bewerbungen` by the time this is asked.
    location ^~ /media/ {
        root ${DATA_DIR};

        location ~ "^/media/[0-9]{4}/[A-Za-z0-9_-][A-Za-z0-9._-]*\$" {
            include ${NGINX_SNIPPETS_DIR}/iem-headers-media.conf;
            expires 30d;
            add_header Cache-Control "public, max-age=2592000";
            try_files \$uri =404;
        }

        return 404;
    }

    # ---- Static assets ----
    # Content-hashed by Vite, so the filename changes whenever the bytes do.
    # That is what makes a one-year immutable cache correct rather than risky.
    location /assets/ {
        include ${NGINX_SNIPPETS_DIR}/iem-headers-site.conf;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
        try_files \$uri =404;
    }

    location ~* \\.(?:jpg|jpeg|png|gif|webp|avif|svg|ico|woff2?)\$ {
        include ${NGINX_SNIPPETS_DIR}/iem-headers-site.conf;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
        access_log off;
    }

    # The 3D scene: 656 KB of JSON, content-hashed like the assets.
    location ~* \\.json\$ {
        include ${NGINX_SNIPPETS_DIR}/iem-headers-site.conf;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }

    # ---- HTML ----
    # Never cached. These are the three entry points, and each one carries the
    # hashed asset names — a cached index.html is how a deployment serves the
    # old bundle for an hour after an update.
    #
    # The include is the whole point of these three lines now: the documents
    # are what a CSP and frame-ancestors protect, and without it this block's
    # own add_header silently discarded every inherited one (SEC-R5).
    location = /index.html  { include ${NGINX_SNIPPETS_DIR}/iem-headers-site.conf; add_header Cache-Control "no-cache, must-revalidate" always; }
    location = /admin.html  { include ${NGINX_SNIPPETS_DIR}/iem-headers-site.conf; add_header Cache-Control "no-cache, must-revalidate" always; }
    location = /stelle.html { include ${NGINX_SNIPPETS_DIR}/iem-headers-site.conf; add_header Cache-Control "no-cache, must-revalidate" always; }

    # ---- Routing ----
    # There is no client-side router on the public site — sections are anchors
    # — so an unknown path is genuinely not found and gets a 404 rather than
    # being rewritten to index.html. The dashboard *is* a router, but it is
    # hash-based, so its paths never reach the server either.
    location / {
        try_files \$uri \$uri/ =404;
    }

    error_page 404 /404.html;
    location = /404.html { internal; }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html { internal; }

    # Version-control and editor leftovers, in case anything is ever deployed
    # by rsync from a working copy.
    location ~ /\\.(?!well-known) { deny all; access_log off; }

    include ${CONFIG_DIR}/nginx-extra.conf*;
EOF
}

nginx::test_and_reload() {
  if ! nginx -t >>"$LOG_FILE" 2>&1; then
    log::error "Die Nginx-Konfiguration ist fehlerhaft:"
    nginx -t 2>&1 | tail -n 10 | sed 's/^/    /'
    die "Nginx-Konfiguration ungültig."
  fi
  if detect::service_active nginx; then
    run systemctl reload nginx || die "Nginx konnte nicht neu geladen werden."
  else
    run systemctl start nginx || die "Nginx konnte nicht gestartet werden."
  fi
}

# The error pages.
#
# Static and self-contained on purpose: a 502 page that loads a stylesheet from
# the application is blank exactly when the application is down.
nginx::error_pages() {
  local dist="$APP_DIR/dist"
  [[ -d "$dist" ]] || return 0

  nginx::error_page "$dist/404.html" "404" "Seite nicht gefunden" \
    "Diese Adresse führt nirgendwohin. Vielleicht ist der Link veraltet." \
    "Zur Startseite"

  nginx::error_page "$dist/50x.html" "Wartung" "Kurz nicht erreichbar" \
    "Die Seite ist gerade nicht verfügbar. Wir sind gleich wieder da." \
    "Nochmals versuchen"

  chown "$APP_USER:$APP_USER" "$dist/404.html" "$dist/50x.html"
  log::ok "Fehlerseiten erzeugt"
}

nginx::error_page() {
  local file="$1" code="$2" title="$3" body="$4" cta="$5"
  cat >"$file" <<EOF
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — ${CFG_COMPANY}</title>
<style>
  /* Self-contained: no external stylesheet, no webfont. This page has to
     render when the application is down, which is when it is needed. */
  :root { color-scheme: light }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
         background:#F6F8FB; color:#0B1B33;
         font:16px/1.6 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif }
  main { max-width:32rem; padding:2rem; }
  .eyebrow { font:500 11px/1 ui-monospace,"IBM Plex Mono",monospace;
             letter-spacing:.18em; text-transform:uppercase; color:#56657E; margin:0 0 1rem }
  h1 { font-size:clamp(1.6rem,4vw,2.2rem); line-height:1.15; margin:0 0 .75rem; font-weight:600 }
  p { color:#56657E; margin:0 0 1.75rem }
  a { display:inline-block; background:#003882; color:#fff; text-decoration:none;
      padding:.7rem 1.25rem; border-radius:.375rem; font-weight:500 }
  a:hover { background:#2C5691 }
</style>
</head>
<body>
  <main>
    <p class="eyebrow">${code}</p>
    <h1>${title}</h1>
    <p>${body}</p>
    <a href="/">${cta}</a>
  </main>
</body>
</html>
EOF
}
