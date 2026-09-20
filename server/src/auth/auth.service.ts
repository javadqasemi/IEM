import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuditOutcome, type User } from "@prisma/client";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../core/audit/audit.service";
import { SettingsService } from "../core/settings/settings.service";
import { afterFailedLogin, isLockedOut, judgeRefresh } from "./auth.rules";
import { MfaService, type FactorOutcome } from "./mfa.service";
import { ReauthService } from "./reauth.service";
import {
  POLICY_BOUNDS,
  POLICY_SETTING_KEYS,
  resolveLockoutPolicy,
  resolvePasswordPolicy,
  type LockoutPolicy,
  type PasswordPolicy,
} from "./security.policy";
import { refuseRevoke, toSessionViews, type SessionView } from "./sessions.rules";
import type { AuthUser } from "../common/decorators";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

/**
 * What a correct password buys, which is now two different things.
 *
 * A discriminated union rather than an optional `challenge` beside an
 * optional `accessToken`, because the two outcomes have **nothing in
 * common**: one carries a session and the other deliberately carries none.
 * An optional-field shape would let the controller set a refresh cookie on
 * the second by forgetting a branch, and forgetting a branch there means the
 * second factor is not a factor.
 */
export type LoginOutcome =
  | ({ kind: "session"; user: unknown } & TokenPair)
  /**
   * The password was right and the factor has not been shown.
   *
   * No token of any kind is issued here. The challenge grants nothing except
   * the right to present a code against one account within five minutes.
   */
  | { kind: "mfa"; challenge: string; expiresIn: number };

