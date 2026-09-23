# Installer

One command turns a fresh server into a running installation.

```bash
# From a checkout
sudo bash deploy/install.sh

# Or hosted
curl -fsSL https://install.example.com/install.sh | sudo bash -s -- \
  --domain www.example.ch --admin-email admin@example.ch --admin-password '…'
```

Ubuntu 24.04, Ubuntu 22.04 and Debian 12. Root required. `--help` lists every
flag; each one also has an `IEM_`-prefixed environment variable, so the same
script drives cloud-init, Ansible and CI.

## What it does

| | |
| --- | --- |
| **Pre-flight** | OS, architecture, RAM, disk, DNS. Offers to add swap on a small box — the frontend build is where 1 GB machines fail. |
| **Packages** | Node 22, pnpm, PM2, Nginx, PostgreSQL, Redis, Certbot, build tools. Only what is missing. |
| **Database** | Role, database, generated password, tuning sized from actual RAM, loopback-only. |
| **Redis** | Loopback-only, password, `volatile-lru`, `FLUSHALL`/`FLUSHDB` removed. |
| **Secrets** | JWT, encryption, session and API keys — 64 chars from `/dev/urandom`, never hardcoded, never printed. |
| **Application** | Source, `npm ci`, build of API and all three frontend entries, migrations, seed, first Super Admin. |
| **Web server** | Static delivery, `/api` reverse proxy, HTTP/2, HSTS, CSP, compression, caching, three rate-limit zones. |
| **HTTPS** | Let's Encrypt, auto-renewal **with a reload hook**, dry-run verified. |
| **Process** | PM2 cluster, memory ceiling, backoff, log rotation, systemd boot unit. |
| **Security** | UFW (SSH allowed *before* enabling), Fail2Ban incl. a dashboard-login jail, sysctl hardening, unattended security updates. |
| **Backups** | Daily/weekly/monthly systemd timers, 7/4/6 retention, verified archive, one taken immediately. |
| **Validation** | ~30 end-to-end checks, then a report on screen and in `/etc/iem/`. |

## Operating it

```
iem status | health | logs | errors | report
iem start | stop | restart | reload | rebuild
iem backup [daily|weekly|monthly] | backups | restore <datei>
iem update [ref]
```

`iem update` backs up, fetches, builds **beside** the running version, migrates,
swaps the directories, `pm2 reload`s (new workers accept connections before old
ones stop), health-checks, and rolls back on any failure.

## Layout

```
/opt/iem                  application (dist/, server/dist/, node_modules/)
/var/lib/iem/media        uploads;  media/bewerbungen is 0700 and never served
/var/lib/iem/backups      the application's own backups (BACKUP_ROOT), 0700
/var/log/iem              API and Nginx logs, rotated 14 days
/var/backups/iem          daily/ weekly/ monthly/
/etc/iem/credentials      every generated secret — 0600 root, BACK THIS UP
/etc/iem/overrides.env    operator settings, appended after the generated env
/etc/iem/nginx-extra.conf extra Nginx directives, included by the site
/etc/nginx/snippets/iem-headers-*.conf  the security headers (and iem-hsts.conf)
```

`server/.env` and the Nginx site are **regenerated on every run**. Persistent
changes belong in the two override files, which are read after the generated
content and therefore win.

**What `server/.env` carries that the API cannot run safely without** (P0, see
`docs/COMPLETE_APPLICATION_AUDIT.md` Part 34):

| Variable | Value | Without it |
| --- | --- | --- |
| `TRUST_PROXY` | `loopback` — Nginx on this host is the one trusted hop | every request comes from 127.0.0.1: one rate-limit bucket for the whole internet, the proxy's address in every audit row |
| `MFA_ENCRYPTION_KEY` | 32 random bytes, hex | every MFA route answers 503 |
| `APP_SECRETS_ENCRYPTION_KEY` | 32 random bytes, hex | the SMTP password cannot be stored |
| `HOST` | `127.0.0.1` | the API listens on every interface, the firewall its only barrier |

