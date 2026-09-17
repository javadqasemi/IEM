import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

export const REDACTED = "••••••••";

/**
 * The settings that ship with the install.
 *
 * Seeded rather than hardcoded so they are editable, but defined here so a
 * fresh database comes up configured rather than empty. `secret: true` marks
 * the values that are redacted in every read — see `SettingsService.list`.
 *
 * **`pending: true` marks a setting that nothing reads yet**, and it exists
 * because of what an audit of this file found: 24 of these 26 keys were stored,
 * shown in the dashboard as live controls, and consumed by no code anywhere.
 * `workflow.requireApproval` was the dangerous one — its own description says
 * switching it off lifts the four-eyes principle, so an operator could
 * reasonably believe they had switched it *on*. The SMTP block was the
 * confusing one: mail was configured from `server/.env`, so filling in this form
 * and finding mail still not sending gave no clue why.
 *
 * Most are now wired (see `pending` on the few that are not). For those that are
 * not, a flag is the honest answer rather than deletion: they are the shape of
 * features that are half-built — `security.requireMfaForAdmins` has columns and
 * a dependency but no enrolment flow — and the dashboard renders them as
 * explicitly not-yet-connected. That is the same choice the executive dashboard
 * makes with `KpiUnavailable`: a control that silently does nothing is worse
 * than one that says it does nothing.
 *
 * A setting stops being `pending` in the same commit that gives it a reader.
 */
export type SettingDef = {
  key: string;
  group: string;
  value: unknown;
  description: string;
  secret?: boolean;
  /** Stored and editable, but read by no code yet. Rendered as such. */
  pending?: boolean;
};

