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

  const tasks = await seedTasks(byNumber);
  const meetings = await seedMeetings(byNumber);

  console.log(
    `  ✓ ${offices.length} Standorte, ${departments.length} Abteilungen, ` +
      `${employees.length} Mitarbeitende, ${disciplines.length} Gewerke, ` +
      `${customers.length} Kunden, ${buildings.length} Gebäude, ${projectSeed.length} Projekte, ` +
      `${tasks} Aufgaben, ${meetings.meetings} Sitzungen, ${meetings.decisions} Entscheide`,
  );
}

/* ------------------------------------------------------------------ */
/* Sitzungen und Entscheide — Wave 2, module 2                          */
/* ------------------------------------------------------------------ */

/**
 * Two Bausitzungen and three Entscheide, and none of them is a placeholder.
 *
 * Each exists to make one part of the module reachable from a screen that would
 * otherwise only be reachable by hand:
 *
 * | | |
 * | --- | --- |
 * | **Bausitzung 12**, held and **approved** | the closed protocol — `refuseProtocolEdit` is invisible until a protocol has been approved, and this is the one that demonstrates it |
 * | **Bausitzung 13**, held and *not* approved | the editable protocol, and the "minutes pending" queue the stats tile counts |
 * | A line of each kind | `INFORMATION`, `ENTSCHEID` with a real decision, `PENDENZ` with a real task |
 * | An external attendee | the Bauherr, who has no `Employee` row and must still be minutable |
 * | A **superseded** decision | `AUFGEHOBEN` with a successor attached — the state that cannot be typed and can only be reached through `supersede` |
 * | A decision with a cost impact | the figure Finance looks for |
 *
 * Matched on `(projectId, title)` and `(projectId, number)` by hand, like
 * milestones and tasks: a `createMany` would duplicate everything on the second
 * run, which is the specific way a seed stops being idempotent while the screen
 * still looks plausible.
 */
