import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
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

/**
 * Finishing a sign-in: the challenge, plus a code from the app **or** a
 * recovery code.
 *
 * Both are optional here and exactly one is required by the service, which is
 * the right place for it — "one of these two" is not something
 * class-validator expresses without a custom constraint, and the message it
 * would produce (`code should not be empty`) is wrong for somebody who
 * supplied a recovery code instead.
 */
export class MfaChallengeDto {
  @IsString() @MinLength(1) @MaxLength(512) challenge!: string;
  @IsOptional() @IsString() @MaxLength(16) code?: string;
  @IsOptional() @IsString() @MaxLength(32) recoveryCode?: string;
}

/**
 * Proving it again, for an operation that can remove a security control.
 *
 * The password is always required; the code is required *as well* when the
 * account has a second factor, which the service decides because only it
 * knows. See `AuthService.reauthenticate` for why it is both rather than
 * either.
 */
export class ReauthenticateDto {
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsOptional() @IsString() @MaxLength(16) code?: string;
  @IsOptional() @IsString() @MaxLength(32) recoveryCode?: string;
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

    /*
      The branch that must never be forgotten, which is why the service
      returns a discriminated union rather than an optional field.

      On `mfa` **no cookie is set and no access token is returned.** The body
      carries an opaque challenge and nothing else. A "partial" session here
      — even one the routes were supposed to reject — would be a session, and
      the factor would be advisory.
    */
    if (result.kind === "mfa") {
      return {
        mfaRequired: true,
        challenge: result.challenge,
        expiresIn: result.expiresIn,
      };
    }

    res.cookie("refresh_token", result.refreshToken, this.cookieOptions());
    return {
      mfaRequired: false,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  /**
   * The second half of a sign-in.
   *
   * Here rather than in `MfaController` because it issues the pair and sets
   * the refresh cookie, which is this controller's business — the URL says
   * `/auth/mfa/challenge` because that is where a reader looks for it, and
   * Nest composes it from the class prefix.
   *
   * `@Public()`, because by construction nobody is signed in yet: the
   * challenge *is* the credential, and it can do exactly one thing.
   *
   * **Ten a minute per IP, the same as `/auth/login`**, and that is the right
   * number because this is the other half of the same act — a limit that let
   * a script try codes faster than it can try passwords would make the second
   * factor the weaker one. Nest keys the throttle per handler, so this budget
   * is its own and does not eat the sign-in's. The per-challenge ceiling of
   * five in `mfa.rules.ts` bounds an attacker *within* one challenge; this
   * bounds them across challenges.
   */
  @Public()
  @Post("mfa/challenge")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async mfaChallenge(
    @Body() dto: MfaChallengeDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string | null,
  ) {
    const result = await this.auth.completeMfaChallenge(
      dto.challenge,
      { code: dto.code, recoveryCode: dto.recoveryCode },
      { ip, userAgent: req.headers["user-agent"] ?? null },
    );
    res.cookie("refresh_token", result.refreshToken, this.cookieOptions());
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      // So the dashboard can say "noch 2 Wiederherstellungscodes" on the
      // screen the reader has just arrived at. Somebody who has spent a code
      // is exactly the person who needs to know how many are left.
      usedRecoveryCode: result.usedRecoveryCode,
      remainingRecoveryCodes: result.remainingRecoveryCodes,
    };
  }

  /**
   * Opens a re-authentication window — see `ReauthService`.
   *
   * Not `@Public()`: the caller is already signed in and the account comes
   * from the verified token, so this can never be used to *obtain* a session.
   * Throttled at ten a minute anyway, because it takes a password and an
   * unbounded endpoint that takes a password is an oracle whatever else is
   * true of it.
   */
  @Post("reauthenticate")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reauthenticate(
    @Body() dto: ReauthenticateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.reauthenticate(
      user,
      { password: dto.password, code: dto.code, recoveryCode: dto.recoveryCode },
      { ip, userAgent: req.headers["user-agent"] ?? null },
    );
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

  /* ---------------------------------------------------------------- */
  /* Sessions — one's own                                              */
  /* ---------------------------------------------------------------- */

  /**
   * **No `@RequirePermissions`, deliberately.**
   *
   * These three are about the caller's *own* account, like `me` above and
   * `change-password` below, and the codebase already treats that as needing
   * authentication and nothing more — `/profil` carries no permission either.
   * A key such as `session.readOwn` would be one every role had to be granted
   * for the dashboard to work, which is a key that means nothing.
   *
   * The scope is the control instead: every one of them takes `user.id` from
   * the verified token and never from the request, so there is no parameter
   * through which one account could reach another's sessions.
   */
  @Get("sessions")
  sessions(@Req() req: AuthedRequest, @CurrentUser() user: AuthUser) {
    const presented = (req as unknown as { cookies?: Record<string, string> }).cookies
      ?.refresh_token;
    return this.auth.sessions(user.id, presented);
  }

  /**
   * Ends one of them.
   *
   * The response says whether the caller just ended the session it is using,
   * so the dashboard can sign itself out rather than carrying on with a
   * refresh token that will fail at the next rotation — which would look like
   * a random sign-out several minutes later.
   */
  @Delete("sessions/:id")
  async revokeSession(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    const presented = (req as unknown as { cookies?: Record<string, string> }).cookies
      ?.refresh_token;

    const result = await this.auth.revokeSession(user.id, id, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
      presentedRefreshToken: presented,
    });

    // Revoking your own session clears your own cookie in the same response.
    // Leaving it set would hand the browser a credential the server has just
    // refused, and the failure would arrive minutes later at the next refresh.
    if (result.wasCurrent) {
      res.clearCookie("refresh_token", { ...this.cookieOptions(), maxAge: undefined });
    }
    return result;
  }

  /** Everything except this one — see `revokeOtherSessions` for the split. */
  @Post("sessions/revoke-others")
  @HttpCode(200)
  revokeOtherSessions(
    @Req() req: AuthedRequest,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    const presented = (req as unknown as { cookies?: Record<string, string> }).cookies
      ?.refresh_token;
    return this.auth.revokeOtherSessions(user.id, presented, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
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
