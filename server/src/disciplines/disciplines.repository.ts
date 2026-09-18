import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { DISCIPLINE_SELECT, toDiscipline } from "./disciplines.mapper";

/**
 * Eight rows of master data, and therefore **no list contract**.
 *
 * F11 exists because a list of thousands cannot be paginated on the client.
 * Eight rows can, and wrapping them in pagination, filters and a sort allowlist
 * would be the ceremony without the problem — every caller would then have to
 * unwrap a `Paginated<T>` to draw a dropdown. The contract is for collections
 * that grow; this one does not.
 */
@Injectable()
export class DisciplinesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeInactive: boolean) {
    const rows = await this.prisma.discipline.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ order: "asc" }, { code: "asc" }],
      select: DISCIPLINE_SELECT,
    });
    return rows.map(toDiscipline);
  }
}