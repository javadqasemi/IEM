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
import { CUSTOMER_LIST } from "./customers.list";
import { CUSTOMER_SELECT, toCustomer } from "./customers.mapper";

/**
 * The Wave 1 customer slice: read-only, and there is no `service.ts`.
 *
 * §3.0.1 allows a feature to omit what it has nothing to put in, and a list
 * with no rules has no orchestration to do. Adding an empty service that
 * forwards every call to the repository would be the shape without the
 * substance — and the shape is what people copy.
 *
 * The full CRM is Wave 3 module 18. When it arrives it adds `customers.dto.ts`,
 * `customers.service.ts` and the lifecycle rules (`LEAD → ACTIVE` on first won
 * offer, archiving blocked while an unpaid invoice exists) **here**, in this
 * folder, rather than anywhere else.
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: RawListQuery) {
    const params = parseListQuery(query, CUSTOMER_LIST);
    const where = buildWhere(params, CUSTOMER_LIST, {
      deletedAt: null,
    }) as Prisma.CustomerWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: buildOrderBy(params, CUSTOMER_LIST),
        ...skipTake(params),
        select: CUSTOMER_SELECT,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginated(items.map(toCustomer), total, params);
  }

  async find(id: string) {
    const row = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: CUSTOMER_SELECT,
    });
    return row ? toCustomer(row) : null;
  }
}
