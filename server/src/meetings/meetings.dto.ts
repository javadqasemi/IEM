import {
  DecisionImpact,
  DecisionStatus,
  DecisionType,
  MeetingApprovalDecision,
  MeetingItemKind,
  MeetingStatus,
  MeetingType,
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
 * **Every field carries a decorator.** The global pipe runs with
 * `whitelist: true`, so a property with no validator is stripped, the service
 * receives `undefined`, Prisma reads that as "leave the column alone", and the
 * endpoint answers 200 having changed nothing. `meetings.dto.test.ts` runs the
 * real pipe with the real options against every field here.
 *
 * And the other half of that mechanism, which cost this project a wave: a
 * transformed DTO carries **every** declared property, so `Object.keys` is not
 * the set of fields the caller sent. Use `changedFields` — see
 * `core/versioning/changed.ts`.
 */

/* ================================================================== */
/* The meeting                                                         */
/* ================================================================== */

export class CreateMeetingDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsISO8601() startsAt!: string;

  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsIn(Object.values(MeetingType)) type?: MeetingType;
  @IsOptional() @IsString() @MaxLength(200) location?: string;

  /**
   * Optional, like `Task.projectId` and for the same reason: an internal
   * Geschäftsleitungssitzung is a meeting with minutes and no project.
   */
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() organiserId?: string;

  /**
   * Left out to have one allocated.
   *
   * `nextSeriesNumber` reads the maximum already issued for this type on this
   * project — so "Bausitzung 14" follows 13 without anybody counting. Supplying
   * it is allowed, because a meeting series that started on paper has to be
   * enterable at its real number.
   */
  @IsOptional() @IsInt() @Min(1) @Max(9999) seriesNumber?: number;
}

/**
 * The edit body.
 *
 * **`status` is absent.** Holding or cancelling a meeting is a transition with
 * preconditions, its own permission (`meeting.hold`) and its own event; folding
 * it in would let `PATCH /meetings/:id { status: "HELD" }` walk past
 * `refuseTransition` the first time somebody forgot to check.
 */
export class UpdateMeetingDto {
  /** The version the caller read before editing. **Required** (F13). */
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(500) versionNote?: string;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string | null;
  @IsOptional() @IsIn(Object.values(MeetingType)) type?: MeetingType;
  @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @IsString() organiserId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(9999) seriesNumber?: number | null;
}

/**
 * The transition.
 *
 * One route for both targets, because `HELD` and `CANCELLED` are the same act —
 * deciding what happened to a planned meeting — and `refuseTransition` is the
 * one place that knows which is allowed from where.
 */
export class ChangeMeetingStatusDto {
  @IsIn(Object.values(MeetingStatus)) status!: MeetingStatus;
  /** Recorded on the event, so the audit row explains a cancellation. */
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/* ================================================================== */
/* Attendees                                                           */
/* ================================================================== */

/**
 * One attendee: an employee **or** an external person, never both.
 *
 * `docs/data-model.md` §3.11 says "exactly one of `employeeId` / `contactId`",
 * and there is no `Contact` table yet — the CRM is Wave 3. An external attendee
 * is therefore a name and an organisation, validated here as mutually exclusive
 * with `employeeId` by the service, because class-validator's conditional
 * decorators would put half the rule in the DTO.
 */
export class AddAttendeeDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() @MaxLength(200) externalName?: string;
  @IsOptional() @IsString() @MaxLength(200) externalOrg?: string;

  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsISO8601() invitedAt?: string;
}

/**
 * Recording who turned up, in one request.
 *
 * A bulk shape rather than a PATCH per attendee, because attendance is entered
 * once for the whole room while writing the protocol — twelve requests for one
 * act would also make twelve audit rows out of one fact.
 */
export class RecordAttendanceDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  // `@ValidateNested` **requires** `@Type`. Without it class-validator receives
  // a plain object, validates nothing inside, and whitelisting strips every
  // nested field — silently.
  @Type(() => AttendanceEntryDto)
  attendance!: AttendanceEntryDto[];
}

export class AttendanceEntryDto {
  @IsString() attendeeId!: string;
  /** `null` is "not recorded"; `false` is "invited and absent". */
  @IsOptional() @IsBoolean() attended?: boolean | null;
  @IsOptional() @IsBoolean() apologised?: boolean;
}

/* ================================================================== */
/* Agenda                                                              */
/* ================================================================== */

export class AddAgendaItemDto {
  @IsString() @MinLength(2) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
  @IsOptional() @IsString() presenterId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(600) durationMinutes?: number;
}

export class UpdateAgendaItemDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) note?: string | null;
  @IsOptional() @IsString() presenterId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(600) durationMinutes?: number | null;
}

/* ================================================================== */
/* The protocol                                                        */
/* ================================================================== */

export class AddMeetingItemDto {
  @IsString() @MinLength(2) @MaxLength(4000) text!: string;
  @IsOptional() @IsIn(Object.values(MeetingItemKind)) kind?: MeetingItemKind;

  @IsOptional() @IsString() agendaItemId?: string;
  @IsOptional() @IsString() responsibleId?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() disciplineId?: string;

  /**
   * An existing decision to record on this line.
   *
   * A line of kind `ENTSCHEID` needs one — `refuseItem` says so — and the
   * decision is created through `POST /decisions` first. The two-step is
   * deliberate: a decision has a number, a rationale and a life of its own, and
   * creating one as a side effect of typing a protocol line is how rationales
   * end up empty.
   */
  @IsOptional() @IsString() decisionId?: string;

