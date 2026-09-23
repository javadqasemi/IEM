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
import { MfaService } from "../auth/mfa.service";
import { ReauthService } from "../auth/reauth.service";
import type { AuthUser } from "../common/decorators";
import {
  SUPER_ADMIN_ROLE,
  added,
  permissionsOf,
  privilegeChangeNeedsReauth,
  refuseAdminister,
  refuseRoleGrant,
  type Principal,
  type RoleGrant,
} from "../rbac/privilege.rules";
import { principalOf, privilegeCeiling } from "../rbac/privilege.errors";

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
    /**
     * The same cross-feature *command* arrangement `AuthService` is here for,
     * and the alternative is the same: `UsersService` writing to
     * `MfaCredential` itself, which would make two writers of a
     * security-critical table — one of which understands the recovery codes
     * and the open challenges that have to go with it, and one of which does
     * not.
     */
    private readonly mfa: MfaService,
    /**
     * The recent-authentication window for privilege changes. The same
     * service the second factor and the restore use — there is one
     * definition of "proved it a moment ago" in this application.
     */
    private readonly reauth: ReauthService,
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

  /* ---------------------------------------------------------------- */
  /* Sessions — somebody else's                                        */
  /* ---------------------------------------------------------------- */

  /**
   * An administrator's view of one account's live sessions.
   *
   * Thin on purpose: `AuthService` already builds this for `/auth/sessions`
   * and it takes the account as an argument, so the administrative view is the
   * same query asked about a different id. A second implementation here would
   * be a second place the `tokenHash` allowlist has to be right.
   *
   * **`existing()` first, and it is not ceremony.** Without it an unknown or
   * deleted id answers `200 []` — "this person has no sessions" — which is the
   * same thing a real account with nobody signed in says. An administrator
   * checking whether a suspicious session is still live would read the wrong
   * answer to the question they actually asked.
   *
   * `presented` is the *caller's* refresh cookie, passed through rather than
   * dropped. Against somebody else's rows it can never match, so nothing is
   * marked current — which is correct. Against their own record it matches,
   * and the screen can warn them before they end the session they are using.
   * Both fall out of one line rather than needing a branch.
   */
  async sessionsOf(id: string, presented: string | undefined) {
    await this.existing(id);
    return this.auth.sessions(id, presented);
  }

  /**
   * Ends one of them.
   *
   * Scoped to the named account twice over — `AuthService.revokeSession`
   * takes the owner's id for its `where` *and* re-checks it in
   * `refuseRevoke` — so an administrator cannot reach a session belonging to
   * somebody other than the user whose page they are on, even by pasting an
   * id from another account.
   */
  async revokeSessionOf(id: string, sessionId: string, actor: AuthUser, ctx: Ctx) {
    await this.existing(id);
    await this.assertMayAdminister(id, actor);
    return this.auth.revokeSession(id, sessionId, actor, ctx);
  }

  /**
   * Ends all of them — the incident response, and the reason the two keys are
   * separate in the catalogue.
   *
   * `logoutAll` rather than `revokeOtherSessions`: an administrator acting on
   * somebody else's account has no session of their own among these rows to
   * keep, and "all except one I do not have" would be an odd thing to mean.
   * The one case where it matters is an administrator doing this to
   * *themselves*, where ending their own session is the honest outcome of the
   * button they pressed — and the screen says so before they press it.
   */
  async revokeAllSessionsOf(id: string, actor: AuthUser, ctx: Ctx) {
    await this.existing(id);
    await this.assertMayAdminister(id, actor);
    return this.auth.logoutAll(id, actor, ctx);
  }

  /**
   * Asserts the account is real and not deleted, and returns nothing.
   *
   * Separate from `get` because the session routes need the *check* and not
   * the record, and calling `get` for its exception would select eleven
   * columns and a role join to throw them away.
   */
  private async existing(id: string): Promise<void> {
    const found = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Benutzer nicht gefunden.");
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
    input: { email: string; name: string; roleIds: string[]; reauthToken?: string },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    /*
      An invitation that carries roles *is* a role assignment, so it answers
      to the same ceiling — otherwise `user.create` would be a way round
      `user.assign`, and the invite a way round the ceiling. A holder of
      `user.create` without `user.assign` may still invite; they may not
      decide what the invitee can do.
    */
    if (input.roleIds.length && !actor.isSuperAdmin && !actor.permissions.has("user.assign")) {
      throw ceiling("Rollen vergeben darf nur, wer Rollen zuweisen darf (user.assign).");
    }
    const roles = await this.rolesByIds(input.roleIds);
    const refusal = refuseRoleGrant(principal(actor), roles);
    if (refusal) throw ceiling(refusal);
    await this.requireReauthIf(
      privilegeChangeNeedsReauth(
        permissionsOf(roles),
        roles.some((r) => r.key === SUPER_ADMIN_ROLE),
      ),
      actor,
      input.reauthToken,
    );

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
    await this.assertMayAdminister(id, actor);
    // Suspending the last active Super Admin is the same lock-out as taking
    // the role away from them — nobody left can undo it from the dashboard.
    if (input.status !== undefined && input.status !== "ACTIVE") {
      await this.assertKeepsOneSuperAdmin(id, []);
    }

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
      // The re-authentication window goes with the sessions, everywhere. A
      // suspended account holding an open one would be an account that can
      // still authorise a security change for five minutes after it lost the
      // right to do anything at all.
      await this.prisma.reauthToken.deleteMany({ where: { userId: id } });
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
  async setRoles(
    id: string,
    roleIds: string[],
    actor: AuthUser,
    ctx: Ctx,
    reauthToken?: string,
  ) {
    const before = await this.get(id);

    /*
      The ceiling, in the order the questions are cheapest to answer wrongly:

      1. May the actor touch this account at all? Not if it holds anything
         the actor does not — that is how an Administrator is kept from
         stripping Geschäftsleitung or demoting a Super Admin.
      2. May the actor hand out each role being *added*? Removals cannot
         make anybody stronger; additions are judged by containment.
      3. Does what is being given need the password again?
    */
    const current = await this.rolesOfUser(id);
    const next = await this.rolesByIds(roleIds);
    if (id !== actor.id) {
      const refusal = refuseAdminister(principal(actor), principalFrom(current));
      if (refusal) throw ceiling(refusal);
    }
    const currentKeys = new Set(current.map((r) => r.key));
    const nextKeys = new Set(next.map((r) => r.key));
    const grantRefusal = refuseRoleGrant(
      principal(actor),
      next.filter((r) => !currentKeys.has(r.key)),
    );
    if (grantRefusal) throw ceiling(grantRefusal);
    await this.requireReauthIf(
      privilegeChangeNeedsReauth(
        added(permissionsOf(current), permissionsOf(next)),
        currentKeys.has(SUPER_ADMIN_ROLE) !== nextKeys.has(SUPER_ADMIN_ROLE),
      ),
      actor,
      reauthToken,
    );

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
      this.prisma.reauthToken.deleteMany({ where: { userId: id } }),
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
    await this.existing(id);
    await this.assertMayAdminister(id, actor);
    await this.assertKeepsOneSuperAdmin(id, []);

    const before = await this.get(id);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: "SUSPENDED",
          // The mirror follows the credential deleted below, in the same
          // transaction — the rule the column's own comment states.
          mfaEnabled: false,
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
      this.prisma.reauthToken.deleteMany({ where: { userId: id } }),
      /*
        The second factor goes with the account, and the recovery codes with
        it. `onDelete: Cascade` does not fire here — this is a *soft* delete,
        so the row stays and so would ten live one-time passwords and an
        encrypted secret belonging to somebody who no longer works here.
      */
      this.prisma.mfaCredential.deleteMany({ where: { userId: id } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: id } }),
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

  /**
   * Clears somebody's second factor — account recovery.
   *
   * Thin, like `sessionsOf` above and for the same reason: `MfaService`
   * already knows that clearing a credential means clearing its recovery
   * codes and closing any half-finished sign-in, and a second
   * implementation here would be a second place all three have to be
   * remembered.
   *
   * `existing()` first, so an unknown id answers 404 rather than reporting a
   * successful reset of nothing.
   */
  async resetMfaFor(id: string, actor: AuthUser, reauthToken: string, ctx: Ctx) {
    await this.existing(id);
    await this.assertMayAdminister(id, actor);
    return this.mfa.resetFor(id, actor, reauthToken, ctx);
  }

  async resetPasswordFor(id: string, actor: AuthUser, ctx: Ctx) {
    const user = await this.get(id);
    await this.assertMayAdminister(id, actor);
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

  /**
   * The ceiling for every administrative act on another account.
   *
   * Acting on one's own account is exempt here — the self-demotion and
   * last-Super-Admin checks decide those — because containment is trivially
   * true of oneself and the interesting question there is a different one.
   */
  private async assertMayAdminister(id: string, actor: AuthUser): Promise<void> {
    if (id === actor.id || actor.isSuperAdmin) return;
    const refusal = refuseAdminister(principal(actor), principalFrom(await this.rolesOfUser(id)));
    if (refusal) throw ceiling(refusal);
  }

  /** A user's roles with their permission keys, as the rules read them. */
  private async rolesOfUser(id: string): Promise<RoleGrant[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId: id },
      select: {
        role: {
          select: { key: true, name: true, permissions: { select: { permission: { select: { key: true } } } } },
        },
      },
    });
    return rows.map(({ role }) => toGrant(role));
  }

  /**
   * The roles named by id, every one of which must exist.
   *
   * An unknown id used to reach `createMany` and fail on the foreign key — a
   * 409 "in use" for what is a bad request. Resolving first also gives the
   * ceiling the permission lists it judges.
   */
  private async rolesByIds(ids: string[]): Promise<RoleGrant[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await this.prisma.role.findMany({
      where: { id: { in: unique } },
      select: {
        key: true,
        name: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException("Mindestens eine der gewählten Rollen gibt es nicht.");
    }
    return rows.map(toGrant);
  }

  /** Re-authentication for a privilege change, when the rules say it needs one. */
  private requireReauthIf(needed: boolean, actor: AuthUser, token?: string): Promise<void> {
    return this.reauth.requireIf(needed, actor.id, token);
  }

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

const principal = principalOf;
const ceiling = privilegeCeiling;

function principalFrom(roles: RoleGrant[]): Principal {
  return {
    isSuperAdmin: roles.some((r) => r.key === SUPER_ADMIN_ROLE),
    permissions: permissionsOf(roles),
  };
}

function toGrant(role: {
  key: string;
  name: string;
  permissions: { permission: { key: string } }[];
}): RoleGrant {
  return { key: role.key, name: role.name, permissions: role.permissions.map((p) => p.permission.key) };
}
