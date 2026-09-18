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
import { EMPLOYEE_LIST } from "./employees.list";
import { EMPLOYEE_SELECT, toEmployee } from "./employees.mapper";

/**
 * Read-only for Wave 1. Skills, certificates, the compensation route and the
 * `LEFT` lifecycle (which revokes the linked `User`) are Wave 1 module 2 and
 * land in this folder.
 */
@Injectable()
export class EmployeesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: RawListQuery) {
    const params = parseListQuery(query, EMPLOYEE_LIST);
    const where = buildWhere(params, EMPLOYEE_LIST, {
      deletedAt: null,
    }) as Prisma.EmployeeWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        orderBy: buildOrderBy(params, EMPLOYEE_LIST),
        ...skipTake(params),
        select: EMPLOYEE_SELECT,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return paginated(items.map(toEmployee), total, params);
  }

  async find(id: string) {
    const row = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      select: EMPLOYEE_SELECT,
    });
    return row ? toEmployee(row) : null;
  }
}