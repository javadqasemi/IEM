import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { RbacService } from "./rbac.service";
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: "Der Schlüssel darf nur Kleinbuchstaben, Ziffern und _ enthalten.",
  })
  key!: string;

  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsArray() @IsString({ each: true }) permissionIds!: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissionIds?: string[];
}

@Controller()
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  private ctx(req: AuthedRequest, ip: string | null) {
    return { ip, userAgent: req.headers["user-agent"] ?? null };
  }

  @Get("permissions")
  @RequirePermissions("role.read")
  permissions() {
    return this.rbac.listPermissions();
  }

  @Get("roles")
  @RequirePermissions("role.read")
  roles() {
    return this.rbac.listRoles();
  }

  @Get("roles/:id")
  @RequirePermissions("role.read")
  role(@Param("id") id: string) {
    return this.rbac.getRole(id);
  }

  @Post("roles")
  @RequirePermissions("role.create")
  create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.rbac.createRole(dto, user, this.ctx(req, ip));
  }

  @Patch("roles/:id")
  @RequirePermissions("role.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.rbac.updateRole(id, dto, user, this.ctx(req, ip));
  }

  @Delete("roles/:id")
  @HttpCode(204)
  @RequirePermissions("role.delete")
  remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.rbac.deleteRole(id, user, this.ctx(req, ip));
  }
}