async function seedMeetings(
  byNumber: (n: string) => { id: string },
): Promise<{ meetings: number; decisions: number }> {
  const guglera = await prisma.project.findUnique({
    where: { number: "P-2026-001" },
    select: { id: true },
  });
  if (!guglera) return { meetings: 0, decisions: 0 };

  const disciplines = await prisma.discipline.findMany({ select: { id: true, code: true } });
  const byCode = (code: string) => disciplines.find((d) => d.code === code)?.id ?? null;

  const day = 86_400_000;
  const ago = (n: number) => new Date(Date.now() - n * day);

  /* ---- The two meetings ------------------------------------------- */

  const meetingSeed = [
    {
      title: "Bausitzung",
      seriesNumber: 12,
      startsAt: ago(35),
      location: "Baubüro Giffers",
      organiser: "MA-001",
      approved: true,
    },
    {
      title: "Bausitzung",
      seriesNumber: 13,
      startsAt: ago(7),
      location: "Baubüro Giffers",
      organiser: "MA-001",
      approved: false,
    },
  ];

  const meetings = new Map<number, string>();

  for (const seed of meetingSeed) {
    const values = {
      title: seed.title,
      type: "BAUSITZUNG" as const,
      status: "HELD" as const,
      seriesNumber: seed.seriesNumber,
      startsAt: seed.startsAt,
      endsAt: new Date(seed.startsAt.getTime() + 90 * 60_000),
      location: seed.location,
      projectId: guglera.id,
      organiserId: byNumber(seed.organiser).id,
    };

    const existing = await prisma.meeting.findFirst({
      where: { projectId: guglera.id, title: seed.title, seriesNumber: seed.seriesNumber },
      select: { id: true },
    });
    const meeting = existing
      ? await prisma.meeting.update({ where: { id: existing.id }, data: values })
      : await prisma.meeting.create({ data: values });
    meetings.set(seed.seriesNumber, meeting.id);

    /* ---- Who was there, including one who is not an employee ------ */

    const room = [
      { p: "MA-001", attended: true },
      { p: "MA-002", attended: true },
      { p: "MA-003", attended: false, apologised: true },
    ];
    for (const person of room) {
      const employeeId = byNumber(person.p).id;
      const found = await prisma.meetingAttendee.findFirst({
        where: { meetingId: meeting.id, employeeId },
        select: { id: true },
      });
      const data = {
        required: true,
        invitedAt: new Date(seed.startsAt.getTime() - 7 * day),
        attended: person.attended,
        apologised: person.apologised ?? false,
        deletedAt: null,
      };
      if (found) await prisma.meetingAttendee.update({ where: { id: found.id }, data });
      else await prisma.meetingAttendee.create({ data: { meetingId: meeting.id, employeeId, ...data } });
    }

    /*
      The Bauherr, as free text.

      There is no `Contact` table — the CRM is Wave 3 — and a Bausitzung
      without the Bauherrschaft in the attendance list is not a Bausitzung.
      This row is what the migration reads across when `Contact` lands.
    */
    const external = await prisma.meetingAttendee.findFirst({
      where: { meetingId: meeting.id, externalName: "R. Bürgi" },
      select: { id: true },
    });
    const externalData = {
      externalName: "R. Bürgi",
      externalOrg: "Gemeinde Giffers",
      required: true,
      attended: true,
      apologised: false,
      deletedAt: null,
    };
    if (external) await prisma.meetingAttendee.update({ where: { id: external.id }, data: externalData });
    else await prisma.meetingAttendee.create({ data: { meetingId: meeting.id, ...externalData } });

    /* ---- The agenda ------------------------------------------------ */

    const agenda = ["Protokoll der letzten Sitzung", "Stand Lüftung", "Termine und Kosten"];
    for (const [index, title] of agenda.entries()) {
      const found = await prisma.meetingAgendaItem.findFirst({
        where: { meetingId: meeting.id, order: index + 1 },
        select: { id: true },
      });
      const data = { title, presenterId: byNumber("MA-001").id, durationMinutes: 20, deletedAt: null };
      if (found) await prisma.meetingAgendaItem.update({ where: { id: found.id }, data });
      else
        await prisma.meetingAgendaItem.create({
          data: { meetingId: meeting.id, order: index + 1, ...data },
        });
    }
  }

  const twelve = meetings.get(12)!;
  const thirteen = meetings.get(13)!;

  /* ---- The decisions ---------------------------------------------- */

  const decisionSeed = [
    {
      number: "E-2026-001",
      title: "Lüftung OG2 wird auf Einzelraumregelung umgebaut",
      rationale:
        "Die Nutzung der Räume 2.10–2.14 wechselt zwischen Unterricht und Betreuung. " +
        "Eine zentrale Regelung führt zu Zugerscheinungen; die Mehrkosten sind gegenüber " +
        "den Beschwerden im Bestand vertretbar.",
      meeting: twelve,
      decidedAt: ago(35),
      decidedBy: "MA-001",
      type: "TECHNISCH" as const,
      status: "ENTSCHIEDEN" as const,
      discipline: "LFT",
      impact: "KOSTEN" as const,
      costImpact: "48000.00",
      scheduleImpactDays: 10,
    },
    {
      number: "E-2026-002",
      title: "Heizzentrale bleibt am bestehenden Standort",
      rationale:
        "Die geprüfte Verlegung in das UG Nord hätte einen Durchbruch in der tragenden " +
        "Wand bedingt. Der Statiker rät ab; der bestehende Standort erfüllt die " +
        "Anforderungen nach der Sanierung.",
      meeting: twelve,
      decidedAt: ago(35),
      decidedBy: "MA-001",
      type: "TECHNISCH" as const,
      // Reversed by E-2026-003 below — the seed's `supersede` pass sets this.
      status: "ENTSCHIEDEN" as const,
      discipline: "HZG",
      impact: "KEINE" as const,
      costImpact: null,
      scheduleImpactDays: null,
    },
    {
      number: "E-2026-003",
      title: "Heizzentrale wird doch in das UG Nord verlegt",
      rationale:
        "Die Bauherrschaft hat den zusätzlichen Raumbedarf für die Betreuung bestätigt. " +
        "Der Statiker hat den Durchbruch mit einer Auswechslung freigegeben. Der Entscheid " +
        "aus Bausitzung 12 wird damit hinfällig.",
      meeting: thirteen,
      decidedAt: ago(7),
      decidedBy: "MA-001",
      type: "TECHNISCH" as const,
      status: "ENTSCHIEDEN" as const,
      discipline: "HZG",
      impact: "TERMIN" as const,
      costImpact: "26500.00",
      scheduleImpactDays: 20,
      supersedes: "E-2026-002",
    },
  ];

  const decisions = new Map<string, string>();

  for (const seed of decisionSeed) {
    const values = {
      title: seed.title,
      rationale: seed.rationale,
      projectId: guglera.id,
      meetingId: seed.meeting,
      type: seed.type,
      status: seed.status,
      decidedAt: seed.decidedAt,
      decidedById: byNumber(seed.decidedBy).id,
      disciplineId: byCode(seed.discipline),
      impact: seed.impact,
      costImpact: seed.costImpact === null ? null : new Prisma.Decimal(seed.costImpact),
      scheduleImpactDays: seed.scheduleImpactDays,
      deletedAt: null,
    };

    const existing = await prisma.decision.findFirst({
      where: { projectId: guglera.id, number: seed.number },
      select: { id: true },
    });
    const row = existing
      ? await prisma.decision.update({ where: { id: existing.id }, data: values })
      : await prisma.decision.create({ data: { number: seed.number, ...values } });
    decisions.set(seed.number, row.id);
  }

  /*
    The reversal, in a second pass.

    `supersedesId` names a decision that may not have existed on the first
    loop — and the pair of writes is what the service's `supersede` performs in
    one transaction: the successor names its predecessor, and the predecessor
    becomes `AUFGEHOBEN`. Seeding only the status would produce the one state
    the whole mechanism exists to prevent: a decision reading as withdrawn with
    nothing to point at.
  */
  for (const seed of decisionSeed) {
    if (!seed.supersedes) continue;
    const newer = decisions.get(seed.number);
    const older = decisions.get(seed.supersedes);
    if (!newer || !older) continue;
    await prisma.decision.update({ where: { id: newer }, data: { supersedesId: older } });
    await prisma.decision.update({ where: { id: older }, data: { status: "AUFGEHOBEN" } });
  }

  /* ---- The protocol ------------------------------------------------ */

  const protocolSeed = [
    {
      meeting: twelve,
      order: 1,
      kind: "INFORMATION" as const,
      text: "Das Protokoll der Bausitzung 11 wird ohne Änderungen genehmigt.",
      discipline: null,
    },
    {
      meeting: twelve,
      order: 2,
      kind: "ENTSCHEID" as const,
      text: "Die Lüftung im OG2 wird auf Einzelraumregelung umgebaut.",
      discipline: "LFT",
      decision: "E-2026-001",
    },
    {
      meeting: twelve,
      order: 3,
      kind: "PENDENZ" as const,
      text: "Luftmengen für die Räume 2.10 bis 2.14 neu berechnen und im Modell nachführen.",
      discipline: "LFT",
      responsible: "MA-002",
      dueIn: -14,
      task: "Lüftungskonzept Obergeschoss überarbeiten",
    },
    {
      meeting: thirteen,
      order: 1,
      kind: "INFORMATION" as const,
      text: "Die Luftmengen aus Bausitzung 12 liegen vor und sind mit der Bauherrschaft besprochen.",
      discipline: "LFT",
    },
    {
      meeting: thirteen,
      order: 2,
      kind: "ENTSCHEID" as const,
      text: "Die Heizzentrale wird entgegen dem Entscheid aus Bausitzung 12 in das UG Nord verlegt.",
      discipline: "HZG",
      decision: "E-2026-003",
    },
    {
      meeting: thirteen,
      order: 3,
      kind: "PENDENZ" as const,
      text: "Prinzipschema Elektro für den neuen Standort der Heizzentrale anpassen und freigeben lassen.",
      discipline: "ELT",
      responsible: "MA-004",
      dueIn: 8,
      task: "Prinzipschema Elektro freigeben lassen",
    },
  ];

  for (const seed of protocolSeed) {
    /*
      The task is *linked*, not created.

      The seeded Pendenzen point at tasks `seedTasks` already made, which is
      what a real protocol looks like after a few weeks — and it keeps the two
      seeds independent: neither has to run first.
    */
    const task = seed.task
      ? await prisma.task.findFirst({
          where: { projectId: guglera.id, title: seed.task, deletedAt: null },
          select: { id: true },
        })
      : null;

    const values = {
      text: seed.text,
      kind: seed.kind,
      disciplineId: seed.discipline ? byCode(seed.discipline) : null,
      responsibleId: seed.responsible ? byNumber(seed.responsible).id : null,
      dueDate: seed.dueIn === undefined ? null : new Date(Date.now() + seed.dueIn * day),
      decisionId: seed.decision ? (decisions.get(seed.decision) ?? null) : null,
      taskId: task?.id ?? null,
      deletedAt: null,
    };

    const existing = await prisma.meetingItem.findFirst({
      where: { meetingId: seed.meeting, order: seed.order },
      select: { id: true },
    });
    if (existing) await prisma.meetingItem.update({ where: { id: existing.id }, data: values });
    else
      await prisma.meetingItem.create({
        data: { meetingId: seed.meeting, order: seed.order, ...values },
      });
  }

  /* ---- The approval ------------------------------------------------ */

  /*
    Bausitzung 12's protocol is approved; 13's is not.

    That pair is what makes `refuseProtocolEdit` visible on a screen: one
    protocol is read-only and says why, the other is editable, and the
    difference is a row in this table rather than a status somebody set.
  */
  const approved = await prisma.meetingApproval.findFirst({
    where: { meetingId: twelve },
    select: { id: true },
  });
  if (!approved) {
    await prisma.meetingApproval.create({
      data: {
        meetingId: twelve,
        decision: "APPROVED",
        note: null,
        decidedById: byNumber("MA-001").id,
        decidedAt: ago(7),
      },
    });
  }

  // And 12's minutes went out; 13's are the "pending" queue on the stats tile.
  await prisma.meeting.update({ where: { id: twelve }, data: { minutesSentAt: ago(33) } });

  return { meetings: meetingSeed.length, decisions: decisionSeed.length };
}

