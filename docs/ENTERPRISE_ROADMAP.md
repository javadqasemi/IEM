# Enterprise roadmap

The remaining work to make this an operable enterprise platform, prioritised. Derived
from `docs/CURRENT_APPLICATION_AUDIT.md` (19 September 2026), which is the evidence for
every item here.

This is **not** a replacement for `docs/roadmap.md`. That document owns the *business
module* build order — Wave 2's remaining modules, Waves 3 and 4. This one owns the
platform: the things every module depends on and the firm's own configuration. Where the
two touch, the dependency is named.

**Priorities.**

| | |
| --- | --- |
| **P0** | Security, data loss, broken production flows, broken builds. Nothing else starts while one is open. |
| **P1** | Enterprise core — needed to operate the company and the CMS properly. |
| **P2** | Operational: workflows, administration, the things that turn "works" into "runnable at 2 a.m." |
| **P3** | Optimisation, polish, convenience. |

Each item states the problem, the impact, the fix, its dependencies and what "done" means.

Status keys: **✅ done in this pass** · **◐ partly done** · **○ open**.

---

## P0 — Critical

### P0-1 ✅ Settings are written with no schema, and one of them is a deletion deadline

**Problem.** `SettingDef` declares no type and `SettingsService.update` validates nothing
beyond "the key exists" and "the value is not `undefined`". `settings.controller.ts`
claims in a comment that *"the shape is checked against the setting's own definition in
the service"*; no such check exists. `applications.service.ts:155` then reads
`applications.retentionDays` with the raw untyped `value()` — no clamp, unlike
`maxFileBytes` two lines above it — and multiplies it into `retainUntil`.

**Business impact.** Setting the retention field to `0` or a negative number makes the
03:00 purge delete every applicant dossier received that day, files included, permanently.
Setting it to anything non-numeric yields `new Date(NaN)`, Prisma rejects the write, and
`POST /applications` 500s — the public careers form stops accepting candidates with no
visible cause. Both are reachable from the settings form by an ordinary mistype, and both
involve personal data.

**Technical impact.** The class is wider than the one call site: every setting is stored
as free-form JSON, so any consumer that does not go through `text`/`number`/`flag` has the
same exposure, and an operator can put a value into the store that silently does nothing.

**Solution.** Give every setting a declared `type` (`string`, `text`, `email`, `url`,
`number`, `boolean`, `stringList`, `select`) with `min`/`max`/`options` where they apply,
validate on write in a pure `settings.rules.ts`, and reject the wrong shape with a 400
that names the key. Clamp the retention read. Validation is pure, so it is exhaustively
testable without a database.

**Dependencies.** None.

**Acceptance.** A `PATCH /settings` carrying the wrong JSON type, an out-of-range number
or an unknown select option is refused with a message naming the key; the retention read
is clamped to a sane range; the comment in the controller is true; tests cover every
declared type including the mask-write no-op.

---

## P1 — Enterprise core

### P1-1 ✅ The firm is not an entity — Company / Organisation settings

**Problem.** Company data lives in three stores that do not know about each other: nine
`Setting` rows (eight of them `pending`, i.e. read by nothing), the `offices` CMS content
type, and the orphan Prisma `Office` table with no API and no screen. Two of them already
disagree about the firm's street address in Thun and in Bern.

**Business impact.** There is no answer to "what is our address" that the system will give
consistently. Changing the main phone number means finding every place it was typed. The
legal identity a Swiss company must publish — UID, commercial register, VAT, legal
address, data-protection contact — is not held anywhere.

**Technical impact.** Every future module that needs the firm's identity (invoicing,
offers, PDF title blocks, transmittal letterheads, e-mail footers) will either invent a
fourth store or hard-code it.

**Solution.** An `Organisation` singleton and a first-class `Office` entity, built to the
five-layer reference pattern with rules, events, audit, versioning, metrics and row-level
permission checks. The published website document then *derives* its `offices` from the
`Office` table instead of from a parallel content type, which makes the header phone, the
contact band, the Standorte section and the `{telefonThun}` / `{standorte}` tokens all
follow one source with no change to the site's components.

**Dependencies.** P0-1 (the settings groups are re-homed into the same workspace).

**Acceptance.** Super Admin can edit organisation identity, legal data, contacts and
offices; an unauthorised user cannot; changes persist, are versioned, are audited and
reach the public site on the next publish; the old duplicate is removed rather than left
behind; offices CRUD includes archive/restore and refuses to orphan employees or projects.

### P1-2 ✅ The settings screen is one long form

**Problem.** No sections, no sub-navigation, no search, no unsaved-changes guard, no
per-field validation, no confirmation on dangerous switches. Field types are guessed from
the stored JSON.

**Business impact.** Configuration is where an administrator does the most damage with the
least feedback. The switch that lifts the four-eyes principle currently takes one click
with no confirmation and no indication anything important happened.

**Solution.** A settings workspace: left sub-navigation, one section per subject, a save
bar that reports dirty/saving/saved per section, field types from the declaration rather
than from the value, an unsaved-changes guard, and confirmation on the changes that
weaken a control.

**Dependencies.** P0-1 (typed definitions are what the renderer reads).

**Acceptance.** Every group reachable from a sub-navigation; leaving with unsaved changes
warns; validation errors appear on the field; dangerous changes confirm; the layout works
at phone width with no horizontal overflow.

### P1-3 ◐ Operational visibility: system, storage, integrations

**Problem.** `/dashboard/health` reports database latency, seed sync and process figures.
There is no application version, no migration state, no queue state, no storage
consumption, and no statement of which integrations are configured.

**Business impact.** "Is mail actually configured?" and "did the last migration apply?"
are unanswerable without shell access.

**Solution.** A read-only System panel in the settings workspace fed by a real endpoint —
versions, migration count and latest name, database latency, job queue by state, media
count and bytes, and an integration list whose status is *derived from configuration that
actually exists* rather than from a table of intentions.

**Done in this pass:** the panel, the endpoint, storage and queue figures, and integration
status for mail, storage, cache and the two that are genuinely absent.
**Still open:** deployment identity (commit/build time) — needs a build-time stamp.

**Acceptance.** No secret is exposed; every figure is measured rather than declared; an
absent integration says *absent*, never *ok*.

### P1-4 ✅ Mail cannot be proven to work

**Problem.** SMTP is configurable from the dashboard and degrades to logging when
unconfigured — so a wrong password looks exactly like a correct one.

**Solution.** A test-send route behind `settings.update`, which resolves the *stored*
configuration, sends to the caller's own address, and reports the transport error
verbatim on failure. Audited, and rate-limited.

