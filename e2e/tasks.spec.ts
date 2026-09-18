import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, TEST_PASSWORD, apiAs, expect, test } from "./fixtures";

/**
 * Aufgaben, **against the live API** — Wave 2, module 1.
 *
 * Three things this suite is for, and the first is the reason it exists at all.
 *
 * **1. The version history says what changed.** `changed` is a `string[]`, so
 * it cannot be wrong at the type level; it was wrong for every edit of every
 * record from F13 until a browser showed a row listing thirteen fields for a
 * request that sent one. The cause is the compiled DTO — ES2022 class fields
 * plus `transform: true` — and **vitest cannot reproduce it**, because esbuild
 * does not define the absent fields. `changed.test.ts` says so and tests the
 * function; this tests the behaviour, on the build that actually runs.
 *
 * **2. The rules reach the API.** `tasks.rules.test.ts` proves
 * `refuseTransition` refuses; only a request proves the service calls it, that
 * the repository fetched the inputs it needs, and that the refusal arrives as a
 * 400 rather than a 500.
 *
 * **3. The board's arithmetic survives a round trip.** A drag is the one
 * interaction where the client and the server each hold half of the answer.
 */

let admin: APIRequestContext;

test.beforeAll(async () => {
  admin = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
});

test.afterAll(async () => {
  await admin.dispose();
});

type Task = {
  id: string;
  title: string;
  status: string;
  version: number;
  position: number;
  isOverdue: boolean;
  project: { id: string; number: string } | null;
  counts: { subtasks: number; checklist: number; dependsOn: number };
};

async function create(ctx: APIRequestContext, body: Record<string, unknown>): Promise<Task> {
  const response = await ctx.post(`${API}/tasks`, { data: body });
  expect(response.status(), `POST /tasks ${JSON.stringify(body)}`).toBe(201);
  return ((await response.json()) as { data: Task }).data;
}

/** Cleaned up after each test that makes one, so a re-run starts where it started. */
const made: string[] = [];

test.afterEach(async () => {
  while (made.length) {
    const id = made.pop()!;
    await admin.delete(`${API}/tasks/${id}`);
  }
});

test.describe("the version history", () => {
  test("records only the fields the request changed", async () => {
    /**
     * **The regression guard for the bug that shipped.**
     *
     * Before the fix this returned every declared field of `UpdateTaskDto` —
     * thirteen of them — for a body carrying one. Nothing failed: the shape was
     * right, the count was plausible, and the only symptom was a Verlauf tab
     * that had stopped being readable.
     */
    const task = await create(admin, { title: "E2E: Verlauf prüfen" });
    made.push(task.id);

    const first = await admin.patch(`${API}/tasks/${task.id}`, {
      data: { expectedVersion: task.version, description: "Nur die Beschreibung." },
    });
    expect(first.status()).toBe(200);

    const history = await admin.get(`${API}/tasks/${task.id}/versions`);
    const rows = ((await history.json()) as { data: { version: number; changed: string[] }[] }).data;

    expect(rows).toHaveLength(1);
    expect(rows[0].changed, "the history claims fields the request never sent").toEqual([
      "description",
    ]);
  });

  test("records two fields when two were sent, and the note separately", async () => {
    const task = await create(admin, { title: "E2E: Zwei Felder" });
    made.push(task.id);

    await admin.patch(`${API}/tasks/${task.id}`, {
      data: {
        expectedVersion: task.version,
        title: "E2E: Zwei Felder, geändert",
        priority: "URGENT",
        versionNote: "Nach Bausitzung 14",
      },
    });

    const history = await admin.get(`${API}/tasks/${task.id}/versions`);
    const rows = ((await history.json()) as {
      data: { changed: string[]; note: string | null }[];
    }).data;

    expect(rows[0].changed.sort()).toEqual(["priority", "title"]);
    // The note is *about* the change, not one of the record's fields.
    expect(rows[0].changed).not.toContain("versionNote");
    expect(rows[0].note).toBe("Nach Bausitzung 14");
  });

  test("records an empty list for a save that changed nothing", async () => {
    // A legitimate request: a form where the user pressed save without editing.
    const task = await create(admin, { title: "E2E: Nichts geändert" });
    made.push(task.id);

    await admin.patch(`${API}/tasks/${task.id}`, { data: { expectedVersion: task.version } });

    const history = await admin.get(`${API}/tasks/${task.id}/versions`);
    const rows = ((await history.json()) as { data: { changed: string[] }[] }).data;
    expect(rows[0].changed).toEqual([]);
  });

  test("keeps a cleared field as a change", async () => {
    // `null` means "clear it" and is an edit somebody made; only `undefined`
    // means absent.
    const task = await create(admin, { title: "E2E: Feld leeren", dueDate: "2026-12-01" });
    made.push(task.id);

    await admin.patch(`${API}/tasks/${task.id}`, {
      data: { expectedVersion: task.version, dueDate: null },
    });

    const history = await admin.get(`${API}/tasks/${task.id}/versions`);
    const rows = ((await history.json()) as { data: { changed: string[] }[] }).data;
    expect(rows[0].changed).toEqual(["dueDate"]);
  });
});

