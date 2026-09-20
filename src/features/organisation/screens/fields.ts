import type { Organisation } from "@/entities/organisation";
import { ORGANISATION_STATUS_OPTIONS } from "@/entities/organisation";

/**
 * How each column of the organisation record is drawn.
 *
 * One table rather than four hand-written forms, and the reason is the same
 * one that makes the navigation data: four sections of the workspace edit
 * different subsets of **one record**, so a field described once and picked by
 * name cannot end up with a different label, a different control or a missing
 * hint depending on which section a reader found it in.
 *
 * It also makes the permission split cheap: the legal section names its
 * fields, the controller gates exactly those keys, and the two lists are the
 * same list — `organisation.types.ts`'s `LEGAL_FIELDS` on the server and
 * `SETTINGS_SECTIONS` here. `organisation.dto.test.ts` asserts the server's
 * pair agree; a field that appears in neither section simply is not editable,
 * which is a visible absence rather than a silent one.
 */

export type OrgFieldType = "text" | "textarea" | "number" | "email" | "url" | "tel" | "select";

export type OrgFieldDef = {
  label: string;
  type: OrgFieldType;
  /** The sentence under the input. Not a placeholder — see the note below. */
  hint?: string;
  options?: { value: string; label: string }[];
  /** Two per row on a wide screen unless the content wants the width. */
  full?: boolean;
  /** `inputMode`/`autocomplete` hints for a phone or a postcode. */
  autoComplete?: string;
};

