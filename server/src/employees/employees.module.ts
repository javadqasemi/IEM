import { Module } from "@nestjs/common";
import { EmployeesController } from "./employees.controller";
import { EmployeesRepository } from "./employees.repository";

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesRepository],
  exports: [EmployeesRepository],
})
export class EmployeesModule {}