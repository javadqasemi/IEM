/**
 * Seeds a fresh install, and reconciles an existing one.
 *
 * Run it as often as you like — it is idempotent. Permissions, roles, content
 * types and settings are upserted; content entries are only created where none
 * exist, so re-running never overwrites an editor's work.
 *
 * **The content comes from the site's own `defaults.ts`.** That file is the
 * copy the static build shipped, so a fresh database starts as the real
 * website rather than as an empty CMS — and there is no second transcription
 * of 30 projects and 41 people to keep in step with the first.
 *
 *   npm run seed
 */
import { PrismaClient, type ContentKind } from "@prisma/client";
import * as argon2 from "argon2";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/rbac/permissions.catalog";
import { CONTENT_TYPES, type ContentTypeDef } from "../src/content/content-types";
import { DEFAULT_SETTINGS } from "../src/settings/settings.service";
// The site package, two directories up. Its `defaultContent` is the single
// source of the seed copy.
import { defaultContent } from "../../src/content/defaults";

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */

async function seedPermissions() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { resource: p.resource, action: p.action, category: p.category, description: p.description },
      create: p,
    });
  }

  // Report, never delete. A permission removed from the catalogue may still be
  // referenced by a custom role somebody built, and silently dropping it would
  // change what that role grants without telling anyone.
  const known = new Set(PERMISSIONS.map((p) => p.key));
  const orphans = (await prisma.permission.findMany()).filter((p) => !known.has(p.key));
  if (orphans.length) {
    console.warn(
      `  ! ${orphans.length} Berechtigung(en) in der Datenbank, aber nicht im Katalog: ` +
        orphans.map((o) => o.key).join(", "),
    );
  }
  console.log(`  ✓ ${PERMISSIONS.length} Berechtigungen`);
}

async function seedRoles() {
  const all = await prisma.permission.findMany();
  const byKey = new Map(all.map((p) => [p.key, p.id]));

  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, rank: def.rank, isSystem: def.isSystem },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        rank: def.rank,
        isSystem: def.isSystem,
      },
    });

    // Super Admin's authority comes from `PermissionsGuard` short-circuiting
    // on the role key, not from the join table — see the note in the
    // catalogue. Granting every row here too would be harmless but would
    // suggest the list is what matters, and it would go stale.
    const keys = def.permissions === "*" ? PERMISSIONS.map((p) => p.key) : def.permissions;

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: keys
        .map((k) => byKey.get(k))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
  console.log(`  ✓ ${SYSTEM_ROLES.length} Rollen`);
}

async function seedContentTypes() {
  for (const t of CONTENT_TYPES) {
    await prisma.contentType.upsert({
      where: { key: t.key },
      update: {
        kind: t.kind as ContentKind,
        name: t.name,
        description: t.description,
        schema: t.fields as unknown as object,
        contentKey: t.contentKey,
        orderable: t.orderable ?? true,
        icon: t.icon ?? null,
        rank: t.rank,
      },
      create: {
        key: t.key,
        kind: t.kind as ContentKind,
        name: t.name,
        description: t.description,
        schema: t.fields as unknown as object,
        contentKey: t.contentKey,
        orderable: t.orderable ?? true,
        icon: t.icon ?? null,
        rank: t.rank,
      },
    });
  }
  console.log(`  ✓ ${CONTENT_TYPES.length} Inhaltstypen`);
}

async function seedSettings() {
  for (const s of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      // Only the metadata is refreshed. The *value* is left alone, because an
      // administrator has very likely changed it and a re-seed must not undo
      // that.
      update: { group: s.group, description: s.description, secret: s.secret ?? false },
      create: {
        key: s.key,
        group: s.group,
        value: s.value as object,
        description: s.description,
        secret: s.secret ?? false,
      },
    });
  }
  console.log(`  ✓ ${DEFAULT_SETTINGS.length} Einstellungen`);
}

/* ------------------------------------------------------------------ */

/**
 * Turns `defaultContent` into entries, one per collection item and one per
 * singleton.
 *
 * The inverse of `buildSnapshot` — and the two have to agree, which is why the
 * `__`-prefixed content keys are handled explicitly in both. Entries are
 * created directly as PUBLISHED with `publishedData` set: seeding produces the
 * site as it already is, so requiring someone to review and approve 100
 * entries before the site works again would be ceremony with no purpose.
 */
