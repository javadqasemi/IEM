import type { FieldErrors } from "@/shared/ui/forms";
import type { Office, Organisation, Setting, SettingGroup } from "@/entities/organisation";

/**
 * The workspace's rules, as pure functions.
 *
 * Same argument the server's `organisation.rules.ts` makes: everything here
 * can be wrong, none of it renders, and a rule reachable only through
 * `useState` is a rule nobody tests. The hooks and screens hold no logic of
 * their own beyond wiring these together.
 */

/* ================================================================== */
/* The sections                                                        */
/* ================================================================== */

/**
 * What a section draws from.
 *
 * Three kinds, because the workspace genuinely has three: the organisation
 * record, the offices register, and the key/value settings store. Folding them
 * into one shape would mean either pretending the settings are columns or
 * pretending the columns are settings, and both were tried — the second is
 * exactly what this work replaced.
 */
export type SectionSource =
  | { kind: "organisation"; fields: readonly (keyof Organisation)[] }
  | { kind: "offices" }
  /**
   * A group of settings, rendered from their declarations.
   *
   * `panel` asks for a supplied component *below* the form — the same
   * `embedded` map, used additively rather than instead of. Introduced for
   * E-Mail (P2-4), whose section is a form and an operations panel, and the
   * shape Backup and Integrations will want for the same reason.
   */
  | { kind: "settings"; groups: readonly string[]; panel?: boolean }
  | { kind: "system" }
  /**
   * A section another feature owns, composed in from above.
   *
   * The fifth kind, added for Benachrichtigungen (P2-3), and it exists
   * because of an arrow this workspace may not draw: `features/organisation`
   * must not import `features/notifications`, and
   * `src/architecture.test.ts` enforces it. So the workspace declares that a
   * slot exists and `admin/pages/SettingsPage.tsx` — the only layer above
   * both — supplies what goes in it. The same arrangement `ProjectDetail`
   * uses for its embedded module tabs, and the same reason.
   *
   * A slug nothing supplies falls back to the not-built placeholder, so the
   * next module to claim a section is one import and one line in that file,
   * with nothing here changing.
   */
  | { kind: "embedded"; reason: string }
  | { kind: "placeholder"; reason: string };

export type SettingsSection = {
  /** The URL segment: `/einstellungen/standorte`. */
  slug: string;
  label: string;
  /** The heading it sits under in the sub-navigation. `null` for the first. */
  zone: string | null;
  title: string;
  description: string;
  /** Holding **any one** opens the section, matching the route table's rule. */
  permissions: string[];
  source: SectionSource;
};

