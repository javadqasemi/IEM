/**
 * The firm's own record: what may be stored, and what may be done to a
 * Standort.
 *
 * Pure — no Prisma, no Nest, no dates read from the clock. That is the part of
 * the Projects reference worth copying rather than the folder names: a rules
 * file that touches nothing can be tested exhaustively, and these are rules
 * that have to be, because their failures are quiet. An office archived while
 * it is the firm's only public one does not throw; it makes the *next publish*
 * fail with "offices is empty", two screens and possibly two days away from the
 * click that caused it.
 */

/* ================================================================== */
/* Swiss identifiers                                                   */
/* ================================================================== */

const UID_SHAPE = /^CHE-(\d{3})\.(\d{3})\.(\d{3})$/;
/** `CHE-123.456.789 MWST` — and the French and Italian spellings. */
const VAT_SHAPE = /^CHE-(\d{3})\.(\d{3})\.(\d{3})\s+(MWST|TVA|IVA)$/;

/**
 * The UID's check digit.
 *
 * Weights 5·4·3·2·7·6·5·4 over the first eight digits, modulo 11. Implemented
 * rather than pattern-matched because the pattern is the easy half: `CHE-
 * 123.456.789` is the shape of a UID and is not one, and a wrong UID on an
 * invoice is a wrong UID everywhere it is copied to afterwards. A remainder of
 * 1 has no valid check digit at all, which is why the function has three
 * outcomes and not two.
 *
 * IEM's own number, `CHE-107.625.851`, is the fixture in the test — the
 * algorithm is worth nothing if it rejects the company it was written for.
 */
const UID_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4];

export function uidCheckDigit(eightDigits: string): number | null {
  if (!/^\d{8}$/.test(eightDigits)) return null;
  const sum = [...eightDigits].reduce(
    (total, digit, index) => total + Number(digit) * UID_WEIGHTS[index],
    0,
  );
  const remainder = sum % 11;
  if (remainder === 1) return null;
  return remainder === 0 ? 0 : 11 - remainder;
}

function refuseSwissNumber(value: string, shape: RegExp, label: string): string | null {
  const match = shape.exec(value.trim());
  if (!match) {
    return `${label} muss die Form CHE-123.456.789${shape === VAT_SHAPE ? " MWST" : ""} haben.`;
  }
  const digits = `${match[1]}${match[2]}${match[3]}`;
  const expected = uidCheckDigit(digits.slice(0, 8));
  if (expected === null || expected !== Number(digits[8])) {
    return `${label} hat eine falsche Prüfziffer — bitte die Nummer im UID-Register nachschlagen.`;
  }
  return null;
}

/** Blank is allowed: a firm may not have entered its UID yet. */
export function refuseUid(uid: string | null | undefined): string | null {
  if (!uid || !uid.trim()) return null;
  return refuseSwissNumber(uid, UID_SHAPE, "Die UID");
}

export function refuseVatId(vatId: string | null | undefined): string | null {
  if (!vatId || !vatId.trim()) return null;
  return refuseSwissNumber(vatId, VAT_SHAPE, "Die MWST-Nummer");
}

/**
 * The UID and the VAT number are the same number wearing a suffix.
 *
 * Checked because they are entered in two fields and copied from two
 * documents, and a firm whose Impressum and whose invoices disagree about its
 * own identifier looks exactly as careless as it would be. A **warning rather
 * than a refusal**: the day a company genuinely has one and not the other, or
 * is mid-change, refusing the save would make the correct data impossible to
 * enter.
 */
export function uidMismatchWarning(
  uid: string | null | undefined,
  vatId: string | null | undefined,
): string | null {
  if (!uid?.trim() || !vatId?.trim()) return null;
  const base = vatId.trim().replace(/\s+(MWST|TVA|IVA)$/, "");
  return base === uid.trim()
    ? null
    : `UID (${uid.trim()}) und MWST-Nummer (${base}) sind verschiedene Nummern — normalerweise sind sie dieselbe.`;
}

/* ================================================================== */
/* Offices                                                             */
/* ================================================================== */

export type OfficeFacts = {
  id: string;
  name: string;
  isHeadquarters: boolean;
  isPublic: boolean;
  archivedAt: Date | null;
};

/** What points at an office, and therefore what a deletion would orphan. */
export type OfficeReferences = {
  employees: number;
  projects: number;
  buildings: number;
};

export const OFFICE_KINDS = ["Hauptsitz", "Zweigbüro", "Aussenstelle", "Baustellenbüro"];

/**
 * Whether this office may be archived.
 *
 * Two refusals, and they guard different things.
 *
 * **The headquarters** is where the firm legally sits. Archiving it would leave
 * the register with no `isHeadquarters` row, so `Impressum` and every future
 * letterhead would have nothing to print — and the repair is to promote another
 * office *first*, which the message says outright rather than leaving the
 * reader to work out.
 *
 * **The last public office** is the quiet one. `assertComplete` refuses a
 * publish whose `offices` array is empty, so archiving the only remaining
 * public office does not fail here — it fails at the next publish, for somebody
 * else, with a message about a content key. Catching it at the click is the
 * whole value.
 */
export function refuseArchiveOffice(office: OfficeFacts, all: OfficeFacts[]): string | null {
  if (office.archivedAt) return `„${office.name}“ ist bereits archiviert.`;
  if (office.isHeadquarters) {
    return (
      `„${office.name}“ ist der Hauptsitz und kann nicht archiviert werden. ` +
      `Bitte zuerst einen anderen Standort als Hauptsitz festlegen.`
    );
  }
  const remainingPublic = all.filter(
    (o) => o.id !== office.id && o.isPublic && !o.archivedAt,
  );
  if (office.isPublic && remainingPublic.length === 0) {
    return (
      `„${office.name}“ ist der letzte öffentliche Standort. Ohne ihn hat die Website keinen ` +
      `Standort mehr und die nächste Veröffentlichung würde abbrechen.`
    );
  }
  return null;
}

