import {
  MilestoneStatus,
  Priority,
  ProjectDisciplineStatus,
  ProjectMemberRole,
  ProjectStatus,
  SiaPhase,
} from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

/**
 * What the module accepts over HTTP.
 *
 * **Every field carries a decorator, and that is not style.** The global pipe
 * runs with `whitelist: true`: a property with no validator is *stripped* on
 * the way in, so the service receives `undefined`, Prisma reads that as "leave
 * the column alone", and the endpoint answers 200 having changed nothing. It
 * has happened twice in this codebase — once on the content DTOs, once on
 * settings — and both times the symptom was a save that silently did nothing
 * rather than an error anybody could search for. `projects.dto.test.ts` runs
 * the real pipe with the real options against every field here.
 *
 * Dates are `@IsISO8601()` strings, not `@IsDate()`. A JSON body has no `Date`,
 * so `@IsDate` would need `@Type(() => Date)` to have already run and would
 * accept `new Date("nonsense")` — an Invalid Date, which Prisma stores as
 * `null`. The string is validated here and parsed in one place in the service.
 */

/* ================================================================== */
/* The project                                                         */
/* ================================================================== */

export class CreateProjectDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;

  /**
   * Required, and the only foreign key that is.
   *
   * An engineering project without a Bauherrschaft is not a project — the
   * schema says so with a non-nullable column, and the DTO says so first, so
   * the caller gets a field error rather than a foreign-key violation.
   */
  @IsString() customerId!: string;

  @IsOptional() @IsString() architectId?: string;
  @IsOptional() @IsString() buildingId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() officeId?: string;

  @IsOptional() @IsIn(Object.values(Priority)) priority?: Priority;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() plannedEndDate?: string;

  /**
   * Money as a string on the way in as well as out.
   *
   * `@IsNumber()` would accept `1234.567` and silently round it at the column,
   * and a contract value that changes between the form and the record is the
   * one number nobody forgives. The service parses it once, and a value that
   * is not a decimal is rejected there with the field named.
   */
  @IsOptional() @IsString() @MaxLength(20) contractValue?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) budgetHours?: number;

  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

/**
 * The edit body.
 *
 * **`status` is deliberately absent.** A status change is a transition with
 * preconditions, its own permission and its own event; folding it into the
 * general update would make `PATCH /projects/:id { status: "COMPLETED" }` walk
 * past `refuseTransition` the first time somebody forgot to check. It has its
 * own route, which is also what makes the audit trail readable — a
 * `project.status_changed` row means what it says.
 *
 * `customerId` is absent for a different reason: moving a project to another
 * client is a commercial act with invoices attached, not a field edit. It is
 * refused rather than unimplemented, and the controller says so.
 */
export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() architectId?: string | null;
  @IsOptional() @IsString() buildingId?: string | null;
  @IsOptional() @IsString() managerId?: string | null;
  @IsOptional() @IsString() officeId?: string | null;
  @IsOptional() @IsIn(Object.values(Priority)) priority?: Priority;
  @IsOptional() @IsIn(Object.values(SiaPhase)) currentPhase?: SiaPhase | null;
  @IsOptional() @IsISO8601() startDate?: string | null;
  @IsOptional() @IsISO8601() plannedEndDate?: string | null;
  @IsOptional() @IsISO8601() actualEndDate?: string | null;
  @IsOptional() @IsString() @MaxLength(20) contractValue?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) budgetHours?: number | null;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

export class ChangeStatusDto {
  @IsIn(Object.values(ProjectStatus)) status!: ProjectStatus;
  /** Recorded on the event, so the audit row explains a hold or a cancellation. */
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/* ================================================================== */
/* Team                                                               */
/* ================================================================== */

export class AddMemberDto {
  @IsString() employeeId!: string;
  @IsOptional() @IsIn(Object.values(ProjectMemberRole)) role?: ProjectMemberRole;
  @IsOptional() @IsInt() @Min(1) @Max(100) allocationPercent?: number;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

/* ================================================================== */
/* Gewerke                                                            */
/* ================================================================== */

export class ScopeDisciplineDto {
  @IsString() disciplineId!: string;
  @IsOptional() @IsIn(Object.values(ProjectDisciplineStatus)) status?: ProjectDisciplineStatus;
  @IsOptional() @IsString() leadEngineerId?: string | null;

  /**
   * A percentage, so a number — unlike money. `@Max(200)` rather than 100: the
   * sum across a project may legitimately exceed 100 with an override, and a
   * per-row cap of 100 would make the honest case impossible to enter one row
   * at a time. The total is checked in `refuseFeeShares`, where the rule
   * actually lives.
   */
  @IsOptional() @IsNumber() @Min(0) @Max(200) feeShare?: number | null;
  @IsOptional() @IsBoolean() feeShareOverride?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) budgetHours?: number | null;
  @IsOptional() @IsString() @MaxLength(20) budgetCost?: string | null;
  @IsOptional() @IsString() @MaxLength(20) hourlyRate?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) scopeNote?: string | null;
}

/* ================================================================== */
/* Meilensteine                                                       */
/* ================================================================== */

export class CreateMilestoneDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsISO8601() dueDate!: string;
  @IsOptional() @IsIn(Object.values(SiaPhase)) phase?: SiaPhase;
  @IsOptional() @IsBoolean() isBillingTrigger?: boolean;
}

export class UpdateMilestoneDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsIn(Object.values(MilestoneStatus)) status?: MilestoneStatus;
  @IsOptional() @IsIn(Object.values(SiaPhase)) phase?: SiaPhase | null;
  @IsOptional() @IsBoolean() isBillingTrigger?: boolean;
}

/* ================================================================== */
/* Bulk                                                               */
/* ================================================================== */

/**
 * The list contract's bulk capability.
 *
 * `@ArrayMaxSize(200)` matches the list's own ceiling: a bulk action is
 * something applied to a selection on screen, and a request naming ten thousand
 * ids is either a mistake or a way around `maxPerPage`.
 */
export class BulkProjectsDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
  @IsIn(Object.values(Priority)) priority!: Priority;
}

/**
 * A nested-DTO example kept in the module because the next eighteen will need
 * it: `@ValidateNested` **requires** `@Type(() => X)`, and without it
 * class-validator receives a plain object, validates nothing inside, and
 * whitelisting strips every nested field. That failure is silent in exactly the
 * way the top of this file describes.
 */
export class ReorderMilestonesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MilestoneOrderDto)
  order!: MilestoneOrderDto[];
}

export class MilestoneOrderDto {
  @IsString() id!: string;
  @IsISO8601() dueDate!: string;
}
