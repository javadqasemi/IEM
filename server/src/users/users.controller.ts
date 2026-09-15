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