/**
 * Two blocks: what the firm *is*, and how the system *runs*.
 *
 * The split is the reader's, not the database's. "Where are our offices" and
 * "what is our UID" are questions about the company and are answered by
 * whoever runs the office; "how does mail get out" and "how long do sessions
 * last" are questions about the installation and are answered by whoever runs
 * it. They were one undifferentiated list of seven cards before, in
 * alphabetical order by group name, so `Bewerbungen` came before `Sicherheit`
 * and `Unternehmen` came last.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    slug: "unternehmen",
    label: "Allgemein",
    zone: null,
    title: "Allgemeine Angaben",
    description:
      "Name, Beschreibung und die Vorgaben, die überall gelten — Sprache, Zeitzone, Währung.",
    permissions: ["organisation.read"],
    source: {
      kind: "organisation",
      fields: [
        "name",
        "shortName",
        "description",
        "foundedYear",
        "organisationType",
        "status",
        "defaultLocale",
        "defaultTimezone",
        "defaultCurrency",
      ],
    },
  },
  {
    slug: "rechtliches",
    label: "Recht und Identität",
    zone: null,
    title: "Rechtliche Angaben",
    description:
      "Was im Handelsregister steht und im Impressum erscheint. Änderungen hier brauchen eine eigene Berechtigung.",
    permissions: ["organisation.read"],
    source: {
      kind: "organisation",
      fields: [
        "legalName",
        "legalForm",
        "uid",
        "vatId",
        "commercialRegister",
        "registerOffice",
        "legalStreet",
        "legalZip",
        "legalCity",
        "legalCountry",
        "invoiceAddress",
        "legalContactName",
        "legalContactEmail",
        "dataProtectionContactName",
        "dataProtectionContactEmail",
        "copyright",
        "legalNotice",
      ],
    },
  },
  {
    slug: "standorte",
    label: "Standorte",
    zone: null,
    title: "Standorte",
    description:
      "Die Büros. Öffentliche Standorte erscheinen mit der nächsten Veröffentlichung auf der Website — im Kopf, im Kontaktfeld und im Abschnitt Standorte.",
    permissions: ["office.read"],
    source: { kind: "offices" },
  },
  {
    slug: "kontakt",
    label: "Kontakt",
    zone: null,
    title: "Kontakt und Kommunikation",
    description:
      "Die zentralen Adressen. Die Website liest hieraus, statt jede Adresse an ihrer eigenen Stelle zu führen.",
    permissions: ["organisation.read"],
    source: {
      kind: "organisation",
      fields: [
        "mainEmail",
        "mainPhone",
        "recruitmentEmail",
        "supportEmail",
        "billingEmail",
        "website",
      ],
    },
  },
  {
    slug: "website",
    label: "Website-Vorgaben",
    zone: null,
    title: "Website-Vorgaben",
    description:
      "Rückfallwerte für Titel, Beschreibung und Vorschaubild. Der Inhaltstyp „SEO“ bleibt massgeblich — diese Werte greifen, wo dort nichts steht.",
    permissions: ["organisation.read"],
    source: {
      kind: "organisation",
      fields: ["seoTitlePattern", "seoDescription", "ogImageUrl", "faviconUrl"],
    },
  },

  {
    slug: "email",
    label: "E-Mail",
    zone: "Betrieb",
    title: "E-Mail-Versand",
    description:
      "Zugang, Absender, Diagnose und Zustellprotokoll. Leere Felder fallen auf die Umgebungsvariablen zurück; ist auch dort nichts gesetzt, werden E-Mails nur protokolliert.",
    permissions: ["settings.read"],
    /**
     * A settings group **and** a panel beside it (P2-4).
     *
     * It was `kind: "settings"` alone until Email Operations, and neither
     * half of the pair would have been right on its own:
     *
     * - The generic renderer draws the form from the declarations in
     *   `core/settings/settings.service.ts`, which is what keeps adding a mail
     *   setting a one-line change and keeps the save bar, the dirty guard and
     *   the validation identical to every other settings group. Replacing it
     *   with a hand-written form would have been a second implementation of
     *   all four.
     * - But a status verdict, two distinct diagnostics and a template
     *   catalogue are not settings, and no declaration can express them.
     *
     * So `panel: true` asks the workspace to render the supplied component
     * *underneath* the form. `SettingsPage.tsx` supplies it, for the reason
     * that file exists: `features/organisation` may not import
     * `features/mail`.
     */
    source: { kind: "settings", groups: ["E-Mail"], panel: true },
  },
  /**
   * Sicherung — the **configuration** half (P2-5).
   *
   * A settings group plus a panel, the arrangement E-Mail introduced: the form
   * is rendered from the declarations in `core/settings/settings.service.ts`,
   * so adding a backup setting stays a one-line change and the save bar, the
   * dirty guard and the validation are the same as every other group. The
   * panel underneath shows what those numbers *mean* — when the next run is,
   * what retention would delete — which no declaration can express.
   *
   * `system.backup`, not `settings.read`: whoever configures backups is an
   * operator, and the key that opens the operations screen is the one that
   * should open its settings. The history and the restore live at
   * `/sicherungen` and deliberately not here.
   */
  {
    slug: "sicherung",
    label: "Sicherung",
    zone: "Betrieb",
    title: "Sicherung und Wiederherstellung",
    description:
      "Wann automatisch gesichert wird, wie lange Sicherungen aufbewahrt werden und wohin sie geschrieben werden. Verlauf und Einspielen stehen unter „Sicherungen“.",
    permissions: ["system.backup"],
    source: { kind: "settings", groups: ["Sicherung"], panel: true },
  },
  {
    slug: "bewerbungen",
    label: "Bewerbungen",
    zone: "Betrieb",
    title: "Bewerbungen",
    description:
      "Wohin Eingänge gemeldet werden, wie gross eine Datei sein darf und wie lange Unterlagen aufbewahrt werden.",
    permissions: ["settings.read"],
    source: { kind: "settings", groups: ["Bewerbungen"] },
  },
  {
    slug: "freigabe",
    label: "Freigabe",
    zone: "Betrieb",
    title: "Freigabe und Veröffentlichung",
    description: "Das Vier-Augen-Prinzip und was nach einer Freigabe geschieht.",
    permissions: ["settings.read"],
    source: { kind: "settings", groups: ["Freigabe", "Website"] },
  },
  {
    slug: "sicherheit",
    label: "Sicherheit",
    zone: "Betrieb",
    title: "Sicherheit",
    description:
      "Sitzungsdauer und Zugriffsvorgaben. Sperrschwelle und Passwortlänge stehen noch im Code — siehe docs/ENTERPRISE_ROADMAP.md, P1-5.",
    permissions: ["settings.read"],
    source: { kind: "settings", groups: ["Sicherheit"] },
  },
  {
    slug: "benachrichtigungen",
    label: "Benachrichtigungen",
    zone: "Betrieb",
    title: "Benachrichtigungen",
    description:
      "Welche Ereignisse eine Meldung auslösen und wer sie erhält. Persönliche Einstellungen — ob Sie selbst eine E-Mail möchten — stehen unter „Benachrichtigungen“ im Hauptmenü.",
    /**
     * `notification.configure`, not `settings.read`.
     *
     * Deciding which events reach whom is governance, and somebody who may
     * read the SMTP host is not thereby somebody who may switch a
     * notification off. `notification.readDeliveries` opens it too, because
     * the delivery log lives in the same section and is a separate
     * authority — a role holding one of the two sees one half.
     */
    permissions: ["notification.configure", "notification.readDeliveries"],
    source: {
      kind: "embedded",
      reason:
        "Der Abschnitt „Benachrichtigungen“ konnte nicht geladen werden. " +
        "Das ist ein Fehler in der Zusammensetzung der Einstellungen, nicht in Ihren Rechten.",
    },
  },
  {
    slug: "system",
    label: "System",
    zone: "Betrieb",
    title: "System",
    description:
      "Laufzeit, Datenbank, Migrationen, Warteschlange, Ablage und Integrationen. Nur lesend.",
    permissions: ["system.health"],
    source: { kind: "system" },
  },
];