export const DEFAULT_SETTINGS: SettingDef[] = [
  {
    key: "company.name",
    group: "Unternehmen",
    value: "IEM AG",
    description: "Firmenname. Steht als Absendername in ausgehenden E-Mails, wenn kein eigener gesetzt ist.",
  },
  {
    key: "company.legalName",
    group: "Unternehmen",
    value: "IEM AG — Ingenieurbüro für Energie- und Messtechnik",
    description: "Vollständige Firmenbezeichnung",
    pending: true,
  },
  {
    key: "company.email",
    group: "Unternehmen",
    value: "info@iem.ch",
    description: "Allgemeine E-Mail",
    pending: true,
  },
  {
    key: "company.website",
    group: "Unternehmen",
    value: "https://www.iem.ch",
    description: "Website",
    pending: true,
  },

  { key: "brand.logoUrl", group: "Marke", value: "/img/logo.svg", description: "Logo", pending: true },
  {
    key: "brand.faviconUrl",
    group: "Marke",
    value: "/favicon.svg",
    description: "Favicon",
    pending: true,
  },
  {
    key: "brand.primaryColor",
    group: "Marke",
    value: "#003882",
    description: "Primärfarbe — dieselbe wie im Logo. Änderungen wirken nicht auf die Website-Tokens.",
    pending: true,
  },

  {
    key: "site.baseUrl",
    group: "Website",
    value: "https://www.iem.ch",
    description: "Basis-URL",
    pending: true,
  },
  {
    key: "site.defaultLocale",
    group: "Website",
    value: "de-CH",
    description: "Sprache",
    pending: true,
  },
  {
    key: "site.maintenanceMode",
    group: "Website",
    value: false,
    description: "Wartungsmodus — die Website liefert dann den letzten Snapshot ohne Aktualisierung.",
    pending: true,
  },

  {
    key: "mail.from",
    group: "E-Mail",
    value: "noreply@iem.ch",
    description: "Absenderadresse. Leer lassen, um MAIL_FROM aus der Umgebung zu verwenden.",
  },
  {
    key: "mail.fromName",
    group: "E-Mail",
    value: "IEM AG",
    description: "Absendername. Leer lassen, um den Firmennamen zu verwenden.",
  },
  {
    key: "mail.smtpHost",
    group: "E-Mail",
    value: "",
    description:
      "SMTP-Server. Leer lassen, um SMTP_HOST aus der Umgebung zu verwenden — ist beides leer, werden E-Mails nur protokolliert.",
  },
  { key: "mail.smtpPort", group: "E-Mail", value: 587, description: "SMTP-Port" },
  { key: "mail.smtpUser", group: "E-Mail", value: "", description: "SMTP-Benutzer" },
  { key: "mail.smtpPassword", group: "E-Mail", value: "", description: "SMTP-Passwort", secret: true },
  { key: "mail.smtpSecure", group: "E-Mail", value: false, description: "TLS ab Verbindungsaufbau" },

  {
    key: "applications.notifyEmail",
    group: "Bewerbungen",
    value: "info@iem.ch",
    description: "Wohin eine Benachrichtigung über neue Bewerbungen geht",
  },
  {
    key: "applications.retentionDays",
    group: "Bewerbungen",
    value: 180,
    description:
      "Nach wie vielen Tagen eine Bewerbung samt Dateien gelöscht wird. Personendaten — nicht unbegrenzt aufbewahren.",
  },
  {
    key: "applications.maxFileBytes",
    group: "Bewerbungen",
    value: 10 * 1024 * 1024,
    description:
      "Grösse pro Datei. Die harte Obergrenze von 10 MB steht im Upload-Filter und kann hier nur unterschritten werden.",
  },

  {
    key: "security.sessionTimeoutMinutes",
    group: "Sicherheit",
    value: 15,
    description:
      "Gültigkeit des Zugriffstokens. Gilt ab der nächsten Anmeldung oder Token-Erneuerung; 1 bis 240 Minuten.",
  },
  {
    key: "security.requireMfaForAdmins",
    group: "Sicherheit",
    value: false,
    description: "Zwei-Faktor-Pflicht für Administratoren",
    // The columns (`User.mfaSecret`, `User.mfaEnabled`), the `otpauth`
    // dependency and this switch all exist; the enrolment and verification flow
    // does not. Enforcing a requirement nobody can satisfy would lock every
    // administrator out, so this stays inert and says so until that flow lands.
    pending: true,
  },
  {
    key: "security.allowedOrigins",
    group: "Sicherheit",
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
    value: true,
    description:
      "Vier-Augen-Prinzip: Einreichende dürfen ihre eigenen Änderungen nicht selbst freigeben. Ausschalten hebt das auf.",
  },
  {
    key: "workflow.autoPublishApproved",
    group: "Freigabe",
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

/** Code-side definition by key — what `list` reads `pending` from. */
const DEFS_BY_KEY = new Map(DEFAULT_SETTINGS.map((d) => [d.key, d]));

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * All settings, grouped.
   *
   * Secret values never leave as plaintext — they come back as a fixed mask,
   * with `hasValue` saying whether one is set. The dashboard shows "gesetzt"
   * or "nicht gesetzt" and writing an unchanged mask back is a no-op, so
   * saving the SMTP form without retyping the password does not blank it.
   */
  async list(canSeeSecrets: boolean) {
    const rows = await this.prisma.setting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
    const groups = new Map<string, unknown[]>();

    for (const row of rows) {
      const masked =
        row.secret && !canSeeSecrets
          ? { ...row, value: row.value ? REDACTED : "", hasValue: Boolean(row.value) }
          : { ...row, hasValue: Boolean(row.value) };
      const list = groups.get(row.group) ?? [];
      // `pending` is a property of the code, not of the row — whether a setting
      // has a reader is decided by what imports it, so it is carried by
      // `DEFAULT_SETTINGS` and joined on here rather than stored in a column
      // that would go stale the moment a consumer was written.
      list.push({ ...masked, pending: DEFS_BY_KEY.get(row.key)?.pending ?? false });
      groups.set(row.group, list);
    }

    return [...groups.entries()].map(([group, settings]) => ({ group, settings }));
  }

  /** Raw read for internal callers — never routed to a controller. */
  async value<T = unknown>(key: string, fallback?: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as T) ?? (fallback as T);
  }

  /**
   * Several settings in one read.
   *
   * A consumer that needs a whole group — mail needs seven — should not make
   * seven round trips for it. Returns a plain lookup so a caller can destructure
   * what it wants and fall back per key.
   */
  async values(keys: string[]): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
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

  /** A number setting, clamped. Out-of-range or non-numeric falls back. */
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

  async update(
    updates: { key: string; value: unknown }[],
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const keys = updates.map((u) => u.key);
    const before = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(before.map((b) => [b.key, b]));

    const applied: { key: string; value: unknown }[] = [];
    for (const update of updates) {
      const existing = byKey.get(update.key);
      if (!existing) throw new NotFoundException(`Unbekannte Einstellung „${update.key}“.`);
      // Writing the mask back means "leave it alone" — see `list`.
      if (existing.secret && update.value === REDACTED) continue;
      /**
       * An absent value is refused rather than written.
       *
       * Prisma reads `undefined` as "do not touch this column", so an update
       * that lost its value on the way in used to sail through: a 200, an audit
       * row claiming the setting had changed, and no change. That is exactly
       * what happened while the DTO's `value` carried no decorator and the
       * global `whitelist: true` pipe stripped it.
       *
       * The decorator is the fix; this is the check that makes the *next*
       * version of that mistake loud instead of silent, wherever it comes from.
       */
      if (update.value === undefined) {
        throw new BadRequestException(
          `Für „${update.key}“ wurde kein Wert übermittelt.`,
        );
      }
      applied.push(update);
    }

    await this.prisma.$transaction(
      applied.map((u) =>
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
      // The audit scrubber removes the values of secret keys; listing only the
      // keys here keeps the log useful without repeating that responsibility.
      after: { keys: applied.map((a) => a.key) },
      message: `${applied.length} Einstellung(en)`,
      ...ctx,
    });

    return this.list(false);
  }
}
