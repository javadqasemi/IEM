import {
  DrawingFormat,
  DrawingStatus,
  DrawingType,
  RecipientRole,
  RevisionReason,
  SiaPhase,
  TransmittalMedium,
  TransmittalPurpose,
} from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { CHANGE_NOTE_MIN } from "./drawings.rules";

/**
 * What the module accepts over HTTP.
 *
 * **Every field carries a decorator.** The global pipe runs with
 * `whitelist: true`, so a property with no validator is stripped, the service
 * receives `undefined`, Prisma reads that as "leave the column alone", and the
 * endpoint answers 200 having changed nothing. `drawings.dto.test.ts` runs the
 * real pipe with the real options against every field here.
 *
 * And the other half of that mechanism, which cost this project a wave: a
 * transformed DTO carries **every** declared property, so `Object.keys` is not
 * the set of fields the caller sent. Use `changedFields` — see
 * `core/versioning/changed.ts`.
 */

/* ================================================================== */
/* The plan                                                            */
/* ================================================================== */

export class CreateDrawingDto {
  /**
   * No format validation, deliberately — `refuseDrawingNumber` explains why.
   * `4723-HZG-EG-101` is this firm's shape and the next client's will differ.
   */
  @IsString() @MinLength(1) @MaxLength(60) number!: string;
  @IsString() @MinLength(2) @MaxLength(200) title!: string;

  /** Both required. A plan without a project or a Gewerk answers no question. */
  @IsString() projectId!: string;
  @IsString() disciplineId!: string;

  @IsIn(Object.values(DrawingType)) type!: DrawingType;

  @IsOptional() @IsString() @MaxLength(40) scale?: string;
  @IsOptional() @IsIn(Object.values(DrawingFormat)) format?: DrawingFormat;
  @IsOptional() @IsIn(Object.values(SiaPhase)) phase?: SiaPhase;

  /**
   * Nullable because a Prinzipschema often depicts no single building.
   * `floorId`, `buildingSystemId` and the room links wait for Wave 2 module 6.
   */
  @IsOptional() @IsString() buildingId?: string | null;

  @IsOptional() @IsString() drawnById?: string | null;

  /**
   * **`status` is absent from this DTO on purpose.**
   *
   * Every plan starts `WIP`. The other statuses have preconditions
   * `refuseTransition` evaluates — a revision must exist, a checker must be
   * someone other than the draftsman — and the create route evaluates none of
   * them. Accepting a status here would be a way straight past the rules, the
   * same trap `CreateTaskDto` documents.
   */
}

export class UpdateDrawingDto {
  /**
   * **Required, not optional.** A lock a caller may omit is one every caller
   * omits exactly once, and the failure is the single data-loss bug a user
   * cannot detect, report or work around.
   */
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(500) versionNote?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) number?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsIn(Object.values(DrawingType)) type?: DrawingType;
  @IsOptional() @IsString() @MaxLength(40) scale?: string | null;
  @IsOptional() @IsIn(Object.values(DrawingFormat)) format?: DrawingFormat;
  @IsOptional() @IsIn(Object.values(SiaPhase)) phase?: SiaPhase | null;
  @IsOptional() @IsString() disciplineId?: string;
  @IsOptional() @IsString() buildingId?: string | null;
  @IsOptional() @IsString() drawnById?: string | null;
  @IsOptional() @IsString() checkedById?: string | null;
  @IsOptional() @IsString() approvedById?: string | null;

  /** `projectId` is absent: moving a plan between projects would break the
   * `(projectId, number)` uniqueness that makes the number citable. */
}

export class ChangeDrawingStatusDto {
  /**
   * `ISSUED` and `SUPERSEDED` are accepted by the *type* and refused by the
   * *rule*, which is deliberate: the refusal explains what to do instead
   * ("ein Plan wird nicht auf ausgegeben gesetzt, sondern versandt"), and a
   * DTO-level rejection would answer "status must be one of …" and teach
   * nobody anything.
   */
  @IsIn(Object.values(DrawingStatus)) status!: DrawingStatus;