/* ------------------------------------------------------------------ */
/* Aufgaben — Wave 2, module 1                                          */
/* ------------------------------------------------------------------ */

/**
 * Nine tasks, and none of them is a placeholder.
 *
 * Each exists to make one part of the module reachable from a screen that would
 * otherwise only be reachable by hand:
 *
 * | | |
 * | --- | --- |
 * | A task per column | so the board is not one full column and five empty ones |
 * | One **blocked**, with a reason | the only status that carries text, and the only column that is unreadable without it |
 * | One **overdue** | `isOverdue` is computed from the clock, so the date is relative to today rather than fixed — a literal date would stop being overdue the day it was seeded and start again never |
 * | One with **subtasks** | `refuseTransition` refuses `DONE` while a child is open, and that is not visible on a flat board |
 * | One with a **dependency** | the same rule through the other input, and the one an `FS` edge gates |
 * | One with a **checklist** | `deriveProgress` counts points and subtasks equally |
 * | One with **no project** | the firm-level to-do: the module's defining case, and the one a demo built from project data would never show |
 *
 * `position` is seeded explicitly at multiples of `POSITION_GAP`, because the
 * board's ordering is the one thing a fresh install cannot derive. `spentHours`
 * is left at 0 and `overdueNotifiedAt` at null on purpose — the first has no
 * writer until Wave 2 module 14, and seeding the second would mean the overdue
 * sweep announced nothing on a fresh database and looked as though it had run.
 *
 * Matched on `(projectId, title)` by hand, like milestones: a task has no
 * business key, and a `createMany` would duplicate every one of these on the
 * second run — which is the specific way a seed stops being idempotent without
 * anybody noticing, because the screen still looks plausible.
 */
