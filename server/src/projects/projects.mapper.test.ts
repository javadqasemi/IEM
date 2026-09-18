import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  toAuditSnapshot,
  toDate,
  toMilestone,
  toMoney,
  toProjectCreateData,
  toProjectDetail,
  toProjectExportRow,
  toProjectListItem,
  toProjectUpdateData,
} from "./projects.mapper";

/**
 * The mapper, both directions.
 *
 * The gate asks for exactly that, and the reason is that the two halves fail
 * differently. Outbound, a missed conversion leaks a `Decimal` as
 * `{"s":1,"e":6,"d":[…]}` — visible, ugly, and caught the first time anybody
 * looks at the network tab. Inbound, a missed conversion writes `null` to a
 * column and the request succeeds, which is the failure nobody sees.
 *
 * No database: the rows are constructed. A mapper that needed one would be a
 * query in disguise.
 */

const row = {
  id: "p1",
  number: "P-2026-014",
  name: "Schulhaus Guglera",
  status: "ACTIVE" as const,
  priority: "HIGH" as const,
  health: "GREEN" as const,
  progressPercent: 40,
  currentPhase: "P41" as const,
  startDate: new Date("2026-01-15T00:00:00.000Z"),
  plannedEndDate: new Date("2026-12-31T00:00:00.000Z"),
  actualEndDate: null,
  contractValue: new Prisma.Decimal("1450000.00"),
  currency: "CHF",
  budgetHours: 2400,
  version: 3,
  updatedAt: new Date("2026-09-18T06:00:00.000Z"),
  createdAt: new Date("2026-01-02T06:00:00.000Z"),
  archivedAt: null,
  customer: { id: "c1", number: "K-00123", name: "Gemeinde Giffers" },
  building: { id: "b1", number: "G-00412", name: "Schulhaus Guglera", city: "Giffers" },
  manager: { id: "e1", firstName: "Anna", lastName: "Meier", email: "anna@iem.ch" },
  office: { id: "o1", name: "Thun" },
};