**Acceptance.** A wrong host produces a named error in the UI within the request; a
correct one produces a mail; the attempt appears in the audit log either way.

**Superseded by P2-4**, which kept the route and changed three things about it: the
error is now a **sanitized classification** rather than the transport's own text, the
recipient may be named, and a second operation — a connection test that sends nothing —
sits beside it. The single probe button this entry describes is gone.

### P2-4 ✅ Email Operations — one provider seam, and a credential nobody can read

**Problem.** Four separate ones, and only the first was visible from the settings screen:

1. **The SMTP password was stored in plaintext.** `secret: true` masked it *on read* and
   nothing encrypted it on write — `EncryptionService` existed and was imported by three
   files, all MFA. Worse, `settings.secrets` was a permission that **handed the plaintext
   back**, so a credential travelled the wire and sat in a browser's memory for no
   operational reason: knowing a password is not needed to replace one.
2. **`nodemailer` was imported directly into `MailService`**, so its error shapes, option
   names and `verify()` semantics were the vocabulary the notification platform, the
   settings screen and the audit log all ended up speaking.
3. **Raw provider errors went to three places at once** — the browser,
   `NotificationDelivery.detail` and the `MailTested` audit payload. A failed `AUTH PLAIN`
   echoes a base64 blob containing the username and the password.
4. **The last hop had never executed.** `SMTP_HOST` was empty on every machine, so every
   `EMAIL` delivery resolved to `SKIPPED`. This was the one honest gap P2-3 left open.

**Solution.**

```
Domain event → Notification → Delivery → MailService → MailProvider → SMTP
                                             ↑
                              Settings → Secret Settings Layer → SecretEncryptionService
```

| | |
| --- | --- |
| **One crypto implementation, two keys** | `KeyedCipher` holds the AES-256-GCM; `EncryptionService` reads `MFA_ENCRYPTION_KEY` and `SecretEncryptionService` reads the new `APP_SECRETS_ENCRYPTION_KEY`. Separate because the recovery stories differ: losing one costs a password somebody retypes, losing the other de-enrols every second factor in the firm. Sharing a key would tie those consequences together |
| **A secret is write-only** | Encrypted at rest, accepted on write, and returned by **no** route. `settings.secrets` now means *manage* — replace and remove — which is what it is named for in `resources.ts`. The permission was not renamed: the key is what roles are granted, and renaming it would be a migration for a better word |
| **A blank field means keep** | `classifySecretWrite` has no spelling of "delete". A settings form posts every field it rendered and the password field renders empty, so "empty clears it" destroys a working credential on the next save of an unrelated field. Removal is `DELETE /settings/secrets/:key`, behind a confirmation |
| **A migration that runs at boot** | Idempotent (`isEncrypted` is a prefix test, not a decryption attempt), narrow (declared secrets only), quiet (no value at any log level), and it fails safe — with no key it changes nothing and says so |
| **Boot safety** | Encrypted secrets with no key to read them is reported loudly rather than treated as empty. Without that the application boots, the panel says "configured" because the row exists, and mail silently stops |
| **A provider seam** | `MailProvider` is the interface; `SmtpProvider` is the one implementation, and `architecture.test.ts` asserts it is the only file that imports nodemailer. Microsoft 365, SES or Postmark is a second class, not a change to notification logic |
| **Failures are classified** | Nine categories, each mapping to a *different thing the operator does next*. The raw text goes to the server log, where the reader already has shell access; the classification goes everywhere else. `mail.failure.test.ts` asserts no part of the input reaches the output, including a password embedded in an AUTH blob |
| **Two diagnostics, not one** | `verify` covers DNS/TCP/TLS/AUTH and sends nothing; the test send additionally covers sender identity, recipient acceptance and the template. One button would either mail somebody every time a password is checked, or never prove a message can leave |
| **Templates stay in code** | A catalogue with previews, not an editor. A template is where a variable meets a string, and both failure modes — a reference to nothing, and a convincing sentence beside a real link — are worse in a system whose messages include "your second factor was removed". In code the variables *are* the parameter type |
| **Status has five states** | `unknown` is the one that matters: configured but never tested. A green light meaning "the fields are filled in" teaches an operator that green means nothing |

**Delivered.**

| | |
| --- | --- |
| Database | **No migration.** Two new settings rows (`mail.replyTo`, `mail.timeoutSeconds`) arrive through the seed; the encryption is a change to what the existing `Setting.value` holds |
| API | `GET \|POST /settings/mail/status\|verify\|test`, `GET /settings/mail/templates[/:key/preview]`, `DELETE /settings/secrets/:key`, `POST /notifications/deliveries/:id/retry` |
| Permissions | **None added.** `settings.update`, `settings.secrets`, `settings.read` and `notification.readDeliveries` already existed; manual retry reuses **`job.retry`**, which leaves `KNOWN_UNENFORCED` at **14 → 13** |
| Deliveries | Reused, never duplicated. The Zustellprotokoll stays in `features/notifications`; the mail panel shows the summary and links to it — `architecture.test.ts` would have refused the alternative |
| Frontend | `features/mail/` on the five layers, embedded into the settings workspace through the new `panel: true` source. The old one-button test card is gone |
| Tests | +41 server unit, +17 client unit, +17 e2e against a real SMTP server |

**Acceptance, met.** A written SMTP password is unreadable through any route and is stored
as `v1.<iv>.<tag>.<ciphertext>`; a blank write keeps it; a wrong host produces a category
and no provider text; and a content submission travels event → delivery → job → SMTP →
**Mailpit confirms the message** → delivery `DELIVERED`. `e2e/mail.spec.ts` is the proof,
and it asks Mailpit rather than nodemailer — a resolved promise proves a library call
returned, not that an SMTP transaction happened.

**Not done, deliberately:** a second provider (the interface exists, nothing implements
it); HTML mail (plain text means the whole HTML-injection question does not arise);
editable templates; and `security.allowedOrigins`, still inert for the reason P1-5 gives.

**One defect found outside the slice and fixed inside it.** The notification bell's unread
badge was white on `brand-bronze`, which is a light gold in the dark theme — 2.03:1 against
the 4.5:1 that 10px text needs. It shipped with P2-2 and no accessibility run had ever seen
it, because the badge renders only when the count is non-zero and no spec had produced an
unread notification. This slice's acceptance test raises real ones, so it surfaced — in
`projects.spec.ts`, two specs away from anything to do with mail. The badge is `brand-navy`
now and **the pair is asserted in `theme.contrast.test.ts`**, which is the part that
matters: a colour pair that is only sometimes on screen cannot be left to the browser suite
to notice.

