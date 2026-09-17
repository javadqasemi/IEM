import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { Allow, IsArray, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { SettingsService } from "./settings.service";
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

class SettingUpdate {
  @IsString() key!: string;

  /**
   * `@Allow()` is load-bearing, not decoration.
   *
   * The global pipe runs with `whitelist: true`, which **strips every property
   * that carries no class-validator decorator**. This field had none, so `value`
   * was removed from each update before the service ever saw it. The service
   * then wrote `value: undefined`, which Prisma reads as "leave this column
   * alone" — so the endpoint answered 200, the audit log recorded
   * `settings.updated` with the key, and the value did not change. **The
   * settings page had never saved anything**, and it reported success while not
   * doing so, which is worse than an error.
   *
   * `@Allow()` rather than a real validator because the value genuinely is
   * arbitrary JSON — a string, a number, a boolean or an array, depending on the
   * key — and the shape is checked against the setting's own definition in the
   * service. `@Allow` is the decorator whose entire purpose is "keep this
   * through the whitelist without asserting anything about it".
   *
   * This is the second time this exact trap has been sprung in this codebase;
   * the first is written up in CLAUDE.md against the content DTOs. Undecorated
   * fields do not fail loudly. They vanish.
   */
  @Allow() value!: unknown;
}

export class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingUpdate)
  updates!: SettingUpdate[];
}

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions("settings.read")
  list(@CurrentUser() user: AuthUser) {
    // Whether the caller sees plaintext secrets is a separate permission from
    // seeing the settings at all — an editor may need the SMTP host without
    // needing the password beside it.
    return this.settings.list(user.isSuperAdmin || user.permissions.has("settings.secrets"));
  }

  @Patch()
  @RequirePermissions("settings.update")
  update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.settings.update(dto.updates, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }
}