async function seedTasks(byNumber: (n: string) => { id: string }): Promise<number> {
  const guglera = await prisma.project.findUnique({
    where: { number: "P-2026-001" },
    select: { id: true, milestones: { where: { deletedAt: null }, select: { id: true, name: true } } },
  });
  const aarefeld = await prisma.project.findUnique({
    where: { number: "P-2026-002" },
    select: { id: true },
  });
  if (!guglera || !aarefeld) return 0;

  const disciplines = await prisma.discipline.findMany({ select: { id: true, code: true } });
  const byCode = (code: string) => disciplines.find((d) => d.code === code)?.id ?? null;
  const ausschreibung = guglera.milestones.find((m) => m.name.startsWith("Ausschreibung"))?.id ?? null;

  /*
    Dates relative to today, not literals.

    `isOverdue` is computed against the clock, so a task seeded as due
    `2026-09-10` is overdue on the day it is written and for ever after —
    including on a database seeded in 2028, where the whole board is red. Days
    from now keeps every case meaning what it was written to mean.
  */
  const day = 86_400_000;
  const inDays = (n: number) => new Date(Date.now() + n * day);

  const seeds: {
    key: string;
    projectId: string | null;
    title: string;
    description?: string;
    status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "BLOCKED";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    assignee: string | null;
    discipline: string | null;
    milestoneId?: string | null;
    dueIn: number | null;
    estimate: string | null;
    blockedFrom?: "TODO" | "IN_PROGRESS" | "IN_REVIEW";
    blockedReason?: string;
    parent?: string;
    checklist?: string[];
    dependsOn?: string;
  }[] = [
    {
      key: "lueftung-konzept",
      projectId: guglera.id,
      title: "Lüftungskonzept Obergeschoss überarbeiten",
      description: "Luftmengen nach SIA 382/1 gegen den revidierten Raumplan prüfen.",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assignee: "MA-002",
      discipline: "LFT",
      milestoneId: ausschreibung,
      dueIn: 12,
      estimate: "16.00",
      checklist: [
        "Raumliste gegen Architekturplan abgleichen",
        "Luftmengen berechnen",
        "Kanalführung im Modell prüfen",
        "Ergebnis mit Fachbereichsleitung besprechen",
      ],
    },
    {
      key: "heizlast",
      projectId: guglera.id,
      title: "Heizlastberechnung aktualisieren",
      status: "TODO",
      priority: "MEDIUM",
      assignee: "MA-001",
      discipline: "HZG",
      dueIn: 20,
      estimate: "8.00",
    },
    {
      key: "ausschreibung-lueftung",
      projectId: guglera.id,
      title: "Ausschreibungsunterlagen Lüftung zusammenstellen",
      status: "TODO",
      priority: "HIGH",
      assignee: "MA-002",
      discipline: "LFT",
      milestoneId: ausschreibung,
      dueIn: 30,
      estimate: "24.00",
      // Gated by the concept above: an `FS` edge, which `refuseTransition`
      // refuses `DONE` against while the predecessor is open.
      dependsOn: "lueftung-konzept",
    },
    {
      key: "sanitaer-abnahme",
      projectId: guglera.id,
      title: "Sanitär-Grobinstallation abnehmen",
      status: "IN_REVIEW",
      priority: "MEDIUM",
      assignee: "MA-003",
      discipline: "SAN",
      dueIn: 5,
      estimate: "4.00",
    },
    {
      key: "elektro-schema",
      projectId: guglera.id,
      title: "Prinzipschema Elektro freigeben lassen",
      status: "BLOCKED",
      blockedFrom: "IN_PROGRESS",
      blockedReason: "Wartet auf den definitiven Küchenausbau der Bauherrschaft.",
      priority: "HIGH",
      assignee: "MA-004",
      discipline: "ELT",
      dueIn: 8,
      estimate: "6.00",
    },
    {
      key: "bestandsaufnahme",
      projectId: guglera.id,
      title: "Bestandsaufnahme Heizzentrale",
      status: "DONE",
      priority: "MEDIUM",
      assignee: "MA-001",
      discipline: "HZG",
      dueIn: -40,
      estimate: "12.00",
    },
    {
      key: "kanalnetz",
      projectId: guglera.id,
      title: "Kanalnetz im Modell nachführen",
      status: "TODO",
      priority: "LOW",
      assignee: "MA-005",
      discipline: "BIM",
      dueIn: 18,
      estimate: "10.00",
      // A subtask, so `refuseTransition` has an open child to refuse `DONE`
      // against — which is not visible on a flat board.
      parent: "lueftung-konzept",
    },
    {
      key: "erdsonden",
      projectId: aarefeld.id,
      title: "Erdsondenfeld mit Geologen abstimmen",
      status: "TODO",
      priority: "URGENT",
      assignee: "MA-002",
      discipline: "ENE",
      // Overdue: the case a screenshot of a freshly seeded board must show,
      // because an overdue card is what the module is *for*.
      dueIn: -6,
      estimate: "3.00",
    },
    {
      key: "zertifikate",
      projectId: null,
      title: "Fachausweise für 2027 erneuern",
      description: "Suva-Kurs Kältemittel und die SIA-Mitgliedschaften.",
      status: "TODO",
      priority: "LOW",
      // Firm-level: no project, no Gewerk. The module's defining case.
      assignee: "MA-001",
      discipline: null,
      dueIn: 60,
      estimate: null,
    },
  ];

  const ids = new Map<string, string>();
  let position = 0;

  for (const seed of seeds) {
    position += 1024;
    const values = {
      title: seed.title,
      description: seed.description ?? null,
      status: seed.status,
      priority: seed.priority,
      blockedFrom: seed.blockedFrom ?? null,
      blockedReason: seed.blockedReason ?? null,
      dueDate: seed.dueIn === null ? null : inDays(seed.dueIn),
      completedAt: seed.status === "DONE" ? inDays(seed.dueIn ?? 0) : null,
      estimateHours: seed.estimate === null ? null : new Prisma.Decimal(seed.estimate),
      position,
      projectId: seed.projectId,
      milestoneId: seed.milestoneId ?? null,
      assigneeId: seed.assignee ? byNumber(seed.assignee).id : null,
      disciplineId: seed.discipline ? byCode(seed.discipline) : null,
      parentTaskId: seed.parent ? (ids.get(seed.parent) ?? null) : null,
    };

    const existing = await prisma.task.findFirst({
      where: { projectId: seed.projectId, title: seed.title },
      select: { id: true },
    });
    const row = existing
      ? await prisma.task.update({ where: { id: existing.id }, data: values })
      : await prisma.task.create({ data: values });
    ids.set(seed.key, row.id);

    if (seed.checklist) {
      for (const [index, text] of seed.checklist.entries()) {
        const point = await prisma.checklistItem.findFirst({
          where: { taskId: row.id, text },
          select: { id: true },
        });
        const data = { text, position: index + 1, done: index === 0 };
        if (point) await prisma.checklistItem.update({ where: { id: point.id }, data });
        else await prisma.checklistItem.create({ data: { taskId: row.id, ...data } });
      }
    }
  }

  /*
    The edges last, in a second pass.

    A dependency names two tasks and the second may not exist yet on the first
    run. Splitting the pass is what lets the seed list read in the order a person
    would write it rather than in topological order.
  */
  for (const seed of seeds) {
    if (!seed.dependsOn) continue;
    const successorId = ids.get(seed.key);
    const predecessorId = ids.get(seed.dependsOn);
    if (!successorId || !predecessorId) continue;
    await prisma.taskDependency.upsert({
      where: { predecessorId_successorId: { predecessorId, successorId } },
      create: { predecessorId, successorId, type: "FS" },
      update: { type: "FS" },
    });
  }

  return seeds.length;
}

