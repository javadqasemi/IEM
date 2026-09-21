import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { NotificationDeliveryStatus, NotificationSeverity } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { NotificationsService } from "./notifications.service";
import { CurrentUser, RequirePermissions, type AuthUser } from "../../common/decorators";

/* ---- DTOs -------------------------------------------------------- */
/*
  Every field carries a decorator, including the booleans.

  `whitelist: true` strips a property with none, so an undecorated `inApp`
  would not be rejected — it would **vanish**, and `updatePreferences` would
  write `undefined` into a non-nullable column or, worse, quietly leave the
  old value while answering 200. CLAUDE.md records that mechanism twice, and
  `notifications.dto.test.ts` is the guard.

  `false` is the value that matters here: it is what somebody sends when they
  switch a notification *off*, and a stripped `false` is indistinguishable
  from "no change" at every layer below this one.
*/

export class ListNotificationsQuery {
  @IsOptional() @IsIn(["true", "false"]) unread?: string;
  @IsOptional() @IsString() @MaxLength(64) type?: string;
  @IsOptional() @IsIn(Object.values(NotificationSeverity)) severity?: NotificationSeverity;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number;
}

export class MarkReadDto {
  /** `false` un-reads it, which is how somebody keeps one to deal with later. */
  @IsBoolean() read!: boolean;
}

export class PreferenceUpdateDto {
  @IsString() @MaxLength(64) type!: string;
  @IsBoolean() inApp!: boolean;
  @IsBoolean() email!: boolean;
}

export class UpdatePreferencesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreferenceUpdateDto)
  updates!: PreferenceUpdateDto[];
}

export class RuleUpdateDto {
  @IsString() @MaxLength(64) type!: string;
  @IsBoolean() enabled!: boolean;
  @IsBoolean() inApp!: boolean;
  @IsBoolean() email!: boolean;
}

export class UpdateRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleUpdateDto)
  updates!: RuleUpdateDto[];
}

export class ListDeliveriesQuery {
  @IsOptional()
  @IsIn(Object.values(NotificationDeliveryStatus))
  status?: NotificationDeliveryStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number;
}

/* ---- Controller -------------------------------------------------- */

/**
 * The notification centre, the personal preferences, and the firm's rules.
 *
 * ---
 *
 * **In `core/` rather than in a feature folder**, and the precedent is exact:
 * `core/list/list-preference.controller.ts` serves each person's own saved
 * views from `CoreModule` for the same reason. This is infrastructure every
 * module feeds and every user reads, not a business module — there is no
 * `notifications` domain the firm would recognise, only a platform.
 *
 * **Three permission levels in one file, and the split is the whole RBAC
 * story:**
 *
 * | | |
 * | --- | --- |
 * | *Own* notifications and preferences | **no permission at all** |
 * | The firm's rules | `notification.configure` |
 * | Delivery outcomes | `notification.readDeliveries` |
 *
 * The first is the argument `/auth/sessions` and `/auth/mfa` already make: a
 * key every role has to hold for the dashboard to work is a key that means
 * nothing. The scope is the control instead — every one of those routes takes
 * `user.id` from the verified token and never from the request, so there is
 * no parameter through which one account could reach another's inbox.
 *
 * The other two are real authority. Configuring which events notify the firm
 * is an administrative act, and reading the delivery log means reading who
 * was told what and when — which is why it is a separate key from configuring
 * and not folded into it.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /* ---------------------------------------------------------------- */
  /* One's own                                                         */
  /* ---------------------------------------------------------------- */

  @Get()
  list(@Query() query: ListNotificationsQuery, @CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id, {
      unreadOnly: query.unread === "true",
      type: query.type,
      severity: query.severity,
      page: query.page,
      perPage: query.perPage,
    });
  }

  /**
   * The bell's number, on its own route.
   *
   * Separate from the list because it is polled and the list is not: one
   * indexed `count` against a page of rows plus their deliveries is the
   * difference between a poll that costs nothing and one that is the most
   * expensive request the dashboard makes.
   */
  @Get("unread-count")
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  /**
   * The catalogue with this person's answers.
   *
   * Before `:id`, or a reader asking for their preferences would be asking
   * for a notification with the id `preferences`. Nest matches in declaration
   * order, so this is reading order rather than correctness — and it still
   * matters to whoever adds the next route.
   */
  @Get("preferences")
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.preferences(user.id);
  }

  @Put("preferences")
  @HttpCode(200)
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.notifications.updatePreferences(user.id, dto.updates);
    return this.notifications.preferences(user.id);
  }

  @Post("read-all")
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(":id/read")
  @HttpCode(204)
  async markRead(
    @Param("id") id: string,
    @Body() dto: MarkReadDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.notifications.markRead(user.id, id, dto.read);
  }

  /* ---------------------------------------------------------------- */
  /* The firm's                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * What the firm has configured, over the whole catalogue.
   *
   * Behind `notification.configure` rather than `settings.read`: which events
   * reach whom is a governance decision, and somebody who may read the SMTP
   * host is not thereby somebody who may decide that security notifications
   * stop being sent.
   */
  @Get("rules")
  @RequirePermissions("notification.configure")
  rules() {
    return this.notifications.rules();
  }

  @Put("rules")
  @HttpCode(200)
  @RequirePermissions("notification.configure")
  async updateRules(@Body() dto: UpdateRulesDto) {
    await this.notifications.updateRules(dto.updates);
    return this.notifications.rules();
  }

  /**
   * What the channels actually did.
   *
   * Its own permission, because it is a different disclosure: the rules say
   * *who would be told*, this says *who was told, when, and whether it
   * arrived*. It carries no titles and no bodies — see the service — so it is
   * an operational log rather than a way to read other people's messages.
   */
  @Get("deliveries")
  @RequirePermissions("notification.readDeliveries")
  deliveries(@Query() query: ListDeliveriesQuery) {
    return this.notifications.deliveries(query);
  }
}