async function seedContent(authorId: string) {
  const existing = await prisma.contentEntry.count();
  if (existing > 0) {
    console.log(`  → ${existing} Inhaltseinträge vorhanden, übersprungen`);
    return;
  }

  const content = defaultContent as unknown as Record<string, unknown>;
  let created = 0;

  for (const type of CONTENT_TYPES) {
    const rows = entriesFor(type, content);
    for (const [index, row] of rows.entries()) {
      const entry = await prisma.contentEntry.create({
        data: {
          typeKey: type.key,
          key: row.key,
          data: row.data as object,
          publishedData: row.data as object,
          status: "PUBLISHED",
          position: index,
          version: 1,
          publishedAt: new Date(),
          createdById: authorId,
          updatedById: authorId,
        },
      });
      await prisma.contentVersion.create({
        data: {
          entryId: entry.id,
          version: 1,
          data: row.data as object,
          status: "PUBLISHED",
          note: "Aus dem statischen Stand übernommen",
          authorId,
        },
      });
      created++;
    }
  }
  console.log(`  ✓ ${created} Inhaltseinträge`);
}

function entriesFor(
  type: ContentTypeDef,
  content: Record<string, unknown>,
): { key: string; data: unknown }[] {
  if (type.kind === "SINGLETON") {
    // The two flat ones, mirrored from `writeSingleton` in the builder.
    if (type.contentKey === "__jobTexts") {
      return [
        {
          key: type.key,
          data: {
            jobUeberUns: content.jobUeberUns,
            jobBewerbung: content.jobBewerbung,
            jobSchluss: content.jobSchluss,
          },
        },
      ];
    }
    if (type.contentKey === "__contactEmail") {
      return [{ key: type.key, data: { value: content.contactEmail } }];
    }
    const value = content[type.contentKey];
    return value === undefined ? [] : [{ key: type.key, data: value }];
  }

  const value = content[type.contentKey];
  if (!value) return [];

  if (type.shape === "keyed") {
    return Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
      key,
      // `jobCategoryNotes` maps to strings; wrap so the entry is an object the
      // form renderer can edit. `buildSnapshot` unwraps it again.
      data: typeof v === "string" ? { [type.fields[0].name]: v } : v,
    }));
  }

  return (value as Record<string, unknown>[]).map((item, i) => ({
    key: entryKey(item, type.key, i),
    data: item,
  }));
}

function entryKey(item: Record<string, unknown>, typeKey: string, index: number): string {
  const source =
    (item.id as string) ??
    (item.name as string) ??
    (item.title as string) ??
    (item.label as string) ??
    (item.role as string) ??
    (item.city as string) ??
    (item.no as string) ??
    `${typeKey}-${index}`;
  const slug = slugify(String(source));
  // A project and a team member can genuinely share a name — Colin Tschudin is
  // both a sponsor and an employee here — so the index disambiguates rather
  // than one silently overwriting the other.
  return slug || `${typeKey}-${index}`;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ------------------------------------------------------------------ */

async function seedSuperAdmin(): Promise<string> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@iem.ch").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  const role = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  → Super Admin ${email} vorhanden`);
    return existing.id;
  }

  // No password in the environment means no password on the account: it is
  // created INVITED and the first sign-in has to go through a reset link.
  // Seeding a default password is how installs end up reachable with
  // admin/admin months later.
  const user = await prisma.user.create({
    data: {
      email,
      name: process.env.SEED_ADMIN_NAME ?? "Super Admin",
      passwordHash: password ? await argon2.hash(password, { type: argon2.argon2id }) : null,
      status: password ? "ACTIVE" : "INVITED",
      roles: { create: { roleId: role.id } },
    },
  });

  console.log(
    password
      ? `  ✓ Super Admin ${email} mit dem Passwort aus SEED_ADMIN_PASSWORD`
      : `  ✓ Super Admin ${email} ohne Passwort — über „Passwort vergessen“ aktivieren`,
  );
  return user.id;
}

async function seedFirstSnapshot(authorId: string) {
  const existing = await prisma.contentSnapshot.count();
  if (existing > 0) {
    console.log(`  → ${existing} Snapshot(s) vorhanden, übersprungen`);
    return;
  }
  await prisma.contentSnapshot.create({
    data: {
      version: 1,
      content: defaultContent as unknown as object,
      note: "Ausgangsstand aus dem statischen Build",
      publishedById: authorId,
    },
  });
  console.log("  ✓ Erster Snapshot (Version 1)");
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log("IEM CMS — Seed\n");
  await seedPermissions();
  await seedRoles();
  await seedContentTypes();
  await seedSettings();
  const adminId = await seedSuperAdmin();
  await seedContent(adminId);
  await seedFirstSnapshot(adminId);
  console.log("\nFertig.");
}

main()
  .catch((err) => {
    console.error("\nSeed fehlgeschlagen:", err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