/* ------------------------------------------------------------------ */
/* Load data — opt-in, for the performance budgets                      */
/* ------------------------------------------------------------------ */

/**
 * Synthetic projects, so a budget measures something.
 *
 * **`SEED_LOAD_PROJECTS=<n>`, default off.** A response-time budget taken
 * against the two demo projects proves the endpoint is reachable and nothing
 * else: every query is fast over two rows, including the ones that will not be
 * fast over two thousand. An N+1 in the list's `select` costs two extra
 * round-trips at this size and five hundred at a realistic one, and only the
 * second is visible.
 *
 * The rows are marked by their number (`P-9xxx-…`) so they are identifiable and
 * removable, and they are spread across the seeded customers, buildings,
 * managers and statuses — a thousand identical rows would let Postgres answer
 * from one page of one index and flatter every figure.
 *
 * They are **not** given members, disciplines or milestones. The detail budget
 * is measured against a real project (`P-2026-001`, which has all three); these
 * exist to make the *list* query work for its living.
 */
async function seedLoadProjects() {
  const requested = Number(process.env.SEED_LOAD_PROJECTS ?? 0);
  if (!Number.isFinite(requested) || requested <= 0) return;

  const year = 9000;
  const existing = await prisma.project.count({ where: { number: { startsWith: `P-${year}-` } } });
  if (existing >= requested) {
    console.log(`  → ${existing} Lastdaten-Projekte vorhanden`);
    return;
  }

  const customers = await prisma.customer.findMany({ select: { id: true } });
  const buildings = await prisma.building.findMany({ select: { id: true } });
  const managers = await prisma.employee.findMany({ select: { id: true } });
  const offices = await prisma.office.findMany({ select: { id: true } });
  if (!customers.length || !managers.length) {
    console.log("  ! Lastdaten übersprungen — Stammdaten fehlen");
    return;
  }

  const statuses = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"] as const;
  const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
  const phases = ["P31", "P32", "P41", "P51", "P52", null] as const;

  const rows = [];
  for (let i = existing; i < requested; i++) {
    const start = new Date(2024, i % 12, ((i * 7) % 27) + 1);
    rows.push({
      number: `P-${year}-${String(i + 1).padStart(5, "0")}`,
      name: `Lastdaten ${i + 1} — ${["Sanierung", "Neubau", "Umbau", "Erweiterung"][i % 4]}`,
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
      currentPhase: phases[i % phases.length],
      customerId: customers[i % customers.length].id,
      buildingId: buildings.length ? buildings[i % buildings.length].id : null,
      managerId: managers[i % managers.length].id,
      officeId: offices.length ? offices[i % offices.length].id : null,
      startDate: start,
      plannedEndDate: new Date(start.getTime() + (200 + (i % 500)) * 86_400_000),
      contractValue: new Prisma.Decimal(((i % 40) * 125_000 + 80_000).toFixed(2)),
      budgetHours: 200 + (i % 60) * 40,
      progressPercent: i % 101,
      description: `Synthetischer Datensatz für die Performance-Budgets (${i + 1}).`,
    });
  }

  // `createMany` in one statement: five hundred `create` calls is five hundred
  // round-trips, and this runs on every machine that measures a budget.
  await prisma.project.createMany({ data: rows, skipDuplicates: true });
  console.log(`  ✓ ${rows.length} Lastdaten-Projekte (insgesamt ${requested})`);
}

