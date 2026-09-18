import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";

/**
 * The audit log's read side.
 *
 * No provider: `AuditService` — the write side — lives in the global
 * `CommonModule`, and the rows are now written by `AuditListener` from domain
 * events rather than by anything here. This module is the list, the detail and
 * the CSV export, which is the whole of what a reader does with it.
 *
 * There is no create, update or delete route and there is not meant to be. A
 * log the application can edit is not evidence of anything.
 */
@Module({
  controllers: [AuditController],
})
export class AuditModule {}