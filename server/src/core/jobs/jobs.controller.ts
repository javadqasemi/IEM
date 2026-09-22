import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { JobStatus, Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { CurrentUser, RequirePermissions, type AuthUser } from "../../common/decorators";
import { AuditService } from "../audit/audit.service";
import { redactToolOutput } from "../backup/backup.failure";
import { JOB_NAMES, backoffMs } from "./catalogue";
import { JobService } from "./job.service";
import {
  jobCapabilities,
  jobPhase,
  refuseCancel,
  refuseRetry,
  safeError,
  safePayload,
} from "./jobs.rules";

/* ---- DTOs -------------------------------------------------------- */

/**
 * `@IsIn(JOB_NAMES)` rather than a free `@IsString`.
 *
 * The filter offers the catalogue, so a name outside it is a typo or a probe
 * — and letting it through would mean a `where` clause on attacker-chosen
 * text. It is also the cheapest possible agreement test: adding a job to the
 * catalogue makes it filterable here with no second edit.
 */
export class JobQuery {
  @IsOptional() @IsIn(Object.values(JobStatus)) status?: JobStatus;
  @IsOptional() @IsIn(JOB_NAMES as unknown as string[]) name?: string;
  /**
   * Everything that has stopped without succeeding, in one chip.
   *
   * `DEAD` alone is the honest answer to "show me the failures" — see
   * `UNREACHABLE_STATUSES`, which records that `FAILED` is written by nothing.
   */
  @IsOptional() @IsIn(["true", "false"]) failedOnly?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  /**
   * Job id, correlation id, or a resource id **inside** the payload.
   *
   * Deliberately three exact-ish matches and not a full-text scan of the
   * payload column: `Job.payload` is unindexed `jsonb`, so a `contains` over
   * it is a sequential scan of the whole table on every keystroke. The ids are
   * what an operator actually pastes.
   */
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage?: number;
}

export class JobActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/* ---- Controller -------------------------------------------------- */

/**
 * Job Operations — the operator surface `core/jobs` shipped without (P2-1).
 *
 * ---
 *
 * ## Why it lives in `core/` rather than in a feature folder
 *
 * `MetricsController` sets the precedent one folder over: infrastructure that
 * has an operator surface keeps the surface beside the thing it operates.
 * The alternative was a `system/` feature folder, and `architecture.test.ts`
 * would have been right to fail it — every feature folder owes a
 * `*.metrics.ts`, and a module with no records of its own has nothing to
 * report. That is the same argument `WITHOUT_METRICS` already makes for
 * `dashboard/`, and the list may only shrink.
 *
 * ## Three permissions, and they are not interchangeable
 *
 * `job.read` opens the screen. `job.retry` re-runs work that did not happen.
 * `job.cancel` stops work that has not started. They were declared in F6 and
 * guarded nothing until now — `job.retry` left `KNOWN_UNENFORCED` in P2-4 on
 * the notification-delivery route, and the other two leave it here.
 *
 * ## Nothing here decides what is safe
 *
 * Every capability comes from `jobs.rules.ts`, and the routes re-check it
 * rather than trusting the button that was pressed. `backup.restore` is
 * refused in every status: a restore that died half way did not leave the
 * database untouched, so "try again" is not the recovery path — a deliberate
 * new restore is, with its confirmation and its re-authentication.
 */
@Controller("jobs")
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobService,
    private readonly audit: AuditService,
  ) {}

  private where(q: JobQuery): Prisma.JobWhereInput {
    const search = q.search?.trim();
    return {
      ...(q.failedOnly === "true" ? { status: JobStatus.DEAD } : q.status ? { status: q.status } : {}),
      ...(q.name ? { name: q.name } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { id: search },
              { correlationId: search },
              /*
                One indexed-ish path into the payload rather than a scan of it.

                `string_contains` on a named path uses the column's own
                structure instead of serialising every row, and the two ids
                below are the ones every payload in `catalogue.ts` actually
                carries. Searching the whole payload was the alternative and
                is a sequential scan per keystroke.
              */
              { payload: { path: ["backupRunId"], equals: search } },
              { payload: { path: ["deliveryId"], equals: search } },
            ],
          }
        : {}),
    };
  }

  /**
   * The list, and **deliberately without the payload**.
   *
   * A payload is `Json` of unbounded size and there is one per row; sending
   * fifty of them to render a table is the N+1's quieter cousin — not too many
   * queries, one query carrying far too much. The detail route has it.
   */
  @Get()
  @RequirePermissions("job.read")
  async list(@Query() q: JobQuery) {
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(200, Math.max(1, q.perPage ?? 50));
    const where = this.where(q);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          name: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          createdAt: true,
          runAfter: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          error: true,
          correlationId: true,
          actorEmail: true,
          lockedBy: true,
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toRow(row)),
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /**
   * The counts behind the System overview's Jobs card.
   *
   * Four `count`s in one transaction rather than a `groupBy` plus arithmetic:
   * `done24h` is a different `where` from the others, so a group-by would
   * still need a second query and the two would be read at different moments.
   */
  @Get("stats")
  @RequirePermissions("job.read")
  async stats() {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [queued, running, dead, done24h, oldestQueued] = await this.prisma.$transaction([
      this.prisma.job.count({ where: { status: JobStatus.QUEUED } }),
      this.prisma.job.count({ where: { status: JobStatus.RUNNING } }),
      this.prisma.job.count({ where: { status: JobStatus.DEAD } }),
      this.prisma.job.count({ where: { status: JobStatus.DONE, finishedAt: { gte: dayAgo } } }),
      this.prisma.job.findFirst({
        where: { status: JobStatus.QUEUED },
        orderBy: { runAfter: "asc" },
        select: { runAfter: true },
      }),
    ]);

    return {
      queued,
      running,
      dead,
      done24h,
      nextRunAt: oldestQueued?.runAfter.toISOString() ?? null,
      /** The names an operator can filter by, so the chip list is not hardcoded twice. */
      names: JOB_NAMES,
    };
  }

  /**
   * One job, with its payload, its error and what may be done with it.
   *
   * The payload is scrubbed by the **same denylist the audit log uses**
   * (`core/redaction/redact.ts`) and bounded, and the error goes through
   * `redactToolOutput` — because `pg_dump` composes its failure text by
   * echoing the connection it attempted, password included.
   */
  @Get(":id")
  @RequirePermissions("job.read")
  async detail(@Param("id") id: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Diese Aufgabe gibt es nicht.");

    return {
      ...this.toRow(job),
      payload: safePayload(job.payload),
      result: safePayload(job.result),
      lockedAt: job.lockedAt?.toISOString() ?? null,
      actorId: job.actorId,
      /**
       * When the next attempt is due, for a job that has one.
       *
       * Derived from the same `backoffMs` the runner uses rather than stored,
       * so the screen cannot disagree with the queue about when it will run.
       * `runAfter` is the authority; this is only shown when the row is
       * waiting and has already spent an attempt.
       */
      nextAttemptAt:
        job.status === JobStatus.QUEUED && job.attempts > 0
          ? job.runAfter.toISOString()
          : null,
      backoffMs: job.attempts > 0 ? backoffMs(job.attempts) : null,
    };
  }

  /**
   * Re-queues a job that stopped without succeeding.
   *
   * The rule is consulted **here**, not only in the UI: a client that has been
   * open since before a deploy, or one somebody wrote themselves, must meet
   * the same refusal as the button.
   */
  @Post(":id/retry")
  @RequirePermissions("job.retry")
  async retry(
    @Param("id") id: string,
    @Body() dto: JobActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, attempts: true },
    });
    if (!job) throw new NotFoundException("Diese Aufgabe gibt es nicht.");

    const refusal = refuseRetry(job);
    if (refusal) throw new BadRequestException(refusal);

    await this.jobs.retry(id);

    /*
      Audited directly rather than through an event, and this is the case the
      rule in CLAUDE.md names: it is an **operator intervention**, not a change
      to a business record that other modules might react to. Nothing
      subscribes to "somebody pressed retry"; the log is the whole point.
    */
    await this.audit.record({
      actor: user,
      action: "job.retried",
      resource: "job",
      resourceId: id,
      before: { status: job.status, attempts: job.attempts },
      after: { status: JobStatus.QUEUED, attempts: 0 },
      message: dto.reason?.trim() || `„${job.name}“ erneut eingereiht.`,
    });

    return { id, status: JobStatus.QUEUED };
  }

  /** Stops a job that has not started. Refuses one that has — see the rule. */
  @Post(":id/cancel")
  @RequirePermissions("job.cancel")
  async cancel(
    @Param("id") id: string,
    @Body() dto: JobActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!job) throw new NotFoundException("Diese Aufgabe gibt es nicht.");

    const refusal = refuseCancel(job);
    if (refusal) throw new BadRequestException(refusal);

    await this.jobs.cancel(id);

    /*
      Re-read rather than assumed.

      `JobService.cancel` is an `updateMany` whose `where` names `QUEUED`, so
      it does nothing if a worker claimed the row between the check above and
      the write — the same single-statement guard `updateIfUnchanged` uses. An
      audit row saying "cancelled" over a job that is now running would be the
      log recording something that did not happen.
    */
    const after = await this.prisma.job.findUnique({
      where: { id },
      select: { status: true },
    });

    await this.audit.record({
      actor: user,
      action: "job.cancelled",
      resource: "job",
      resourceId: id,
      outcome: after?.status === JobStatus.CANCELLED ? "SUCCESS" : "FAILURE",
      before: { status: job.status },
      after: { status: after?.status ?? null },
      message:
        after?.status === JobStatus.CANCELLED
          ? dto.reason?.trim() || `„${job.name}“ abgebrochen.`
          : "Abbruch kam zu spät — die Aufgabe war bereits übernommen.",
    });

    if (after?.status !== JobStatus.CANCELLED) {
      throw new BadRequestException(
        "Die Aufgabe wurde in der Zwischenzeit übernommen und läuft. Sie lässt sich nicht mehr abbrechen.",
      );
    }

    return { id, status: JobStatus.CANCELLED };
  }

  /* ---- Shared shaping ------------------------------------------- */

  private toRow(job: {
    id: string;
    name: string;
    status: JobStatus;
    attempts: number;
    maxAttempts: number;
    createdAt: Date;
    runAfter: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    durationMs: number | null;
    error: string | null;
    correlationId: string | null;
    actorEmail: string | null;
    lockedBy: string | null;
  }) {
    return {
      id: job.id,
      name: job.name,
      status: job.status,
      phase: jobPhase(job),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      createdAt: job.createdAt.toISOString(),
      runAfter: job.runAfter.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      durationMs: job.durationMs,
      error: safeError(job.error, redactToolOutput),
      correlationId: job.correlationId,
      actorEmail: job.actorEmail,
      lockedBy: job.lockedBy,
      capabilities: jobCapabilities(job),
    };
  }
}
