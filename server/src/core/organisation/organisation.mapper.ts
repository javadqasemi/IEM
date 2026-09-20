import type { Prisma } from "@prisma/client";
import { toSiteOffice, type SiteOffice } from "./organisation.rules";
import {
  GENERAL_FIELDS,
  LEGAL_FIELDS,
  OFFICE_FIELDS,
  type OrganisationInput,
  type CreateOfficeInput,
  type UpdateOfficeInput,
} from "./organisation.types";

/**
 * Rows in, API shapes out — and the only file besides the repository that names
 * a Prisma type.
 *
 * The seam matters most on the way *back in*: `toOrganisationUpdateData` emits
 * only the keys the caller actually sent, which is what makes a PATCH of one
 * field a change to one column. Spreading the DTO would write every declared
 * property, because a validated DTO carries all of them as `undefined` under
 * ES2022 class-field semantics — the trap CLAUDE.md records against
 * `Object.keys(dto)` and the reason `changedFields` exists.
 */

export const ORGANISATION_SELECT = {
  id: true,
  name: true,
  shortName: true,
  description: true,
  foundedYear: true,
  organisationType: true,
  defaultLocale: true,
  defaultTimezone: true,
  defaultCurrency: true,
  status: true,
  legalName: true,
  legalForm: true,
  uid: true,
  vatId: true,
  commercialRegister: true,
  registerOffice: true,
  legalStreet: true,
  legalZip: true,
  legalCity: true,
  legalCountry: true,
  invoiceAddress: true,
  legalContactName: true,
  legalContactEmail: true,
  dataProtectionContactName: true,
  dataProtectionContactEmail: true,
  copyright: true,
  legalNotice: true,
  mainEmail: true,
  mainPhone: true,
  recruitmentEmail: true,
  supportEmail: true,
  billingEmail: true,
  website: true,
  seoTitlePattern: true,
  seoDescription: true,
  ogImageUrl: true,
  faviconUrl: true,
  version: true,
  updatedAt: true,
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.OrganisationSelect;

type OrganisationRow = Prisma.OrganisationGetPayload<{ select: typeof ORGANISATION_SELECT }>;

export function toOrganisation(row: OrganisationRow) {
  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ? { id: row.updatedBy.id, name: row.updatedBy.name } : null,
  };
}

/**
 * What the audit log records as `before` and `after`.
 *
 * The mapped record, not the row — and deliberately the *whole* of it. A
 * settings-shaped change is exactly the case where "which field moved" is the
 * only interesting question, and a diff needs both sides complete to answer it.
 */
export function toOrganisationAudit(row: OrganisationRow) {
  const { updatedBy: _updatedBy, ...rest } = toOrganisation(row);
  return rest;
}

export function toOrganisationUpdateData(
  input: OrganisationInput,
  actorId: string | null,
): Prisma.OrganisationUpdateManyMutationInput {
  const data: Record<string, unknown> = { updatedById: actorId };
  for (const field of [...GENERAL_FIELDS, ...LEGAL_FIELDS]) {
    const value = (input as Record<string, unknown>)[field];
    // `undefined` means "not sent"; `null` means "cleared", and Prisma writes
    // it. Conflating them is how a PATCH of one field blanks fifteen others.
    if (value !== undefined) data[field] = value;
  }
  // The lock's own increment. Inside the same `updateMany` whose `where`
  // matched the old value, so two writers cannot both take version 8.
  data.version = { increment: 1 };
  return data as Prisma.OrganisationUpdateManyMutationInput;
}

/* ================================================================== */
/* Offices                                                             */
/* ================================================================== */

export const OFFICE_SELECT = {
  id: true,
  name: true,
  kind: true,
  street: true,
  zip: true,
  city: true,
  canton: true,
  country: true,
  phone: true,
  email: true,
  latitude: true,
  longitude: true,
  mapsUrl: true,
  openingHours: true,
  isHeadquarters: true,
  isPublic: true,
  position: true,
  archivedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OfficeSelect;

type OfficeRow = Prisma.OfficeGetPayload<{ select: typeof OFFICE_SELECT }>;

export function toOffice(row: OfficeRow) {
  return {
    ...row,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOfficeCreateData(
  input: CreateOfficeInput,
  actorId: string | null,
): Prisma.OfficeCreateInput {
  const data: Record<string, unknown> = { name: input.name, updatedById: actorId };
  for (const field of OFFICE_FIELDS) {
    if (field === "name") continue;
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) data[field] = value;
  }
  return data as unknown as Prisma.OfficeCreateInput;
}

/**
 * `updateMany` data, which takes **scalars only**.
 *
 * Stated because the alternative typechecks and fails at runtime: the
 * optimistic lock needs the version inside the `where`, only `updateMany`
 * allows that, and a relation operation there is rejected with *Unknown
 * argument*. Same trap as `toProjectUpdateData` — see the note there.
 */
export function toOfficeUpdateData(
  input: UpdateOfficeInput,
  actorId: string | null,
): Prisma.OfficeUpdateManyMutationInput {
  const data: Record<string, unknown> = { updatedById: actorId };
  for (const field of OFFICE_FIELDS) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) data[field] = value;
  }
  data.version = { increment: 1 };
  return data as Prisma.OfficeUpdateManyMutationInput;
}

/**
 * The offices as the published website document carries them.
 *
 * Public, not archived, in `position` order — the three filters that make the
 * table usable as both master data and site content. An office that is
 * archived or internal is a real row that simply is not part of the document.
 */
export function toSiteOffices(rows: OfficeRow[]): SiteOffice[] {
  return rows
    .filter((row) => row.isPublic && !row.archivedAt)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "de-CH"))
    .map(toSiteOffice);
}
