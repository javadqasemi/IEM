import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import type { Response } from "express";
import { AuthService } from "./auth.service";
import { MailService } from "../mail/mail.service";
import {
  ClientIp,
  CurrentUser,
  Public,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

/* ---- DTOs -------------------------------------------------------- */

export class LoginDto {
  @IsEmail({}, { message: "Bitte eine gültige E-Mail-Adresse angeben." })
  email!: string;

  @IsString()
  @MinLength(1, { message: "Bitte das Passwort angeben." })
  @MaxLength(256)
  password!: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(256) newPassword!: string;
}

export class RequestResetDto {
  @IsEmail() email!: string;
}

export class CompleteResetDto {
  @IsString() token!: string;
  @IsString() @MinLength(12) @MaxLength(256) password!: string;
}

/* ---- Controller -------------------------------------------------- */

/**
 * Sign-in, token rotation and password handling.
 *
 * The refresh token is returned **only** as an `httpOnly` cookie, never in the
 * JSON body. That is the one credential here worth protecting from cross-site
 * scripting: the access token is short-lived and the dashboard needs it in
 * memory to set an `Authorization` header, but a refresh token in reach of
 * page JavaScript is a persistent session an XSS could take away with it.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions() {
    const days = Number(this.config.get("REFRESH_TTL_DAYS") ?? 30);
    return {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      // `lax` rather than `strict`: the dashboard is a single origin, and
      // `strict` would drop the cookie when an admin follows a link into it
      // from an email, which reads as a random sign-out.
      sameSite: "lax" as const,
      path: "/api/v1/auth",
      maxAge: days * 24 * 60 * 60 * 1000,
    };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  // Ten attempts a minute per IP. Generous for a person, useless for a script,
  // and it works alongside the per-account lockout in the service rather than
  // instead of it — one bounds the attacker, the other bounds the target.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string | null,
  ) {
    const result = await this.auth.login(dto.email, dto.password, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
    res.cookie("refresh_token", result.refreshToken, this.cookieOptions());
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async refresh(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string | null,
  ) {
    const presented = (req as unknown as { cookies?: Record<string, string> }).cookies
      ?.refresh_token;
    const pair = await this.auth.refresh(presented ?? "", {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
    res.cookie("refresh_token", pair.refreshToken, this.cookieOptions());
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    const presented = (req as unknown as { cookies?: Record<string, string> }).cookies
      ?.refresh_token;
    await this.auth.logout(presented, user, { ip, userAgent: req.headers["user-agent"] ?? null });
    res.clearCookie("refresh_token", { ...this.cookieOptions(), maxAge: undefined });
  }

  @Post("logout-all")
  @HttpCode(204)
  async logoutAll(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    await this.auth.logoutAll(user.id, user, { ip, userAgent: req.headers["user-agent"] ?? null });
    res.clearCookie("refresh_token", { ...this.cookieOptions(), maxAge: undefined });
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }

  @Post("change-password")
  @HttpCode(204)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  async forgot(@Body() dto: RequestResetDto, @ClientIp() ip: string | null) {
    const result = await this.auth.requestReset(dto.email, { ip });
    if (result) await this.mail.sendPasswordReset(dto.email, result.token);
    // Same body whether or not the address exists — see `requestReset`.
    return { message: "Falls ein Konto existiert, wurde eine E-Mail versendet." };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async reset(@Body() dto: CompleteResetDto, @ClientIp() ip: string | null) {
    await this.auth.completeReset(dto.token, dto.password, { ip });
  }
}
