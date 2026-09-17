import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis";
import { SharedThrottlerStorage } from "./throttler.storage";
import { AuditService } from "../audit/audit.service";

/**
 * Infrastructure every module needs: the database, the audit log and Redis.
 *
 * `@Global` because the alternative is importing the same three providers into
 * a dozen feature modules. It is deliberately the *only* global module — the
 * feature modules stay explicitly wired so their dependencies are readable.
 *
 * `SharedThrottlerStorage` is exported for `ThrottlerModule.forRootAsync` in
 * `app.module.ts`, which cannot construct it itself — it needs `RedisService`,
 * and that lives here.
 */
@Global()
@Module({
  providers: [PrismaService, RedisService, AuditService, SharedThrottlerStorage],
  exports: [PrismaService, RedisService, AuditService, SharedThrottlerStorage],
})
export class CommonModule {}