### P1-5 ◐ Security configuration is constant

**Problem.** Lockout threshold, lockout duration and password minimum length are constants
in `auth.rules.ts`. `security.allowedOrigins` is inert. There was no active-session view —
**that half is now P2-9 ✅**.

**Business impact.** An incident cannot be responded to without a deploy. The second half
of this — that neither a user nor an administrator could end a suspicious session short of
deleting the account — is closed.

**Solution.** The obvious repair — move all three into the settings table — is wrong in a
way worth writing down: it turns every security property into something an operator can
switch off, and an attacker holding a Super Admin session can then switch them off before
doing anything else. So `server/src/auth/security.policy.ts` sorts every security number
into four kinds and makes exactly one of them configurable:

| Kind | Where | Examples |
| --- | --- | --- |
| **Invariant** | Compile time, never configurable | `REFRESH_GRACE_MS`, `PASSWORD_FLOOR`, `PASSWORD_MAX_LENGTH`, the obvious-password deny-list, rotation and family revocation, the `@Throttle` limits |
| **Environment** | Deployment and secrets, never readable through the API | `JWT_ACCESS_SECRET`, `REFRESH_TTL_DAYS`, `CORS_ORIGINS`, `REDIS_URL`, `SMTP_*` |
| **Organisation policy** | Super Admin, validated, audited, **clamped** | `security.sessionTimeoutMinutes`, `maxFailedLogins`, `lockoutMinutes`, `passwordMinLength` |
| **User** | The person's own | Their password, their sessions, their MFA enrolment — the last of which is now built, **P3-2 ✅** |

**The rule that makes the third kind safe: a policy may tighten an invariant and may not
loosen it.** `resolvePasswordPolicy` clamps the configured minimum *up* to
`PASSWORD_FLOOR`, so a row saying `4` resolves to `12`. The clamp is applied on **read**,
not trusted from the write path — validation guards the API, and this covers every other
way a row can come to hold a bad number: a migration, a hand-edit, a release from before
the bound existed.

**Done:** the four-layer split, the three new clamped settings, `afterFailedLogin` and
`assertPasswordStrength` taking the policy as an argument so the rules stay pure, and the
Sicherheit section of the settings workspace rendering them automatically — with bounds,
units and a confirmation on each, because all three are declared `dangerous`. 55 auth
tests, of which 29 are the policy.

**Remaining:** nothing here but `security.allowedOrigins`, which stays inert deliberately:
making CORS dynamic costs a database read per preflight and locks the dashboard out of its
own API when it is wrong. The active-sessions view that used to be listed here shipped as
**P2-9 ✅** below, split out because it was a screen and an endpoint rather than a
configuration question.

**Acceptance met so far.** Changing the lockout threshold takes effect on the next attempt
without a restart; no policy value can weaken an invariant however it reaches the table.

### P1-6 ○ Fourteen permissions guard nothing

**Problem.** `KNOWN_UNENFORCED` lists 14 keys selectable in the role editor that no route
checks. Harmless while the routes do not exist; misleading the moment one does.

**Solution.** Not a single change — each entry retires with the module that earns it
(jobs, SEO, backup, import/export, impersonation). The list is already the tracking
mechanism and the test already fails on a stale entry. What this roadmap adds is the
*order*: `job.*` with P2-1, `seo.*` with P2-4, `content.export/import/unpublish/schedule`
with P2-3, `system.backup` with P2-5, `user.impersonate` deliberately last or never.

**Acceptance.** The list only shrinks, and each removal lands in the commit that adds the
route.

---

## P2 — Important

### P2-1 ○ Background jobs have no operator surface
`core/jobs` is durable, retried and attributable, and the `Job` table is the row an
operator needs when an export never arrives — but there is no controller and no screen,
and `job.read`/`retry`/`cancel` guard nothing. **Fix:** a jobs list with state filter,
payload, attempts, last error, and retry/cancel actions. **Acceptance:** a failed job can
be diagnosed and retried from the dashboard; three permissions leave `KNOWN_UNENFORCED`.

### P2-2 ✅ Notifications are a table and nothing else

**Problem.** `Notification` existed as a Prisma model with no implementation at all, the
settings group rendered as explicitly not-yet-connected, and two business services sent
e-mail directly — `ApplicationsService` to a configured address, and a `sendReviewRequest`
that was written and **called by nobody**, so the review mail simply never existed.

**Solution: one platform, and no module sends an e-mail.**

```
domain event → listener → draft → dispatch()
                                    ├─ recipients   (strategy → users → dedupe → actor rule)
                                    ├─ channels     (invariant → organisation → person)
                                    ├─ Notification (one row per recipient, unique per event)
                                    ├─ Delivery     (one row per channel)
                                    └─ job          (e-mail only, durable, retried)
```

#### The decisions worth reading

| | |
| --- | --- |
| **Four tables, four owners** | A notification is what the *recipient* is owed; a delivery is what the *channel* did; a preference is what the *person* chose; a rule is what the *firm* chose. Folding any pair loses a question somebody asks — "has she read it" and "did the e-mail go" have different answers |
| **`SKIPPED` is not `FAILED`** | A deliberate non-send with a reason. "We chose not to" and "we tried and could not" look identical in a log that has only one of them, and only the second is a fault |
| **The invariant chain** | `security invariant → organisation policy → user preference`, the shape `security.policy.ts` already uses, applied on **read**. Four security notifications cannot have their in-app copy switched off by anyone; their *e-mail* copy still can, which is what keeps people from filtering the sender |
| **The actor rule, and its exception** | Telling somebody what they just did is noise — except for the four `subject` notifications, where the actor being the account holder is precisely the case the message exists for. Somebody with your session disabling your second factor *is* you as far as the server can tell |
| **Idempotency is an index, not a check** | `@@unique([eventKey, userId])` and a caught `P2002`. A read-then-write is the race the index settles |
| **The loop that had to be cut** | `JobFailed` → notification → e-mail job → fails → `JobFailed`. A dying `notification.deliver` job raises nothing; the failure is still a `DEAD` row, an audit entry and a log line |
| **No realtime stack** | There is no WebSocket or SSE infrastructure here, and adding one for a bell would be a connection per tab, a reconnection strategy and a second authentication path. A 60-second poll that pauses on a hidden tab, with `pollMs` on `useQuery` as the seam a transport later replaces |

#### What became a domain event

