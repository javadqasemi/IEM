import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import {
  buildOrderBy,
  buildWhere,
  paginated,
  parseListQuery,
  skipTake,
} from "../core/list/list";
import type { RawListQuery } from "../core/list/list.decorator";
import { BUILDING_LIST } from "./buildings.list";
import { BUILDING_SELECT, toBuilding } from "./buildings.mapper";

/**
 * Read-only, like the customer slice, and for the same reason.
 *
 * Floors, `BuildingSystem`s, rooms and loads — the part that makes this the
 * centre of the engineering model rather than an address book — are Wave 2
 * module 6 and land in this folder.
 */
@Injectable()
export class BuildingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: RawListQuery) {
    const params = parseListQuery(query, BUILDING_LIST);
    const where = buildWhere(params, BUILDING_LIST, {
      deletedAt: null,
    }) as Prisma.BuildingWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.building.findMany({
        where,
        orderBy: buildOrderBy(params, BUILDING_LIST),
        ...skipTake(params),
        select: BUILDING_SELECT,
      }),
      this.prisma.building.count({ where }),
    ]);

    return paginated(items.map(toBuilding), total, params);
  }

  async find(id: string) {
    const row = await this.prisma.building.findFirst({
      where: { id, deletedAt: null },
      select: BUILDING_SELECT,
    });
    return row ? toBuilding(row) : null;
  }
}
