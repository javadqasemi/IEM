import { Injectable, NotFoundException } from "@nestjs/common";
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
 */
export const DEFAULT_SETTINGS: {
  key: string;
  group: string;
  value: unknown;
  description: string;
  secret?: boolean;
}[] = [
  { key: "company.name", group: "Unternehmen", value: "IEM AG", description: "Firmenname" },
  {
    key: "company.legalName",
    group: "Unternehmen",
    value: "IEM AG — Ingenieurbüro für Energie- und Messtechnik",
    description: "Vollständige Firmenbezeichnung",
  },
  { key: "company.email", group: "Unternehmen", value: "info@iem.ch", description: "Allgemeine E-Mail" },
  { key: "company.website", group: "Unternehmen", value: "https://www.iem.ch", description: "Website" },

  { key: "brand.logoUrl", group: "Marke", value: "/img/logo.svg", description: "Logo" },
  { key: "brand.faviconUrl", group: "Marke", value: "/favicon.svg", description: "Favicon" },
  {
    key: "brand.primaryColor",
    group: "Marke",
    value: "#003882",
    description: "Primärfarbe — dieselbe wie im Logo. Änderungen wirken nicht auf die Website-Tokens.",
  },

  { key: "site.baseUrl", group: "Website", value: "https://www.iem.ch", description: "Basis-URL" },
  { key: "site.defaultLocale", group: "Website", value: "de-CH", description: "Sprache" },
  {
    key: "site.maintenanceMode",
    group: "Website",
    value: false,
    description: "Wartungsmodus — die Website liefert dann den letzten Snapshot ohne Aktualisierung.",
  },

  { key: "mail.from", group: "E-Mail", value: "noreply@iem.ch", description: "Absenderadresse" },
  { key: "mail.fromName", group: "E-Mail", value: "IEM AG", description: "Absendername" },
  { key: "mail.smtpHost", group: "E-Mail", value: "", description: "SMTP-Server" },
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
    description: "Grösse pro Datei",
  },

  {
    key: "security.sessionTimeoutMinutes",
    group: "Sicherheit",
    value: 15,
    description: "Gültigkeit des Zugriffstokens",
  },
  {
    key: "security.requireMfaForAdmins",
    group: "Sicherheit",
    value: false,
    description: "Zwei-Faktor-Pflicht für Administratoren",
  },
  {
    key: "security.allowedOrigins",
    group: "Sicherheit",
    value: [],
    description: "Zusätzliche erlaubte Herkünfte für die API",
  },

  {
    key: "workflow.requireApproval",
    group: "Freigabe",
    value: true,
    description:
      "Ob Inhalte eine Freigabe durchlaufen müssen. Ausschalten hebt den Vier-Augen-Grundsatz auf.",
  },
  {
    key: "workflow.autoPublishApproved",
    group: "Freigabe",
    value: false,
    description: "Freigegebene Inhalte sofort veröffentlichen, ohne zweiten Schritt",
  },
];

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
      list.push(masked);
      groups.set(row.group, list);
    }

    return [...groups.entries()].map(([group, settings]) => ({ group, settings }));
  }

  /** Raw read for internal callers — never routed to a controller. */
  async value<T = unknown>(key: string, fallback?: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as T) ?? (fallback as T);
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