describe("outbound: row → API", () => {
  it("turns a Decimal into a fixed-scale string", () => {
    // Not a number. A client that receives a number does arithmetic on it, and
    // float arithmetic on money is how a total ends in .0000000001.
    const item = toProjectListItem(row);
    expect(item.contractValue).toBe("1450000.00");
    expect(typeof item.contractValue).toBe("string");
  });

  it("keeps the scale a plain toString would drop", () => {
    const item = toProjectListItem({ ...row, contractValue: new Prisma.Decimal("1200") });
    // `.toString()` gives "1200" — the same amount rendered two ways on two
    // screens, which reads as two different numbers to the person signing.
    expect(item.contractValue).toBe("1200.00");
  });

  it("passes null money through as null", () => {
    expect(toProjectListItem({ ...row, contractValue: null }).contractValue).toBeNull();
  });

  it("turns every Date into an ISO string with the zone", () => {
    const item = toProjectListItem(row);
    expect(item.startDate).toBe("2026-01-15T00:00:00.000Z");
    expect(item.actualEndDate).toBeNull();
    // `2026-09-18` read in Zürich and in UTC are different days, and the
    // difference lands on a contracted deadline.
    expect(item.updatedAt).toMatch(/Z$/);
  });

  it("leaves no Date or Decimal anywhere in the output", () => {
    // The assertion that survives a field being added: walk the whole result
    // rather than naming the fields the test happened to know about.
    const walk = (value: unknown, path: string): void => {
      if (value instanceof Date) throw new Error(`Date left at ${path}`);
      if (value instanceof Prisma.Decimal) throw new Error(`Decimal left at ${path}`);
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      }
    };
    expect(() => walk(toProjectListItem(row), "project")).not.toThrow();
  });

  it("joins a person's name once, in one place", () => {
    expect(toProjectListItem(row).manager).toEqual({
      id: "e1",
      name: "Anna Meier",
      email: "anna@iem.ch",
    });
  });

  it("survives a project with no building, manager or office", () => {
    const bare = toProjectListItem({ ...row, building: null, manager: null, office: null });
    expect(bare.building).toBeNull();
    expect(bare.manager).toBeNull();
    expect(bare.office).toBeNull();
  });

  it("maps the detail children", () => {
    const detail = toProjectDetail({
      ...row,
      description: null,
      notes: null,
      createdById: "u1",
      updatedById: "u1",
      architect: null,
      members: [
        {
          id: "m1",
          role: "ENGINEER" as const,
          allocationPercent: 60,
          from: new Date("2026-02-01T00:00:00.000Z"),
          to: null,
          employee: {
            id: "e2",
            firstName: "Beat",
            lastName: "Roth",
            email: "beat@iem.ch",
            position: "Projektingenieur",
          },
        },
      ],
      disciplines: [
        {
          id: "d1",
          status: "ACTIVE" as const,
          feeShare: new Prisma.Decimal("35.00"),
          feeShareOverride: false,
          budgetHours: 800,
          budgetCost: new Prisma.Decimal("120000.00"),
          hourlyRate: null,
          scopeNote: null,
          discipline: { id: "x1", code: "LFT", name: "Lüftung", defaultColour: "disc-lueftung" },
          leadEngineer: null,
        },
      ],
      milestones: [
        {
          id: "s1",
          name: "Bauprojekt abgegeben",
          dueDate: new Date("2026-05-01T00:00:00.000Z"),
          metAt: null,
          status: "OPEN" as const,
          phase: "P32" as const,
          isBillingTrigger: true,
        },
      ],
    });

    expect(detail.members[0].employee.name).toBe("Beat Roth");
    // A share is a number and a budget is a string — the split the whole file
    // turns on.
    expect(detail.disciplines[0].feeShare).toBe(35);
    expect(detail.disciplines[0].budgetCost).toBe("120000.00");
    expect(detail.disciplines[0].discipline.colour).toBe("disc-lueftung");
    expect(detail.milestones[0].dueDate).toBe("2026-05-01T00:00:00.000Z");
  });

  it("flattens the export into named columns", () => {
    const csv = toProjectExportRow(row);
    expect(csv["Nummer"]).toBe("P-2026-014");
    expect(csv["Kunde"]).toBe("Gemeinde Giffers");
    expect(csv["Projektleitung"]).toBe("Anna Meier");
    // A date column in a spreadsheet is a day, not an instant.
    expect(csv["Start"]).toBe("2026-01-15");
    for (const value of Object.values(csv)) expect(typeof value).toBe("string");
  });

  it("reads the manager from either row shape", () => {
    /*
      The regression guard for an audit log that lied.

      `findForRules` selects `managerId`; the detail select has no such column
      and carries `manager: { id }` instead. A snapshot that read only the
      first produced a `before` with the manager and an `after` without it — so
      every edit that did not touch the manager was recorded as removing them.
      Nothing failed; the row was simply wrong, which is the worst thing an
      audit row can be. It was found by reading a real row, not by a type error.
    */
    const common = {
      name: "P",
      status: "ACTIVE",
      startDate: new Date("2026-01-15T00:00:00.000Z"),
      plannedEndDate: null,
    };
    expect(toAuditSnapshot({ ...common, managerId: "e1" }).managerId).toBe("e1");
    expect(toAuditSnapshot({ ...common, manager: { id: "e1" } }).managerId).toBe("e1");
    // And the two shapes must agree on everything, not only on the manager.
    expect(toAuditSnapshot({ ...common, managerId: "e1" })).toEqual(
      toAuditSnapshot({ ...common, manager: { id: "e1" } }),
    );
  });

  it("reports no manager as null from either shape", () => {
    const common = { name: "P", status: "PLANNED", startDate: null, plannedEndDate: null };
    expect(toAuditSnapshot({ ...common, managerId: null }).managerId).toBeNull();
    expect(toAuditSnapshot({ ...common, manager: null }).managerId).toBeNull();
    expect(toAuditSnapshot(common).managerId).toBeNull();
  });

  it("maps a milestone on its own the same way as inside the detail", () => {
    const standalone = toMilestone({
      id: "s1",
      name: "Bauprojekt abgegeben",
      dueDate: new Date("2026-05-01T00:00:00.000Z"),
      metAt: new Date("2026-04-28T00:00:00.000Z"),
      status: "MET",
      phase: "P32",
      isBillingTrigger: true,
    });
    expect(standalone.dueDate).toBe("2026-05-01T00:00:00.000Z");
    expect(standalone.metAt).toBe("2026-04-28T00:00:00.000Z");
  });
});