Nine events feed it, and **eight of them existed only on paper**. Four `Content*` events
were declared in the F7 catalogue and raised by nobody; the module wrote its audit rows by
hand. Four MFA facts were direct `audit.record` calls — against this repository's own rule,
restated by `AuditListener`: *events describe things that happened to records; direct audit
calls describe things that happened to nobody.* A second factor being switched off happens
to a record.

**The audit log is byte-identical either way**, which is what made the migration safe to do
four call sites at a time: `auditActionFor` derives `content.submitted` from
`ContentSubmitted` — the same string the hand-written call used — and
`notifications.agreement.test.ts` pins all ten derivations to literals.

`JobFailed` is new, raised once when a job goes `DEAD` rather than on every attempt.

#### Delivered

| | |
| --- | --- |
| Database | Four tables, three enums, `Notification.kind` replaced by `type` + `severity`. Migration `20260921090000_notifications`, **reviewed by hand** — the diff contained one `DROP COLUMN` and the table was verified empty first |
| Catalogue | Ten notification types across four categories, each with a severity, a recipient strategy, defaults and a `mandatory` flag. Every one has a real producer; the agreement test checks both directions |
| API | `GET /notifications`, `…/unread-count`, `POST …/:id/read`, `…/read-all`, `GET|PUT …/preferences`, `GET|PUT …/rules`, `GET …/deliveries` |
| Permissions | `notification.configure`, `notification.readDeliveries` — 117 → **119**, both enforced. `KNOWN_UNENFORCED` unchanged at 14 |
| Jobs | `mail.send` **renamed** to `notification.deliver` and given a real producer and handler. The payload is a delivery id, so no address is ever written into the queue table |
| Mail | One shared abstraction, `MailService.sendNotification`, which reports its outcome instead of swallowing it. `sendApplicationNotice` and `sendReviewRequest` **deleted** |
| Frontend | `features/notifications/` on the five layers; the bell in the shell's header; a centre at `/benachrichtigungen` with an inbox and a preferences tab; the firm's rules and the delivery log embedded in Einstellungen through `admin/pages/SettingsPage.tsx` |
| Tests | +75 server unit, +40 client unit, +24 e2e, +12 security-matrix cells |

**Not done, deliberately:** `TaskOverdue` is still consumed by nobody. It is the one event
this module could plausibly have wired and did not, because a task notification needs a
recipient strategy the catalogue does not have — *the assignee* — and inventing a fifth
strategy for an event whose module ships its own board was more speculation than the slice
needed. It is one entry in `catalogue.ts` and one line in the listener when Aufgaben asks
for it.

### P2-3 ○ Publishing is missing four verbs
No unpublish, no import, no export, and scheduling is half built — `scheduledAt` is read
by the 5-minute cron and set by nothing. **Acceptance:** an editor can schedule a publish
and see it pending; an entry can be withdrawn from the live site without a rollback; four
permissions leave `KNOWN_UNENFORCED`.

### P2-4 ○ SEO and redirects
`Redirect` has a table, hits counter and enable flag; `seo.read`/`seo.update` guard
nothing. The `seo` content type already covers per-site meta well, so this item is
redirects plus robots.txt plus the fallback patterns from the organisation's website
defaults. **Acceptance:** a redirect can be created and is served; two permissions leave
the list.

### P2-5 ✅ Backup and recovery — proved by restoring, not by dumping

**Problem.** There was no backup system of any kind. `/dashboard/system` carried
an `unbuilt` integration row saying so, `system.backup` had been in the permission
catalogue since F6 guarding nothing, and `backup.create` had been in the job
catalogue since F10 with no handler. Recovery was "somebody runs `pg_dump` by hand,
we think".

**Solution.**

```
schedule / button → BackupRun → job → pg_dump + tar + manifest
                                   → checksum → verify (pg_restore --list)
                                   → SUCCESS
restore → permission → re-auth → typed word → verified? → compatible?
        → no conflict → pre-restore backup (blocking) → write gate
        → pg_restore → validate → gate opens
```

#### The decisions worth reading

| | |
| --- | --- |
| **Completed ≠ verified** | Two columns, never one. A run is `SUCCESS` only after its checksums re-match and `pg_restore --list` / `tar -tzf` parse it. A file existing is not recoverability, and a module that conflated them would report files |
| **Verified ≠ recoverable** | Which is why the **drill** exists: restore into `<db>_restore_drill`, then read back the migration state, a Super Admin, the organisation, the settings and the content. `pg_restore` exiting 0 proves none of that — it reports ownership notices as errors and restores partially without complaint in some failure modes |
| **`DRILL` is the default mode** | The dangerous one is never pre-selected. An operator who opens the dialog and presses everything runs a drill, which proves the backup and changes nothing. And the typed word is required for *both*, because the muscle memory built on drills is what they bring to the real thing at 03:00 |
| **The pre-restore backup blocks** | If it fails the restore is `ABORTED` before anything is overwritten. A safety net taken optimistically and ignored on failure is a gesture |
| **Retention may never leave zero** | The last verified backup of each type survives whatever the counts say, along with protected runs, anything still running, and every `PRE_RESTORE` backup. `keep: 0` would otherwise mean "delete everything", and a misconfigured form is not a reason to have no backups |
| **The preview *is* the deletion** | `planRetention` is pure and both the screen and the job call it. A preview computed differently from what it previews is a preview that lies exactly when somebody relies on it |
| **`occurrenceKey` is a date, not a timestamp** | `2026-09-22:FULL`. A unique index, not a check. A timestamp would make every scheduler retry a separate full backup of the same night, which is how a nightly job fills a disk |
| **An allowlist, not an exclude list** | The media archive names the directories it *does* take. An exclude list is a promise to remember every future directory somebody adds, and the forgotten one is the one with something in it |
| **No password in `argv`** | `PGPASSWORD` in the child's environment, `spawn` with an argument array and `shell: false`. An argument is visible in `ps`, in a crash dump, and in libpq's own error text — which is also why `redactToolOutput` exists |
| **The manifest has nowhere to put a secret** | Same technique as `EmailInput` and `MailProviderDescription`. `findSecretLikeKeys` runs over it before it is written, so a future field named `smtpPassword` fails the backup rather than shipping in it |
| **Write protection is a process flag** | Not `site.maintenanceMode`. A flag in the database cannot govern an operation that is replacing that database — `pg_restore --clean` drops the `Setting` table partway through, so a guard reading it would find the row missing, the table missing, or the *restored* value |

#### Delivered