The two keys are generated once and **never rotated by a re-run** — a value in
`overrides.env` is adopted, then the one in `/etc/iem/credentials`. Losing
`MFA_ENCRYPTION_KEY` de-enrols every second factor, so back up
`/etc/iem/credentials` **separately** from the database backups: whoever holds
both can decrypt the stored factors and the SMTP password.

**Security headers.** Nginx drops inherited `add_header` lines in any block that
declares its own, so every such block `include`s one of the snippets above — that
is how the HTML documents keep their CSP and `frame-ancestors`. `npm run
deploy:test` (from the repository) renders the installer's own configuration and
fails a block that breaks the rule; with `NGINX_BIN` set it serves it and reads
the headers of each document, and `validate.sh` checks them on the live server.

## Idempotence

Re-running is the supported way to repair an installation. Packages are checked
before install, the database role and schema are created only if absent, and
secrets are read back from `/etc/iem/credentials` rather than regenerated —
rotating the database password would lock out the running application,
rotating the JWT secret would sign every administrator out, and rotating
`MFA_ENCRYPTION_KEY` would make every stored second factor unreadable.

## Deviations from the specification, and why

The brief asked for a longer list of software than this application uses.
Installing something a production server never runs is not neutral — it is
attack surface, disk, and another thing to patch — so these were left out
deliberately rather than overlooked.

**Docker and Docker Compose — not installed.** The brief asks for these *and*
PM2. They are two different deployment models and this platform uses one:
Nginx serves the built static files, PM2 runs the API. Docker would add a
daemon and a second network stack that nothing here uses. If containers ever
become the target, `lib/packages.sh` and `lib/process.sh` are the two modules
that change.

**FFmpeg and ImageMagick — not installed.** Nothing transcodes video, and image
work is done by `sharp`, which ships its own prebuilt libvips. Neither binary
would ever be invoked.

**Redis — installed, and actually used.** It would otherwise have been
decoration, so two real jobs were wired for it: a leader lock so the scheduler
runs on exactly one PM2 worker (scheduled publishing is *not* idempotent —
four workers would produce four snapshots), and shared rate-limit state so the
configured limit is not silently multiplied by the worker count. Without
`REDIS_URL` the API refuses to start clustered rather than degrading quietly.

**Default data — only what the schema has.** The brief lists Departments,
Countries, Languages, Notification Templates and Dashboard Widgets. None of
those entities exists in this data model, and inventing tables to fill a
checklist would leave dead schema behind. What the seed creates is what is
real: ~50 permissions, 10 roles, 36 content types, the settings catalogue, the
site's full content (30 references, 41 people, 7 vacancies) and the first
published snapshot.

**Legal pages — not generated.** The brief asks the installer to publish
Privacy and Impressum pages. It does not, and this is the deviation worth
reading twice: an Impressum or a privacy notice invented for a real company
would be a false legal statement published under that company's name. The
404 and 500 pages *are* generated, because those are deployment artefacts with
no legal content. Datenschutz and Impressum are listed as open points in the
final report, and both are required in Switzerland before the site accepts
personal data in public.

**Monitoring — health endpoints and checks, no agent.** `iem health` and
`/api/v1/dashboard/health` report database latency, seed integrity, memory,
uptime and disk. No Prometheus, Grafana or APM agent is installed, because
which one is right depends on what the customer already runs — and installing
the wrong one is worse than installing none.

## Not yet verified

**The installer has never been executed.** It was written on a Windows machine
with no WSL distribution, no Docker and no `shellcheck`, so there was no Linux
available to run or lint it on.

What *was* done: a static analyser (`deploy/` is checked for undefined
functions, unterminated heredocs, module/loader drift, `rm -rf` against
unquoted variables, secrets reaching the log, the SSH-before-firewall ordering,
and the step order in `main()`). It passes across 17 files, 131 functions and
118 call sites. That catches typos and structural mistakes. It does not catch
anything about how apt, Certbot or PostgreSQL actually behave.

Before this is used on a customer's server it needs one run end to end on a
throwaway Ubuntu 24.04 VM, and then a second run on the same box to confirm
idempotence.
