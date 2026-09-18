import { Module } from "@nestjs/common";
import { RbacController } from "./rbac.controller";
import { RbacService } from "./rbac.service";

/**
 * Roles and permissions.
 *
 * The *catalogue* is not here: `resources.ts` and `permissions.catalog.ts` are
 * plain modules with no Nest involvement, because the guard imports them
 * directly and a provider would make the source of truth resolvable only
 * inside the injection context.
 */
@Module({
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}