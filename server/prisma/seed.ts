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
// Run straight through `tsx`, this script gets no env file of its own — the
// Prisma CLI loads `prisma.config.ts`, `npm run seed` does not.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type ContentKind } from "@prisma/client";
import * as argon2 from "argon2";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/rbac/permissions.catalog";
import { CONTENT_TYPES, type ContentTypeDef } from "../src/content/content-types";
import { DEFAULT_SETTINGS } from "../src/core/settings/settings.service";
// The site package, two directories up. Its `defaultContent` is the single
// source of the seed copy.
import { defaultContent } from "../../src/content/defaults";

// The same driver adapter the server uses. From Prisma 7 a bare
// `new PrismaClient()` throws: the connection is made by `pg`, not by a
// bundled query engine, and `schema.prisma` carries no `url` to fall back on.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL ist nicht gesetzt. server/.env.example nach server/.env kopieren und ausfüllen.",
  );
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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
/* The operational domain — Wave 1                                      */
/* ------------------------------------------------------------------ */

/**
 * Master data and two worked projects.
 *
 * **Idempotent by business key**, like every other function here: `upsert` on
 * `code`, `number` or `personnelNumber`, so running the seed against a database
 * an editor has been using adds what is missing and touches nothing else. The
 * alternative — create-if-empty — silently does nothing the second time, which
 * is how a new content type ends up missing on every machine but the one it was
 * written on.
 *
 * The two projects are **not** placeholders. They exercise the parts of the
 * module that are otherwise only reachable by hand: one is `ACTIVE` with
 * milestones in three states so `deriveHealth` has something to weigh, the
 * other is `PLANNED` with none so the "0%, not 100%" rule is visible on a
 * screen. `progressPercent` and `health` are left at their defaults on purpose
 * — the reconciler computes them, and seeding the derived values would hide a
 * reconciler that had stopped working.
 */