export const DEFAULT_SECTION = SETTINGS_SECTIONS[0].slug;

export function sectionFor(slug: string | undefined): SettingsSection | null {
  if (!slug) return SETTINGS_SECTIONS[0];
  return SETTINGS_SECTIONS.find((section) => section.slug === slug) ?? null;
}

/**
 * The sections this user may open.
 *
 * A courtesy, like every other permission check on the client — the server's
 * 403 is the control. What it buys is a sub-navigation that does not offer
 * eleven rows of which four answer "kein Zugriff".
 */
export function visibleSections(
  can: (permission: string) => boolean,
): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) =>
    section.permissions.length === 0
      ? true
      : section.permissions.some((permission) => can(permission)),
  );
}

/** The sub-navigation's groups, in declaration order, zones preserved. */
export function sectionGroups(sections: SettingsSection[]) {
  const groups: { id: string; label: string | null; items: SettingsSection[] }[] = [];
  for (const section of sections) {
    const id = section.zone ?? "firm";
    const last = groups[groups.length - 1];
    if (last && last.id === id) last.items.push(section);
    else groups.push({ id, label: section.zone, items: [section] });
  }
  return groups;
}

/* ================================================================== */
/* Validation                                                          */
/* ================================================================== */

/**
 * `CHE-123.456.789` — the **shape only**.
 *
 * The check digit is verified on the server (`organisation.rules.ts`,
 * modulo 11) and deliberately **not** reimplemented here. Two copies of an
 * arithmetic rule drift, and the one that drifts is the copy nobody runs
 * against real data.
 *
 * Shape is different: it is the common typo, it is worth catching before a
 * round trip, and the two rules cannot disagree because this one is strictly
 * weaker — anything the server accepts passes here.
 */