test.describe("the rules, through the API", () => {
  test("refuses DONE while a subtask is open, and says how many", async () => {
    const parent = await create(admin, { title: "E2E: Elternaufgabe" });
    const child = await create(admin, { title: "E2E: Teilaufgabe", parentTaskId: parent.id });
    made.push(child.id, parent.id);

    const response = await admin.put(`${API}/tasks/${parent.id}/status`, {
      data: { status: "DONE" },
    });
    expect(response.status(), "a refused rule must be a 400, not a 500").toBe(400);
    expect((await response.json()).message).toContain("Teilaufgabe");
  });

  test("refuses DONE while an FS predecessor is open, and names it", async () => {
    const first = await create(admin, { title: "E2E: Vorgänger" });
    const second = await create(admin, { title: "E2E: Nachfolger" });
    made.push(second.id, first.id);

    const edge = await admin.post(`${API}/tasks/${second.id}/dependencies`, {
      data: { predecessorId: first.id, type: "FS" },
    });
    expect(edge.status()).toBe(201);

    const refused = await admin.put(`${API}/tasks/${second.id}/status`, {
      data: { status: "DONE" },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).message).toContain("E2E: Vorgänger");
  });

  test("allows DONE despite an open SS predecessor", async () => {
    /**
     * The distinction the four relation types exist for. A start-to-start
     * relation says "these begin together" and has nothing to say about
     * finishing; treating every dependency as `FS` makes the other two
     * decorative and a Bauprogramm unrepresentable.
     */
    const first = await create(admin, { title: "E2E: SS-Vorgänger" });
    const second = await create(admin, { title: "E2E: SS-Nachfolger" });
    made.push(second.id, first.id);

    await admin.post(`${API}/tasks/${second.id}/dependencies`, {
      data: { predecessorId: first.id, type: "SS" },
    });

    const done = await admin.put(`${API}/tasks/${second.id}/status`, { data: { status: "DONE" } });
    expect(done.status()).toBe(200);
  });

  test("refuses a dependency that would close a cycle", async () => {
    // A→B→C exists; adding C→A closes it. Nothing about A's own edges says so,
    // and the consequence is three tasks that can never be completed, each of
    // which looks fine on its own.
    const a = await create(admin, { title: "E2E: Kreis A" });
    const b = await create(admin, { title: "E2E: Kreis B" });
    const c = await create(admin, { title: "E2E: Kreis C" });
    made.push(c.id, b.id, a.id);

    await admin.post(`${API}/tasks/${b.id}/dependencies`, { data: { predecessorId: a.id } });
    await admin.post(`${API}/tasks/${c.id}/dependencies`, { data: { predecessorId: b.id } });

    const closing = await admin.post(`${API}/tasks/${a.id}/dependencies`, {
      data: { predecessorId: c.id },
    });
    expect(closing.status()).toBe(400);
    expect((await closing.json()).message).toContain("Kreis");
  });

  test("refuses blocking without a reason, and returns to where it came from", async () => {
    const task = await create(admin, { title: "E2E: Blockieren" });
    made.push(task.id);

    await admin.put(`${API}/tasks/${task.id}/status`, { data: { status: "IN_PROGRESS" } });

    const noReason = await admin.put(`${API}/tasks/${task.id}/status`, {
      data: { status: "BLOCKED" },
    });
    expect(noReason.status(), "a blocked column with no reasons is unreadable").toBe(400);

    const blocked = await admin.put(`${API}/tasks/${task.id}/status`, {
      data: { status: "BLOCKED", reason: "Wartet auf die Bauherrschaft." },
    });
    expect(blocked.status()).toBe(200);

    const back = await admin.post(`${API}/tasks/${task.id}/unblock`, { data: {} });
    expect(back.status()).toBe(201);
    /**
     * `IN_PROGRESS`, not `TODO`. Unblocking is a *return*: a task that was in
     * review when the client went quiet must not reappear in the backlog three
     * weeks later as though nobody had done anything.
     */
    expect(((await back.json()) as { data: Task }).data.status).toBe("IN_PROGRESS");
  });
});

