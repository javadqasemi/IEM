import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../core/audit/audit.service";
import { ReauthService } from "../auth/reauth.service";
import { PERMISSIONS } from "./permissions.catalog";
import {
  SUPER_ADMIN_ROLE,
  privilegeChangeNeedsReauth,
  refusePermissionGrant,
  refuseRoleEdit,
  refuseRoleGrant,
} from "./privilege.rules";
import { principalOf, privilegeCeiling } from "./privilege.errors";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reauth: ReauthService,
  ) {}

  /**
   * The permission catalogue, grouped for the role editor.
   *
   * Served from the database rather than from the constant so the ids the
   * editor posts back are real rows — but the *set* is still defined in
   * `permissions.catalog.ts`, and the seeder keeps the two in step.
   */
  async listPermissions() {
    const rows = await this.prisma.permission.findMany({ orderBy: [{ category: "asc" }, { key: "asc" }] });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = groups.get(row.category) ?? [];
      list.push(row);
      groups.set(row.category, list);
    }
    return [...groups.entries()].map(([category, permissions]) => ({ category, permissions }));
  }

  /**
   * Every role, each marked with whether **this caller** may hand it out.
   *
   * `grantable` is a courtesy for the role picker, computed by the same rule
   * the write path enforces — so the dashboard never offers a role the server
   * will refuse, and never has to hold its own copy of the ceiling.
   */
  async listRoles(actor: AuthUser) {
    const rows = await this.prisma.role.findMany({
      orderBy: { rank: "asc" },
      include: {
        permissions: { select: { permission: { select: { id: true, key: true } } } },
        _count: { select: { users: true } },
      },
    });
    const me = principal(actor);
    return rows.map((role) => ({
      ...role,
      grantable:
        refuseRoleGrant(me, [
          { key: role.key, name: role.name, permissions: role.permissions.map((p) => p.permission.key) },
        ]) === null,
    }));
  }

  async getRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { select: { permission: true } },
        users: { select: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!role) throw new NotFoundException("Rolle nicht gefunden.");
    return role;
  }

  async createRole(
    input: {
      key: string;
      name: string;
      description?: string;
      permissionIds: string[];
      reauthToken?: string;
    },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const keys = await this.permissionKeys(input.permissionIds);
    const refusal = refusePermissionGrant(principal(actor), keys);
    if (refusal) throw ceiling(refusal);
    await this.requireReauthIf(privilegeChangeNeedsReauth(keys, false), actor, input.reauthToken);

    const key = input.key.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (key === SUPER_ADMIN_ROLE) {
      throw new BadRequestException("Dieser Schlüssel ist für die Systemrolle reserviert.");
    }
    const role = await this.prisma.role.create({
      data: {
        key,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        // Custom roles sort after the shipped ones, which are ranked 0–100.
        rank: 500,
        permissions: { create: input.permissionIds.map((permissionId) => ({ permissionId })) },
      },
    });
    this.audit.record({
      actor,
      action: "role.created",
      resource: "role",
      resourceId: role.id,
      after: { key, name: input.name, permissions: input.permissionIds.length },
      ...ctx,
    });
    return role;
  }

  /**
   * Updates a role.
   *
   * A system role's **name and description** stay editable — an organisation
   * may well call a Manager something else — but its `key` and its `isSystem`
   * flag do not, because guards and the seeder look it up by key.
   */
  async updateRole(
    id: string,
    input: { name?: string; description?: string; permissionIds?: string[]; reauthToken?: string },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const before = await this.getRole(id);

    if (before.key === SUPER_ADMIN_ROLE && input.permissionIds) {
      throw new BadRequestException(
        "Super Admin hat per Definition alle Berechtigungen — die Liste ist nicht einschränkbar.",
      );
    }

    /*
      The ceiling, twice. A role holding anything the actor lacks is above
      them and not theirs to edit — renaming included, since a renamed
      "Geschäftsleitung" is how somebody is talked into assigning it. And
      what the edit *adds* must be the actor's to give, because adding a key
      to a role grants it to everybody holding the role, the actor possibly
      among them.
    */
    const me = principal(actor);
    const beforeKeys = before.permissions.map((p) => p.permission.key);
    const editRefusal = refuseRoleEdit(me, {
      key: before.key,
      name: before.name,
      permissions: beforeKeys,
    });
    if (editRefusal) throw ceiling(editRefusal);
    if (input.permissionIds) {
      const nextKeys = await this.permissionKeys(input.permissionIds);
      const grantRefusal = refusePermissionGrant(me, nextKeys);
      if (grantRefusal) throw ceiling(grantRefusal);
      const had = new Set(beforeKeys);
      await this.requireReauthIf(
        privilegeChangeNeedsReauth(
          nextKeys.filter((k) => !had.has(k)),
          false,
        ),
        actor,
        input.reauthToken,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      if (input.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: input.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
    });

    const after = await this.getRole(id);
    this.audit.record({
      actor,
      action: "role.updated",
      resource: "role",
      resourceId: id,
      before: { permissions: before.permissions.map((p) => p.permission.key) },
      after: { permissions: after.permissions.map((p) => p.permission.key) },
      ...ctx,
    });
    return after;
  }

  async deleteRole(id: string, actor: AuthUser, ctx: Ctx) {
    const role = await this.getRole(id);
    if (role.isSystem) {
      throw new BadRequestException("Systemrollen können nicht gelöscht werden.");
    }
    const refusal = refuseRoleEdit(principal(actor), {
      key: role.key,
      name: role.name,
      permissions: role.permissions.map((p) => p.permission.key),
    });
    if (refusal) throw ceiling(refusal);
    if (role.users.length) {
      throw new BadRequestException(
        `Dieser Rolle sind noch ${role.users.length} Benutzer zugewiesen. Zuerst umhängen.`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
    this.audit.record({
      actor,
      action: "role.deleted",
      resource: "role",
      resourceId: id,
      before: { key: role.key, name: role.name },
      ...ctx,
    });
  }

  /** What the catalogue says, for a health check against the database. */
  catalogSize() {
    return PERMISSIONS.length;
  }

  /**
   * The keys behind a list of permission ids, every one of which must exist.
   *
   * The editor posts ids; the ceiling judges keys. An unknown id used to fail
   * on the foreign key inside the transaction.
   */
  private async permissionKeys(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await this.prisma.permission.findMany({
      where: { id: { in: unique } },
      select: { key: true },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException("Mindestens eine der gewählten Berechtigungen gibt es nicht.");
    }
    return rows.map((r) => r.key);
  }

  private requireReauthIf(needed: boolean, actor: AuthUser, token?: string): Promise<void> {
    return this.reauth.requireIf(needed, actor.id, token);
  }
}

const principal = principalOf;
const ceiling = privilegeCeiling;
