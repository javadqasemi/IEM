import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * The single Prisma client for the process.
 *
 * Repositories take this rather than constructing their own: a client owns a
 * connection pool, and one per module would multiply it by the number of
 * modules for no benefit.
 *
 * **Driver adapter, not the query engine.** From Prisma 7 the connection is
 * made by `pg` through `PrismaPg` instead of by Prisma's bundled Rust binary.
 * That is why `schema.prisma` no longer carries a `url`, and it means the
 * deployment is plain Node with no platform-specific engine to ship or to get
 * wrong in a container.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // Fail here, with a sentence that says what to do, rather than letting
      // the first query fail with a driver-level error three layers down.
      throw new Error(
        "DATABASE_URL ist nicht gesetzt. server/.env.example nach server/.env kopieren und ausfüllen.",
      );
    }

    super({
      adapter: new PrismaPg({ connectionString }),
      log: [
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    // Prisma's event-emitter typing is loose; the cast keeps the handlers
    // without widening the whole class to `any`.
    const on = this as unknown as {
      $on: (event: string, cb: (payload: { message: string }) => void) => void;
    };
    on.$on("warn", (e) => this.logger.warn(e.message));
    on.$on("error", (e) => this.logger.error(e.message));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Closes the pool when the process is asked to stop, so an in-flight request
   * finishes instead of dying with a half-written transaction.
   */
  async enableShutdownHooks(app: INestApplication) {
    process.on("beforeExit", () => {
      void app.close();
    });
  }
}