describe("inbound: DTO → Prisma", () => {
  it("parses a well-formed amount", () => {
    expect(toMoney("1234.50", "Auftragswert")?.toFixed(2)).toBe("1234.50");
    expect(toMoney("1234", "Auftragswert")?.toFixed(2)).toBe("1234.00");
  });

  it("refuses an amount a person typed, naming the field", () => {
    // The failure this prevents is silent: `Number("1'200.00")` is NaN, and a
    // NaN reaching a Decimal column stores null.
    expect(() => toMoney("1'200.00", "Auftragswert")).toThrow(/Auftragswert/);
    expect(() => toMoney("1,50", "Auftragswert")).toThrow();
    expect(() => toMoney("12.345", "Auftragswert")).toThrow();
    expect(() => toMoney("abc", "Auftragswert")).toThrow();
  });

  it("treats empty and absent as null, not as zero", () => {
    expect(toMoney("", "x")).toBeNull();
    expect(toMoney(undefined, "x")).toBeNull();
    expect(toMoney(null, "x")).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
  });

  it("distinguishes 'not supplied' from 'clear it'", () => {
    // The whole reason PATCH works. `undefined` must not reach the column as
    // null, and `null` must.
    const untouched = toProjectUpdateData({}, "u1");
    expect("name" in untouched).toBe(false);
    expect("startDate" in untouched).toBe(false);
    expect("managerId" in untouched).toBe(false);

    const cleared = toProjectUpdateData({ startDate: null, managerId: null }, "u1");
    expect(cleared.startDate).toBeNull();
    expect(cleared.managerId).toBeNull();
  });

  it("writes a relation as a scalar foreign key, never as connect", () => {
    /*
      The regression guard for a 500 that typechecked.

      An update goes through `updateMany` — the optimistic lock needs the
      version inside the `where`, and only `updateMany` allows that. Its input
      has **no relation operations at all**, so a body carrying
      `manager: { connect: … }` is rejected at runtime with *Unknown argument
      `manager`*. It compiled, because the parameter was the looser
      `ProjectUpdateInput` and the object is spread into the call; it was found
      by pressing Save.
    */
    const data = toProjectUpdateData({ buildingId: "b9", managerId: "e1" }, "u1");
    expect(data.buildingId).toBe("b9");
    expect(data.managerId).toBe("e1");
    expect("building" in data).toBe(false);
    expect("manager" in data).toBe(false);

    // Nothing anywhere in an update body may be a relation operation.
    for (const [key, value] of Object.entries(data)) {
      const looksLikeRelation =
        value !== null &&
        typeof value === "object" &&
        ("connect" in value || "disconnect" in value);
      expect(looksLikeRelation, `${key} is a relation operation`).toBe(false);
    }
  });

  it("records who wrote it", () => {
    expect(toProjectUpdateData({ name: "Neu" }, "u1").updatedById).toBe("u1");
  });

  it("builds a create with the required customer connected", () => {
    const data = toProjectCreateData(
      {
        number: "P-2026-001",
        name: "Neubau Bern",
        customerId: "c1",
        contractValue: "500000",
        startDate: "2026-03-01",
      },
      "u1",
    );
    expect(data.number).toBe("P-2026-001");
    expect(data.customer).toEqual({ connect: { id: "c1" } });
    expect((data.contractValue as Prisma.Decimal).toFixed(2)).toBe("500000.00");
    expect(data.startDate).toBeInstanceOf(Date);
    expect(data.createdById).toBe("u1");
    expect(data.updatedById).toBe("u1");
  });

  it("refuses a bad amount on create too, not only on update", () => {
    expect(() =>
      toProjectCreateData(
        { number: "P-2026-001", name: "X", customerId: "c1", contractValue: "viel" },
        "u1",
      ),
    ).toThrow(/Auftragswert/);
  });
});
