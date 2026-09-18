import type { Prisma } from "@prisma/client";

/**
 * The Wave 1 building slice.
 *
 * The SIA 416 figures are `Decimal` columns and they leave as **numbers**, not
 * strings — unlike money. An area is a measurement: it is charted, summed and
 * compared, and float arithmetic on square metres is harmless in a way that
 * float arithmetic on Rappen is not. The distinction is the reason
 * `projects.mapper.ts` has two converters instead of one.
 */

export const BUILDING_SELECT = {
  id: true,
  number: true,
  name: true,
  address: true,
  zip: true,
  city: true,
  country: true,
  parcelNumber: true,
  egid: true,
  usage: true,
  constructionType: true,
  energyStandard: true,
  yearBuilt: true,
  yearRenovated: true,
  floorCount: true,
  undergroundFloorCount: true,
  heatedArea: true,
  grossArea: true,
  volume: true,
  customer: { select: { id: true, number: true, name: true } },
  office: { select: { id: true, name: true } },
  _count: { select: { projects: true } },
} satisfies Prisma.BuildingSelect;

type Row = Prisma.BuildingGetPayload<{ select: typeof BUILDING_SELECT }>;

const area = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());

export function toBuilding(row: Row) {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    address: row.address,
    zip: row.zip,
    city: row.city,
    country: row.country,
    parcelNumber: row.parcelNumber,
    egid: row.egid,
    usage: row.usage,
    constructionType: row.constructionType,
    energyStandard: row.energyStandard,
    yearBuilt: row.yearBuilt,
    yearRenovated: row.yearRenovated,
    floorCount: row.floorCount,
    undergroundFloorCount: row.undergroundFloorCount,
    heatedArea: area(row.heatedArea),
    grossArea: area(row.grossArea),
    volume: area(row.volume),
    customer: { id: row.customer.id, number: row.customer.number, name: row.customer.name },
    office: row.office && { id: row.office.id, name: row.office.name },
    projectCount: row._count.projects,
  };
}

export type BuildingView = ReturnType<typeof toBuilding>;
