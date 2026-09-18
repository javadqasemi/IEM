import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { PrismaService } from "../../common/prisma.service";
import { CurrentUser, type AuthUser } from "../../common/decorators";
import { RESOURCES } from "../../rbac/resources";

class SortDto {
  @IsString() @MaxLength(60) field!: string;
  @IsIn(["asc", "desc"]) dir!: "asc" | "desc";
}

/**
 * What one person has done to one list.
 *
 * **Every field decorated**, including `hidden`, because the global pipe runs
 * with `whitelist: true` and an undecorated property is stripped in silence —
 * the reader would hide three columns, see them come back on the next load,
 * and have nothing to look at to find out why.
 */
export class ListViewDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(60, { each: true })
  hidden?: string[];

  @IsOptional() @ValidateNested() @Type(() => SortDto) sort?: SortDto;

  @IsOptional() @IsInt() @Min(1) @Max(200) perPage?: number;
}

/**
 * Saved list views, one per user per resource (foundation stage F11).
 *
 * **No permission guard, and that is correct.** A list preference is a
 * property of the *reader*, not of the data: it says which columns they want
 * to see, not which rows they may. `JwtAuthGuard` is global and denies by
 * default, so being signed in is the whole requirement — and every route below
 * is scoped to `user.id` with no way to name another.
 *
 * Generic rather than one endpoint per resource, because the shape is the same
 * for all twenty-six and a per-module copy is twenty-six places for the
 * `userId` scope to be forgotten once.
 */
@Controller("list-preferences")
export class ListPreferenceController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `{}` for a resource the reader has never touched, not a 404.
   *
   * "No saved view" is the normal state, and a client that had to treat it as
   * an error would write the same `catch` on every list screen.
   */
  @Get(":resource")
  async get(@Param("resource") resource: string, @CurrentUser() user: AuthUser) {
    const row = await this.prisma.listPreference.findUnique({
      where: { userId_resource: { userId: user.id, resource } },
    });
    return row?.view ?? {};
  }

  @Put(":resource")
  async put(
    @Param("resource") resource: string,
    @Body() view: ListViewDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertKnownResource(resource);
    const row = await this.prisma.listPreference.upsert({
      where: { userId_resource: { userId: user.id, resource } },
      create: { userId: user.id, resource, view: view as object },
      update: { view: view as object },
    });
    return row.view;
  }

  /**
   * Restores the default by **deleting** the row rather than writing the
   * defaults into it.
   *
   * Storing them would freeze them at whatever they were on the day the reader
   * pressed the button: a column added to the table six months later would be
   * hidden for everybody who had ever restored their defaults, and nothing
   * would explain why.
   */
  @Delete(":resource")
  @HttpCode(204)
  async reset(@Param("resource") resource: string, @CurrentUser() user: AuthUser) {
    await this.prisma.listPreference.deleteMany({ where: { userId: user.id, resource } });
  }
}

/**
 * The resource has to be one the system has.
 *
 * Not security — the row is scoped to the caller either way — but hygiene: a
 * typo in a screen would otherwise create a preference row nothing ever reads,
 * and the reader's columns would silently stop being remembered.
 */
function assertKnownResource(resource: string): void {
  if (!RESOURCES.some((r) => r.key === resource)) {
    throw new Error(`Unbekannte Ressource „${resource}“.`);
  }
}
