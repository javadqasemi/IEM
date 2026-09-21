import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../../common/decorators";
import { REDACTED, planSettingUpdates, type SettingDef } from "./settings.rules";
import { SecretSettingsService } from "./settings.secrets";

type Ctx = { ip?: string | null; userAgent?: string | null };

export { REDACTED };
export type { SettingDef };

/**
 * The settings that ship with the install.
 *
 * Seeded rather than hardcoded so they are editable, but defined here so a
 * fresh database comes up configured rather than empty.
 *
 * **Every entry declares a `type`**, and that is new. Types are what
 * `settings.rules.ts` validates against on write and what the dashboard renders
 * from; before them the field type was *inferred from the stored value*, which
 * meant a setting could not be rendered correctly until it already held the
 * right kind of value. See the note at the top of `settings.rules.ts` for the
 * data-loss path that made it urgent.
 *
 * **`pending: true` marks a setting that nothing reads yet.** A flag is the
 * honest answer rather than deletion: they are the shape of features that are
 * half-built — `security.requireMfaForAdmins` is the last one, and since P3-2
 * it is half-built in the *other* direction, because the second factor now
 * works and only the compulsion is missing — and the dashboard renders them as
 * explicitly not-yet-connected. That is the same choice the executive dashboard makes with
 * `KpiUnavailable`: a control that silently does nothing is worse than one that
 * says it does nothing. A setting stops being `pending` in the same commit that
 * gives it a reader.
 *
 * **Nine keys left this list** when the firm became an entity: `company.name`,
 * `company.legalName`, `company.email`, `company.website`, the three `brand.*`
 * and two `site.*`. Eight of them were `pending`, and all nine are now typed,
 * validated, versioned and audited **columns** on `Organisation` — a place
 * where "the company's e-mail address" is a field rather than a JSON blob under
 * a string key. `brand.primaryColor` is the one that was not merely moved but
 * **removed**: the IEM palette is defined in `tailwind.config.ts` and
 * `admin.css`, and a settings field that appeared to change it while changing
 * nothing was a promise the system must not make.
 */
