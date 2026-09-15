import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PERMISSIONS } from "./permissions.catalog";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { rank: "asc" },
      include: {
        permissions: { select: { permission: { select: { id: true, key: true } } } },
        _count: { select: { users: true } },
      },
    });
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
    input: { key: string; name: string; description?: string; permissionIds: string[] },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const key = input.key.toLowerCase().replace(/[^a-z0-9_]/g, "_");
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
    input: { name?: string; description?: string; permissionIds?: string[] },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const before = await this.getRole(id);

    if (before.key === "super_admin" && input.permissionIds) {
      throw new BadRequestException(
        "Super Admin hat per Definition alle Berechtigungen — die Liste ist nicht einschränkbar.",
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
}
