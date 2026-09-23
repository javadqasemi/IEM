# Sicherung und Wiederherstellung — Runbook

**This document describes what is built, not what is planned.** Every command
in it has been run against this repository. Where something is a limitation
rather than a feature, it says so in the same sentence.

Delivered as P2-5. The design arguments are in `docs/ENTERPRISE_ROADMAP.md`;
this is the operational half — what runs, where things are, and what to do at
three in the morning.

---

## 1. What is backed up

| Artifact | Contents | Tool |
| --- | --- | --- |
| `<id>.dump` | The whole PostgreSQL database — schema, data, sequences, enums, indexes, and `_prisma_migrations` | `pg_dump --format=custom --compress=6` |
| `<id>-media.tar.gz` | `MEDIA_ROOT` — uploaded site media **and applicant dossiers** | `tar -czf` |
| `<id>.manifest.json` | Backup id, timestamps, schema version, database version, and a SHA-256 for each artifact | written by the application |

**The media archive contains personal data.** `MEDIA_ROOT/bewerbungen/` holds
CVs and references. That is why downloading a backup sits behind
`system.restore` rather than `system.backup`: obtaining the archive and
restoring it disclose the same thing.

**Nothing else is archived.** `backup.media.ts` holds an *allowlist* of owned
directories rather than a list of exclusions — `node_modules`, build output,
logs and source are not omitted by rule, they are simply not named. Adding a
second owned directory is a line in that file.

### The consistency limitation

A `FULL` backup dumps the database and then archives the media. The gap is
seconds and it is real: a file uploaded between the two is in the archive
without a database row, or the reverse. The manifest records both timestamps
and states the caveat in `consistency.note`. Point-in-time consistency across
both would need a storage-level snapshot, which this does not do.

---

## 2. Where backups are stored

`BACKUP_ROOT`, default `./var/backups` relative to `server/`, laid out as:

```
var/backups/2026/09/<backup-id>/
  <backup-id>.dump
  <backup-id>-media.tar.gz
  <backup-id>.manifest.json
```

**Deliberately outside `MEDIA_ROOT`.** The media root is served over HTTP by
the static handler in `main.ts` behind an allowlist, and CLAUDE.md records two
ways that allowlist has been walked past. A database dump under a served root
is one regex away from being public. The only route to an artifact is
`POST /backups/:id/artifacts/:kind/download`, behind `system.restore`, **the
re-authentication window** (`{ reauthToken }` in the body, from
`POST /auth/reauthenticate`) and audited. It was a `GET` behind the permission
alone until P0 (SEC-2): the archive is the whole database and every CV, the same
disclosure as a restore, and now asks for the same proof.

**Check your reverse proxy does not serve `var/`.**

### This is not disaster recovery

Backups on the same disk as the database protect against a dropped table, a
bad migration and a mistaken delete. They do **not** protect against the disk,
the machine, the ransomware or the building. The status panel says this, the
API returns the sentence in `offSiteWarning` so a future client cannot omit it,
and it is true until somebody copies artifacts off the machine.

There is no off-site provider implemented. `BackupStorageProvider` is the
interface to implement — four methods — and nothing above it changes.

---

## 3. Encryption and keys

**Backup artifacts are not encrypted at rest**, and this is a deliberate stop
rather than an oversight. The reasoning:

- The correct implementation is **streaming** encryption over a multi-gigabyte
  file. `SecretEncryptionService` is an in-memory small-secret cipher and using
  it here would load an entire dump into Node's heap — the brief says not to,
  and it is right.
- A `BACKUP_ENCRYPTION_KEY` that only ever protected artifacts sitting on the
  same disk as the database, readable by the same operating-system user, adds
  very little: an attacker who can read `var/backups` can generally read
  `server/.env`.
- Encryption earns its place when artifacts **leave the machine**, which is the
  same change that makes off-site storage real. Both belong in the same slice.

**What is protected today:** the directory is outside the web root, nothing
serves it, and the download route requires `system.restore` and is audited.