export const DEFAULT_SETTINGS: SettingDef[] = [
  {
    key: "site.maintenanceMode",
    group: "Website",
    type: "boolean",
    value: false,
    description: "Wartungsmodus — die Website liefert dann den letzten Snapshot ohne Aktualisierung.",
    pending: true,
  },

  {
    key: "mail.from",
    group: "E-Mail",
    type: "email",
    value: "noreply@iem.ch",
    description: "Absenderadresse",
    blankMeans: "MAIL_FROM aus der Umgebung",
  },
  {
    key: "mail.fromName",
    group: "E-Mail",
    type: "string",
    value: "IEM AG",
    description: "Absendername",
    blankMeans: "der Firmenname aus den Unternehmensangaben",
  },
  {
    key: "mail.smtpHost",
    group: "E-Mail",
    type: "string",
    value: "",
    description: "SMTP-Server",
    blankMeans: "SMTP_HOST aus der Umgebung — ist beides leer, werden E-Mails nur protokolliert",
  },
  {
    key: "mail.smtpPort",
    group: "E-Mail",
    type: "number",
    value: 587,
    description: "SMTP-Port",
    min: 1,
    max: 65535,
  },
  {
    key: "mail.smtpUser",
    group: "E-Mail",
    type: "string",
    value: "",
    description: "SMTP-Benutzer",
    blankMeans: "SMTP_USER aus der Umgebung",
  },
  {
    key: "mail.smtpPassword",
    group: "E-Mail",
    type: "string",
    value: "",
    description: "SMTP-Passwort",
    secret: true,
    blankMeans: "SMTP_PASSWORD aus der Umgebung",
  },
  {
    key: "mail.smtpSecure",
    group: "E-Mail",
    type: "boolean",
    value: false,
    description: "TLS ab Verbindungsaufbau",
  },
  {
    key: "mail.replyTo",
    group: "E-Mail",
    type: "email",
    value: "",
    description: "Antwortadresse (Reply-To)",
    blankMeans: "keine — Antworten gehen an die Absenderadresse",
  },
  {
    key: "mail.timeoutSeconds",
    group: "E-Mail",
    type: "number",
    value: 10,
    description: "Zeitlimit für Verbindung und Versand",
    unit: "Sekunden",
    /*
      Bounded, because an unbounded timeout is the setting that makes mail look
      broken rather than slow: a `0` gives up before the handshake and a very
      large one leaves a durable job occupying a worker while a firewall drops
      packets in silence. `settings.rules.test.ts` fails an unbounded number.
    */
    min: 1,
    max: 120,
  },

  /*
    `applications.notifyEmail` stood here and is **retired** (P2-3).

    It was a single address — `info@iem.ch` by default — that
    `ApplicationsService` mailed directly when a dossier arrived. Two things
    were wrong with it and both are the reason the notification platform
    exists: it was a hardcoded recipient in a business service, and it was a
    shared mailbox rather than a person, so nobody's preference applied to it
    and nothing recorded whether it arrived.

    Who hears about a new application is now a **permission** —
    `application.read` — resolved centrally, so the recipients follow the role
    editor instead of a text field somebody has to remember to update when
    HR changes. The e-mail still goes out by default, which is the part that
    had to stay true on the day this shipped.

    The row is not deleted by a migration: the seeder reports an orphaned
    setting rather than dropping it, which is the documented behaviour and
    leaves the old value visible to anybody wondering where it went.
  */
  {
    /**
     * The P0.
     *
     * `min: 30` is not a style choice. Below it the purge starts deleting
     * dossiers a recruiter has not finished reading, and at `0` it deletes them
     * the same night. The upper bound is ten years, which is longer than any
     * retention an applicant would expect and short enough to stay a number
     * rather than a synonym for "forever".
     */
    key: "applications.retentionDays",
    group: "Bewerbungen",
    type: "number",
    value: 180,
    description: "Aufbewahrungsfrist für Bewerbungen",
    unit: "Tage",
    min: 30,
    max: 3650,
  },
  {
    key: "applications.maxFileBytes",
    group: "Bewerbungen",
    type: "number",
    value: 10 * 1024 * 1024,
    description: "Grösse pro Datei",
    unit: "Bytes",
    min: 64 * 1024,
    max: 10 * 1024 * 1024,
  },

  {
    key: "security.sessionTimeoutMinutes",
    group: "Sicherheit",
    type: "number",
    value: 15,
    description: "Gültigkeit des Zugriffstokens",
    unit: "Minuten",
    min: 1,
    max: 240,
  },
  /*
    The lockout and password numbers, which used to be constants in
    `auth.rules.ts`.

    Bounded here **and** clamped again on read in `security.policy.ts`. That
    is not belt and braces for its own sake: validation guards the API, and
    the clamp guards every other way a row can come to hold a number — a
    migration, a hand-edit, a release before the bound existed. The lower end
    of each is the security-relevant one, and `passwordMinLength` cannot be
    set below the invariant floor of twelve however it is written.
  */
  {
    key: "security.maxFailedLogins",
    group: "Sicherheit",
    type: "number",
    value: 5,
    description: "Fehlversuche bis zur Sperrung",
    unit: "Versuche",
    min: 3,
    max: 10,
  },
  {
    key: "security.lockoutMinutes",
    group: "Sicherheit",
    type: "number",
    value: 15,
    description: "Dauer der Sperrung nach zu vielen Fehlversuchen",
    unit: "Minuten",
    min: 5,
    max: 1440,
  },
  {
    key: "security.passwordMinLength",
    group: "Sicherheit",
    type: "number",
    value: 12,
    description: "Mindestlänge für Passwörter",
    unit: "Zeichen",
    // Twelve is the floor and not merely the default: `resolvePasswordPolicy`
    // clamps up to it, so a lower value cannot take effect even if one
    // reaches the table by another route.
    min: 12,
    max: 128,
  },
  {
    key: "security.requireMfaForAdmins",
    group: "Sicherheit",
    type: "boolean",
    value: false,
    description: "Zwei-Faktor-Pflicht für Administratoren",
    /*
      Still `pending`, and the reason has changed — which is worth writing
      down, because the old one no longer applies and a reader would assume
      it does.

      It used to say the enrolment flow did not exist, so enforcing this
      would lock every administrator out. **The flow exists** (P3-2):
      `/auth/mfa/enroll`, a real TOTP sign-in, recovery codes, a self-service
      disable and an administrative reset. `User.mfaSecret`, which this
      comment used to name, is gone.

      What is missing is the *enforcement*, and it is a screen rather than a
      check. Making this true means refusing a session to somebody who has
      not enrolled, which needs a **forced-enrolment flow at sign-in**: a
      screen that appears instead of the dashboard, cannot be skipped, and
      survives a broken authenticator without locking the firm out of its own
      system. Shipping the switch before that flow would produce a row saying
      "MFA is required" while everybody without it carries on signing in — a
      security property an operator can read, believe, and not have, which is
      exactly what `auth/security.policy.ts` sorts its four categories to
      prevent.

      So it stays inert and says so. `docs/ENTERPRISE_ROADMAP.md` → P3-2b.
    */
    pending: true,
  },
  {
    key: "security.allowedOrigins",
    group: "Sicherheit",
    type: "stringList",
    value: [],
    description: "Zusätzliche erlaubte Herkünfte für die API",
    // CORS is resolved once at bootstrap from `CORS_ORIGINS`. Making it dynamic
    // means a database read on every preflight, and getting it wrong locks the
    // dashboard out of its own API — a change worth making deliberately rather
    // than as part of a settings sweep.
    pending: true,
  },

  {
    key: "workflow.requireApproval",
    group: "Freigabe",
    type: "boolean",
    value: true,
    description:
      "Vier-Augen-Prinzip: Einreichende dürfen ihre eigenen Änderungen nicht selbst freigeben",
  },
  {
    key: "workflow.autoPublishApproved",
    group: "Freigabe",
    type: "boolean",
    value: false,
    description: "Freigegebene Inhalte sofort veröffentlichen, ohne zweiten Schritt",
    // Publishing is atomic and site-wide: it freezes *every* approved entry and
    // writes one snapshot. Firing that from an approval would let one person's
    // decision publish someone else's unrelated approved work, and it would run
    // as an approver who may not hold `content.publish` at all. That needs a
    // per-entry publish path before it can mean what its label says.
    pending: true,
  },
];

