import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type UserStatus } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../core/audit/audit.service";
import { AuthService } from "../auth/auth.service";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  status: true,
  locale: true,
  mfaEnabled: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: { select: { id: true, key: true, name: true, rank: true } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(params: { search?: string; status?: UserStatus; roleKey?: string; page?: number; perPage?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.roleKey ? { roles: { some: { role: { key: params.roleKey } } } } : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { email: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: PUBLIC_FIELDS,
        orderBy: { name: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
  }

  async get(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: PUBLIC_FIELDS,
    });
    if (!user) throw new NotFoundException("Benutzer nicht gefunden.");
    return user;
  }

  /**
   * Invites a user.
   *
   * No password is set here and none is sent: the invite carries a one-time
   * reset token and the recipient chooses their own. Mailing a generated
   * password puts a live credential in an inbox and in whatever archives that
   * inbox is backed up to.
   */
  async invite(
    input: { email: string; name: string; roleIds: string[] },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && !existing.deletedAt) {
      throw new BadRequestException("Diese Adresse ist bereits vergeben.");
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        status: "INVITED",
        roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
      },
      select: PUBLIC_FIELDS,
    });

    const token = randomBytes(32).toString("base64url");
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        // A week, not an hour: an invitation sits in an inbox over a weekend,
        // and an expired invite means a support request rather than a risk.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    this.audit.record({
      actor,
      action: "user.invited",
      resource: "user",
      resourceId: user.id,
      after: { email, name: user.name, roles: input.roleIds },
      ...ctx,
    });
    return { user, inviteToken: token };
  }

  async update(
    id: string,
    input: { name?: string; avatarUrl?: string | null; locale?: string; status?: UserStatus },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const before = await this.get(id);
    this.assertNotSelfDemotion(id, actor, input.status);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: PUBLIC_FIELDS,
    });

    // Suspension has to end the sessions, or the account stays usable until
    // the refresh token expires — which is the opposite of what was asked for.
    if (input.status === "SUSPENDED") {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    this.audit.record({
      actor,
      action: "user.updated",
      resource: "user",
      resourceId: id,
      before,
      after: user,
      ...ctx,
    });
    return user;
  }

  /**
   * Replaces a user's roles.
   *
   * Sessions are ended afterwards. `JwtAuthGuard` resolves permissions per
   * request so a *reduction* takes effect immediately anyway — but ending the
   * session means the dashboard re-reads its navigation and the user is not
   * left looking at menu items that now 403.
   */
  async setRoles(id: string, roleIds: string[], actor: AuthUser, ctx: Ctx) {
    const before = await this.get(id);
    await this.assertKeepsOneSuperAdmin(id, roleIds);
    if (id === actor.id && !(await this.rolesInclude(roleIds, "super_admin")) && actor.isSuperAdmin) {
      throw new ForbiddenException(
        "Die eigene Super-Admin-Rolle kann nicht entzogen werden — das sperrt Sie aus.",
      );
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    const after = await this.get(id);
    this.audit.record({
      actor,
      action: "user.roles_changed",
      resource: "user",
      resourceId: id,
      before: before.roles,
      after: after.roles,
      ...ctx,
    });
    return after;
  }

  /** Soft delete, so the audit log keeps pointing at a row that exists. */
  async remove(id: string, actor: AuthUser, ctx: Ctx) {
    if (id === actor.id) throw new ForbiddenException("Das eigene Konto kann nicht gelöscht werden.");
    await this.assertKeepsOneSuperAdmin(id, []);

    const before = await this.get(id);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: "SUSPENDED",
          // The address is freed for reuse and the original preserved in the
          // audit log — otherwise the unique index blocks re-inviting someone
          // who left and came back.
          email: `deleted+${id}@iem.invalid`,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.audit.record({
      actor,
      action: "user.deleted",
      resource: "user",
      resourceId: id,
      before,
      ...ctx,
    });
  }

  async resetPasswordFor(id: string, actor: AuthUser, ctx: Ctx) {
    const user = await this.get(id);
    const result = await this.auth.requestReset(user.email, ctx);
    this.audit.record({
      actor,
      action: "user.password_reset_sent",
      resource: "user",
      resourceId: id,
      ...ctx,
    });
    return result;
  }

  /* ---- Guard rails ------------------------------------------------ */

  private async rolesInclude(roleIds: string[], key: string): Promise<boolean> {
    if (!roleIds.length) return false;
    const n = await this.prisma.role.count({ where: { id: { in: roleIds }, key } });
    return n > 0;
  }

  private assertNotSelfDemotion(id: string, actor: AuthUser, status?: UserStatus) {
    if (id === actor.id && status && status !== "ACTIVE") {
      throw new ForbiddenException("Das eigene Konto kann nicht deaktiviert werden.");
    }
  }

  /**
   * Refuses any change that would leave the install with no Super Admin.
   *
   * The failure this prevents is unrecoverable through the UI: with the last
   * Super Admin gone, nobody can publish, grant roles or restore one — the fix
   * is a database console. Worth one extra count per role change.
   */
  private async assertKeepsOneSuperAdmin(userId: string, nextRoleIds: string[]) {
    const isSuper = await this.prisma.userRole.count({
      where: { userId, role: { key: "super_admin" } },
    });
    if (!isSuper) return;
    if (await this.rolesInclude(nextRoleIds, "super_admin")) return;

    const others = await this.prisma.userRole.count({
      where: {
        role: { key: "super_admin" },
        userId: { not: userId },
        user: { deletedAt: null, status: "ACTIVE" },
      },
    });
    if (others === 0) {
      throw new ForbiddenException(
        "Dies ist der letzte aktive Super Admin. Zuerst einen weiteren ernennen.",
      );
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
