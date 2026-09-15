import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis";
import { AuditService } from "../audit/audit.service";

/**
 * Infrastructure every module needs: the database, the audit log and Redis.
 *
 * `@Global` because the alternative is importing the same three providers into
 * a dozen feature modules. It is deliberately the *only* global module — the
 * feature modules stay explicitly wired so their dependencies are readable.
 */
@Global()
@Module({
  providers: [PrismaService, RedisService, AuditService],
  exports: [PrismaService, RedisService, AuditService],
})
export class CommonModule {}