| | |
| --- | --- |
| Database | Three tables (`BackupRun`, `BackupArtifact`, `RestoreRun`), seven enums. Migration `20260921074026_backup_recovery`, **reviewed before applying** — purely additive, no `DROP`, no `ALTER COLUMN` |
| Permissions | **One new key.** `system.backup` left `KNOWN_UNENFORCED` (14 → 12 with `job.retry`), and `system.restore` is new — it gates applying *and downloading* a backup, because the archive is the whole database and every applicant dossier. `administrator` holds the first and not the second |
| Jobs | `backup.create` finally has a handler and its payload became an **id**; `backup.verify`, `backup.retention` and `backup.restore` are new. No second queue |
| Scheduler | An hourly `@Cron` that decides in the handler, so moving the hour needs no restart. Redis lock for the tick, unique `occurrenceKey` for the night — both, because either alone leaks a duplicate in a case the other covers |
| Frontend | `features/backup/` on the five layers; `/sicherungen` for operations and *Einstellungen → Sicherung* for configuration, using the additive `panel: true` slot for the second time |
| Tests | +49 server unit, +13 e2e including the drill |
| Runbook | `docs/BACKUP_RECOVERY_RUNBOOK.md` — storage, keys, verification, restore, emergency manual recovery, and the recovery-test procedure |

**Acceptance, met and measured.** A `FULL` backup of this database is 9.95 MB in
1.7 s, verified as *"Datenbank: 483 Objekte lesbar · Medien: 17 Einträge lesbar"*.
The drill restored it into `iem_cms_restore_drill` and read back: migration
`20260921074026_backup_recovery`, 16 migrations, 10 users, 1 Super Admin,
*Ingenieurbüro IEM AG*, 29 settings, 160 content entries. The media archive
extracted to an isolated path and **all 13 files were byte-identical by SHA-256**.

**The folder was split mid-slice**, and the architecture test is what forced it.
`backup/` held a controller *and* two services with readers outside the module —
`MaintenanceService` for a global guard and `BackupStatusService` for
`/dashboard/system` — which is the "infrastructure wearing a feature's folder
name" problem `audit/` and `settings/` were fixed for. `core/backup/` holds the
services; `backup/` holds the routes; the module classes are named for the split.

**Not done, deliberately:**

- **No off-site storage.** `BackupStorageProvider` is the interface; `LOCAL` is
  the only implementation. The status API returns `offSiteWarning` and the UI
  renders it, because a backup on the same disk as the database is not disaster
  recovery and must not be presented as one.
- **No encryption at rest.** The correct implementation is *streaming* over a
  multi-gigabyte file, and `SecretEncryptionService` is an in-memory small-secret
  cipher — using it here would load a dump into Node's heap. It also earns little
  while artifacts sit on the same disk, readable by the same OS user that can read
  `server/.env`. It belongs in the same slice as off-site storage, with a dedicated
  `BACKUP_ENCRYPTION_KEY`. The runbook says all of this.
- **In-place restore has never been executed against a live database.** Every
  guard is implemented and the code path is exercised up to the point of
  divergence; what has been *run and validated* is the drill. Proving
  recoverability does not require destroying a working database, and the brief
  says not to.
- **No automatic drills.** A monthly scheduled drill would be the strongest
  assurance this module could offer and is one cron entry away.

### P2-5 ○ (superseded — see above)
There is no backup system. The settings workspace says so rather than showing an empty
panel, which is the honest interim. **Fix:** a scheduled `pg_dump` to the storage adapter
as a `core/jobs` job, a retention policy, a restore that requires elevated confirmation.
**Acceptance:** last/next backup and status are real figures; restore is audited and
gated; `system.backup` leaves the list.

### P2-6 ○ Departments
A `Department` table with a tree and a head, no API, no screen — and the site's team type
still carries a hardcoded `group` option list. **Acceptance:** departments are managed in
Company Settings and the team content type reads them.

### P2-7 ○ The pre-pattern screens
`Content.tsx`, `ContentEditor.tsx`, `Media.tsx`, `People.tsx`, `Workflow.tsx` and
`Operations.tsx` are 15k–29k-line multi-screen files predating the five-layer pattern and
the `DataView`/`useListView` contract. `ContentEditor` also hand-writes a breadcrumb the
router derives. **Acceptance:** each becomes a feature folder; `WITHOUT_METRICS` shrinks by
the same number.

### P2-9 ✅ Active session management
Split out of P1-5, because it is a screen and an endpoint rather than a configuration
question. `RefreshToken` already stored `ip`, `userAgent`, `createdAt`, `expiresAt`,
`revokedAt` and the rotation chain — everything a session list needs — and
`POST /auth/logout-all` already existed, so **no migration was required**.

**Acceptance, all four met.** A user sees and revokes their own sessions
(`GET/DELETE /auth/sessions`, `POST /auth/sessions/revoke-others`, rendered as a card on
*Mein Konto*); an administrator sees and revokes another's
(`GET /users/:id/sessions`, `DELETE /users/:id/sessions/:sessionId`,
`POST /users/:id/sessions/revoke-all`, rendered in the user dialog); the current session
is marked; and every revocation is audited as `auth.session_revoked`,
`auth.sessions_revoked_others` or `auth.logout_all`, each carrying the target as
`resourceId` and the caller as `actor`.

**Nothing secret leaves.** `toSessionViews` builds the response from an explicit key
list, so adding a column to `RefreshToken` cannot widen it; `sessions.rules.test.ts`
asserts the exact key set and `sessions.spec.ts` asserts it again against a real body.

Four decisions worth keeping:

| | |
| --- | --- |
| **A session is one row** | Rotation revokes as it issues, so a live session has exactly one unrevoked row — the grouping problem solved by a `where` clause instead of walking `replacedById`, which is unindexed. The cost is that `createdAt` is the *last rotation*, so the column is **"Zuletzt aktiv"** and never "Angemeldet seit": labelling a rotation as a sign-in would be a plausible-looking lie |
| **The caller's own sessions carry no permission** | `/auth/sessions` is the account's own, like `/auth/me`. A `session.readOwn` would be a key every role had to be granted for the dashboard to work, which is a key that means nothing. The scope is the control: the account comes from the verified token, never from a parameter |
| **`user.readSessions` is not `user.read`** | Several roles see the user list; none of them sees devices, addresses and working hours. Split again from `user.revokeSessions`, because answering "is this account signed in somewhere it should not be" and acting on the answer are different authorities. Both go to `administrator`, which costs it nothing new — `user.update` can already SUSPEND an account, which ends every session it has |
| **An unknown user is 404, not `200 []`** | An empty list is what a real account with nobody signed in says. `sessionsOf` looks the user up first, and the security matrix uses a *fabricated* id deliberately: the guard answers 403 and the handler answers 404, so the two statuses together prove the guard fires rather than the route being uniformly unreachable |

