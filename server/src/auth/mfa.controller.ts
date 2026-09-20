import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, MaxLength, MinLength } from "class-validator";
import { MfaService } from "./mfa.service";
import {
  ClientIp,
  CurrentUser,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

/* ---- DTOs -------------------------------------------------------- */
/*
  Every field carries a decorator, including the ones that look obvious.

  `whitelist: true` on the global pipe strips any property that has none, so
  an undecorated field does not fail — it **vanishes**, and the failure
  surfaces downstream as "the code is missing" against a request that plainly
  contained one. CLAUDE.md records the release where that took the content
  editor down.

  `MaxLength` everywhere for the same reason the password DTO has one: these
  strings reach a hash or an HMAC, and an unbounded body is free work.
*/

export class VerifyEnrolmentDto {
  @IsString()
  @MinLength(1, { message: "Bitte den Code aus der App eingeben." })
  @MaxLength(16)
  code!: string;
}

/**
 * The body of anything that removes or replaces a security control.
 *
 * `reauthToken` in the body rather than in a header: a custom header would
 * need `allowedHeaders` widened in `main.ts` for one feature, and a field is
 * validated by the pipe that validates everything else. See `ReauthService`.
 */
export class ReauthenticatedDto {
  @IsString()
  @MinLength(1, { message: "Bitte zuerst das Passwort bestätigen." })
  @MaxLength(256)
  reauthToken!: string;
}

/* ---- Controller -------------------------------------------------- */

/**
 * The second factor of the caller's own account.
 *
 * **No `@RequirePermissions` on anything here, deliberately**, and it is the
 * same argument `/auth/sessions` is written up with: these are operations on
 * the caller's own account, like `/auth/me` and `/auth/change-password`, and
 * a key such as `mfa.manage` would be one every role had to be granted for
 * the dashboard to work — which is a key that means nothing.
 *
 * The scope is the control instead. Every route takes `user.id` from the
 * verified token and never from the request, so there is no parameter through
 * which one account could reach another's factor. The **administrative**
 * counterpart is `POST /users/:id/mfa/reset`, which names a user and is
 * therefore behind `user.resetMfa` — the same split `/auth/sessions` and
 * `/users/:id/sessions` make.
 *
 * **`POST /auth/mfa/challenge` is not here**, although its URL says it should
 * be. It is the second half of `login` — it issues the pair and sets the
 * refresh cookie — so it lives in `auth.controller.ts` beside the first half,
 * where a reader tracing a sign-in will find it. Putting it here would mean
 * two controllers setting the session cookie and one of them reaching into
 * the other's options.
 */
@Controller("auth/mfa")
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  private ctx(req: AuthedRequest, ip: string | null) {
    return { ip, userAgent: req.headers["user-agent"] ?? null };
  }

  /** Whether it is on, since when, and how many codes are left. */
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user.id);
  }

  /**
   * Step 2 — a secret, a QR code and a manual key.
   *
   * Throttled: each call discards the previous pending secret and computes a
   * QR symbol, so an unbounded loop is both wasteful and a way to keep an
   * enrolment permanently un-finishable in another tab. Twenty a minute is
   * far more than a person setting up a phone will ever need.
   */
  @Post("enroll")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  start(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.mfa.startEnrolment(user, this.ctx(req, ip));
  }

  /**
   * Step 3 — the first correct code, and the recovery codes.
   *
   * Ten a minute, matching `/auth/login`. The code is six digits, so the
   * search space is a million and the throttle is what makes guessing it
   * pointless — the per-challenge ceiling that bounds a *sign-in* has no
   * equivalent here, because an enrolment is already authenticated and
   * consuming it on five mistakes would be a way to lock somebody out of
   * their own setup screen.
   */
  @Post("enroll/verify")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(
    @Body() dto: VerifyEnrolmentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.mfa.verifyEnrolment(user, dto.code, this.ctx(req, ip));
  }

  /**
   * Turns it off. Behind recent authentication — see `MfaService.disable`.
   *
   * `POST … /disable` rather than `DELETE /auth/mfa`, and the reason is the
   * body: the re-authentication proof travels in it, and a `DELETE` with a
   * body is a shape several proxies and one fetch polyfill quietly drop.
   */
  @Post("disable")
  @HttpCode(204)
  async disable(
    @Body() dto: ReauthenticatedDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    await this.mfa.disable(user, dto.reauthToken, this.ctx(req, ip));
  }

  /** A new set; the old ones stop working. Behind recent authentication. */
  @Post("recovery-codes")
  @HttpCode(200)
  regenerate(
    @Body() dto: ReauthenticatedDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.mfa.regenerateRecoveryCodes(user, dto.reauthToken, this.ctx(req, ip));
  }
}