**When encryption is added** it must use a dedicated `BACKUP_ENCRYPTION_KEY` —
never `JWT_ACCESS_SECRET`, `MFA_ENCRYPTION_KEY` or
`APP_SECRETS_ENCRYPTION_KEY` — and the key must be backed up **separately from
the backups it protects**, never inside them. A key stored in the archive it
encrypts protects nothing.

### Keys the backup does contain

None. The manifest type has no field a credential could occupy, and
`findSecretLikeKeys` runs over it before it is written — a future field named
`smtpPassword` fails the backup rather than shipping in it.

The **database dump does** contain the `Setting` table, which holds the
encrypted SMTP password. That ciphertext is useless without
`APP_SECRETS_ENCRYPTION_KEY`, which is in `server/.env` and is *not* in the
backup. Restoring onto a machine with a different key means re-entering the
SMTP password — which is the correct behaviour and worth knowing before an
incident.

---

## 4. Automatic backups

Configured at **Einstellungen → Sicherung**:

| Setting | Default | |
| --- | --- | --- |
| `backup.automatic` | off | Master switch |
| `backup.scheduledType` | `FULL` | Database, media, or both |
| `backup.hour` | 2 | Local hour |
| `backup.timezoneOffsetMinutes` | 60 | Fixed offset, not a timezone name |
| `backup.keepDatabase` / `keepMedia` / `keepFull` | 14 / 8 / 12 | Retention counts |
| `backup.minimumAgeHours` | 24 | Floor before anything may be deleted |

The cron ticks **hourly** and decides in the handler, so changing the hour needs
no restart.

**Duplicate protection is two mechanisms**, both needed: a Redis lock
serialises the tick (one process decides to enqueue) and a unique
`occurrenceKey` — `2026-09-22:FULL` — serialises the night. The second is what
survives a restart, a deploy at 01:59 and a worker retry.

Retention runs an hour after the backup window, deliberately: the night's
backup has to be *verified* before retention counts it as a recovery point.

---

## 5. Verification — and why it is not the same as "completed"

Every run is verified before it is called `SUCCESS`:

1. every artifact's **SHA-256 is recomputed** and compared to what was recorded;
2. the dump's table of contents is parsed with `pg_restore --list`;
3. the media archive's headers are parsed with `tar -tzf`;
4. the manifest is parsed and re-scanned for secret-shaped keys.

A run that fails any of these is left `FAILED`, so nothing downstream treats it
as a recovery point. **A file existing is not recoverability** — that is what
the drill is for.

---

## 6. How to restore

### 6.1 The drill — run this monthly

**A backup that has never been restored is an assumption.**

*Sicherungen → pick a backup → Einspielen → Art: Übung → `WIEDERHERSTELLEN` →
password.*

It restores into `<database>_restore_drill`, runs six validation checks and
reports. **It touches nothing else.** The drill database is kept for inspection
and dropped at the start of the next drill.

What the checks confirm: the connection works, the migration state is known, a
Super Admin survived, the organisation record is there, the settings are there,
and the content is there. `pg_restore` exiting 0 confirms none of that.

### 6.2 The real thing

*Sicherungen → pick a backup → Einspielen → Art: Produktivsystem →
`WIEDERHERSTELLEN` → password.*

Requires all of:

- `system.restore` — **not** `system.backup`;
- a re-authentication window (password, plus the second factor if enrolled);
- the word `WIEDERHERSTELLEN` typed out;
- the backup being **verified** — an unverified one is refused;
- a compatible schema;
- no other backup, restore or retention pass running.

It then, in order:

1. takes a **pre-restore `FULL` backup** and waits for it to verify;
2. **aborts if that fails** — nothing is overwritten;
3. closes the write gate (mutating requests answer 503; reads and `/auth/*`
   stay open);
4. runs `pg_restore --clean --if-exists`;
5. runs the validation checks;
6. reopens the write gate, whatever happened.