**Remaining, and deliberate:** the administrator's view is a panel inside `EditUserDialog`
rather than a route, because there is no user *detail page* in this application at all —
`/benutzer` is a list whose rows open a dialog. Building one is P2-7's job. The cost is
that a user's sessions have no shareable URL; the panel is written to move onto that page
unchanged when it exists.

### P2-8 ○ Media library gaps
Checksums are stored and indexed but duplicates are never surfaced; there is no
replace-with-history UI, no bulk metadata edit, no orphan report. **Acceptance:** an upload
of an identical file offers the existing asset.

---

## P3 — Optimisation

| | |
| --- | --- |
| P3-1 ○ | **Legal pages** are placeholders (`README.md` → Known limitations). Now that the organisation holds UID, register and data-protection contact, an Impressum can be generated from it rather than typed. |
| P3-2 ✅ | **MFA enrolment.** Delivered in full — see the section below, which the brief that commissioned it calls *P2.2*. The `mfaSecret` column the old entry referred to is **gone**: a plaintext TOTP secret beside the e-mail address it belongs to is not a head start, it is the thing that had to be removed first. |
| P3-2b ○ | **MFA as an organisation policy** — *optional* / *required for privileged roles* / *required for everyone*. Deliberately **not** shipped with P3-2 and the reason is the shape of the setting rather than the size of it: making it true means refusing a session to somebody who has not enrolled, which means a forced-enrolment flow at sign-in that cannot be skipped and that has to survive a broken authenticator without locking the firm out of its own system. A setting without that flow is a row saying "MFA is required for everyone" while everyone without it carries on signing in — a security property an operator can read, believe, and not have, which is exactly what `security.policy.ts` exists to prevent. The seam is `AuthService.login`, which already branches on `MfaService.requiresFactor`; nothing in the module changes to add it. |
| P3-3 ○ | **Structured data.** The organisation now holds everything a schema.org `Organization` / `LocalBusiness` block needs. Emitting it is invisible to the design and good for search. |
| P3-4 ○ | **Lint backlog.** 0 errors is the bar and holds; 35 warnings (28 React-Compiler, 8 `exhaustive-deps`) are a countable backlog that grows with the dashboard. |
| P3-5 ○ | **Prettier.** Configured, deliberately not run across the tree. A one-commit reformat is a decision to take once, on its own. |
| P3-6 ○ | **Performance budgets over real volume.** `budgets.spec.ts` refuses to claim anything below 100 rows; `SEED_LOAD_PROJECTS=500` is opt-in. Making it the default for CI would turn the slope check into a standing regression gate. |
| P3-7 ✅ | **The login throttle is now a budget the suite spends rather than one it discovers.** Six independent paths reached `/auth/login` and none knew what the others had spent, so whichever was eleventh inside a sixty-second window failed — two files away, as a missing rail over a screenshot of the login page. `spendLogin()` in `e2e/fixtures.ts` reserves an attempt before the request and waits when the window is full; every path calls it, including the ones expected to fail. `login-budget.spec.ts` asserts against the source that none opts out, because a bypass is unobservable at runtime except as somebody else's flake. `infrastructure.spec.ts` stopped signing in twice with a hardcoded password. **No production limit moved.** Superseded the paragraph below. |
| P3-8 ✅ | **`e2e/` was typechecked by nobody.** `tsconfig.json` is the application and `tsconfig.test.json` covers `src/**/*.test.ts`; twenty-odd Playwright files were checked by neither, and Playwright transpiles without checking. `tsconfig.e2e.json` is a third program in `npm run typecheck`, and its first run found a `spendLogin` used in `security.spec.ts` and imported nowhere. |
| P3-7 (old) ○ | **The e2e suite now sits at the login-throttle ceiling.** `/auth/login` allows 10/min per IP; a full run needs roughly that many, because `security.spec.ts` signs in one account per role and `auth.spec.ts` deliberately spends attempts on failures. The seventh role account (`adm@iem.test`, added for the `organisation.updateLegal` gate) is what closed the margin, and the 61-second ride-out in `apiToken`/`workerContext` now fires often enough to be felt. **Do not raise the limit** — it is a real control and CLAUDE.md records three separate misdiagnoses of it. The two honest levers are to run `auth.spec.ts` last so its deliberate failures do not starve the rest, or to drop the seventh account: `organisation.controller.test.ts` already covers the legal gate as a pure unit test, so only the `office.delete` route cell would be lost, and that one is a plain decorator the agreement test already checks. |

---

## P3-2 ✅ Multi-factor authentication — the brief's *P2.2*

**Problem.** `User.mfaSecret` and `User.mfaEnabled` existed, `otpauth` was a declared and
unused dependency, and a settings switch referred to a flow that did not exist. The column
was the worst part of it: a **plaintext Base32 TOTP secret** in the same row as the e-mail
address it belongs to, readable by anyone with a database console or a backup.

**Business impact.** A password is the only thing between a stolen credential and the
firm's whole project book, its client list and its drawings. Every other control in this
system — the lockout, the throttle, the audit log, the row-level scope — assumes the
person holding the password is the account holder.

### Architecture

**Four tables, not three columns**, each answering a question the others cannot:

| | |
| --- | --- |
| `MfaCredential` | **What the person has.** One row per method per user, `PENDING` until a code has been checked against it. The secret is AES-256-GCM at rest; `lastUsedStep` is the replay guard |
| `MfaRecoveryCode` | **What they fall back to.** Ten rows, sha256, each spendable once |
| `MfaChallenge` | **A sign-in halfway through.** The password was right and the factor has not been shown |
| `ReauthToken` | **"I proved it again just now"** — a different claim from "I am signed in", and the one that guards switching the factor off |

**The property everything else rests on:** a correct password against an enrolled account
returns **no access token and sets no refresh cookie**. `AuthService.login` returns a
discriminated union rather than an optional field precisely so that a caller cannot
forget the branch, because forgetting it once means the factor is advisory.

### The decisions worth reading