/**
 * Whether this office may be deleted outright.
 *
 * Deletion is for a row created by mistake, and everything else is archiving —
 * the same split Projects makes. So the rule is not "are you sure" but "does
 * anything point at this": an office with employees on it is part of the
 * firm's history, and a soft delete that hid it would leave every one of those
 * records rendering a blank where a Standort should be.
 */
export function refuseDeleteOffice(
  office: OfficeFacts,
  references: OfficeReferences,
  all: OfficeFacts[],
): string | null {
  const pointing = [
    references.employees && `${references.employees} Mitarbeitende`,
    references.projects && `${references.projects} Projekte`,
    references.buildings && `${references.buildings} Gebäude`,
  ].filter(Boolean) as string[];

  if (pointing.length) {
    return (
      `„${office.name}“ kann nicht gelöscht werden: ${pointing.join(", ")} verweisen darauf. ` +
      `Ein geschlossener Standort wird archiviert, nicht gelöscht.`
    );
  }
  if (office.isHeadquarters) {
    return `„${office.name}“ ist der Hauptsitz und kann nicht gelöscht werden.`;
  }
  const others = all.filter((o) => o.id !== office.id && !o.archivedAt);
  if (others.length === 0) {
    return `„${office.name}“ ist der einzige Standort und kann nicht gelöscht werden.`;
  }
  return null;
}

/**
 * Whether this office may become — or stop being — the headquarters.
 *
 * Promotion needs no permission beyond `office.update` and no rule: the caller
 * says which office is the seat and the repository demotes the others in the
 * same transaction. What *is* refused is the other direction, because it has no
 * replacement: clearing the flag on the only headquarters leaves none, and
 * "which office is the registered seat" then has no answer.
 */
export function refuseHeadquartersChange(
  office: OfficeFacts,
  next: boolean,
  all: OfficeFacts[],
): string | null {
  if (next === office.isHeadquarters) return null;
  if (next) {
    return office.archivedAt
      ? `„${office.name}“ ist archiviert und kann nicht Hauptsitz werden.`
      : null;
  }
  const otherHq = all.some((o) => o.id !== office.id && o.isHeadquarters && !o.archivedAt);
  return otherHq
    ? null
    : `Es muss genau einen Hauptsitz geben. Bitte stattdessen einen anderen Standort als Hauptsitz festlegen.`;
}

/* ================================================================== */
/* What the website reads                                              */
/* ================================================================== */

/**
 * An office as the published document carries it.
 *
 * `src/content/schema.ts` → `OfficeEntry`, and the shape is the site's rather
 * than the table's: `zip` there means **"PLZ und Ort"** — `3600 Thun`, one
 * line, because that is how a Swiss address is printed — while `city` is the
 * bare name the team filter groups by. Deriving both from two columns is why
 * the table can hold them separately without the site having to change.
 */
export type SiteOffice = {
  city: string;
  street: string;
  zip: string;
  phone: string;
  phoneHref: string;
  kind: string;
};

/**
 * `+41 33 227 40 20` → `tel:+41332274020`.
 *
 * Derived rather than stored, which retires a field the CMS used to ask an
 * editor to type by hand with the help text *"Form: tel:+41332274020"*. Two
 * fields holding one fact, maintained by a human, is the duplication this whole
 * module exists to remove — and the failure was silent: a mistyped link dials
 * the wrong number and the page looks perfect.
 */
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  // A national number becomes international: the site is read on phones abroad.
  if (cleaned.startsWith("+")) return `tel:${cleaned}`;
  if (cleaned.startsWith("00")) return `tel:+${cleaned.slice(2)}`;
  if (cleaned.startsWith("0")) return `tel:+41${cleaned.slice(1)}`;
  return `tel:${cleaned}`;
}

export function toSiteOffice(office: {
  city: string | null;
  street: string | null;
  zip: string | null;
  phone: string | null;
  kind: string;
}): SiteOffice {
  const city = office.city ?? "";
  const zip = office.zip ?? "";
  return {
    city,
    street: office.street ?? "",
    // `3600 Thun`, and just the city when there is no postcode yet — an
    // address line reading " Thun" with a leading space is the sort of thing
    // that reaches production because nobody reads a space.
    zip: [zip, city].filter(Boolean).join(" "),
    phone: office.phone ?? "",
    phoneHref: office.phone ? telHref(office.phone) : "",
    kind: office.kind,
  };
}

/**
 * Whether these offices can produce a publishable `offices` array.
 *
 * `assertComplete` already refuses an empty one, but it does so at the end of
 * the publish with a message naming a content key. This is the same check
 * asked *early*, so the publish screen can say which Standort is incomplete
 * while there is still somebody looking at it who can fix it.
 */
export function officeWarnings(offices: SiteOffice[]): string[] {
  const warnings: string[] = [];
  if (offices.length === 0) {
    warnings.push(
      "Kein öffentlicher Standort: Die Website hätte keine Adresse und keine Telefonnummer.",
    );
    return warnings;
  }
  for (const office of offices) {
    const missing = [
      !office.city && "Ort",
      !office.street && "Strasse",
      !office.phone && "Telefon",
    ].filter(Boolean) as string[];
    if (missing.length) {
      warnings.push(
        `Standort „${office.city || office.kind}“: ${missing.join(", ")} fehlt — ` +
          `die Angabe bleibt auf der Website leer.`,
      );
    }
  }
  return warnings;
}
