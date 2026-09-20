import { Body, Controller, Get, Patch, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Allow, IsArray, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { SettingsService } from "../core/settings/settings.service";
import { MailService } from "../mail/mail.service";
import { EventBus } from "../core/events/event-bus";
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
   * arbitrary JSON — a string, a number, a boolean or an array, depending on
   * the key. **The shape is checked against the setting's own declaration in
   * `settings.rules.ts`**, which is where a per-key rule can live and a
   * decorator cannot.
   *
   * That sentence used to be here and was not true: nothing checked the shape
   * anywhere, and one unchecked value — `applications.retentionDays` — was
   * multiplied into a deletion deadline. A `0` there deleted every applicant
   * dossier received that day; a non-numeric one produced `new Date(NaN)` and
   * took the public application form down with a 500. The rules file exists
   * because of that; see the note at the top of it.
   *
   * This is the second time the whitelist trap has been sprung in this
   * codebase; the first is written up in CLAUDE.md against the content DTOs.
   * Undecorated fields do not fail loudly. They vanish.
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
  constructor(
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly events: EventBus,
  ) {}

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

  /**
   * Proves the mail configuration, to the caller's own address.
   *
   * **The recipient is not a parameter**, and that is the security property
   * rather than a simplification: an endpoint that sends mail to an
   * arbitrary address, from the firm's own domain, with a body a caller could
   * influence, is an open relay with a permission check in front of it.
   * `settings.update` is a permission several roles hold; none of them is
   * "may send mail as IEM to anyone".
   *
   * Throttled at three a minute for the same reason — the send itself is the
   * expensive, outward-facing part, and a settings page does not need more.
   *
   * The outcome is announced whichever way it goes. Somebody debugging "mail
   * stopped working last Tuesday" wants the failures in the audit log, not
   * only the successes.
   */
  @Post("mail/test")
  @RequirePermissions("settings.update")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async testMail(@CurrentUser() user: AuthUser) {
    const result = await this.mail.sendTest(user.email);

    this.events.publish("MailTested", {
      entity: "setting",
      entityId: "mail",
      payload: { to: user.email, ok: result.ok, error: result.error },
      message: result.stub
        ? "Kein SMTP-Server konfiguriert — die Nachricht wurde nur protokolliert."
        : result.ok
          ? `Testnachricht über ${result.host} versendet.`
          : `Test-Versand fehlgeschlagen: ${result.error}`,
    });

    return { ...result, to: user.email };
  }
}