test.describe("the board", () => {
  test("moves a card between named neighbours and keeps the order", async () => {
    const project = await firstProjectId(admin);
    const a = await create(admin, { title: "E2E: Karte A", projectId: project });
    const b = await create(admin, { title: "E2E: Karte B", projectId: project });
    const c = await create(admin, { title: "E2E: Karte C", projectId: project });
    made.push(c.id, b.id, a.id);

    // C to the top, before A.
    const moved = await admin.put(`${API}/tasks/${c.id}/position`, {
      data: { beforeId: a.id, afterId: null },
    });
    expect(moved.status()).toBe(200);

    const column = await columnOf(admin, project, "TODO");
    const ours = column.filter((task) => made.includes(task.id)).map((task) => task.title);
    expect(ours.slice(0, 3)).toEqual(["E2E: Karte C", "E2E: Karte A", "E2E: Karte B"]);
  });

  test("renumbers rather than refusing when the gap runs out", async () => {
    /**
     * `positionBetween` returns `null` when the integers either side are
     * adjacent, and the service then renumbers the column **inside the same
     * transaction** as the move. Rare — with a gap of 1024 it takes ten
     * insertions into the same space — and it has to work the first time it
     * happens, because the symptom otherwise is a card that silently refuses to
     * move.
     */
    const project = await firstProjectId(admin);
    const top = await create(admin, { title: "E2E: Oben", projectId: project });
    const bottom = await create(admin, { title: "E2E: Unten", projectId: project });
    made.push(bottom.id, top.id);

    const filler = await create(admin, { title: "E2E: Füller", projectId: project });
    made.push(filler.id);

    // Drop it between the same two cards over and over. Each drop halves the
    // gap; the eleventh has none left.
    for (let i = 0; i < 14; i += 1) {
      const response = await admin.put(`${API}/tasks/${filler.id}/position`, {
        data: { afterId: top.id, beforeId: bottom.id },
      });
      expect(response.status(), `drop ${i + 1} of 14`).toBe(200);
    }

    const column = await columnOf(admin, project, "TODO");
    const positions = column.map((task) => task.position);
    // Still strictly ascending and still distinct — the two properties a
    // renumber has to preserve.
    expect([...new Set(positions)]).toHaveLength(positions.length);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  test("runs the transition rules on a drag, not only on the status route", async () => {
    // A board that could drag a card into `Erledigt` past an open subtask would
    // be a second, weaker door into the same transition.
    const parent = await create(admin, { title: "E2E: Drag-Eltern" });
    const child = await create(admin, { title: "E2E: Drag-Kind", parentTaskId: parent.id });
    made.push(child.id, parent.id);

    const dragged = await admin.put(`${API}/tasks/${parent.id}/position`, {
      data: { status: "DONE" },
    });
    expect(dragged.status()).toBe(400);
  });
});

test.describe("row-level rules", () => {
  test.beforeAll(() => {
    test.skip(
      !TEST_PASSWORD,
      "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` legt die Rollenkonten an.",
    );
  });

  test("an engineer writes their own card and not a colleague's", async () => {
    /**
     * `task.updateOwn`, which is the one row-level **write** rule in the system.
     * It cannot be a route decorator — `RequirePermissions` is AND, so naming
     * both keys would lock out every engineer, and ownership depends on a row
     * the guard has not read.
     */
    const engineer = await apiAs("ing@iem.test", TEST_PASSWORD);

    const list = await engineer.get(`${API}/tasks?perPage=50`);
    const items = ((await list.json()) as { data: { items: (Task & { assignee: { email: string } | null })[] } })
      .data.items;

    const own = items.find((task) => task.assignee?.email === "chiara.bianchi@iem.ch");
    const foreign = items.find(
      (task) => task.assignee && task.assignee.email !== "chiara.bianchi@iem.ch",
    );
    expect(own, "the seeded engineer has no task of their own").toBeTruthy();
    expect(foreign, "the seeded engineer sees no colleague's task").toBeTruthy();

    const mine = await engineer.patch(`${API}/tasks/${own!.id}`, {
      data: { expectedVersion: own!.version, description: "Von mir." },
    });
    expect(mine.status()).toBe(200);

    const theirs = await engineer.patch(`${API}/tasks/${foreign!.id}`, {
      data: { expectedVersion: foreign!.version, description: "Nein." },
    });
    expect(theirs.status()).toBe(403);

    // But commenting is allowed on anybody's card: asking a question on
    // somebody else's work is the point of a thread.
    const comment = await engineer.post(`${API}/tasks/${foreign!.id}/comments`, {
      data: { body: "E2E: Ist das noch aktuell?" },
    });
    expect(comment.status()).toBe(201);
    await engineer.delete(
      `${API}/tasks/${foreign!.id}/comments/${((await comment.json()) as { data: { id: string } }).data.id}`,
    );

    // And assigning is not: who does the work is a planning decision.
    const assign = await engineer.put(`${API}/tasks/${own!.id}/assignee`, {
      data: { assigneeId: null },
    });
    expect(assign.status()).toBe(403);

    await engineer.dispose();
  });

  test("a firm-level task is invisible to somebody it is not assigned to", async () => {
    /**
     * The case the project scope cannot express, and the reason
     * `tasks.scope.ts` is a union of three rules: `Task.projectId` is nullable,
     * so a predicate built only from project membership would hide every
     * firm-level task from everyone — including the person it is assigned to.
     * A 404 rather than a 403, because whether a task exists is itself
     * information.
     */
    const engineer = await apiAs("ing@iem.test", TEST_PASSWORD);

    const all = await admin.get(`${API}/tasks?filter[projectId]=isnull:true&perPage=20`);
    const firmLevel = ((await all.json()) as { data: { items: Task[] } }).data.items[0];
    expect(firmLevel, "no firm-level task in the seed").toBeTruthy();

    const response = await engineer.get(`${API}/tasks/${firmLevel.id}`);
    expect(response.status()).toBe(404);

    await engineer.dispose();
  });
});

/* ---- Helpers -------------------------------------------------------- */

async function firstProjectId(ctx: APIRequestContext): Promise<string> {
  const response = await ctx.get(`${API}/projects?q=P-2026-001`);
  const items = ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(items.length, "the seeded demo project is missing").toBeGreaterThan(0);
  return items[0].id;
}

/** One column, the way the board fetches it. */
async function columnOf(ctx: APIRequestContext, projectId: string, status: string): Promise<Task[]> {
  const response = await ctx.get(
    `${API}/tasks?filter[projectId]=eq:${projectId}&filter[status]=eq:${status}` +
      `&filter[parentTaskId]=isnull:true&sort=position:asc&perPage=200`,
  );
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: { items: Task[] } }).data.items;
}
