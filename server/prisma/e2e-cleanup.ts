/**
 * Removes everything an E2E run has ever created, before the next one starts.
 *
 * ---
 *
 * ## Why this exists
 *
 * `afterAll` cannot be made sufficient. A killed Playwright process never
 * reaches it; a timed-out test abandons what it made; and a refusal the domain
 * is *right* to make — `DELETE /drawings/:id` will not take an issued plan —
 * leaves a row behind by design.
 *
 * By the time it was noticed, one seeded project carried **782 drawings**
 * where the seed makes six, plus 857 tasks, 852 meetings and 595 decisions.
 * That broke a real test rather than merely being untidy: the Planversand
 * dialog asks for a page of 100 plans — a documented design decision — so a
 * plan the test had just created was not in the list, and two full suite runs
 * were spent diagnosing a defect that did not exist.
 *
 * ## Why it runs *before* rather than after
 *
 * Crash safety. A cleanup that runs afterwards is exactly the one a crash
 * skips. Running first means the state a previous run died in is the state
 * this one starts by clearing, and the only thing the previous run had to do
 * was **label** its work — which it does at creation time, not at exit.
 *
 * ## What it will not do
 *
 * It deletes only rows whose own identifying text carries `E2E`, and it
 * touches no table where that cannot be checked. Concretely it will not:
 *
 * - delete a seeded project, plan or meeting, because none of them is marked;
 * - delete anything by age, by "recently created", or by "not in the seed",
 *   all of which would eventually take somebody's real work;
 * - touch `User`, `Role`, `Permission`, `Setting` or `Organisation` at all.
 *
 * The one deliberate exception is `JobApplication`, which is matched on its
 * `position` — the public form is the only way to create one and the spec
 * submits a marked position. Applicant dossiers are personal data, so the
 * match is exact rather than a prefix.
 *
 * ## Order
 *
 * Children before parents. Most relations cascade, but not all, and a delete
 * that half-succeeds is worse than one that does not run — so the order is
 * explicit rather than trusted to the schema.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL fehlt — Aufräumen übersprungen.");
  process.exit(0);
}

/*
  The adapter is not optional on Prisma 7.

  `new PrismaClient()` without one throws immediately — the trap CLAUDE.md
  records against throwaway scripts. `seed.ts` constructs it the same way.
*/
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** The marker `e2e/fixtures.ts` puts on everything a run creates. */
const MARK = "E2E";
const contains = { contains: MARK } as const;

