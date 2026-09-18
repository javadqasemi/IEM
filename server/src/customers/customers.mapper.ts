import type { Prisma } from "@prisma/client";

/**
 * Prisma row → what the API returns, for the Wave 1 customer slice.
 *
 * The mapper exists although the transformation is nearly nothing, and that is
 * the rule §3.0.1 states: *a seam that exists only when convenient is not a
 * seam.* The day this grows a `Decimal` turnover field or a nested contact, the
 * conversion has a place to go and no call site changes.
 */

export const CUSTOMER_SELECT = {
  id: true,
  number: true,
  name: true,
  legalName: true,
  type: true,
  status: true,
  address: true,
  zip: true,
  city: true,
  country: true,
  phone: true,
  email: true,
  website: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { projects: true, buildings: true } },
} satisfies Prisma.CustomerSelect;

type Row = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

export function toCustomer(row: Row) {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    legalName: row.legalName,
    type: row.type,
    status: row.status,
    address: row.address,
    zip: row.zip,
    city: row.city,
    country: row.country,
    phone: row.phone,
    email: row.email,
    website: row.website,
    owner: row.owner ? { id: row.owner.id, name: `${row.owner.firstName} ${row.owner.lastName}` } : null,
    /**
     * Sent with the row because it is the answer to "may I archive this".
     * A count the client would otherwise get by listing every project of every
     * customer it draws — 25 extra requests for a number Postgres already has.
     */
    projectCount: row._count.projects,
    buildingCount: row._count.buildings,
  };
}

export type CustomerView = ReturnType<typeof toCustomer>;
