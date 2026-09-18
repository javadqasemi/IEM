import { Controller, Get, Query } from "@nestjs/common";
import { RequirePermissions } from "../common/decorators";
import { DisciplinesRepository } from "./disciplines.repository";

@Controller("disciplines")
export class DisciplinesController {
  constructor(private readonly disciplines: DisciplinesRepository) {}

  /**
   * `?includeInactive=true` for the administration screen.
   *
   * A raw `@Query` rather than a DTO, because the global pipe would strip an
   * undecorated field and a one-boolean DTO is more ceremony than the flag.
   * The coercion is explicit — `Boolean("false")` is `true`, which is the
   * mistake this one line exists to not make.
   */
  @Get()
  @RequirePermissions("discipline.read")
  list(@Query("includeInactive") includeInactive?: string) {
    return this.disciplines.list(includeInactive === "true");
  }
}