/* ------------------------------------------------------------------ */
/* Test accounts — opt-in, and never on by default                      */
/* ------------------------------------------------------------------ */

/**
 * One account per operational role, for the security matrix.
 *
 * **Gated on `SEED_TEST_USERS=true` and a password in `SEED_TEST_PASSWORD`,
 * and it will not run without both.** Seeding six known accounts with a shared
 * password is exactly how an installation ends up reachable months later with
 * a credential somebody found in a repository — so the default is off, the
 * password is never defaulted, and the function says so out loud when it
 * declines.
 *
 * They are not decoration. `e2e/security.spec.ts` asserts a full
 * role × verb × resource matrix against the live API, and a matrix that can
 * only test Super Admin proves the one thing nobody doubts. The row-level rules
 * in particular — "a Projektleiter sees the projects they manage" — cannot be
 * observed at all without an account that is a Projektleiter.
 *
 * Each is linked to a **real `Employee`**, because `projects.scope.ts` resolves
 * a caller's visibility through `Employee.userId`. A test user without that
 * link would see nothing and the test would pass for the wrong reason.
 */
const TEST_USERS = [
  {
    email: "pl@iem.test",
    name: "Petra Leiter (Test)",
    role: "project_manager",
    /**
     * Anna Meier manages P-2026-001 and is on no other project.
     *
     * The narrowest useful case: her scope resolves to exactly one of the two
     * seeded projects, so a test can assert both what she sees *and* what she
     * does not — which is the half that catches a scope that silently returns
     * everything.
     */
    personnelNumber: "MA-001",
  },
  {
    email: "ing@iem.test",
    name: "Chiara Ingenieur (Test)",
    role: "engineer",
    // A member of P-2026-001 and manager of nothing: the `members.some` branch
    // of the scope, which the manager case never exercises.
    personnelNumber: "MA-003",
  },
  {
    email: "gl@iem.test",
    name: "Gabriela Leitung (Test)",
    role: "management",
    personnelNumber: "MA-002",
  },
  {
    email: "fin@iem.test",
    name: "Fabio Finanzen (Test)",
    role: "finance",
    /**
     * Deliberately **no** employee record.
     *
     * Finance holds `project.readAll`, so the scope is empty for them and the
     * missing link must not matter. It is the one combination that proves the
     * widening grant is what is doing the work, rather than an accident of the
     * lookup.
     */
    personnelNumber: null,
  },
  {
    email: "hr@iem.test",
    name: "Heidi Personal (Test)",
    role: "hr",
    personnelNumber: "MA-004",
  },
  {
    email: "gast@iem.test",
    name: "Gast (Test)",
    role: "guest",
    // No employee, no project permission at all. The floor of the matrix.
    personnelNumber: null,
  },
] as const;