/** Code-side definition by key — what `list` and `update` read. */
const DEFS_BY_KEY = new Map(DEFAULT_SETTINGS.map((d) => [d.key, d]));

/**
 * Settings whose change weakens a control rather than configuring one.
 *
 * The dashboard confirms these before saving, with the consequence spelled out.
 * Held here rather than in the screen because the *server* is where the list of
 * things that matter belongs — a second copy in the client would be the one
 * that goes out of date, and it would go out of date silently.
 */
export const DANGEROUS_SETTINGS: Record<string, string> = {
  "workflow.requireApproval":
    "Ausgeschaltet darf jede einreichende Person ihre eigenen Änderungen selbst freigeben. " +
    "Das Vier-Augen-Prinzip entfällt für die gesamte Website.",
  "applications.retentionDays":
    "Eine kürzere Frist löscht bestehende Bewerbungen beim nächsten nächtlichen Lauf — " +
    "samt Dateien, unwiderruflich.",
  "security.sessionTimeoutMinutes":
    "Eine längere Gültigkeit bedeutet, dass ein entwendetes Zugriffstoken entsprechend " +
    "länger brauchbar bleibt.",
  "security.maxFailedLogins":
    "Mehr Versuche bedeuten mehr Spielraum zum Erraten eines Passworts. Die Sperrung ist " +
    "die einzige Bremse gegen automatisiertes Durchprobieren.",
  "security.lockoutMinutes":
    "Eine kürzere Sperrung lässt Angreifer schneller weiterprobieren; eine sehr lange " +
    "sperrt Mitarbeitende aus, die sich nur vertippt haben.",
  "security.passwordMinLength":
    "Eine kürzere Vorgabe wirkt nur auf neue Passwörter — bestehende bleiben gültig. " +
    "Unter zwölf Zeichen ist sie ohnehin nicht wirksam.",
};

