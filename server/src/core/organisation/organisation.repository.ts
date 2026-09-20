import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { OFFICE_SELECT, ORGANISATION_SELECT } from "./organisation.mapper";

/** The singleton's id. A constant, not a lookup — see the model's comment. */
export const ORG_ID = "org";

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrganisationRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /**
   * The organisation, created on first read if it is missing.
   *
   * An `upsert` rather than a `findUnique`, and that is the property the
   * constant id buys: there is no state in which this returns nothing, so no
   * caller needs a null branch and no deployment needs the seed to have run.
   * The column defaults in the schema are what a fresh row comes up holding.
   */
  async get(tx: Tx | null = null) {
    const db = tx ?? this.prisma;
    return db.organisation.upsert({
      where: { id: ORG_ID },
      create: { id: ORG_ID },
      update: {},
      select: ORGANISATION_SELECT,
    });
  }

  /**
   * The guarded write.
   *
   * `updateMany` with the version in the `where`, exactly as
   * `ProjectsRepository.updateIfUnchanged`: read-compare-write is a race with
   * extra steps, and Postgres's row lock on `UPDATE … WHERE version = 7` is
   * what actually decides between two savers. The count is the answer.
   */
  async updateIfUnchanged(
    expectedVersion: number,
    data: Prisma.OrganisationUpdateManyMutationInput,
    tx: Tx,
  ): Promise<number> {
    const { count } = await tx.organisation.updateMany({
      where: { id: ORG_ID, version: expectedVersion },
      data,
    });
    return count;
  }

  async versionOf(tx: Tx | null = null): Promise<number | null> {
    const db = tx ?? this.prisma;
    const row = await db.organisation.findUnique({
      where: { id: ORG_ID },
      select: { version: true },
    });
    return row?.version ?? null;
  }

  /* ================================================================ */
  /* Offices                                                           */
  /* ================================================================ */

  /**
   * Every office, archived ones included.
   *
   * The register shows them with a filter rather than hiding them, because
   * "which offices have we had" is a question an archive exists to answer.
   * `toSiteOffices` is what narrows the set for the website.
   */
  async listOffices(tx: Tx | null = null) {
    const db = tx ?? this.prisma;
    return db.office.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: OFFICE_SELECT,
    });
  }

  async findOffice(id: string, tx: Tx | null = null) {
    const db = tx ?? this.prisma;
    return db.office.findFirst({ where: { id, deletedAt: null }, select: OFFICE_SELECT });
  }

  async createOffice(data: Prisma.OfficeCreateInput, tx: Tx) {
    return tx.office.create({ data, select: OFFICE_SELECT });
  }

  async updateOfficeIfUnchanged(
    id: string,
    expectedVersion: number,
    data: Prisma.OfficeUpdateManyMutationInput,
    tx: Tx,
  ): Promise<number> {
    const { count } = await tx.office.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data,
    });
    return count;
  }

  async officeVersionOf(id: string): Promise<number | null> {
    const row = await this.prisma.office.findFirst({
      where: { id, deletedAt: null },
      select: { version: true },
    });
    return row?.version ?? null;
  }

  /**
   * Demotes every other office.
   *
   * Runs inside the promoting transaction, so there is never an instant with
   * two headquarters and never one with none. A partial unique index would
   * express the same rule in the database, and is worth adding the day a
   * second writer exists — today there is exactly one.
   */
  async demoteOtherHeadquarters(keepId: string, tx: Tx): Promise<void> {
    await tx.office.updateMany({
      where: { id: { not: keepId }, isHeadquarters: true, deletedAt: null },
      data: { isHeadquarters: false },
    });
  }

  async setArchived(id: string, at: Date | null, tx: Tx) {
    await tx.office.updateMany({ where: { id }, data: { archivedAt: at } });
  }

  async softDeleteOffice(id: string, at: Date, tx: Tx) {
    await tx.office.updateMany({ where: { id }, data: { deletedAt: at } });
  }

  /** What points at an office — the three foreign keys the schema declares. */
  async officeReferences(id: string) {
    const [employees, projects, buildings] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { officeId: id, deletedAt: null } }),
      this.prisma.project.count({ where: { officeId: id, deletedAt: null } }),
      this.prisma.building.count({ where: { officeId: id, deletedAt: null } }),
    ]);
    return { employees, projects, buildings };
  }

  async counts() {
    const [total, active, archived] = await this.prisma.$transaction([
      this.prisma.office.count(),
      this.prisma.office.count({ where: { deletedAt: null, archivedAt: null } }),
      this.prisma.office.count({ where: { deletedAt: null, archivedAt: { not: null } } }),
    ]);
    return { total, active, archived };
  }
}