async function seedDomain() {
  const offices = await Promise.all(
    [
      { name: "Thun", address: "Bierigutstrasse 6", zip: "3608", city: "Thun", isHeadquarters: true },
      { name: "Bern", address: "Belpstrasse 48", zip: "3007", city: "Bern", isHeadquarters: false },
    ].map((office) =>
      prisma.office.upsert({
        // No unique on `name`, so find-then-create rather than a true upsert.
        where: { id: office.name === "Thun" ? "seed-office-thun" : "seed-office-bern" },
        create: { id: `seed-office-${office.name.toLowerCase()}`, ...office },
        update: office,
      }),
    ),
  );
  const thun = offices[0];

  const departments = await Promise.all(
    [
      { code: "HLK", name: "Heizung · Lüftung · Klima" },
      { code: "SAN", name: "Sanitär" },
      { code: "ELT", name: "Elektro" },
      { code: "BIM", name: "BIM und Koordination" },
    ].map((d) => prisma.department.upsert({ where: { code: d.code }, create: d, update: d })),
  );

  const people = [
    { personnelNumber: "MA-001", firstName: "Anna", lastName: "Meier", position: "Projektleiterin", dep: "HLK" },
    { personnelNumber: "MA-002", firstName: "Beat", lastName: "Roth", position: "Projektingenieur", dep: "HLK" },
    { personnelNumber: "MA-003", firstName: "Chiara", lastName: "Bianchi", position: "Fachbereichsleiterin Sanitär", dep: "SAN" },
    { personnelNumber: "MA-004", firstName: "David", lastName: "Küng", position: "Elektroplaner", dep: "ELT" },
    { personnelNumber: "MA-005", firstName: "Elena", lastName: "Schmid", position: "BIM-Koordinatorin", dep: "BIM" },
  ];

  const employees = await Promise.all(
    people.map((person) => {
      const data = {
        personnelNumber: person.personnelNumber,
        firstName: person.firstName,
        lastName: person.lastName,
        email: `${person.firstName.toLowerCase()}.${person.lastName
          .toLowerCase()
          .replace(/[^a-z]/g, "")}@iem.ch`,
        position: person.position,
        hireDate: new Date("2020-01-06"),
        departmentId: departments.find((d) => d.code === person.dep)!.id,
        officeId: thun.id,
      };
      return prisma.employee.upsert({
        where: { personnelNumber: person.personnelNumber },
        create: data,
        update: data,
      });
    }),
  );
  const byNumber = (n: string) => employees.find((e) => e.personnelNumber === n)!;

  /*
    The eight Gewerke.

    `defaultColour` is a **token name**, not a hex literal — six of these are
    already the public site's `disc-*` tokens, which is the point: one colour
    for Lüftung on a plan, in a schedule and in the 3D scene, resolved per
    theme.
  */
  const disciplineSeed = [
    { code: "HZG", name: "Heizung", colour: "disc-heat", share: 0.22, manager: "MA-001" },
    { code: "LFT", name: "Lüftung", colour: "disc-air", share: 0.26, manager: "MA-001" },
    { code: "KLT", name: "Klima und Kälte", colour: "disc-air", share: 0.12, manager: "MA-002" },
    { code: "SAN", name: "Sanitär", colour: "disc-water", share: 0.16, manager: "MA-003" },
    { code: "ELT", name: "Elektro", colour: "disc-power", share: 0.14, manager: "MA-004" },
    { code: "ENE", name: "Energie", colour: "disc-energy", share: 0.04, manager: null },
    { code: "MSR", name: "MSRL", colour: "disc-power", share: 0.04, manager: null },
    { code: "BIM", name: "BIM und Koordination", colour: "disc-model", share: 0.02, manager: "MA-005" },
  ];

  const disciplines = await Promise.all(
    disciplineSeed.map((d, index) => {
      const data = {
        code: d.code,
        name: d.name,
        defaultColour: d.colour,
        defaultBudgetShare: new Prisma.Decimal(d.share.toFixed(4)),
        defaultHourlyRate: new Prisma.Decimal("165.00"),
        order: index,
        managerId: d.manager ? byNumber(d.manager).id : null,
      };
      return prisma.discipline.upsert({ where: { code: d.code }, create: data, update: data });
    }),
  );
  const byCode = (code: string) => disciplines.find((d) => d.code === code)!;

  const customerSeed = [
    { number: "K-00123", name: "Gemeinde Giffers", type: "PUBLIC_BODY" as const, city: "Giffers", zip: "1735" },
    { number: "K-00124", name: "Wohnbaugenossenschaft Aare", type: "COMPANY" as const, city: "Thun", zip: "3600" },
  ];
  const customers = await Promise.all(
    customerSeed.map((c) => {
      const data = { ...c, country: "CH", ownerId: byNumber("MA-001").id };
      return prisma.customer.upsert({ where: { number: c.number }, create: data, update: data });
    }),
  );
  const customerByNumber = (n: string) => customers.find((c) => c.number === n)!;

  const buildingSeed = [
    {
      number: "G-00412",
      name: "Schulhaus Guglera",
      customer: "K-00123",
      city: "Giffers",
      zip: "1735",
      usage: "SCHULE" as const,
      constructionType: "SANIERUNG" as const,
      yearBuilt: 1972,
      heatedArea: "4200.00",
      grossArea: "5100.00",
      volume: "18400.00",
    },
    {
      number: "G-00413",
      name: "Wohnüberbauung Aarefeld",
      customer: "K-00124",
      city: "Thun",
      zip: "3600",
      usage: "WOHNBAU" as const,
      constructionType: "NEUBAU" as const,
      yearBuilt: null,
      heatedArea: "7800.00",
      grossArea: "9200.00",
      volume: "29500.00",
    },
  ];

  const buildings = await Promise.all(
    buildingSeed.map((b) => {
      const data = {
        number: b.number,
        name: b.name,
        customerId: customerByNumber(b.customer).id,
        city: b.city,
        zip: b.zip,
        country: "CH",
        usage: b.usage,
        constructionType: b.constructionType,
        yearBuilt: b.yearBuilt,
        heatedArea: new Prisma.Decimal(b.heatedArea),
        grossArea: new Prisma.Decimal(b.grossArea),
        volume: new Prisma.Decimal(b.volume),
        officeId: thun.id,
      };
      return prisma.building.upsert({ where: { number: b.number }, create: data, update: data });
    }),
  );
  const buildingByNumber = (n: string) => buildings.find((b) => b.number === n)!;

  const projectSeed = [
    {
      number: "P-2026-001",
      name: "Schulhaus Guglera — Sanierung HLKS",
      customer: "K-00123",
      building: "G-00412",
      manager: "MA-001",
      status: "ACTIVE" as const,
      priority: "HIGH" as const,
      currentPhase: "P41" as const,
      startDate: new Date("2026-01-15"),
      plannedEndDate: new Date("2027-06-30"),
      contractValue: "1450000.00",
      budgetHours: 2400,
      description:
        "Ersatz der Heizzentrale, Erneuerung der Lüftung in allen Geschossen, " +
        "Anpassung Sanitär und Elektro im Bereich der Eingriffe.",
      disciplines: ["HZG", "LFT", "SAN", "ELT", "BIM"],
      members: [
        { p: "MA-002", role: "ENGINEER" as const, alloc: 60 },
        { p: "MA-003", role: "ENGINEER" as const, alloc: 30 },
        { p: "MA-005", role: "CONSULTANT" as const, alloc: 20 },
      ],
      milestones: [
        { name: "Vorprojekt abgenommen", due: "2026-03-31", status: "MET" as const, phase: "P31" as const, billing: true },
        { name: "Bauprojekt abgegeben", due: "2026-08-31", status: "MET" as const, phase: "P32" as const, billing: true },
        { name: "Ausschreibung versandt", due: "2026-11-30", status: "AT_RISK" as const, phase: "P41" as const, billing: false },
        { name: "Inbetriebnahme Lüftung", due: "2027-05-31", status: "OPEN" as const, phase: "P53" as const, billing: true },
      ],
    },
    {
      number: "P-2026-002",
      name: "Wohnüberbauung Aarefeld — Neubau",
      customer: "K-00124",
      building: "G-00413",
      manager: "MA-002",
      status: "PLANNED" as const,
      priority: "MEDIUM" as const,
      currentPhase: null,
      startDate: new Date("2026-10-01"),
      plannedEndDate: new Date("2028-12-31"),
      contractValue: "2980000.00",
      budgetHours: 4800,
      description: "Gebäudetechnik für 64 Wohnungen, Erdsonden-Wärmepumpe und kontrollierte Lüftung.",
      disciplines: ["HZG", "LFT", "SAN", "ENE"],
      members: [{ p: "MA-004", role: "ENGINEER" as const, alloc: 25 }],
      milestones: [],
    },
  ];

  for (const seed of projectSeed) {
    const data = {
      number: seed.number,
      name: seed.name,
      status: seed.status,
      priority: seed.priority,
      currentPhase: seed.currentPhase,
      customerId: customerByNumber(seed.customer).id,
      buildingId: buildingByNumber(seed.building).id,
      managerId: byNumber(seed.manager).id,
      officeId: thun.id,
      startDate: seed.startDate,
      plannedEndDate: seed.plannedEndDate,
      contractValue: new Prisma.Decimal(seed.contractValue),
      budgetHours: seed.budgetHours,
      description: seed.description,
    };

    const project = await prisma.project.upsert({
      where: { number: seed.number },
      create: data,
      update: data,
    });

    for (const code of seed.disciplines) {
      const discipline = byCode(code);
      const scope = {
        status: seed.status === "ACTIVE" ? ("ACTIVE" as const) : ("PLANNED" as const),
        leadEngineerId: discipline.managerId,
        // The Gewerk's share of *this* project's fee, proposed from the master
        // data rather than typed — which is what `defaultBudgetShare` is for.
        feeShare: discipline.defaultBudgetShare
          ? new Prisma.Decimal((Number(discipline.defaultBudgetShare) * 100).toFixed(2))
          : null,
        /*
          Set explicitly, although it is `false` by default.

          An upsert's `update` half only writes the fields it names, so a field
          the seed owns and omits keeps whatever it drifted to — which is how a
          "Freigabe > 100%" badge survived a reseed that had just reset the
          share it applied to. A seed that reconciles has to name every field
          it is responsible for, including the ones whose value is the default.
        */
        feeShareOverride: false,
        budgetHours: Math.round((seed.budgetHours * Number(discipline.defaultBudgetShare ?? 0))),
        hourlyRate: discipline.defaultHourlyRate,
      };
      await prisma.projectDiscipline.upsert({
        where: { projectId_disciplineId: { projectId: project.id, disciplineId: discipline.id } },
        create: { projectId: project.id, disciplineId: discipline.id, ...scope },
        update: scope,
      });
    }

    for (const member of seed.members) {
      const from = seed.startDate;
      await prisma.projectMember.upsert({
        where: {
          projectId_employeeId_from: {
            projectId: project.id,
            employeeId: byNumber(member.p).id,
            from,
          },
        },
        create: {
          projectId: project.id,
          employeeId: byNumber(member.p).id,
          role: member.role,
          allocationPercent: member.alloc,
          from,
        },
        update: { role: member.role, allocationPercent: member.alloc, deletedAt: null },
      });
    }

    /*
      Milestones have no business key, so they are matched on
      `(projectId, name)` by hand. A `createMany` would duplicate every
      milestone on the second run — which is the specific way a seed stops
      being idempotent without anybody noticing, because the screen still
      looks plausible.
    */
    for (const milestone of seed.milestones) {
      const existing = await prisma.milestone.findFirst({
        where: { projectId: project.id, name: milestone.name },
        select: { id: true },
      });
      const values = {
        name: milestone.name,
        dueDate: new Date(milestone.due),
        status: milestone.status,
        phase: milestone.phase,
        isBillingTrigger: milestone.billing,
        metAt: milestone.status === "MET" ? new Date(milestone.due) : null,
      };
      if (existing) {
        await prisma.milestone.update({ where: { id: existing.id }, data: values });
      } else {
        await prisma.milestone.create({ data: { projectId: project.id, ...values } });
      }
    }
  }

  console.log(
    `  ✓ ${offices.length} Standorte, ${departments.length} Abteilungen, ` +
      `${employees.length} Mitarbeitende, ${disciplines.length} Gewerke, ` +
      `${customers.length} Kunden, ${buildings.length} Gebäude, ${projectSeed.length} Projekte`,
  );
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
  await seedDomain();
  console.log("\nFertig.");
}

main()
  .catch((err) => {
    console.error("\nSeed fehlgeschlagen:", err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