/**
 * The keys whose values are credentials, from the declarations themselves.
 *
 * Derived rather than listed, so adding `secret: true` to a declaration is the
 * only step needed to route a new value through the cipher. A second hand-kept
 * list is how the next integration's API key ends up in the clear.
 */
export const SECRET_SETTING_KEYS = DEFAULT_SETTINGS.filter((d) => d.secret).map((d) => d.key);

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly secrets: SecretSettingsService,
  ) {}

  /**
   * Seal anything still in the clear, then say so if anything is unreadable.
   *
   * In that order, and the order matters: the migration is what turns a
   * plaintext row into an envelope, so running the check first would report a
   * deployment as healthy and then immediately create the rows it was looking
   * for. Both are cheap — one indexed read over a handful of keys — and both
   * happen before the first request, which is the only time a credential is
   * guaranteed not to be half-written.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.secrets.migrateLegacyPlaintext(SECRET_SETTING_KEYS);
      await this.secrets.warnIfUnreadable(SECRET_SETTING_KEYS);
    } catch (err) {
      // A database that is not up yet must not stop the process: the migration
      // is idempotent and the next boot does it. Logged so a permanent failure
      // is not mistaken for a deployment that never had a secret.
      this.logger.warn(
        `Verschlüsselung der geheimen Einstellungen übersprungen: ${(err as Error).message}`,
      );
    }
  }

  /**
   * All settings, grouped, with the declaration each is rendered from.
   *
   * **A secret never leaves as plaintext, for anybody** (P2-4). It used to be
   * masked only when the caller lacked `settings.secrets`; that permission now
   * means *manage* rather than *read*, and there is no branch here that
   * returns the value — because an API that can be asked for a credential is
   * one screenshot, one proxy log or one over-broad role away from handing it
   * out. `canManageSecrets` therefore decides whether the field is *editable*,
   * not whether it is visible, and it travels back so the form can draw the
   * replace and remove controls rather than offering them and meeting a 403.
   *
   * `configured` is what the dashboard renders as "gesetzt" / "nicht gesetzt".
   * Writing the mask back — or writing nothing at all — is a no-op, so saving
   * the SMTP form without retyping the password cannot blank it.
   *
   * A row in the database that this code no longer declares is **skipped**
   * rather than shown. The seeder reports orphans instead of deleting them, so
   * a retired key survives a deploy; rendering it would put a control on the
   * page that nothing reads and that `update` would refuse.
   */
  async list(canManageSecrets: boolean) {
    const rows = await this.prisma.setting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
    const groups = new Map<string, unknown[]>();

    for (const row of rows) {
      const def = DEFS_BY_KEY.get(row.key);
      if (!def) continue;

      /*
        `configured` is computed from the stored value, never from decrypting
        it. A row holding an envelope is configured even on a deployment whose
        key has gone missing — which is true, and is why
        `SecretSettingsService.warnIfUnreadable` exists to say the other half
        out loud rather than letting this line imply mail is working.
      */
      const configured = typeof row.value === "string" ? row.value !== "" : Boolean(row.value);
      const masked = def.secret
        ? { value: configured ? REDACTED : "", hasValue: configured }
        : { value: row.value, hasValue: Boolean(row.value) };

      const list = groups.get(row.group) ?? [];
      list.push({
        key: row.key,
        group: row.group,
        description: row.description,
        secret: row.secret,
        updatedAt: row.updatedAt,
        ...masked,
        /**
         * Whether this caller may replace or remove this credential.
         *
         * Only meaningful on a secret, and `false` on everything else so a
         * screen can read one property rather than two. It is a courtesy —
         * `removeSecret` and the `settings.secrets` guard are the control.
         */
        canManage: def.secret ? canManageSecrets : false,
        /** `true` once a value is stored, whether or not it can be decrypted. */
        configured: def.secret ? configured : undefined,
        // Everything below is a property of the *code*, not of the row: whether
        // a setting has a reader, and what shape it may hold, are decided by
        // what imports it. Storing them in columns would go stale the moment a
        // consumer was written.
        type: def.type,
        pending: def.pending ?? false,
        min: def.min,
        max: def.max,
        options: def.options,
        unit: def.unit,
        blankMeans: def.blankMeans,
        dangerous: DANGEROUS_SETTINGS[row.key],
      });
      groups.set(row.group, list);
    }

    return [...groups.entries()].map(([group, settings]) => ({ group, settings }));
  }

  /**
   * Raw read for internal callers — never routed to a controller.
   *
   * A secret comes back **decrypted**, which is the point of the seam: the one
   * consumer that genuinely needs the SMTP password asks for it by key and
   * gets a string, and does not learn that there is a cipher. An unreadable
   * secret comes back as the fallback rather than throwing — see `reveal`.
   */
  async value<T = unknown>(key: string, fallback?: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row) return fallback as T;
    if (DEFS_BY_KEY.get(key)?.secret) {
      return ((this.secrets.reveal(row.value, key) ?? undefined) as T) ?? (fallback as T);
    }
    return (row.value as T) ?? (fallback as T);
  }

  /**
   * Several settings in one read.
   *
   * A consumer that needs a whole group — mail needs seven — should not make
   * seven round trips for it. Returns a plain lookup so a caller can destructure
   * what it wants and fall back per key.
   *
   * Secrets are decrypted here too, and this is the method `MailService` uses.
   * An unreadable one is **omitted from the result** rather than present as
   * `null`: the caller's fallback chain already treats a missing key as "not
   * configured, use the environment", and that is exactly the right behaviour
   * for a password that cannot be decrypted.
   */
  async values(keys: string[]): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      if (DEFS_BY_KEY.get(row.key)?.secret) {
        const plaintext = this.secrets.reveal(row.value, row.key);
        if (plaintext !== null) out[row.key] = plaintext;
        continue;
      }
      out[row.key] = row.value;
    }
    return out;
  }

  /**
   * A string setting, or the fallback when it is unset or blank.
   *
   * Blank counts as unset on purpose: every text setting here is one an operator
   * can clear to mean "use the environment value instead", and an empty SMTP
   * host that overrode a configured one would be a trap.
   */
  async text(key: string, fallback: string): Promise<string> {
    const value = await this.value<unknown>(key);
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  /**
   * A number setting, clamped. Out-of-range or non-numeric falls back.
   *
   * **Use this rather than `value<number>()` for anything arithmetic**, even
   * now that writes are validated. Validation stops a bad value being stored
   * through the API; it does not stop one that is already in the table from a
   * release before the type existed, or one written by a migration, or one
   * typed straight into the database. The clamp is the reader's own guard and
   * it costs nothing.
   */
  async number(key: string, fallback: number, min: number, max: number): Promise<number> {
    const value = await this.value<unknown>(key);
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** A boolean setting. Anything that is not a real boolean falls back. */
  async flag(key: string, fallback: boolean): Promise<boolean> {
    const value = await this.value<unknown>(key);
    return typeof value === "boolean" ? value : fallback;
  }

  /**
   * Writes a batch, or refuses the whole batch.
   *
   * All-or-nothing on purpose. A settings form saves several fields at once and
   * a partial write leaves the operator looking at a screen where some of their
   * changes took and some did not, with no indication which — the worst
   * possible feedback for a configuration page. `planSettingUpdates` sorts the
   * batch first, so the refusal names every problem rather than the first.
   */
  async update(updates: { key: string; value: unknown }[], actor: AuthUser, ctx: Ctx) {
    const plan = planSettingUpdates(DEFS_BY_KEY, updates);

    if (plan.unknown.length) {
      throw new NotFoundException(
        `Unbekannte Einstellung(en): ${plan.unknown.map((k) => `„${k}“`).join(", ")}.`,
      );
    }
    if (plan.errors.length) {
      /*
        The refusal is audited as a denial rather than only returned.

        Someone repeatedly trying to push the retention period to zero is a
        thing an operator should be able to see afterwards, and a 400 that
        exists only in a browser's network tab is not evidence of anything.
      */
      this.audit.record({
        actor,
        action: "settings.rejected",
        resource: "setting",
        outcome: "FAILURE",
        after: { keys: updates.map((u) => u.key) },
        message: plan.errors.join(" "),
        ...ctx,
      });
      throw new BadRequestException(plan.errors.join(" "));
    }

    /*
      Secrets are sealed *before* the transaction opens.

      `seal` throws a 503 when no key is configured, and doing that inside the
      transaction would roll back the ordinary settings beside it — so an
      operator saving the mail form on a server with no
      `APP_SECRETS_ENCRYPTION_KEY` would lose the host and the port as well as
      the password, with one error message mentioning neither.
    */
    const sealed = plan.secrets.map((s) => ({ key: s.key, value: this.secrets.seal(s.plaintext) }));

    await this.prisma.$transaction(
      [...plan.apply, ...sealed].map((u) =>
        this.prisma.setting.update({
          where: { key: u.key },
          data: { value: u.value as Prisma.InputJsonValue, updatedById: actor.id },
        }),
      ),
    );

    this.audit.record({
      actor,
      action: "settings.updated",
      resource: "setting",
      /*
        Keys, never values — and for a secret that is not merely the audit
        scrubber's job being duplicated, it is the only reason this is safe.
        `plan.secrets` holds plaintext credentials; naming the keys records
        that the SMTP password was replaced, which is the auditable fact, while
        the value itself never enters the log at any level.
      */
      after: {
        keys: plan.apply.map((a) => a.key),
        secretsReplaced: sealed.map((s) => s.key),
      },
      message: `${plan.apply.length + sealed.length} Einstellung(en)`,
      ...ctx,
    });

    return this.list(canManageSecrets(actor));
  }

  /**
   * Clears a stored credential, deliberately, on its own.
   *
   * **Not reachable through `update`.** The whole argument of
   * `classifySecretWrite` is that no spelling of a blank field may destroy a
   * working credential, which leaves removal needing somewhere else to live —
   * a route of its own, behind `settings.secrets`, behind a confirmation, and
   * audited as its own action rather than folded into "3 Einstellung(en)".
   *
   * Idempotent: removing a secret that is already empty is a success, because
   * the caller's intent — "there must be no credential stored here" — is
   * satisfied either way, and a 404 would send somebody looking for a row that
   * is in exactly the state they asked for.
   */
  async removeSecret(key: string, actor: AuthUser, ctx: Ctx) {
    const def = DEFS_BY_KEY.get(key);
    if (!def) throw new NotFoundException(`Unbekannte Einstellung „${key}“.`);
    if (!def.secret) {
      throw new BadRequestException(
        `„${def.description || key}“ ist kein geheimer Wert und wird über die normalen Einstellungen geändert.`,
      );
    }

    await this.prisma.setting.update({
      where: { key },
      data: { value: "", updatedById: actor.id },
    });

    this.audit.record({
      actor,
      action: "settings.secret_removed",
      resource: "setting",
      resourceId: key,
      after: { key },
      message: `Geheimer Wert „${def.description || key}“ entfernt.`,
      ...ctx,
    });

    return this.list(true);
  }
}

/**
 * Whether this caller may manage credentials.
 *
 * One spelling of the check, shared by the controller and by the value
 * `update` hands back — two copies would eventually disagree about Super
 * Admin, which short-circuits on the role key rather than on holding every
 * permission.
 */
export function canManageSecrets(user: AuthUser): boolean {
  return user.isSuperAdmin || user.permissions.has("settings.secrets");
}