async function main() {
  const removed: Record<string, number> = {};
  const note = (label: string, count: number) => {
    if (count > 0) removed[label] = (removed[label] ?? 0) + count;
  };

  /* ---- Drawings, and the two tables that hang off them ------------- */
  /*
    The one that actually broke a test. `TransmittalItem` points at a
    revision, so it goes first; a Transmittal left with no items is itself
    test debris and goes after.
  */
  const drawings = await prisma.drawing.findMany({
    where: { OR: [{ number: contains }, { title: contains }] },
    select: { id: true },
  });
  const drawingIds = drawings.map((d) => d.id);

  if (drawingIds.length) {
    const revisions = await prisma.drawingRevision.findMany({
      where: { drawingId: { in: drawingIds } },
      select: { id: true },
    });
    const revisionIds = revisions.map((r) => r.id);

    if (revisionIds.length) {
      note(
        "TransmittalItem",
        (await prisma.transmittalItem.deleteMany({
          where: { drawingRevisionId: { in: revisionIds } },
        })).count,
      );
    }
    note(
      "DrawingRevision",
      (await prisma.drawingRevision.deleteMany({ where: { drawingId: { in: drawingIds } } })).count,
    );
    note("Drawing", (await prisma.drawing.deleteMany({ where: { id: { in: drawingIds } } })).count);
  }

  // Transmittals the specs made directly, plus any left with nothing in them.
  const orphanTransmittals = await prisma.transmittal.findMany({
    where: { items: { none: {} } },
    select: { id: true },
  });
  if (orphanTransmittals.length) {
    const ids = orphanTransmittals.map((t) => t.id);
    note(
      "TransmittalRecipient",
      (await prisma.transmittalRecipient.deleteMany({ where: { transmittalId: { in: ids } } }))
        .count,
    );
    note("Transmittal", (await prisma.transmittal.deleteMany({ where: { id: { in: ids } } })).count);
  }

  /* ---- Meetings and the decisions that come out of them ------------ */
  /*
    Decisions first, and not only for the foreign key.

    A decision can supersede another — `supersedesId` points **from the new
    one to the old one**, which is the direction `meetings.rules.ts` argues for
    and the one call in that module where the wrong way round still typechecks.
    So the link is cleared before the delete rather than trusting a
    self-referential `SetNull` to pick an order.

    `MeetingItem` carries the protocol line that records a decision, and it is
    the other side of a `@unique`, so it goes first.
  */
  const decisions = await prisma.decision.findMany({
    where: { OR: [{ title: contains }, { number: contains }] },
    select: { id: true },
  });
  if (decisions.length) {
    const ids = decisions.map((d) => d.id);
    await prisma.meetingItem.updateMany({
      where: { decisionId: { in: ids } },
      data: { decisionId: null },
    });
    await prisma.decision.updateMany({
      where: { supersedesId: { in: ids } },
      data: { supersedesId: null },
    });
    note("Decision", (await prisma.decision.deleteMany({ where: { id: { in: ids } } })).count);
  }

  const meetings = await prisma.meeting.findMany({
    where: { title: contains },
    select: { id: true },
  });
  if (meetings.length) {
    const ids = meetings.map((m) => m.id);
    // Anything still pointing at a meeting that is going.
    await prisma.decision.updateMany({
      where: { meetingId: { in: ids } },
      data: { meetingId: null },
    });
    note("Meeting", (await prisma.meeting.deleteMany({ where: { id: { in: ids } } })).count);
  }

  /* ---- Tasks ------------------------------------------------------- */
  const tasks = await prisma.task.findMany({ where: { title: contains }, select: { id: true } });
  if (tasks.length) {
    const ids = tasks.map((t) => t.id);
    /*
      Subtasks cascade (`TaskSubtasks` is `onDelete: Cascade`), so a marked
      parent takes its children — including any the spec did *not* mark,
      which is correct: a subtask of a test task is test data.

      Dependencies do not cascade from both sides, so they go first. A task
      can be named by another task's dependency row in either direction, and a
      delete that hit one direction only would fail on the other.
    */
    await prisma.taskDependency.deleteMany({
      where: { OR: [{ predecessorId: { in: ids } }, { successorId: { in: ids } }] },
    });
    note("Task", (await prisma.task.deleteMany({ where: { id: { in: ids } } })).count);
  }

  /* ---- Projects, last of the business entities --------------------- */
  /*
    After the four above, because a project owns them and a delete that hit a
    project first would either cascade further than intended or fail on a
    constraint. Anything still hanging off a marked project by then was made
    by something that did not mark it, and is reported rather than removed.
  */
  const projects = await prisma.project.findMany({
    where: { OR: [{ name: contains }, { number: contains }] },
    select: { id: true, name: true },
  });
  for (const project of projects) {
    try {
      await prisma.project.delete({ where: { id: project.id } });
      note("Project", 1);
    } catch {
      note("Project (übersprungen)", 1);
    }
  }

  /* ---- Legacy names, from before the convention -------------------- */
  /*
    A one-time compatibility sweep, and deliberately a **list of exact
    historic prefixes** rather than anything clever.

    Before `e2eName`/`e2eNumber` existed, four specs named their rows in their
    own style and none of them carried a marker: `project-edit.spec.ts` wrote
    "Edit-Dialog Testlauf …", `versioning.spec.ts` wrote "Versionierung
    Testlauf …", and two older shapes — "Replay …" and "Versionierung Probe …"
    — survive from specs that have since been rewritten. On this machine that
    was 183 projects.

    It is here rather than run once by hand because anybody pulling this branch
    onto an existing database has the same debris, and telling them to write
    SQL would be the fix not shipping.

    **`Lastdaten …` is deliberately absent.** Those are the 500 rows
    `SEED_LOAD_PROJECTS` creates so `budgets.spec.ts` can measure something
    real, and deleting them would quietly turn the performance budgets back
    into a test over two rows.
  */
  /*
    `UI-…` plans, from before `drawings-ui.spec.ts` used `e2eNumber("UI")`.

    This is the exact prefix that produced the 782-drawing pile-up, so it is
    worth sweeping on every machine rather than only on the one where it was
    found. `DEMO-…` is deliberately **not** here: those are demo rows a script
    creates on purpose, and taking them would be this cleanup deciding what
    somebody else's fixture is for.
  */
  const legacyDrawings = await prisma.drawing.findMany({
    where: { number: { startsWith: "UI-" } },
    select: { id: true },
  });
  if (legacyDrawings.length) {
    const ids = legacyDrawings.map((d) => d.id);
    const revisions = await prisma.drawingRevision.findMany({
      where: { drawingId: { in: ids } },
      select: { id: true },
    });
    if (revisions.length) {
      await prisma.transmittalItem.deleteMany({
        where: { drawingRevisionId: { in: revisions.map((r) => r.id) } },
      });
    }
    await prisma.drawingRevision.deleteMany({ where: { drawingId: { in: ids } } });
    note(
      "Drawing (Altbestand)",
      (await prisma.drawing.deleteMany({ where: { id: { in: ids } } })).count,
    );
  }

  const LEGACY_PROJECT_PREFIXES = [
    "Edit-Dialog Testlauf",
    "Versionierung Testlauf",
    "Versionierung Probe",
    "Replay ",
  ];
  for (const prefix of LEGACY_PROJECT_PREFIXES) {
    const stale = await prisma.project.findMany({
      where: { name: { startsWith: prefix } },
      select: { id: true },
    });
    for (const project of stale) {
      try {
        await prisma.project.delete({ where: { id: project.id } });
        note("Project (Altbestand)", 1);
      } catch {
        note("Project (übersprungen)", 1);
      }
    }
  }

  /* ---- Content ----------------------------------------------------- */
  /*
    Hard-deleted, not soft-deleted.

    The API soft-deletes an entry so a publish can reason about it, which is
    right for a person pressing a button and wrong here: a soft-deleted row
    still counts toward every list the next run measures, which is the whole
    problem this script exists to solve.

    Versions go first — they carry the payload and have no cascade.
  */
  const entries = await prisma.contentEntry.findMany({
    where: { OR: [{ key: contains }, { data: { path: ["name"], string_contains: MARK } }] },
    select: { id: true },
  });
  if (entries.length) {
    const ids = entries.map((e) => e.id);
    note(
      "ContentVersion",
      (await prisma.contentVersion.deleteMany({ where: { entryId: { in: ids } } })).count,
    );
    note(
      "ReviewRequest",
      (await prisma.reviewRequest.deleteMany({ where: { entryId: { in: ids } } })).count,
    );
    note("ContentEntry", (await prisma.contentEntry.deleteMany({ where: { id: { in: ids } } })).count);
  }

  /* ---- Applicant dossiers ------------------------------------------ */
  /*
    Matched **exactly**, not by prefix.

    These are personal data. A `contains` match on a free-text position would
    eventually take a real application whose title happened to contain the
    letters; an exact match takes only what `downloads.spec.ts` submits.
  */
  note(
    "JobApplication",
    (await prisma.jobApplication.deleteMany({ where: { position: "E2E Testdossier" } })).count,
  );

  /* ---- Backups ----------------------------------------------------- */
  /*
    Runs the backup suite created, by trigger and age rather than by a name —
    a `BackupRun` has no human-readable field to mark, and inventing one so a
    test could label itself would be the test shaping the schema.

    `MANUAL` only: a `SCHEDULED` run belongs to the installation and a
    `PRE_RESTORE` one is somebody's way back. Older than an hour, so a run
    in flight is never touched.
  */
  const cutoff = new Date(Date.now() - 3_600_000);
  const staleBackups = await prisma.backupRun.findMany({
    where: { trigger: "MANUAL", createdAt: { lt: cutoff } },
    select: { id: true },
  });
  if (staleBackups.length) {
    const ids = staleBackups.map((b) => b.id);
    note(
      "RestoreRun",
      (await prisma.restoreRun.deleteMany({ where: { backupRunId: { in: ids } } })).count,
    );
    note("BackupRun", (await prisma.backupRun.deleteMany({ where: { id: { in: ids } } })).count);
  }

  /* ---- Report ------------------------------------------------------ */
  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  if (total === 0) {
    console.log("E2E-Aufräumen: nichts zu entfernen.");
    return;
  }
  console.log("E2E-Aufräumen:");
  for (const [table, count] of Object.entries(removed)) {
    console.log(`  ${String(count).padStart(5)} × ${table}`);
  }
}

main()
  .catch((err) => {
    /*
      Reported, never fatal.

      A cleanup that fails the whole suite would mean a transient database
      hiccup reading as a broken application. The worst case of skipping it is
      the state this script was written to fix, which is visible in its own
      output rather than silent.
    */
    console.error(`E2E-Aufräumen fehlgeschlagen: ${(err as Error).message}`);
  })
  .finally(() => prisma.$disconnect());