async function seedTestUsers() {
  if (process.env.SEED_TEST_USERS !== "true") {
    console.log("  → Testkonten übersprungen (SEED_TEST_USERS ist nicht 'true')");
    return;
  }

  const password = process.env.SEED_TEST_PASSWORD;
  if (!password) {
    // Refused rather than defaulted. A fallback password here would be in
    // every install that ever set the flag once.
    console.log("  ! SEED_TEST_USERS=true, aber SEED_TEST_PASSWORD fehlt — keine Konten angelegt");
    return;
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  let created = 0;

  for (const spec of TEST_USERS) {
    const role = await prisma.role.findUnique({ where: { key: spec.role } });
    if (!role) {
      console.log(`  ! Rolle ${spec.role} fehlt — ${spec.email} übersprungen`);
      continue;
    }

    const user = await prisma.user.upsert({
      where: { email: spec.email },
      create: { email: spec.email, name: spec.name, passwordHash: hash, status: "ACTIVE" },
      // The hash is rewritten on every run: the point of these accounts is that
      // the suite can sign in, and a stale password from an earlier value of
      // the variable would fail six tests with an authentication error that
      // looks like a permissions bug.
      update: { name: spec.name, passwordHash: hash, status: "ACTIVE", deletedAt: null },
    });

    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    if (spec.personnelNumber) {
      await prisma.employee.update({
        where: { personnelNumber: spec.personnelNumber },
        data: { userId: user.id },
      });
    }

    created += 1;
  }

  console.log(`  ✓ ${created} Testkonten (${TEST_USERS.map((u) => u.role).join(", ")})`);
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
  await seedLoadProjects();
  await seedTestUsers();
  console.log("\nFertig.");
}

main()
  .catch((err) => {
    console.error("\nSeed fehlgeschlagen:", err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
