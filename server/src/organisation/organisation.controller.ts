import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { OrganisationService } from "../core/organisation/organisation.service";
import { ORG_ID } from "../core/organisation/organisation.repository";
import { LEGAL_FIELDS } from "../core/organisation/organisation.types";
import { OFFICE_KINDS } from "../core/organisation/organisation.rules";
import { VersioningService } from "../core/versioning/versioning.service";
import { CurrentUser, RequirePermissions, type AuthUser } from "../common/decorators";
import { CreateOfficeDto, UpdateOfficeDto, UpdateOrganisationDto } from "./organisation.dto";

/**
 * The firm's own record, over HTTP.
 *
 * Two controllers in one file, the way `meetings.controller.ts` carries
 * `/meetings` and `/decisions`: `/organisation` and `/offices` are one module
 * and share one cache prefix on the client, because an office is part of the
 * company's identity and a screen that edits one renders the other.
 *
 * The **service is in `core/`** — see the note on `OrganisationService` for
 * why. This file is the routes and the permissions, and nothing else.
 */
@Controller("organisation")
export class OrganisationController {
  constructor(
    private readonly organisation: OrganisationService,
    private readonly versions: VersioningService,
  ) {}

  @Get()
  @RequirePermissions("organisation.read")
  async get(@CurrentUser() user: AuthUser) {
    return {
      organisation: await this.organisation.get(),
      /**
       * Whether *this* caller may write the legal half, sent with the record.
       *
       * So the form can render those fields read-only rather than letting
       * somebody fill them in and meet a 403 on save. It is a courtesy — the
       * check below is the control — but it is the difference between a
       * disabled field and lost work.
       */
      canEditLegal: user.isSuperAdmin || user.permissions.has("organisation.updateLegal"),
      officeKinds: OFFICE_KINDS,
    };
  }

  /**
   * One PATCH, two authorities.
   *
   * `@RequirePermissions` is AND across its arguments and cannot ask "only if
   * the body touches these fields", so the legal gate is here in the handler.
   * That is the `◐` pattern `docs/permissions.md` §4 documents and
   * `permissions.agreement.test.ts` counts as enforcement — the same shape
   * `settings.secrets` uses.
   *
   * The alternative, two routes, would put the decision of *which* route to
   * call in the client. A client deciding which half of a request needs the
   * stronger permission is not authorisation.
   */
  @Patch()
  @RequirePermissions("organisation.update")
  async update(@Body() dto: UpdateOrganisationDto, @CurrentUser() user: AuthUser) {
    const body = dto as unknown as Record<string, unknown>;
    const touchesLegal = LEGAL_FIELDS.some((field) => body[field] !== undefined);
    if (
      touchesLegal &&
      !user.isSuperAdmin &&
      !user.permissions.has("organisation.updateLegal")
    ) {
      throw new ForbiddenException(
        "Rechtliche Angaben — UID, Handelsregister, MWST, Sitz — dürfen nur mit der " +
          "Berechtigung „Rechtliche Angaben ändern“ bearbeitet werden.",
      );
    }
    return this.organisation.update(dto, user);
  }

  @Get("versions")
  @RequirePermissions("organisation.read")
  history(@Query("limit") limit?: string) {
    return this.versions.history("organisation", ORG_ID, Math.min(Number(limit) || 50, 200));
  }

  @Get("versions/:version")
  @RequirePermissions("organisation.read")
  version(@Param("version") version: string) {
    return this.versions.at("organisation", ORG_ID, Number(version));
  }
}

@Controller("offices")
export class OfficesController {
  constructor(
    private readonly organisation: OrganisationService,
    private readonly versions: VersioningService,
  ) {}

  /**
   * Every office, archived ones included, unpaginated.
   *
   * Deliberately not on the `core/list` contract. That machinery earns its
   * keep over a register of five hundred projects; this firm has two offices
   * and will plausibly never have twenty. Paginating it would cost a filter
   * bar, a saved-view row and a column picker on a list that fits on a phone
   * screen — the brief's own instruction not to force table capabilities onto
   * a list too small to need them.
   */
  @Get()
  @RequirePermissions("office.read")
  list() {
    return this.organisation.offices();
  }

  @Get(":id")
  @RequirePermissions("office.read")
  detail(@Param("id") id: string) {
    return this.organisation.office(id);
  }

  @Get(":id/versions")
  @RequirePermissions("office.read")
  history(@Param("id") id: string) {
    return this.versions.history("office", id, 50);
  }

  @Post()
  @RequirePermissions("office.create")
  create(@Body() dto: CreateOfficeDto, @CurrentUser() user: AuthUser) {
    return this.organisation.createOffice(dto, user);
  }

  @Patch(":id")
  @RequirePermissions("office.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateOfficeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organisation.updateOffice(id, dto, user);
  }

  /**
   * Archive and restore on one route, because they are one decision read in
   * two directions and a `POST /restore` beside a `POST /archive` is two
   * routes that can disagree about what "archived" means.
   */
  @Put(":id/archive")
  @RequirePermissions("office.archive")
  archive(@Param("id") id: string, @Query("restore") restore?: string) {
    return this.organisation.archiveOffice(id, restore !== "true");
  }

  @Delete(":id")
  @RequirePermissions("office.delete")
  remove(@Param("id") id: string) {
    return this.organisation.deleteOffice(id);
  }
}