  /**
   * Create a `Task` from this line, when it is a Pendenz.
   *
   * Default **true** for a `PENDENZ` and ignored otherwise: the entire reason
   * this module comes after Tasks is that a Pendenz should land on somebody's
   * board. `false` exists for the case where the task already exists and is
   * linked with `taskId`.
   */
  @IsOptional() @IsBoolean() createTask?: boolean;
  @IsOptional() @IsString() taskId?: string;
}

export class UpdateMeetingItemDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(4000) text?: string;
  @IsOptional() @IsIn(Object.values(MeetingItemKind)) kind?: MeetingItemKind;
  @IsOptional() @IsString() agendaItemId?: string | null;
  @IsOptional() @IsString() responsibleId?: string | null;
  @IsOptional() @IsISO8601() dueDate?: string | null;
  @IsOptional() @IsString() disciplineId?: string | null;
  @IsOptional() @IsString() decisionId?: string | null;
}

/** A reorder, as a drag on the protocol produces it. */
export class ReorderItemsDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) order!: string[];
}

/* ================================================================== */
/* Approval and minutes                                                */
/* ================================================================== */

export class ApproveMinutesDto {
  @IsIn(Object.values(MeetingApprovalDecision)) decision!: MeetingApprovalDecision;
  /**
   * Required for `AMENDED`, checked in the service rather than here.
   *
   * A conditional decorator would put half of what an approval means in the
   * DTO and half in `refuseApproval`; the rules file owns what an approval is.
   */
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
}

/* ================================================================== */
/* Decisions                                                           */
/* ================================================================== */

export class CreateDecisionDto {
  @IsString() @MinLength(3) @MaxLength(300) title!: string;

  /**
   * **Required, and the module's defining field.**
   *
   * `docs/data-model.md` §3.11: the record exists to answer *why*, and a
   * decision without a reason is the row nobody can act on two years later.
   * The length floor is in `refuseDecision`, because "ok" passes any decorator.
   */
  @IsString() @MinLength(1) @MaxLength(8000) rationale!: string;

  /** Required: a decision is always about a project. */
  @IsString() projectId!: string;
  @IsISO8601() decidedAt!: string;

  @IsOptional() @IsString() meetingId?: string;
  @IsOptional() @IsString() decidedById?: string;
  @IsOptional() @IsString() @MaxLength(200) decidedByExternal?: string;
  @IsOptional() @IsIn(Object.values(DecisionType)) type?: DecisionType;
  @IsOptional() @IsIn(Object.values(DecisionStatus)) status?: DecisionStatus;
  @IsOptional() @IsString() disciplineId?: string;

  @IsOptional() @IsIn(Object.values(DecisionImpact)) impact?: DecisionImpact;
  /**
   * Money as a string on the way in as well as out — `@IsNumber()` would accept
   * `1234.567` and let the column round it silently. The service parses it once
   * through `toMoney`, which refuses anything else with the field named.
   */
  @IsOptional() @IsString() @MaxLength(20) costImpact?: string;
  @IsOptional() @IsInt() @Min(-3650) @Max(3650) scheduleImpactDays?: number;
}

/**
 * The edit body.
 *
 * **`status` and `supersedesId` are absent.** Reversing a decision is
 * `decision.supersede`, not an edit — `docs/permissions.md` §3.11: *"`update`
 * is corrections; reversing a decision is its own authority."*
 */
export class UpdateDecisionDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(500) versionNote?: string;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(8000) rationale?: string;
  @IsOptional() @IsISO8601() decidedAt?: string;
  @IsOptional() @IsString() decidedById?: string | null;
  @IsOptional() @IsString() @MaxLength(200) decidedByExternal?: string | null;
  @IsOptional() @IsIn(Object.values(DecisionType)) type?: DecisionType;
  @IsOptional() @IsString() disciplineId?: string | null;
  @IsOptional() @IsIn(Object.values(DecisionImpact)) impact?: DecisionImpact;
  @IsOptional() @IsString() @MaxLength(20) costImpact?: string | null;
  @IsOptional() @IsInt() @Min(-3650) @Max(3650) scheduleImpactDays?: number | null;
}

/**
 * The status change.
 *
 * **`AUFGEHOBEN` is accepted here and refused by the rules**, which looks
 * backwards and is the right way round. Narrowing the enum in the DTO would
 * make the route physically incapable of it — and would answer an attempt with
 * *"Die Eingaben sind unvollständig oder ungültig"*, which tells a user nothing
 * about what to do instead. `refuseDecisionStatus` answers with the sentence
 * that matters: a decision is not withdrawn directly, it is replaced by the one
 * that takes its place.
 *
 * The same division `ChangeStatusDto` makes for projects: the DTO owns the
 * shape, the rules file owns the meaning.
 */
export class ChangeDecisionStatusDto {
  @IsIn(Object.values(DecisionStatus)) status!: DecisionStatus;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/**
 * Reversing a decision by naming the one that replaces it.
 *
 * The body is sent to the **new** decision's route, and it names the old one —
 * so a reversal names its successor rather than the other way round, which is
 * what lets `AUFGEHOBEN` be a verifiable fact rather than a claim.
 */
export class SupersedeDecisionDto {
  @IsString() supersedesId!: string;
}

/* ================================================================== */
/* Bulk                                                                */
/* ================================================================== */

/**
 * The list contract's bulk action, and it is deliberately narrow.
 *
 * Only the Gewerk, because it is the field that gets *classified* in bulk — a
 * Projektleiter tagging twenty protocol lines as Lüftung while preparing a
 * Fachsitzung. Everything else about a line is specific to it.
 */
export class BulkItemsDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsString() disciplineId?: string | null;
}

/** Kept for the nested-DTO example the other modules reference. */
export class MeetingItemOrderDto {
  @IsString() id!: string;
  @IsNumber() order!: number;
}
