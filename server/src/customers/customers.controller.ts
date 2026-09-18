import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { RequirePermissions } from "../common/decorators";
import { ListQuery, type RawListQuery } from "../core/list/list.decorator";
import { CustomersRepository } from "./customers.repository";

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersRepository) {}

  @Get()
  @RequirePermissions("customer.read")
  list(@ListQuery() query: RawListQuery) {
    return this.customers.list(query);
  }

  @Get(":id")
  @RequirePermissions("customer.read")
  async find(@Param("id") id: string) {
    const customer = await this.customers.find(id);
    if (!customer) throw new NotFoundException("Kunde nicht gefunden.");
    return customer;
  }
}
