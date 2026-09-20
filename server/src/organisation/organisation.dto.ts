import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

/**
 * What may arrive on the wire.
 *
 * **Every field carries a decorator, including the ones that look like they
 * need none.** The global pipe runs with `whitelist: true` and strips any
 * property without one — silently. That has cost this codebase two separate
 * outages: the content DTOs' undecorated `data`, and the settings DTO's
 * undecorated `value`, which made the settings page report success while
 * saving nothing for an entire release.
 *
 * **`@IsOptional()` plus an explicit null branch**, not `@IsOptional()` alone.
 * `@IsOptional` skips validation for `null` *and* `undefined`, which is right
 * here — the two mean different things downstream (`undefined` is "not sent",
 * `null` is "cleared") and the mapper is what keeps them apart. Where a field
 * may be cleared, `ValidateIf` lets the `null` through the format check that
 * would otherwise reject it.
 */

/** Allows `null` through a format validator that would otherwise reject it. */
const nullable = () => ValidateIf((_, value) => value !== null);

export class UpdateOrganisationDto {
  /**
   * The optimistic lock, and it is **required**.
   *
   * A lock a caller may omit is one every caller omits exactly once, and the
   * failure is the single data-loss bug a user cannot detect, report or work
   * around: the second save wins silently and the first person's work is gone.
   * The client always has the number — `version` is on the record it rendered
   * the form from. Same reasoning as `UpdateProjectDto`.
   */
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;

  /* ---- General ---------------------------------------------------- */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) shortName?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @nullable() @Type(() => Number) @IsInt() @Min(1800) @Max(2100)
  foundedYear?: number | null;
  @IsOptional() @IsString() @MaxLength(120) organisationType?: string;
  /**
   * A BCP-47 tag, loosely. Not `@IsLocale()`: that accepts `de_CH` with an
   * underscore, which `Intl` does not, so the validator would pass a value
   * that throws the first time a date is formatted with it.
   */
  @IsOptional() @IsString() @MaxLength(35) defaultLocale?: string;
  @IsOptional() @IsString() @MaxLength(64) defaultTimezone?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(3) defaultCurrency?: string;
  @IsOptional() @IsIn(["ACTIVE", "DORMANT", "LIQUIDATION"])
  status?: "ACTIVE" | "DORMANT" | "LIQUIDATION";

  /* ---- Contact ---------------------------------------------------- */
  @IsOptional() @nullable() @IsEmail({}, { message: "Haupt-E-Mail ist keine gültige Adresse." })
  mainEmail?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(60) mainPhone?: string | null;
  @IsOptional() @nullable() @IsEmail({}, { message: "Bewerbungs-E-Mail ist keine gültige Adresse." })
  recruitmentEmail?: string | null;
  @IsOptional() @nullable() @IsEmail({}, { message: "Support-E-Mail ist keine gültige Adresse." })
  supportEmail?: string | null;
  @IsOptional() @nullable() @IsEmail({}, { message: "Rechnungs-E-Mail ist keine gültige Adresse." })
  billingEmail?: string | null;
  @IsOptional() @nullable() @IsUrl({ require_protocol: true }) website?: string | null;

  /* ---- Website defaults ------------------------------------------- */
  @IsOptional() @nullable() @IsString() @MaxLength(200) seoTitlePattern?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(320) seoDescription?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) ogImageUrl?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) faviconUrl?: string | null;

  /* ---- Legal — needs `organisation.updateLegal` -------------------- */
  @IsOptional() @nullable() @IsString() @MaxLength(200) legalName?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) legalForm?: string | null;
  /**
   * Shape only here; the **check digit** is verified in
   * `organisation.rules.ts`. A regex in a decorator cannot do modulo-11
   * arithmetic, and `CHE-123.456.789` is the shape of a UID and is not one.
   */
  @IsOptional() @nullable() @IsString() @MaxLength(20) uid?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(30) vatId?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) commercialRegister?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) registerOffice?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) legalStreet?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) legalZip?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) legalCity?: string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(2) legalCountry?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(500) invoiceAddress?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) legalContactName?: string | null;
  @IsOptional() @nullable() @IsEmail({}, { message: "Rechtlicher Kontakt: keine gültige Adresse." })
  legalContactEmail?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) dataProtectionContactName?: string | null;
  @IsOptional() @nullable() @IsEmail({}, { message: "Datenschutzkontakt: keine gültige Adresse." })
  dataProtectionContactEmail?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) copyright?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(5000) legalNotice?: string | null;
}

class OfficeFieldsDto {
  @IsOptional() @IsString() @MaxLength(60) kind?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(200) street?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) zip?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) city?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(60) canton?: string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(2) country?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(60) phone?: string | null;
  @IsOptional() @nullable() @IsEmail({}, { message: "Standort-E-Mail ist keine gültige Adresse." })
  email?: string | null;
  @IsOptional() @nullable() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  latitude?: number | null;
  @IsOptional() @nullable() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  longitude?: number | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) mapsUrl?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) openingHours?: string | null;
  @IsOptional() @IsBoolean() isHeadquarters?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999) position?: number;
}

export class CreateOfficeDto extends OfficeFieldsDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
}

export class UpdateOfficeDto extends OfficeFieldsDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
}

/** The recipient is always the caller, so the body carries nothing at all. */
export class TestMailDto {}