type Ctx = {
  ip?: string | null;
  userAgent?: string | null;
  /**
   * The refresh cookie this request carried, where a caller needs to know
   * whether it acted on its *own* session. Only `revokeSession` reads it, and
   * it is hashed before any comparison — the raw value never leaves the
   * request.
   */
  presentedRefreshToken?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    /**
     * The dependency points one way — `AuthService` → `MfaService` — and that
     * is what keeps `AuthModule` free of a `forwardRef`. This service knows
     * how to issue a session and asks the other whether it may; the other
     * knows what a factor is and issues nothing.
     */
    private readonly mfa: MfaService,
    private readonly reauth: ReauthService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Passwords                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Argon2id, the current password-hashing recommendation — memory-hard, so a
   * GPU farm gains far less against it than against bcrypt. Parameters are the
   * OWASP baseline: 19 MiB, two passes.
   */
  hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private verifyPassword(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain).catch(() => false);
  }

  /* ---------------------------------------------------------------- */
  /* Sign in                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Email and password, and then possibly a second step.
   *
   * **Nothing is issued before the factor passes.** Where the account has a
   * verified credential this returns a challenge and no tokens at all — not a
   * restricted access token, not a refresh cookie — because a partial session
   * is a session, and every route that forgot to check its restriction would
   * be a way past the factor. The only thing the browser holds between the
   * two steps is an opaque string that can do exactly one thing.
   *
   * The lockout counters are cleared here rather than after the factor,
   * because they count *password* failures and the password was right. What
   * is deliberately **not** written yet is `lastLoginAt` and the
   * `INVITED → ACTIVE` promotion: neither is true until somebody is actually
   * signed in, and a "last seen" that moved when a stranger typed the right
   * password and then failed the factor would hide the one event worth
   * noticing.
   */
  async login(email: string, password: string, ctx: Ctx): Promise<LoginOutcome> {
    const now = new Date();
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
    });

    // One message for "no such user", "wrong password" and "not activated".
    // Distinguishing them turns the sign-in form into a way to find out which
    // addresses have accounts.
    const deny = () => new UnauthorizedException("E-Mail oder Passwort ist falsch.");

    if (!user || !user.passwordHash) {
      // Still audit it: a burst of failures against addresses that do not
      // exist is exactly the pattern worth being able to see afterwards.
      this.audit.record({
        action: "auth.login_failed",
        resource: "user",
        resourceId: null,
        outcome: AuditOutcome.FAILURE,
        message: `Unbekannte Adresse: ${email}`,
        ...ctx,
      });
      throw deny();
    }

    if (isLockedOut(user, now)) {
      this.audit.record({
        action: "auth.login_locked",
        resource: "user",
        resourceId: user.id,
        outcome: AuditOutcome.DENIED,
        ...ctx,
      });
      throw new UnauthorizedException(
        "Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.",
      );
    }

    if (user.status === "SUSPENDED") {
      this.audit.record({
        action: "auth.login_suspended",
        resource: "user",
        resourceId: user.id,
        outcome: AuditOutcome.DENIED,
        ...ctx,
      });
      throw new UnauthorizedException("Dieses Konto ist gesperrt.");
    }

    const ok = await this.verifyPassword(user.passwordHash, password);
    if (!ok) {
      /*
        The streak restarts once a lockout has been served — see
        `afterFailedLogin`, which is where the reason is written down and
        where every boundary of it is tested.

        The threshold and the duration are the organisation's policy now
        rather than constants, resolved and clamped by `security.policy.ts`.
        The clamp is what keeps this safe to configure: the numbers can be
        tightened for an incident and cannot be loosened past the bounds.
      */
      const policy = await this.lockoutPolicy();
      const next = afterFailedLogin(user, now, policy);
      await this.prisma.user.update({
        where: { id: user.id },
        data: next,
      });
      this.audit.record({
        action: "auth.login_failed",
        resource: "user",
        resourceId: user.id,
        outcome: AuditOutcome.FAILURE,
        message: `Fehlversuch ${next.failedLogins}/${policy.maxFailedLogins}`,
        ...ctx,
      });
      throw deny();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });

    if (await this.mfa.requiresFactor(user.id)) {
      const challenge = await this.mfa.createChallenge(user.id, ctx);
      this.audit.record({
        action: "auth.mfa_challenged",
        resource: "user",
        resourceId: user.id,
        actor: { id: user.id, email: user.email } as AuthUser,
        message: "Passwort akzeptiert, zweiter Faktor angefordert.",
        ...ctx,
      });
      return {
        kind: "mfa",
        challenge: challenge.token,
        expiresIn: Math.round((challenge.expiresAt.getTime() - Date.now()) / 1000),
      };
    }

    return { kind: "session", ...(await this.completeSignIn(user, ctx)) };
  }

  /**
   * Finishes a sign-in that was interrupted by the second factor.
   *
   * Here rather than in `MfaService` because issuing a session is this
   * service's business and nothing else's — the other one decides whether the
   * factor held and returns an account id.
   *
   * `outcome` travels back to the controller so the dashboard can say *"noch
   * 2 Wiederherstellungscodes"* on the screen the reader is already looking
   * at. Somebody who has just spent a code is exactly the person who needs to
   * be told how many are left, and a notification a week later is a
   * notification nobody reads.
   */
  async completeMfaChallenge(
    challenge: string,
    input: { code?: string; recoveryCode?: string },
    ctx: Ctx,
  ): Promise<TokenPair & { user: unknown } & FactorOutcome> {
    const result = await this.mfa.completeChallenge(challenge, input, ctx);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    return {
      ...(await this.completeSignIn(user, ctx)),
      usedRecoveryCode: result.usedRecoveryCode,
      remainingRecoveryCodes: result.remainingRecoveryCodes,
    };
  }

  /**
   * The last three things every successful sign-in does, whatever route it
   * took to get here.
   *
   * One method rather than two copies, because the copy is where the two
   * paths would drift — an `INVITED` user who enrolled a second factor and
   * then signed in would stay `INVITED` for ever if only the password path
   * promoted them.
   */
  private async completeSignIn(
    user: User,
    ctx: Ctx,
  ): Promise<TokenPair & { user: unknown }> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        // An invited user becomes active the first time they sign in.
        status: user.status === "INVITED" ? "ACTIVE" : user.status,
      },
    });

    this.audit.record({
      action: "auth.login",
      resource: "user",
      resourceId: user.id,
      actor: { id: user.id, email: user.email } as AuthUser,
      ...ctx,
    });

    const tokens = await this.issue(user, ctx);
    return { ...tokens, user: await this.profile(user.id) };
  }

  /* ---------------------------------------------------------------- */
  /* Re-authentication                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Proves, again, that the person at the keyboard is the account holder.
   *
   * The password **and**, where the account has one, the second factor. Both,
   * not either: a re-authentication that a password alone satisfies is worth
   * nothing against the threat MFA was enrolled for, and one that only takes
   * a code would let somebody who watched a phone screen turn the factor off.
   *
   * Audited in both directions. A burst of failures here is somebody trying
   * passwords against a session they already hold, which is a different and
   * more interesting event than a failed sign-in.
   *
   * It is **not** a way to sign in: the caller is already authenticated, the
   * account comes from the verified token, and a wrong password costs nothing
   * but an audit row. It is therefore deliberately outside the account
   * lockout — locking an account out of its own settings screen would be a
   * denial of service somebody could aim at a colleague from a shared desk.
   * The route's own throttle is what bounds it.
   */
  async reauthenticate(
    actor: AuthUser,
    input: { password: string; code?: string; recoveryCode?: string },
    ctx: Ctx,
  ): Promise<{ token: string; expiresAt: string }> {
    const deny = () =>
      new UnauthorizedException("Passwort oder Code stimmt nicht.");

    const user = await this.prisma.user.findFirst({
      where: { id: actor.id, deletedAt: null, status: "ACTIVE" },
    });
    if (!user?.passwordHash || !(await this.verifyPassword(user.passwordHash, input.password))) {
      this.audit.record({
        actor,
        action: "auth.reauthentication_failed",
        resource: "user",
        resourceId: actor.id,
        outcome: AuditOutcome.FAILURE,
        message: "Falsches Passwort bei der erneuten Bestätigung.",
        ...ctx,
      });
      throw deny();
    }

    if (await this.mfa.requiresFactor(user.id)) {
      const outcome = await this.mfa.verifyFactor(user.id, input);
      if (!outcome) {
        this.audit.record({
          actor,
          action: "auth.reauthentication_failed",
          resource: "user",
          resourceId: actor.id,
          outcome: AuditOutcome.FAILURE,
          message: "Zweiter Faktor bei der erneuten Bestätigung nicht akzeptiert.",
          ...ctx,
        });
        throw deny();
      }
      if (outcome.usedRecoveryCode) {
        this.audit.record({
          actor,
          action: "auth.mfa_recovery_used",
          resource: "user",
          resourceId: actor.id,
          message:
            `Wiederherstellungscode zur erneuten Bestätigung verwendet; ` +
            `${outcome.remainingRecoveryCodes} verbleiben.`,
          ...ctx,
        });
      }
    }

    const { token, expiresAt } = await this.reauth.open(user.id);
    this.audit.record({
      actor,
      action: "auth.reauthenticated",
      resource: "user",
      resourceId: actor.id,
      ...ctx,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /* ---------------------------------------------------------------- */
  /* Tokens                                                            */
  /* ---------------------------------------------------------------- */

  private async issue(user: User, ctx: Ctx): Promise<TokenPair> {
    const ttl = await this.accessTtl();
    // No version claim: see `AccessTokenPayload` in `guards.ts` for why one was
    // removed rather than implemented.
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        // See the note in `auth.module.ts`: `jsonwebtoken` types `expiresIn`
        // as a literal union no environment-sourced string can satisfy.
        expiresIn: ttl as unknown as number,
      },
    );

    // The refresh token is opaque random bytes, not a JWT: it is stored, so it
    // has to be revocable, and there is nothing to gain from making it
    // self-describing when the server looks it up anyway.
    const refreshToken = randomBytes(48).toString("base64url");
    const days = Number(this.config.get("REFRESH_TTL_DAYS") ?? 30);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
      },
    });

    return { accessToken, refreshToken, expiresIn: parseTtl(ttl) };
  }

  /**
   * How long an access token lasts, as a `jsonwebtoken` duration string.
   *
   * `security.sessionTimeoutMinutes` is the source and `JWT_ACCESS_TTL` is the
   * fallback. The setting existed from the start, was labelled "Gültigkeit des
   * Zugriffstokens", and was read by nothing — so shortening a session in the
   * dashboard changed no session.
   *
   * Clamped to 1–240 minutes by `SettingsService.number`. The ceiling is the
   * point: this token is a bearer credential that cannot be revoked before it
   * expires (the *refresh* token is the revocable half), so an operator typing
   * 10000 into a box should not be able to mint day-long ones. The floor keeps a
   * typo from issuing tokens that expire before the response arrives.
   *
   * Read per issue rather than cached — that is one indexed row on sign-in and
   * on refresh, and it means a change applies to the next token rather than
   * after a restart. A session already running keeps its current token until it
   * expires, which is why the setting's description says so.
   */
  private async accessTtl(): Promise<string> {
    const envTtl = this.config.get<string>("JWT_ACCESS_TTL") ?? "15m";
    try {
      const minutes = await this.settings.number(
        POLICY_SETTING_KEYS.sessionTimeoutMinutes,
        Math.max(1, Math.round(parseTtl(envTtl) / 60)),
        POLICY_BOUNDS.sessionTimeoutMinutes.min,
        POLICY_BOUNDS.sessionTimeoutMinutes.max,
      );
      return `${minutes}m`;
    } catch {
      // A settings read that fails must not stop anyone signing in.
      return envTtl;
    }
  }

  /**
   * The lockout numbers the organisation has set, clamped.
   *
   * Read per failed attempt rather than cached, for the same reason
   * `accessTtl` is: a threshold tightened during an incident should apply to
   * the next attempt, not after a restart. A failed sign-in is not a hot
   * path — it is, by construction, something that should be rare.
   *
   * **A settings read that fails falls back to the defaults rather than to
   * no lockout.** The failure mode of the other direction is the one that
   * matters: a database hiccup must not quietly turn the brake off.
   */
  private async lockoutPolicy(): Promise<LockoutPolicy> {
    try {
      const raw = await this.settings.values([
        POLICY_SETTING_KEYS.maxFailedLogins,
        POLICY_SETTING_KEYS.lockoutMinutes,
      ]);
      return resolveLockoutPolicy({
        maxFailedLogins: raw[POLICY_SETTING_KEYS.maxFailedLogins],
        lockoutMinutes: raw[POLICY_SETTING_KEYS.lockoutMinutes],
      });
    } catch {
      return resolveLockoutPolicy({});
    }
  }

  /** The password policy, clamped so it can only be stricter than the floor. */
  async passwordPolicy(): Promise<PasswordPolicy> {
    try {
      const raw = await this.settings.values([POLICY_SETTING_KEYS.passwordMinLength]);
      return resolvePasswordPolicy({
        passwordMinLength: raw[POLICY_SETTING_KEYS.passwordMinLength],
      });
    } catch {
      return resolvePasswordPolicy({});
    }
  }

  /**
   * Exchanges a refresh token for a new pair, rotating it.
   *
   * Rotation plus reuse detection: each refresh revokes the token it was given
   * and records the replacement. A token presented *after* it was rotated is
   * evidence that two parties hold the same credential, and the answer is to
   * revoke the whole family — which signs the attacker and the legitimate user
   * out together. Logging both out is the right trade; the alternative leaves
   * the attacker holding a live session.
   *
   * **What was wrong with that as the only rule.** Rotation has a gap nothing on
   * the client can close: the replacement travels back in a `Set-Cookie`, so
   * anything already in flight is still carrying the old token. Two tabs
   * restoring a session in the same instant therefore presented it twice, the
   * second was read as theft, and every session the user had was revoked. It
   * surfaced as *"the dashboard signs me out at random"*, it got worse the more
   * tabs somebody kept open, and there was no fix available to a client because
   * the second request was sent before the first reply existed.
   *
   * `judgeRefresh` separates the two. Inside `REFRESH_GRACE_MS` of the rotation
   * the old token is a race and is served; outside it, it is a replay and the
   * family goes. A token revoked with no successor was ended on purpose — a
   * sign-out, a password change — and is refused without the alarm.
   *
   * Both grace cases are audited. A quiet weakening of a theft control is worth
   * nothing to the operator who has to decide whether an account was taken.
   */
  async refresh(presented: string, ctx: Ctx): Promise<TokenPair> {
    const hash = sha256(presented);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!row) throw new UnauthorizedException("Sitzung ungültig. Bitte neu anmelden.");

    const verdict = judgeRefresh(row, new Date());

    if (verdict === "replayed") {
      await this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.audit.record({
        action: "auth.refresh_reuse_detected",
        resource: "user",
        resourceId: row.userId,
        outcome: AuditOutcome.DENIED,
        message: "Bereits verwendetes Refresh-Token vorgelegt — alle Sitzungen beendet.",
        ...ctx,
      });
      throw new UnauthorizedException("Sitzung ungültig. Bitte neu anmelden.");
    }

    if (verdict === "ended") {
      // Deliberately revoked: a sign-out elsewhere, a password change, a reset.
      // Recorded as a denial so the log can tell it apart from a replay, and
      // *not* answered by revoking a family that is already gone.
      this.audit.record({
        action: "auth.refresh_revoked",
        resource: "user",
        resourceId: row.userId,
        outcome: AuditOutcome.DENIED,
        message: "Beendete Sitzung vorgelegt.",
        ...ctx,
      });
      throw new UnauthorizedException("Sitzung beendet. Bitte neu anmelden.");
    }

    if (verdict === "expired") {
      throw new UnauthorizedException("Sitzung abgelaufen. Bitte neu anmelden.");
    }

    if (row.user.deletedAt || row.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Dieses Konto ist nicht mehr aktiv.");
    }

    const next = await this.issue(row.user, ctx);

    if (verdict === "concurrent") {
      /*
        The row is already revoked and already names its successor. Leaving both
        alone is deliberate: overwriting `replacedById` would break the chain
        this decision reads, and revoking the successor would end whichever tab
        actually received it — the one thing that is certainly a live session.
        The unclaimed token expires on its own.
      */
      this.audit.record({
        action: "auth.refresh_concurrent",
        resource: "user",
        resourceId: row.userId,
        actor: { id: row.user.id, email: row.user.email } as AuthUser,
        message: "Rotiertes Token innerhalb der Toleranz erneut vorgelegt — gleichzeitige Anfrage.",
        ...ctx,
      });
      return next;
    }

    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: {
        revokedAt: new Date(),
        replacedById: sha256(next.refreshToken),
      },
    });
    return next;
  }

  async logout(presented: string | undefined, actor: AuthUser | null, ctx: Ctx): Promise<void> {
    if (presented) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(presented), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.audit.record({ action: "auth.logout", resource: "user", resourceId: actor?.id, actor, ...ctx });
  }

  /* ---------------------------------------------------------------- */
  /* Sessions                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * The live sessions of one account.
   *
   * `revokedAt: null` is the whole grouping: rotation revokes as it issues,
   * so a live session is exactly one row. See the note at the top of
   * `sessions.rules.ts` for why that is a consequence rather than a choice,
   * and why this reports *last activity* rather than a sign-in time.
   *
   * `presented` is the caller's refresh cookie, hashed here so the comparison
   * happens against the same column the server authenticates with — and so
   * nothing but the hash is ever held. A caller with no cookie gets a list
   * with no current session marked, which is true.
   */
  async sessions(userId: string, presented: string | undefined): Promise<SessionView[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      // Explicit: the default would carry `tokenHash` and `replacedById` out
      // of the repository, and the only thing standing between those and a
      // response body would be somebody remembering to strip them.
      select: {
        id: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
        tokenHash: true,
      },
    });

    return toSessionViews(rows, presented ? sha256(presented) : null, new Date());
  }

  /**
   * Ends one session.
   *
   * Scoped by `userId` in the `where` *and* checked by `refuseRevoke`. Two
   * answers to one question on purpose: the scope is what makes another
   * account's session unreachable, and the rule is what makes a mistake in
   * the scope visible rather than silent.
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    actor: AuthUser | null,
    ctx: Ctx,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    const row = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, revokedAt: null },
      select: { id: true, userId: true, tokenHash: true },
    });

    const refusal = refuseRevoke(row, userId);
    if (refusal) throw new BadRequestException(refusal);

    await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    this.audit.record({
      action: "auth.session_revoked",
      resource: "user",
      resourceId: userId,
      actor,
      message: `Sitzung ${sessionId} beendet.`,
      ...ctx,
    });

    const presented = ctx.presentedRefreshToken;
    return {
      revoked: true,
      wasCurrent: Boolean(presented && row!.tokenHash === sha256(presented)),
    };
  }

  /**
   * Ends every session **except** the one asking.
   *
   * Distinct from `logoutAll`, which ends that one too. The difference is the
   * whole point of the control: "sign out my other devices" is something you
   * do *because* you intend to keep working here, and an implementation that
   * signed the caller out as well would be indistinguishable from the sign-out
   * button they did not press.
   */
  async revokeOtherSessions(
    userId: string,
    presented: string | undefined,
    actor: AuthUser | null,
    ctx: Ctx,
  ): Promise<{ revoked: number }> {
    const keep = presented ? sha256(presented) : null;

    const { count } = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        // `not: null` would be wrong when there is no cookie: it matches
        // nothing, so a caller without one would revoke nothing and be told
        // it worked. Omitting the clause revokes all of them, which is the
        // correct reading of "everything other than a session I do not have".
        ...(keep ? { tokenHash: { not: keep } } : {}),
      },
      data: { revokedAt: new Date() },
    });

    this.audit.record({
      action: "auth.sessions_revoked_others",
      resource: "user",
      resourceId: userId,
      actor,
      message: `${count} weitere Sitzung(en) beendet.`,
      ...ctx,
    });

    return { revoked: count };
  }

  /**
   * "Sign out everywhere" — the profile page, a role change, and an
   * administrator ending somebody else's sessions.
   *
   * `userId` is the account being ended and `actor` is whoever asked, which
   * are the same person for the first two callers and deliberately not for the
   * third. The audit row already recorded both, so an administrative
   * revocation needs no separate action name: "who did it to whom" is the
   * question the log has to answer and it answers it either way.
   *
   * Returns the count rather than `void` so a screen can say *how many* were
   * ended. Nothing about the existing callers changes — they ignore it — but
   * "3 Sitzungen beendet" and "nothing happened" are different outcomes and a
   * `void` cannot tell them apart.
   */
  async logoutAll(
    userId: string,
    actor: AuthUser | null,
    ctx: Ctx,
  ): Promise<{ revoked: number }> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // The re-authentication window goes with the sessions. This is one of the
    // moments where "the same person is still there" stops being something
    // the server may assume, and a surviving window would be a standing
    // capability to switch a second factor off.
    await this.reauth.closeAll(userId);
    this.audit.record({
      action: "auth.logout_all",
      resource: "user",
      resourceId: userId,
      actor,
      ...ctx,
    });
    return { revoked: count };
  }

  /* ---------------------------------------------------------------- */
  /* Profile and password change                                       */
  /* ---------------------------------------------------------------- */

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        locale: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        roles: {
          select: {
            role: {
              select: {
                key: true,
                name: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });

    const roles = user.roles.map((r) => ({ key: r.role.key, name: r.role.name }));
    const permissions = [
      ...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
    ].sort();

    // The dashboard renders its navigation from this list, so Super Admin has
    // to come back as something it can check — hence the explicit flag rather
    // than expecting the client to infer omnipotence from a long array.
    return {
      ...user,
      roles,
      permissions,
      isSuperAdmin: roles.some((r) => r.key === "super_admin"),
    };
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
    actor: AuthUser,
    ctx: Ctx,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await this.verifyPassword(user.passwordHash, current))) {
      throw new BadRequestException("Das aktuelle Passwort ist falsch.");
    }
    assertPasswordStrength(next, await this.passwordPolicy());

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(next) },
    });
    // Every other session is now holding a token that was issued against the
    // old password. Ending them is the whole point of changing it.
    await this.logoutAll(userId, actor, ctx);
    this.audit.record({ action: "auth.password_changed", resource: "user", resourceId: userId, actor, ...ctx });
  }

  /* ---------------------------------------------------------------- */
  /* Password reset                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Starts a reset. Returns the token so the caller can mail it.
   *
   * Always resolves, whether or not the address exists — the response must not
   * differ, or this endpoint becomes an address-enumeration oracle.
   */
  async requestReset(email: string, ctx: Ctx): Promise<{ token: string; userId: string } | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
    });
    if (!user) return null;

    const token = randomBytes(32).toString("base64url");
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    this.audit.record({
      action: "auth.password_reset_requested",
      resource: "user",
      resourceId: user.id,
      ...ctx,
    });
    return { token, userId: user.id };
  }

  async completeReset(token: string, password: string, ctx: Ctx): Promise<void> {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException("Dieser Link ist abgelaufen oder wurde bereits verwendet.");
    }
    assertPasswordStrength(password, await this.passwordPolicy());

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash: await this.hashPassword(password),
          failedLogins: 0,
          lockedUntil: null,
          status: "ACTIVE",
        },
      }),
      this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      // As in `logoutAll`: whoever set this password is not necessarily
      // whoever opened the window, so the window closes with the sessions.
      this.prisma.reauthToken.deleteMany({ where: { userId: row.userId } }),
    ]);

    this.audit.record({
      action: "auth.password_reset_completed",
      resource: "user",
      resourceId: row.userId,
      ...ctx,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Length over composition rules.
 *
 * Twelve characters with no class requirements produces better passwords than
 * eight with four character classes: the second reliably yields `Passwort1!`.
 * The only other check is against a short list of the ones people actually
 * pick for admin accounts.
 */
const OBVIOUS = ["passwort", "password", "12345678", "qwertz", "iemag", "admin123"];

/**
 * @param policy The organisation's, already clamped. Defaulted so a caller
 * without one still gets the floor rather than no check — the direction that
 * matters, since the failure of the other one is a password nobody checked.
 */
export function assertPasswordStrength(
  password: string,
  policy: PasswordPolicy = resolvePasswordPolicy({}),
): void {
  if (password.length < policy.minLength) {
    throw new BadRequestException(
      `Das Passwort muss mindestens ${policy.minLength} Zeichen lang sein.`,
    );
  }
  if (password.length > policy.maxLength) {
    throw new BadRequestException("Das Passwort ist zu lang.");
  }
  const lower = password.toLowerCase();
  /*
    The deny-list is an invariant, not a policy — see `security.policy.ts`.
    It stays in code because a list an operator can edit is a list that gets
    emptied the first time somebody's chosen password is refused by it.
  */
  if (OBVIOUS.some((o) => lower.includes(o))) {
    throw new BadRequestException("Dieses Passwort ist zu leicht zu erraten.");
  }
}

/**
 * `"15m"` → seconds, for the `expiresIn` in the response body.
 *
 * It used to say "which the client uses to pre-refresh", and the client does no
 * such thing — nothing in `src/` reads the field. That is deliberate rather than
 * missing: a timer in every tab that renews a token nobody is using would be
 * more rotations, more races and a session that never ends for a browser left
 * open on a desk. The dashboard refreshes when a request comes back 401, retries
 * it once, and the user sees one extra round trip they cannot feel.
 *
 * The number stays in the response because it is true and an operator reading a
 * network tab wants it; the comment is corrected rather than the behaviour.
 */
function parseTtl(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 900;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
}