  /**
   * Required for a withdrawal and optional otherwise — enforced in the service
   * rather than here, because the requirement depends on another field.
   * `DrawingWithdrawn.reason` is a non-nullable `string` in the event
   * catalogue, which is where that rule was actually settled.
   */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/* ================================================================== */
/* Revisions                                                           */
/* ================================================================== */

export class CreateRevisionDto {
  /**
   * **Required, and it is the whole point of the row.** Six months later the
   * question is never "was there a revision C" but "what changed in C".
   */
  @IsString() @MinLength(CHANGE_NOTE_MIN) @MaxLength(2000) changeNote!: string;

  @IsOptional() @IsIn(Object.values(RevisionReason)) reason?: RevisionReason;

  /**
   * Left out to have one allocated — `nextDrawingRevision` reads the plan's
   * current letter and advances it, skipping `I` and `O`. Supplying it is
   * allowed because a plan set that started life in AutoCAD arrives at `C`.
   */
  @IsOptional() @IsString() @MaxLength(4) revision?: string;

  @IsOptional() @IsString() drawnById?: string | null;
  @IsOptional() @IsString() checkedById?: string | null;

  /**
   * The file. Sent as metadata rather than as multipart, because the bytes go
   * through the same upload route the media library uses and this endpoint
   * records the result — the split `MediaService.upload` already draws.
   */
  @IsString() @MaxLength(400) storageKey!: string;
  @IsString() @MaxLength(260) fileName!: string;
  @IsInt() @Min(1) size!: number;
  @IsString() @MaxLength(128) checksum!: string;
  @IsString() @MaxLength(160) mimeType!: string;
}

/* ================================================================== */
/* Planversand                                                         */
/* ================================================================== */

export class TransmittalItemDto {
  @IsString() drawingRevisionId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) copies?: number;
  @IsOptional() @IsIn(Object.values(DrawingFormat)) format?: DrawingFormat;
}

export class TransmittalRecipientDto {
  /**
   * One of the two, checked by `refuseTransmittal` rather than by a decorator:
   * class-validator cannot express "exactly one of these", and a rule that can
   * name which row is wrong beats a generic rejection of the whole body.
   */
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() @MaxLength(200) externalName?: string;
  @IsOptional() @IsString() @MaxLength(200) externalOrg?: string;
  @IsOptional() @IsString() @MaxLength(200) externalMail?: string;

  @IsOptional() @IsIn(Object.values(RecipientRole)) role?: RecipientRole;
}

export class CreateTransmittalDto {
  @IsString() projectId!: string;

  @IsOptional() @IsISO8601() sentAt?: string;
  @IsOptional() @IsIn(Object.values(TransmittalPurpose)) purpose?: TransmittalPurpose;
  @IsOptional() @IsIn(Object.values(TransmittalMedium)) medium?: TransmittalMedium;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;

  /**
   * `ArrayMinSize(1)` on both, which duplicates two of `refuseTransmittal`'s
   * checks and is worth it: an empty array is a shape error and belongs at the
   * edge, while "this revision is not released" is a domain rule and belongs in
   * the rules file. The rule still checks both, because it is also called from
   * places that did not come through this DTO.
   */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => TransmittalItemDto)
  items!: TransmittalItemDto[];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => TransmittalRecipientDto)
  recipients!: TransmittalRecipientDto[];

  /**
   * `number` is absent — allocated by `nextTransmittalSequence` from the
   * maximum already issued. A Planversand cannot be deleted, so the sequence
   * has no holes to reuse and must never appear to.
   */
}

export class AcknowledgeDto {
  @IsString() recipientId!: string;
  /** Left out for "now", which is the normal case. */
  @IsOptional() @IsISO8601() acknowledgedAt?: string;
}
