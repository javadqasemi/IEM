import { Module } from "@nestjs/common";
import { DisciplinesController } from "./disciplines.controller";
import { DisciplinesRepository } from "./disciplines.repository";

@Module({
  controllers: [DisciplinesController],
  providers: [DisciplinesRepository],
  exports: [DisciplinesRepository],
})
export class DisciplinesModule {}