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
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/decorators";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type Ctx = { ip?: string | null; userAgent?: string | null };

/**
 * How long a failed-login streak locks an account, and at what count.
 *
 * Fifteen minutes after five attempts is slow enough to make online guessing
 * pointless and short enough that a person who mistyped their password twice
 * and then went to look it up is not calling support. The counter clears on
 * every success.
 */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
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

  async login(email: string, password: string, ctx: Ctx): Promise<TokenPair & { user: unknown }> {
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

    if (user.lockedUntil && user.lockedUntil > new Date()) {
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
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
        },
      });
      this.audit.record({
        action: "auth.login_failed",
        resource: "user",
        resourceId: user.id,
        outcome: AuditOutcome.FAILURE,
        message: `Fehlversuch ${failed}/${MAX_FAILED_LOGINS}`,
        ...ctx,
      });
      throw deny();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
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
  /* Tokens                                                            */
  /* ---------------------------------------------------------------- */

  private async issue(user: User, ctx: Ctx): Promise<TokenPair> {
    const ttl = this.config.get<string>("JWT_ACCESS_TTL") ?? "15m";
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
   * Exchanges a refresh token for a new pair, rotating it.
   *
   * Rotation plus reuse detection: each refresh revokes the token it was given
   * and records the replacement. If a *already revoked* token is presented,
   * that means someone is replaying a stolen copy — the whole family is then
   * revoked, which signs the attacker and the legitimate user out together.
   * Logging both out is the right trade; the alternative leaves the attacker
   * holding a live session.
   */
  async refresh(presented: string, ctx: Ctx): Promise<TokenPair> {
    const hash = sha256(presented);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!row) throw new UnauthorizedException("Sitzung ungültig. Bitte neu anmelden.");

    if (row.revokedAt) {
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

    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException("Sitzung abgelaufen. Bitte neu anmelden.");
    }
    if (row.user.deletedAt || row.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Dieses Konto ist nicht mehr aktiv.");
    }

    const next = await this.issue(row.user, ctx);
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

  /** "Sign out everywhere" — used from the profile page and on role changes. */
  async logoutAll(userId: string, actor: AuthUser | null, ctx: Ctx): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.audit.record({
      action: "auth.logout_all",
      resource: "user",
      resourceId: userId,
      actor,
      ...ctx,
    });
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
    assertPasswordStrength(next);

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
    assertPasswordStrength(password);

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

export function assertPasswordStrength(password: string): void {
  if (password.length < 12) {
    throw new BadRequestException("Das Passwort muss mindestens 12 Zeichen lang sein.");
  }
  if (password.length > 256) {
    throw new BadRequestException("Das Passwort ist zu lang.");
  }
  const lower = password.toLowerCase();
  if (OBVIOUS.some((o) => lower.includes(o))) {
    throw new BadRequestException("Dieses Passwort ist zu leicht zu erraten.");
  }
}

/** `"15m"` → seconds, for the `expiresIn` the client uses to pre-refresh. */
function parseTtl(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 900;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
}