| | |
| --- | --- |
| **A challenge is a row, not a JWT** | It has to be revocable and *countable*. A stateless challenge cannot enforce "five wrong codes and this attempt is over", and it is replayable for its whole lifetime by anyone who sees it. The same argument `RefreshToken` is built on |
| **One encryption service, in `core/crypto`** | A TOTP secret is the first value here that must be read back in the clear; API keys and stored SMTP credentials are the same shape and are next. `MFA_ENCRYPTION_KEY` is **environment**, deliberately not derived from `JWT_ACCESS_SECRET` — rotating that one is the documented way to sign everybody out, and an operator doing the ordinary thing would otherwise destroy every enrolment |
| **Recent authentication is not MFA-specific** | `ReauthService.require` is one gate, five minutes, a window rather than a ticket. Backup restore, API secrets and destructive administration are already named as its next callers |
| **Disabling keeps the sessions; an admin reset ends them** | The asymmetry is the point. A password change revokes because every other session holds a token issued against a credential that no longer exists — untrue here. An administrator resets because the holder is locked out (nothing to lose) or the credential is suspect (everything to gain); both readings end the sessions |
| **`user.resetMfa`, and no `user.readMfa`** | Reset is an intervention and gets a key. Reading is not split: `mfaEnabled` is a boolean already in the user list, and it reveals nothing the way a session's device, IP and working hours do. `administrator` holds the reset key — clearing a lost authenticator is support work, it grants no access, and putting it behind the single Super Admin account is how a locked-out Geschäftsleitung ends up with somebody editing the database |
| **Crockford's base32 for recovery codes** | The omitted glyphs *fold*: a typed `O` can only have meant `0`, so a correctly copied code is repaired rather than refused. Thirty-two symbols is also exactly five bits, so a masked byte picks one without the modulo bias a 30-symbol alphabet would need rejection sampling to avoid |
| **The QR code is geometry, not an image** | The server returns a `viewBox` size and one SVG path. No `dangerouslySetInnerHTML`, ~2 kB instead of ~12, and the page draws the quiet zone in its own tokens. One path rather than 841 rectangles |

### Security numbers

All seven are **invariants** in `mfa.rules.ts`, not settings, and `security.policy.ts` says
why: three are interoperability constraints (SHA-1, six digits, thirty seconds — an
authenticator showing a code the server rejects is indistinguishable from a broken
enrolment), one is a detector's tolerance (**±1 step**, so a code is live for at most
ninety seconds), and three are brute-force bounds (enrolment 10 min, challenge 5 min,
**five attempts per challenge**). Rate limits: ten a minute per IP on each of
`/auth/mfa/challenge`, `/auth/mfa/enroll/verify` and `/auth/reauthenticate`, which are
separate buckets from `/auth/login` because Nest keys a throttle per handler.

### Operational recovery

If `MFA_ENCRYPTION_KEY` is lost, enrolled users cannot complete a sign-in with their app —
the stored secrets cannot be read. **Their recovery codes still work**, because those are
hashed rather than encrypted, and anyone holding `user.resetMfa` can clear a credential.
Back the key up *with* the database, never in it. If the variable is absent entirely the
application still boots and MFA answers 503 naming it, which is the right direction for a
deployment that does not use the feature.

### Delivered

| | |
| --- | --- |
| Database | Four tables, two enums, `User.mfaSecret` **dropped**. Migration `20260920180304_mfa_totp` |
| API | `GET /auth/mfa`, `POST /auth/mfa/enroll`, `…/enroll/verify`, `…/disable`, `…/recovery-codes`, `POST /auth/mfa/challenge` (public), `POST /auth/reauthenticate`, `POST /users/:id/mfa/reset` |
| Permissions | `user.resetMfa` — 116 → **117**, enforced. `KNOWN_UNENFORCED` unchanged at 14 |
| Audit | Ten `auth.mfa_*` / `auth.reauth*` actions, direct `AuditService.record` like the rest of auth rather than domain events — these are things that happened to *nobody else*, which is the documented split. No secret, code or ciphertext appears in any of them |
| Frontend | `features/mfa/` on the five-layer pattern with two `lazy()` boundaries (12.5 kB + 2.1 kB + 4.2 kB shared), `OtpInput`/`RecoveryCodeInput` in `shared/ui/forms`, `ReauthenticationDialog` beside `ConfirmDialog` in `shared/ui/overlays` |
| Tests | +79 server unit (60 rules, 18 crypto, 15 DTO), +13 client, +23 e2e including an **independent RFC 4226/6238 implementation** in `e2e/totp.ts` checked against the published vectors, +9 security-matrix cells |

**Two defects were found by the e2e suite rather than by review**, and the second is the
one that mattered:

| | Found by | |
| --- | --- | --- |
| 1 | e2e, replay | The suite's own tests reused a TOTP code inside one time step and were refused. That is the replay guard working; the tests now track the spent step and wait only when they must. Worth recording because it is the behaviour an authenticator user will meet if they sign in twice in thirty seconds, and the screen says so |
| 2 | e2e, browser | **`invalidate()` unmounted the dialog holding the recovery codes.** The exact trap CLAUDE.md records from the settings workspace, arriving somewhere far more expensive: `MfaCard` renders a skeleton while it has no status and the wizard is its child, so invalidating the status key after enrolment would have destroyed **ten one-time codes that cannot be fetched again** before the reader could write them down. Every mutation in `useMfa.ts` now primes the known outcome instead, and the card carries a comment saying not to add one back |
| 3 | e2e, twice misdiagnosed | **A test that was not testing anything.** The browser journey timed out at six minutes and was twice read as "legitimately slow" — it does pay two throttled sign-ins and three TOTP step waits, so the story fitted. It was wrong: `page.goto` to a URL differing only in its **hash** is a same-document navigation, so after `clearCookies()` the SPA never rebooted, the session survived, no login form appeared, and the next `fill` waited for it until the clock ran out. The screenshot showed a healthy dashboard, which is the tell. **The browser sign-in through a second factor was never being exercised.** `page.reload()` in `signInAs` took it from six minutes timing out to sixty seconds passing. Recorded because the mistake was the response, not the bug: raising a timeout is what stops you finding the cause |

---

## Order of work

```
P0-1  settings validation            ← blocks everything
  └─ P1-1  Organisation + Offices    ← the module
       ├─ P1-2  settings workspace
       ├─ P1-3  system/storage/integrations panel
       └─ P1-4  mail test send
  └─ P1-5  security configuration
       └─ P2-9  active sessions        ← the screen half of P1-5, done
P2-2 notifications ✅ → P2-1 jobs → P2-3 publishing verbs → P2-4 SEO → P2-5 backup
P2-6 departments · P2-7 screen migration · P2-8 media
```

**Notifications went before jobs**, which is the reverse of the order above as it was
written, and the swap is worth recording because the dependency pointed the other way
from how it read. A jobs *screen* is an operator surface for a queue that already works;
notifications need the queue itself, which existed, and in return they gave the jobs
screen the one thing it was missing — `system.job_failed` now tells an operator that a
job died, so the screen they will build is somewhere to go rather than somewhere to
remember to look.

