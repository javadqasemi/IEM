/**
 * The shapes the organisation service takes and returns.
 *
 * Plain types, declared here rather than in `organisation/organisation.dto.ts`,
 * because of where the two halves of this module live. The **service** is in
 * `core/` — `MailService` and `ContentService` both inject it, and CLAUDE.md's
 * rule is that a service with more than one caller belongs in `core/` before
 * the second caller appears rather than after. The **controller and its
 * class-validator DTOs** are in the feature folder, where the routes are.
 *
 * So `core` cannot import the DTO classes without importing a feature, and the
 * DTO classes satisfy these structurally instead. It is the same arrangement
 * `SettingsService.update` uses: it takes `{ key, value }[]` and
 * `UpdateSettingsDto` happens to be one.
 */

/** Everything an `organisation.update` caller may write. */
export type OrganisationGeneralInput = {
  name?: string;
  shortName?: string;
  description?: string | null;
  foundedYear?: number | null;
  organisationType?: string;
  defaultLocale?: string;
  defaultTimezone?: string;
  defaultCurrency?: string;
  status?: "ACTIVE" | "DORMANT" | "LIQUIDATION";

  mainEmail?: string | null;
  mainPhone?: string | null;
  recruitmentEmail?: string | null;
  supportEmail?: string | null;
  billingEmail?: string | null;
  website?: string | null;

  seoTitlePattern?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
  faviconUrl?: string | null;
};

/** Everything that additionally needs `organisation.updateLegal`. */
export type OrganisationLegalInput = {
  legalName?: string | null;
  legalForm?: string | null;
  uid?: string | null;
  vatId?: string | null;
  commercialRegister?: string | null;
  registerOffice?: string | null;
  legalStreet?: string | null;
  legalZip?: string | null;
  legalCity?: string | null;
  legalCountry?: string;
  invoiceAddress?: string | null;
  legalContactName?: string | null;
  legalContactEmail?: string | null;
  dataProtectionContactName?: string | null;
  dataProtectionContactEmail?: string | null;
  copyright?: string | null;
  legalNotice?: string | null;
};

export type OrganisationInput = OrganisationGeneralInput &
  OrganisationLegalInput & {
    /** The optimistic lock. Required — see the note on `UpdateOrganisationDto`. */
    expectedVersion: number;
  };

/**
 * The legal fields, as a list.
 *
 * Used twice and both uses need it to be exactly right: the controller decides
 * whether a request needs `organisation.updateLegal` by asking whether it
 * touches any of these, and the mapper uses the same list to build the update.
 * Derived from neither `Prisma` nor the DTO class, because both would make the
 * permission boundary depend on something that changes for unrelated reasons.
 */
export const LEGAL_FIELDS = [
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
] as const;

export const GENERAL_FIELDS = [
  "name",
  "shortName",
  "description",
  "foundedYear",
  "organisationType",
  "defaultLocale",
  "defaultTimezone",
  "defaultCurrency",
  "status",
  "mainEmail",
  "mainPhone",
  "recruitmentEmail",
  "supportEmail",
  "billingEmail",
  "website",
  "seoTitlePattern",
  "seoDescription",
  "ogImageUrl",
  "faviconUrl",
] as const;

export type OfficeInput = {
  name?: string;
  kind?: string;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  canton?: string | null;
  country?: string;
  phone?: string | null;
  email?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mapsUrl?: string | null;
  openingHours?: string | null;
  isHeadquarters?: boolean;
  isPublic?: boolean;
  position?: number;
};

export type CreateOfficeInput = OfficeInput & { name: string };
export type UpdateOfficeInput = OfficeInput & { expectedVersion: number };

export const OFFICE_FIELDS = [
  "name",
  "kind",
  "street",
  "zip",
  "city",
  "canton",
  "country",
  "phone",
  "email",
  "latitude",
  "longitude",
  "mapsUrl",
  "openingHours",
  "isHeadquarters",
  "isPublic",
  "position",
] as const;
