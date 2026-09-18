import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { RequirePermissions } from "../common/decorators";
import { ListQuery, type RawListQuery } from "../core/list/list.decorator";
import { BuildingsRepository } from "./buildings.repository";

@Controller("buildings")
export class BuildingsController {
  constructor(private readonly buildings: BuildingsRepository) {}

  @Get()
  @RequirePermissions("building.read")
  list(@ListQuery() query: RawListQuery) {
    return this.buildings.list(query);
  }

  @Get(":id")
  @RequirePermissions("building.read")
  async find(@Param("id") id: string) {
    const building = await this.buildings.find(id);
    if (!building) throw new NotFoundException("Gebäude nicht gefunden.");
    return building;
  }
}