/*
  **Hints, not placeholders.**

  A placeholder disappears the moment somebody types, which is exactly when
  they are trying to follow it, and grey-on-white placeholder text is the most
  common contrast failure in any form. Where an example genuinely helps —
  `CHE-123.456.789` — it is in the hint, where it stays put and is measured by
  axe like any other text.
*/
export const ORGANISATION_FIELDS: Record<string, OrgFieldDef> = {
  /* ---- General ---------------------------------------------------- */
  name: {
    label: "Firmenname",
    type: "text",
    hint: "Wie die Firma auftritt. Steht als Absendername in ausgehenden E-Mails, wenn dort keiner gesetzt ist.",
  },
  shortName: { label: "Kürzel", type: "text", hint: "Für enge Stellen — Listen, Titelblätter." },
  description: {
    label: "Beschreibung",
    type: "textarea",
    full: true,
    hint: "Ein bis zwei Sätze. Wird noch nirgends veröffentlicht; die Website-Texte stehen unter „Website bearbeiten“.",
  },
  foundedYear: { label: "Gründungsjahr", type: "number" },
  organisationType: {
    label: "Organisationsform",
    type: "text",
    hint: "Aktiengesellschaft, GmbH, Einzelfirma …",
  },
  status: { label: "Status", type: "select", options: ORGANISATION_STATUS_OPTIONS },
  defaultLocale: {
    label: "Sprache und Region",
    type: "text",
    hint: "BCP-47, z. B. de-CH. Bestimmt Datums- und Zahlenformate.",
  },
  defaultTimezone: {
    label: "Zeitzone",
    type: "text",
    hint: "IANA-Name, z. B. Europe/Zurich.",
  },
  defaultCurrency: { label: "Währung", type: "text", hint: "Drei Buchstaben, z. B. CHF." },

  /* ---- Legal ------------------------------------------------------- */
  legalName: {
    label: "Vollständige Firmenbezeichnung",
    type: "text",
    full: true,
    hint: "Wie im Handelsregister eingetragen, falls abweichend vom Firmennamen.",
  },
  legalForm: { label: "Rechtsform", type: "text" },
  uid: {
    label: "UID",
    type: "text",
    hint: "Form CHE-123.456.789. Die Prüfziffer wird beim Speichern geprüft.",
  },
  vatId: {
    label: "MWST-Nummer",
    type: "text",
    hint: "Dieselbe Nummer mit dem Zusatz MWST.",
  },
  commercialRegister: {
    label: "Handelsregister-Nummer",
    type: "text",
    hint: "Die Nummer im kantonalen Register.",
  },
  registerOffice: { label: "Registerort", type: "text", hint: "Der Kanton oder das Amt." },
  legalStreet: { label: "Strasse (Sitz)", type: "text" },
  legalZip: { label: "PLZ (Sitz)", type: "text", autoComplete: "postal-code" },
  legalCity: { label: "Ort (Sitz)", type: "text" },
  legalCountry: { label: "Land", type: "text", hint: "Zwei Buchstaben, z. B. CH." },
  invoiceAddress: {
    label: "Rechnungsadresse",
    type: "textarea",
    full: true,
    hint: "Freitext — eine Rechnungsadresse ist oft eine Abteilung und ein Postfach, keine zweite Anschrift.",
  },
  legalContactName: { label: "Rechtlicher Kontakt", type: "text" },
  legalContactEmail: { label: "E-Mail rechtlicher Kontakt", type: "email" },
  dataProtectionContactName: {
    label: "Datenschutzkontakt",
    type: "text",
    hint: "Meist dieselbe Person wie der rechtliche Kontakt — getrennt geführt für den Tag, an dem sie es nicht ist.",
  },
  dataProtectionContactEmail: { label: "E-Mail Datenschutz", type: "email" },
  copyright: {
    label: "Copyright-Zeile",
    type: "text",
    full: true,
    hint: "Der Fussbereich der Website führt seine eigene Zeile unter „Website bearbeiten“; diese hier ist für Dokumente.",
  },
  legalNotice: {
    label: "Rechtlicher Hinweis",
    type: "textarea",
    full: true,
    hint: "Haftungsausschluss oder Ähnliches. Noch nicht veröffentlicht — siehe docs/ENTERPRISE_ROADMAP.md, P3-1.",
  },

  /* ---- Contact ----------------------------------------------------- */
  mainEmail: { label: "Haupt-E-Mail", type: "email" },
  mainPhone: { label: "Haupttelefon", type: "tel", autoComplete: "tel" },
  recruitmentEmail: {
    label: "Bewerbungen",
    type: "email",
    hint: "Die Adresse auf der Karriereseite. Die Meldung über einen Eingang geht separat an die Adresse unter „Bewerbungen“.",
  },
  supportEmail: { label: "Support", type: "email" },
  billingEmail: { label: "Rechnungen", type: "email" },
  website: { label: "Website", type: "url", hint: "Mit https://." },

  /* ---- Website defaults -------------------------------------------- */
  seoTitlePattern: {
    label: "Titelmuster",
    type: "text",
    full: true,
    hint: "Rückfallwert, z. B. „{seite} — IEM AG“. Der Inhaltstyp „SEO“ bleibt massgeblich.",
  },
  seoDescription: {
    label: "Standard-Beschreibung",
    type: "textarea",
    full: true,
    hint: "Greift, wo unter „SEO“ nichts steht.",
  },
  ogImageUrl: { label: "Vorschaubild", type: "text", full: true, hint: "Pfad oder URL." },
  faviconUrl: { label: "Favicon", type: "text", full: true, hint: "Pfad oder URL." },
};

/** The value as the control wants it: never `null`, never a number in a text box. */
export function fieldValue(record: Organisation, name: string): string {
  const value = record[name as keyof Organisation];
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * The typed value to store, from what the control produced.
 *
 * An emptied field becomes `null` rather than `""` — "present and blank" reads
 * on screen exactly like unset and sorts differently in every query after it.
 * The two fields that may not be null (`name`, `shortName`) are the ones the
 * validator refuses empty, so they never reach this branch with a blank.
 */
export function parseFieldValue(
  name: string,
  raw: string,
): string | number | null {
  const def = ORGANISATION_FIELDS[name];
  const trimmed = raw;
  if (def?.type === "number") {
    if (trimmed.trim() === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (name === "name" || name === "shortName" || name === "organisationType") return trimmed;
  if (name === "defaultLocale" || name === "defaultTimezone" || name === "defaultCurrency") {
    return trimmed;
  }
  if (name === "legalCountry") return trimmed;
  if (name === "status") return trimmed;
  return trimmed === "" ? null : trimmed;
}
