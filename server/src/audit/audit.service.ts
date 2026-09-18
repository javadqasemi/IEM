import { Injectable, Logger } from "@nestjs/common";
import { AuditOutcome, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { correlationId } from "../core/context/request-context";
import type { AuthUser } from "../common/decorators";

export type AuditInput = {
  actor?: AuthUser | null;
  /** Past tense, dotted: `content.published`, `user.role_assigned`. */
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  outcome?: AuditOutcome;
  message?: string;
  /**
   * Ties every row one request produced together.
   *
   * Filled from `AsyncLocalStorage` when the caller does not pass one, so a
   * direct `record()` in the middle of a request is grouped with the rows the
   * event listener wrote for the same request without anybody arranging it.
   */
  correlationId?: string | null;
};

/**
 * The audit log.
 *
 * Deliberately **explicit rather than automatic.** An interceptor that logged
 * every request would produce a log full of `GET /api/v1/content/entries` and
 * still miss the thing anyone actually asks the log about — what a record
 * looked like before and after a change. So writes are called from the service
 * that performed them, where both versions are in hand.
 *
 * Three properties the callers rely on:
 *
 * 1. **It never throws.** A failure to record an action must not roll back the
 *    action, and must not turn a successful publish into a 500. Failures are
 *    logged to the process logger instead, which is where an operator would
 *    look for "why is the audit log empty".
 * 2. **It never blocks the response.** Entries are written on the next tick.
 * 3. **It redacts.** `before`/`after` pass through `scrub`, so a user record
 *    with a password hash in it does not put that hash in a table half the
 *    organisation can read.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget. Returns immediately; the row is written after. */
  record(input: AuditInput): void {
    void this.write(input);
  }

  /** Awaitable form, for the few places that must know the row landed. */
  async writeSync(input: AuditInput): Promise<void> {
    await this.write(input);
  }

  private async write(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actor?.id ?? null,
          actorEmail: input.actor?.email ?? null,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? null,
          before: toJson(scrub(input.before)),
          after: toJson(scrub(input.after)),
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          outcome: input.outcome ?? AuditOutcome.SUCCESS,
          message: input.message ?? null,
          correlationId: input.correlationId ?? correlationId(),
        },
      });
    } catch (err) {
      this.logger.error(
        `Audit write failed for ${input.action} on ${input.resource}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * Field names whose values never belong in the audit log.
 *
 * Matched case-insensitively on the *key*, at any depth. It is a denylist, and
 * a denylist is the weaker choice — but the values being logged are arbitrary
 * content documents, so an allowlist would mean logging almost nothing. The
 * mitigation is that the only records with secrets in them are users, tokens
 * and settings, and all three are covered here.
 */
const SECRET_KEYS = [
  "password",
  "passwordhash",
  "mfasecret",
  "tokenhash",
  "token",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "smtppassword",
];

const REDACTED = "«entfernt»";

function scrub(value: unknown, depth = 0): unknown {
  if (value == null || depth > 12) return value ?? undefined;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? REDACTED : scrub(v, depth + 1);
  }
  return out;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}
