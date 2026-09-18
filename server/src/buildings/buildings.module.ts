import { Module } from "@nestjs/common";
import { BuildingsController } from "./buildings.controller";
import { BuildingsRepository } from "./buildings.repository";

@Module({
  controllers: [BuildingsController],
  providers: [BuildingsRepository],
  exports: [BuildingsRepository],
})
export class BuildingsModule {}