const UID_SHAPE = /^CHE-\d{3}\.\d{3}\.\d{3}$/;
const VAT_SHAPE = /^CHE-\d{3}\.\d{3}\.\d{3}\s+(MWST|TVA|IVA)$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateOrganisation(values: Organisation): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.name.trim()) errors.name = ["Der Firmenname darf nicht leer sein."];
  if (!values.shortName.trim()) errors.shortName = ["Das Kürzel darf nicht leer sein."];

  if (values.uid?.trim() && !UID_SHAPE.test(values.uid.trim())) {
    errors.uid = ["Erwartet wird die Form CHE-123.456.789."];
  }
  if (values.vatId?.trim() && !VAT_SHAPE.test(values.vatId.trim())) {
    errors.vatId = ["Erwartet wird die Form CHE-123.456.789 MWST."];
  }

  for (const field of [
    "mainEmail",
    "recruitmentEmail",
    "supportEmail",
    "billingEmail",
    "legalContactEmail",
    "dataProtectionContactEmail",
  ] as const) {
    const value = values[field]?.trim();
    if (value && !EMAIL_SHAPE.test(value)) errors[field] = ["Keine gültige E-Mail-Adresse."];
  }

  const website = values.website?.trim();
  if (website && !/^https?:\/\//.test(website)) {
    errors.website = ["Die Adresse muss mit http:// oder https:// beginnen."];
  }

  if (values.foundedYear !== null) {
    const year = values.foundedYear;
    if (!Number.isInteger(year) || year < 1800 || year > 2100) {
      errors.foundedYear = ["Bitte ein Jahr zwischen 1800 und 2100 angeben."];
    }
  }

  if (values.defaultCurrency.trim().length !== 3) {
    errors.defaultCurrency = ["Drei Buchstaben, z. B. CHF."];
  }

  return errors;
}

export function validateOffice(values: Office | (Omit<Office, "id" | "version"> & object)): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = ["Der Name darf nicht leer sein."];
  if (values.email?.trim() && !EMAIL_SHAPE.test(values.email.trim())) {
    errors.email = ["Keine gültige E-Mail-Adresse."];
  }
  if (values.country.trim().length !== 2) {
    errors.country = ["Zwei Buchstaben, z. B. CH."];
  }
  /*
    Coordinates are optional and come in pairs.

    Half a coordinate is not a location, and the failure is silent — a map
    link built from a latitude and an empty longitude points at the Gulf of
    Guinea rather than at Thun.
  */
  const hasLat = values.latitude !== null;
  const hasLng = values.longitude !== null;
  if (hasLat !== hasLng) {
    const missing = hasLat ? "longitude" : "latitude";
    errors[missing] = ["Koordinaten brauchen beide Werte oder keinen."];
  }
  return errors;
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

/** The declared settings of the groups a section names, in declaration order. */
export function settingsFor(groups: SettingGroup[], names: readonly string[]): Setting[] {
  return names.flatMap((name) => groups.find((group) => group.group === name)?.settings ?? []);
}

/**
 * Which of the pending edits need confirming before they are saved.
 *
 * The list of *which* settings matter is the **server's** (`DANGEROUS_SETTINGS`
 * travels on each row as `dangerous`), so the screen cannot fall out of step
 * with it. What lives here is the question the screen asks: given these edits,
 * what has to be said out loud first.
 *
 * A setting only counts when its value has actually moved. Confirming a
 * dangerous setting that the reader opened and left alone teaches them to
 * click through the dialog, which is the failure mode of every confirmation
 * that fires too often.
 */
export function dangerousEdits(
  settings: Setting[],
  edits: Record<string, unknown>,
): { key: string; label: string; warning: string }[] {
  return settings
    .filter((setting) => setting.dangerous && setting.key in edits)
    .filter((setting) => !sameValue(setting.value, edits[setting.key]))
    .map((setting) => ({
      key: setting.key,
      label: setting.label,
      warning: setting.dangerous!,
    }));
}

/**
 * Whether an edited value differs from the stored one.
 *
 * `JSON.stringify` rather than `===` because a `stringList` is an array, and
 * two arrays with the same three origins in them are not a change. Key order
 * cannot matter here — a setting is a scalar or a list of strings, never an
 * object — so the recursive canonicalisation `useForm` needs is unnecessary.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The edits that actually differ from what is stored. */
export function pendingSettingUpdates(
  settings: Setting[],
  edits: Record<string, unknown>,
): { key: string; value: unknown }[] {
  return Object.entries(edits)
    .filter(([key, value]) => {
      const setting = settings.find((s) => s.key === key);
      if (!setting) return false;
      return !sameValue(setting.value, value);
    })
    .map(([key, value]) => ({ key, value }));
}

/**
 * The offices the public website will show, in the order it will show them.
 *
 * Mirrors `toSiteOffices` on the server so the register can say so on screen.
 * Duplicating the predicate is the trade, and it is a small one: it is two
 * boolean checks and a sort, the server's copy is the one that decides, and
 * the alternative — asking the API what the site would show — is a round trip
 * to learn something the rows already say.
 */
export function publicOffices(offices: Office[]): Office[] {
  return offices
    .filter((office) => office.isPublic && !office.archivedAt)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "de-CH"));
}