**Write protection governs one process.** The flag is in memory, because a flag
in the database cannot govern an operation that is replacing that database. On
a multi-instance deployment, **stop the other instances first**. Single-instance
is this application's documented shape today.

### 6.3 If the schema does not match

`REQUIRES_MIGRATION` — restore, then run `npx prisma migrate deploy` in
`server/`.

`INCOMPATIBLE` — the backup is *newer* than this build, or its migration is
unknown. Prisma does not migrate backwards. Deploy the matching application
version first, or recover manually.

---

## 7. Emergency manual recovery

When the application will not start, everything above is unavailable. The
artifacts are plain files and the tools are standard.

```bash
# 1. Find the backup. The manifest says what it is.
ls server/var/backups/2026/09/
cat server/var/backups/2026/09/<id>/<id>.manifest.json

# 2. Check it is intact, against the manifest's sha256.
sha256sum server/var/backups/2026/09/<id>/<id>.dump

# 3. Check it is readable before doing anything destructive.
pg_restore --list server/var/backups/2026/09/<id>/<id>.dump | head

# 4. Restore into a NEW database first. Never straight over production.
createdb -h localhost -p 5433 -U postgres iem_recovered
pg_restore -h localhost -p 5433 -U postgres -d iem_recovered \
  --clean --if-exists --no-owner --no-acl \
  server/var/backups/2026/09/<id>/<id>.dump

# 5. Look at it.
psql -h localhost -p 5433 -U postgres -d iem_recovered \
  -c 'SELECT count(*) FROM "User"; SELECT name FROM "Organisation";'

# 6. Media.
tar -xzf server/var/backups/2026/09/<id>/<id>-media.tar.gz -C /tmp/recovered
```

Then point `DATABASE_URL` at the recovered database, or rename it into place
with the application stopped.

`PGPASSWORD` in the environment, never on the command line — an argument is
visible in `ps` and in the tool's own error messages.

---

## 8. Recovery test procedure

Quarterly, and after any change to the schema, the storage layout or the
PostgreSQL version:

1. **Run a drill** from *Sicherungen*. Confirm all six checks pass.
2. **Verify the media half** — the drill covers the database only:
   ```bash
   tar -xzf <id>-media.tar.gz -C /tmp/media-drill
   # compare against the live tree; every file should be byte-identical
   ```
3. **Check the manifest** records the migration you expect.
4. **Record it.** The restore history at *Sicherungen* is the record.

If a drill fails, the backups are not recovery points, whatever the status
panel says. Treat it as an incident.

---

## 9. Known limitations

| | |
| --- | --- |
| **Local storage only** | Same disk as the database. Not disaster recovery. `BackupStorageProvider` is the seam |
| **No encryption at rest** | Deliberate — see §3. Directory permissions and the `system.restore` gate are what protect artifacts today |
| **Write protection is per-process** | In-memory flag. Multi-instance deployments must stop other instances before an in-place restore |
| **Consistency gap** | Database and media are captured seconds apart; the manifest records both times |
| **In-place restore is untested against a live database** | The code path exists with every guard; what has been *executed and validated* is the drill. See `docs/ENTERPRISE_ROADMAP.md` → P2-5 |
| **No automatic drills** | A scheduled monthly drill would be the strongest possible assurance and is one cron entry away. Not built |
| **`pg_dump` major version must match** | A newer client can dump an older server; an older client cannot read a newer server's output. Set `PG_BIN_PATH` deliberately |

---

## 10. Failure categories

Sanitized, and never a raw tool message — `pg_dump` echoes the connection it
attempted, which carries the user and the host.

`DATABASE_UNAVAILABLE` · `DUMP_FAILED` · `STORAGE_UNAVAILABLE` · `DISK_FULL` ·
`ARCHIVE_FAILED` · `CHECKSUM_FAILED` · `VERIFICATION_FAILED` ·
`RETENTION_FAILED` · `RESTORE_FAILED` · `VERSION_INCOMPATIBLE` ·
`TOOL_MISSING` · `UNKNOWN`

The raw text goes to the server log, where the reader already has shell access.
