import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../common/prisma.service";
import {
  IS_PUBLIC,
  PERMISSIONS_KEY,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

/** What the access token carries. Kept small — it is sent on every request. */
export type AccessTokenPayload = {
  sub: string;
  email: string;
  /** Token version, bumped when a user's roles change. See below. */
  v: number;
};

/**
 * Authentication.
 *
 * Registered globally and **denies by default**: a route is protected unless
 * it carries `@Public()`. That way a controller added later by someone who has
 * not read this file is closed rather than open, and every exception is a
 * visible, greppable decision.
 *
 * The caller's permissions are resolved from the database on each request
 * rather than being packed into the token. That is a read per request, and it
 * buys the thing a permission system exists for: revoking a role takes effect
 * immediately instead of whenever the token happens to expire. The read is a
 * single indexed join and Postgres serves it from cache.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    if (!token) throw new UnauthorizedException("Nicht angemeldet.");

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Sitzung abgelaufen. Bitte neu anmelden.");
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: "ACTIVE" },
      select: {
        id: true,
        email: true,
        name: true,
        roles: {
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });
    // A token for a user who has since been suspended or deleted is not an
    // expired token — say so plainly rather than letting it look like a bug.
    if (!user) throw new UnauthorizedException("Dieses Konto ist nicht mehr aktiv.");

    const roles = user.roles.map((r) => r.role.key);
    const permissions = new Set<string>();
    for (const r of user.roles) {
      for (const p of r.role.permissions) permissions.add(p.permission.key);
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
      permissions,
      isSuperAdmin: roles.includes("super_admin"),
    } satisfies AuthUser;

    return true;
  }
}

/**
 * Authorisation.
 *
 * Runs after `JwtAuthGuard` and checks the keys a route declared with
 * `@RequirePermissions`. A route with none is open to any signed-in user — the
 * dashboard has a few of those (own profile, own notifications) and they are
 * the right shape for it.
 *
 * Super Admin short-circuits on the *role*, not on holding every key. A role
 * that merely listed all permissions would quietly stop being omnipotent the
 * moment a new permission was added to the catalogue — which is exactly the
 * moment you least want the only account that can fix things to lose access.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) throw new UnauthorizedException("Nicht angemeldet.");
    if (user.isSuperAdmin) return true;

    const missing = required.filter((k) => !user.permissions.has(k));
    if (missing.length) {
      // Name the missing permission. An administrator debugging someone else's
      // access needs to know *which* one, and it is not a secret — the whole
      // catalogue is visible in the role editor.
      throw new ForbiddenException(
        `Fehlende Berechtigung: ${missing.join(", ")}.`,
      );
    }
    return true;
  }
}

function bearer(req: AuthedRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  // The dashboard can also send the access token as a same-site cookie, which
  // keeps it out of JavaScript's reach on that path.
  const cookie = (req as unknown as { cookies?: Record<string, string> }).cookies?.access_token;
  return cookie || null;
}
