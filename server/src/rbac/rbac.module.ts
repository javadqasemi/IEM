import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacController } from "./rbac.controller";
import { RbacService } from "./rbac.service";

/**
 * Roles and permissions.
 *
 * The *catalogue* is not here: `resources.ts` and `permissions.catalog.ts` are
 * plain modules with no Nest involvement, because the guard imports them
 * directly and a provider would make the source of truth resolvable only
 * inside the injection context.
 *
 * `AuthModule` for `ReauthService`: adding privileged permissions to a role
 * needs the actor's password again, through the same window every other
 * security change uses (`privilege.rules.ts`). Nothing in `auth/` imports
 * this module, so there is no cycle.
 */
@Module({
  imports: [AuthModule],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}