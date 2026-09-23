import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { UsersService } from "./users.service";
import { MailService } from "../mail/mail.service";
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

export class InviteUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsArray() @IsString({ each: true }) roleIds!: string[];
  /**
   * The actor's recent-authentication window, required only when the roles
   * confer privileged permissions — see `privilegeChangeNeedsReauth`. The
   * server answers `reauth_required` when it is missing and needed.
   */
  @IsOptional() @IsString() @MaxLength(256) reauthToken?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() avatarUrl?: string | null;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsIn(Object.values(UserStatus)) status?: UserStatus;
}

export class SetRolesDto {
  @IsArray() @IsString({ each: true }) roleIds!: string[];
  /** As on `InviteUserDto`: needed when the change grants privileged permissions. */
  @IsOptional() @IsString() @MaxLength(256) reauthToken?: string;
}

/**
 * The proof that the administrator asking is at the keyboard.
 *
 * In the body rather than a header: a custom header would need
 * `allowedHeaders` widened in `main.ts` for one feature. See `ReauthService`.
 */
export class ResetMfaDto {
  @IsString()
  @MinLength(1, { message: "Bitte zuerst das eigene Passwort bestätigen." })
  @MaxLength(256)
  reauthToken!: string;
}

export class ListUsersQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(Object.values(UserStatus)) status?: UserStatus;
  @IsOptional() @IsString() roleKey?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage?: number;
}

@Controller("users")
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  private ctx(req: AuthedRequest, ip: string | null) {
    return { ip, userAgent: req.headers["user-agent"] ?? null };
  }

  @Get()
  @RequirePermissions("user.read")
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get(":id")
  @RequirePermissions("user.read")
  get(@Param("id") id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermissions("user.create")
  async invite(
    @Body() dto: InviteUserDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    const { user: created, inviteToken } = await this.users.invite(dto, user, this.ctx(req, ip));
    await this.mail.sendInvite(created.email, created.name, inviteToken);
    // The token is not returned. It goes to the invitee's inbox and nowhere
    // else — echoing it here would put a live credential in the browser's
    // network log for anyone with the admin's screen.
    return created;
  }

  @Patch(":id")
  @RequirePermissions("user.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.users.update(id, dto, user, this.ctx(req, ip));
  }

  @Put(":id/roles")
  @RequirePermissions("user.assign")
  setRoles(
    @Param("id") id: string,
    @Body() dto: SetRolesDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.users.setRoles(id, dto.roleIds, user, this.ctx(req, ip), dto.reauthToken);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("user.delete")
  remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.users.remove(id, user, this.ctx(req, ip));
  }

  /* ---------------------------------------------------------------- */
  /* Sessions — somebody else's                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Where this account is signed in.
   *
   * `user.readSessions` rather than `user.read`, because device, IP address
   * and working hours are more than the user list shows — see the argument in
   * `rbac/resources.ts`.
   *
   * The caller's own refresh cookie is passed through so that an administrator
   * looking at *their own* record sees which row is the session they are
   * using. Against anybody else's rows it cannot match, so nothing is marked
   * and the honest answer falls out without a branch.
   */
  @Get(":id/sessions")
  @RequirePermissions("user.readSessions")
  sessions(@Param("id") id: string, @Req() req: AuthedRequest) {
    const presented = (req as unknown as { cookies?: Record<string, string> }).cookies
      ?.refresh_token;
    return this.users.sessionsOf(id, presented);
  }

  /** Ends one. Audited against the target, with the administrator as actor. */
  @Delete(":id/sessions/:sessionId")
  @RequirePermissions("user.revokeSessions")
  revokeSession(
    @Param("id") id: string,
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.users.revokeSessionOf(id, sessionId, user, this.ctx(req, ip));
  }

  /**
   * Ends all of them — "this account is compromised, lock it out now".
   *
   * `@Post` with an explicit 200 rather than `@Delete` on the collection: it
   * is an act with a result worth reading (how many were ended), and the
   * dashboard reports that number back.
   */
  @Post(":id/sessions/revoke-all")
  @HttpCode(200)
  @RequirePermissions("user.revokeSessions")
  revokeAllSessions(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.users.revokeAllSessionsOf(id, user, this.ctx(req, ip));
  }

  /* ---------------------------------------------------------------- */
  /* The second factor — somebody else's                               */
  /* ---------------------------------------------------------------- */

  /**
   * Clears an account's second factor. Account recovery, and nothing else.
   *
   * `user.resetMfa` rather than `user.update`, for the reason
   * `revokeSessions` is split from `readSessions`: this removes a security
   * control from an account that is not the caller's. It grants no access —
   * the password is still required afterwards — and the target's sessions
   * are revoked rather than opened.
   *
   * **Behind the caller's own recent authentication as well as the
   * permission**, which is the part a decorator cannot express: a permission
   * says who may, and the re-authentication says that the person holding the
   * session is the one asking. An administrator's laptop left unlocked at a
   * shared desk must not be a way to strip a colleague's second factor. The
   * proof travels in the body — see `ReauthService`.
   *
   * There is no route that *reads* a factor's secret, a code or a QR image,
   * and there will not be one. An administrator can remove the credential;
   * they can never hold it.
   */
  @Post(":id/mfa/reset")
  @HttpCode(200)
  @RequirePermissions("user.resetMfa")
  resetMfa(
    @Param("id") id: string,
    @Body() dto: ResetMfaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.users.resetMfaFor(id, user, dto.reauthToken, this.ctx(req, ip));
  }

  @Post(":id/send-password-reset")
  @HttpCode(202)
  @RequirePermissions("user.update")
  async sendReset(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    const result = await this.users.resetPasswordFor(id, user, this.ctx(req, ip));
    if (result) {
      const target = await this.users.get(id);
      await this.mail.sendPasswordReset(target.email, result.token);
    }
    return { message: "Eine E-Mail wurde versendet." };
  }
}
