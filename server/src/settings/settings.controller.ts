import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { IsArray, IsString, ValidateNested } from "class-validator";
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
  value!: unknown;
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
