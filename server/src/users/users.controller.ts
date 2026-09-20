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
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() avatarUrl?: string | null;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsIn(Object.values(UserStatus)) status?: UserStatus;
}

export class SetRolesDto {
  @IsArray() @IsString({ each: true }) roleIds!: string[];
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
    return this.users.setRoles(id, dto.roleIds, user, this.ctx(req, ip));
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
