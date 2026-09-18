import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersRepository } from "./customers.repository";

@Module({
  controllers: [CustomersController],
  providers: [CustomersRepository],
  exports: [CustomersRepository],
})
export class CustomersModule {}
