import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { RequirePermissions } from "../common/decorators";
import { ListQuery, type RawListQuery } from "../core/list/list.decorator";
import { EmployeesRepository } from "./employees.repository";

@Controller("employees")
export class EmployeesController {
  constructor(private readonly employees: EmployeesRepository) {}

  @Get()
  @RequirePermissions("employee.read")
  list(@ListQuery() query: RawListQuery) {
    return this.employees.list(query);
  }

  @Get(":id")
  @RequirePermissions("employee.read")
  async find(@Param("id") id: string) {
    const employee = await this.employees.find(id);
    if (!employee) throw new NotFoundException("Person nicht gefunden.");
    return employee;
  }
}