P2-9 is drawn under P1-5 rather than in the P2 chain because it is the same piece of work
seen from the other side: P1-5 made the security *numbers* answerable without a deploy,
and P2-9 made the security *state* visible and reversible without one. It needed no
migration and nothing in the P2 chain depends on it, which is why it could go first.

P1-1 comes before every P2 because five of them need somewhere to be configured, and
because the alternative is each inventing its own.

---

## What this pass delivered

**P0-1, P1-1, P1-2 and P1-4 in full; P1-3 apart from deployment identity.** Nothing was
marked done that is not wired to a reader — the three groups the brief asks for that this
system genuinely cannot serve (Notifications, Backup, Analytics/Maps) render as explicitly
not built rather than as empty forms.

| | |
| --- | --- |
| Database | `Organisation` (singleton, id `org`) and fifteen new columns on `Office`; `address` **renamed** to `street` rather than dropped, so the two existing rows kept their data. Migration `20260919000000_organisation_and_offices` |
| API | `/organisation` (GET, PATCH, versions), `/offices` (full CRUD + archive), `POST /settings/mail/test`, `GET /dashboard/system` |
| Permissions | `organisation` ×3 and `office` ×5 — 106 keys → 114, all eight enforced on a route. `KNOWN_UNENFORCED` is unchanged at 14. (P2-9 later took it to **116** with `user.readSessions` and `user.revokeSessions`, both enforced, the list still 14) |
| Events | `OrganisationUpdated`, `OfficeCreated/Updated/Archived/Restored/Deleted`, `MailTested` — 75 → 82, all audited through `AuditListener` |
| Single source of truth | The published document's `offices` is **injected from the `Office` table**; the `offices` content type is retired, its rows removed by the migration. The header phone, contact band, Standorte section and the `{telefonThun}` / `{standorte}` tokens all follow it, with no change to any site component |
| Frontend | `features/organisation/` on the five-layer pattern, `entities/organisation/`, and two new shared primitives (`SideNav`, `SaveBar`). The old one-page settings screen left `pages/Operations.tsx` |
| Tests | +126 server (settings rules 33, organisation rules 38, DTO 20, controller gate 22, metrics 13), +56 client, +14 e2e matrix cells, 2 behavioural e2e tests and a 6-test `organisation.spec.ts`. 1'890 unit tests, 0 lint errors, 34 warnings — one below the previous baseline |

**Seven defects were found by writing the tests rather than by reading the code**, and
three of them were in code that predates this work — a settings section is simply the
first screen in the dashboard that is a **form which stays open after saving**, and that
is the shape they were all hiding behind:

| | Found by | |
| --- | --- | --- |
| 1 | mapper test | `toOfficeCreateBody` trimmed every optional field and not `name`, `kind` or `country`. `city` is what the site's team filter groups by and what `crossCheck` compares at publish time, so a trailing space would have emptied the filter for everyone at that office *and* produced a warning naming a Standort that visibly exists. |
| 2 | axe, all widths | The System panel wrapped a full-width row in a `<div>` inside a `<dl>` — a `definition-list` violation. Fixed by giving the shared `Pair` a `className`, which is the better shape anyway. |
| 3 | live API probe | `VersioningService.conflict` templates `${label} wurde inzwischen geändert`, so a plural label produced "Die Unternehmensangaben **wurde**". |
| 4 | e2e, request count | **`SaveBar` fired the save twice.** The button was `type="submit"` *and* carried an `onClick`, so inside a form one click sent two `PATCH`es — and the second, with the now-stale `expectedVersion`, came back **409**. A save that had worked reported a conflict with itself. |
| 5 | e2e, pre-existing | **`useForm.dirty` never recomputed after a save.** The baseline was a `useRef` and `dirty` a `useMemo` over `[values]`, and a ref is invisible to a dependency array. Harmless in a dialog that closes on save; on a form that stays open it kept saying "Ungespeicherte Änderungen" over a written record and made the guard fire on a clean screen. The hook's own comment already claimed this worked. |
| 6 | e2e, pre-existing | **`invalidate()` takes the data off screen.** It zeroes `updatedAt`, and `useQuery` gates `data` on `updatedAt > 0` — so a key's own data reads `null` between invalidating and refetching, and a screen that renders a skeleton without data unmounts. `useQuery`'s comment promises the opposite. Worked around by priming the response the server already returned, and by narrowing each mutation's invalidation. |
| 7 | e2e, pre-existing | **The login-throttle ride-out could not finish.** `apiToken` answers a 429 by waiting 61 s; the global Playwright timeout was 45 s, so a spec authenticating in `beforeAll` reported a hung hook while the remedy was mid-sleep. Adding a seventh role account is what made the suite reach the limit at all. |

5, 6 and 7 are the interesting ones: each was latent, each is in shared infrastructure, and
none was reachable from any screen that existed before. They are written up where they live
— `useForm.ts`, `useOrganisation.ts` and `playwright.config.ts` — and CLAUDE.md records the
third occurrence of the throttle misdiagnosis.

**Verified against the running system**, not only in unit tests: every bad retention value
refused with the correct status (400 for a value, 404 for an unknown key, all-or-nothing on
a batch); the UID check digit refusing a correctly-shaped wrong number; the optimistic lock
refusing a replay; `administrator` writing the company but refused on the legal fields and
on `office.delete`; and the publish screen reporting "Standorte" as changed when an office
is edited and nothing when it is put back. The public stylesheet still hashes to
`globals-B1c5Zfq1.css`, which is the check that the locked brand design was not touched.

**State of the gates, stated exactly.** `npm run verify` is green: 0 lint errors, 34
warnings (one *below* the previous baseline of 35), 726 client and 1'164 server unit tests.
The browser suite was run per spec on the final code — `organisation` 6/6, `screens` and
`a11y` at all three widths in both themes, `security` 45/45, `budgets` 11/11, `project-edit`
10/10 — and each passed. The one *full* `npm run e2e` on the final code ended **318 passed,
6 failed**, and all six are the login throttle (P3-7 above) plus trace-artifact `ENOENT`
cascading from it; the dev servers were also killed for host memory pressure during that
run. No failure was an assertion about behaviour, and none has been dismissed as flaky
without a cause: the cause is named and is now a roadmap item.

The reasoning for each decision that was argued rather than inherited lives where it
applies — `server/src/core/organisation/organisation.rules.ts`,
`server/src/core/settings/settings.rules.ts` and `src/features/organisation/service.ts` —
in the same form the other modules use.
