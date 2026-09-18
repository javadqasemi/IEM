import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "@/core/api";
import { taskRepository } from "../repository";

/**
 * The repository against a stubbed client.
 *
 * What is checked is the one thing this layer decides: **which URL and which
 * method answer which question**, and that the screen's vocabulary becomes the
 * server's. Nothing here asserts the shape of a response — that is the mapper's
 * test, and the separation is the point of having two files.
 *
 * The filter translation is the reason this file is worth its length.
 * `{ assignee: "meier" }` has to become `filter[assignee]=like:meier`, and a
 * screen never learns that.
 *
 * `environment: "node"`, so `window` is stubbed rather than provided: the client
 * reads `window.location.origin` to resolve a relative base, which is the whole
 * of its dependency on a DOM.
 */

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(() => {
  (globalThis as { window?: unknown }).window = { location: { origin: "http://localhost:5173" } };
});

beforeEach(() => {
  calls = [];
  setAccessToken("test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(respond({ items: [], total: 0, page: 1, perPage: 25, pages: 0 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

/** The decoded query string, so an assertion reads like the URL a person types. */
function query(index = 0): string {
  return decodeURIComponent(new URL(calls[index].url).search);
}

const path = (index = 0) => new URL(calls[index].url).pathname;
const body = (index = 0) => JSON.parse(String(calls[index].init?.body ?? "null"));
const method = (index = 0) => calls[index].init?.method ?? "GET";

describe("list", () => {
  it("translates the screen's words into the contract's", async () => {
    await taskRepository.list({
      search: "lüftung",
      assignee: "meier",
      discipline: "LFT",
      priority: "URGENT",
    });
    const q = query();
    expect(q).toContain("q=lüftung");
    expect(q).toContain("filter[assignee]=like:meier");
    expect(q).toContain("filter[discipline]=eq:LFT");
    expect(q).toContain("filter[priority]=eq:URGENT");
  });

  it("uses in: for several statuses and eq: for one", async () => {
    // Both are the same chip control on screen. Sending `eq:` with several
    // would silently match none.
    await taskRepository.list({ statuses: ["TODO", "IN_PROGRESS"] });
    expect(query(0)).toContain("filter[status]=in:TODO,IN_PROGRESS");

    await taskRepository.list({ status: "DONE" });
    expect(query(1)).toContain("filter[status]=eq:DONE");
  });

  it("prefers the list of statuses when both are given", async () => {
    await taskRepository.list({ statuses: ["TODO"], status: "DONE" });
    const q = query();
    expect(q).toContain("filter[status]=in:TODO");
    expect(q).not.toContain("eq:DONE");
  });

  it("turns the root sentinel into isnull and an id into eq", async () => {
    /**
     * The one filter that needs three states and gets them from two values.
     * `undefined` means "do not filter" — all tasks, subtasks included — while
     * `"root"` means the top level and an id means one task's children. A
     * `null` could only have expressed two of the three.
     */
    await taskRepository.list({ parent: "root" });
    expect(query(0)).toContain("filter[parentTaskId]=isnull:true");

    await taskRepository.list({ parent: "t1" });
    expect(query(1)).toContain("filter[parentTaskId]=eq:t1");

    await taskRepository.list({});
    expect(query(2)).not.toContain("parentTaskId");
  });

  it("sends a due-date ceiling as lte", async () => {
    await taskRepository.list({ dueBefore: "2026-12-31" });
    expect(query()).toContain("filter[dueDate]=lte:2026-12-31");
  });

  it("sends the page and the sort the caller asked for", async () => {
    await taskRepository.list({ page: 3, perPage: 50, sort: { field: "dueDate", dir: "desc" } });
    const q = query();
    expect(q).toContain("page=3");
    expect(q).toContain("perPage=50");
    expect(q).toContain("sort=dueDate:desc");
  });

  it("sends nothing it was not given", async () => {
    // An empty query has to be an empty query string, or a screen that clears
    // its filters keeps sending the last ones as empty strings — which the
    // server then refuses as an unknown value.
    await taskRepository.list({});
    expect(query()).toBe("");
  });
});

describe("the write routes", () => {
  it("patches a task and puts its status", async () => {
    await taskRepository.update("t1", { expectedVersion: 3, title: "Neu" });
    expect(path(0)).toBe("/api/v1/tasks/t1");
    expect(method(0)).toBe("PATCH");
    expect(body(0)).toEqual({ expectedVersion: 3, title: "Neu" });

    await taskRepository.changeStatus("t1", { status: "DONE" });
    expect(path(1)).toBe("/api/v1/tasks/t1/status");
    // `PUT`, because it sets a state rather than merging a change.
    expect(method(1)).toBe("PUT");
  });

  it("moves a card by naming its neighbours, never a position", async () => {
    /**
     * The client must not compute a position: it would hold a second copy of
     * the server's gap arithmetic, including the renumber case it cannot
     * perform, and two people dragging into the same gap would both compute the
     * same value.
     */
    await taskRepository.move("t1", { status: "IN_PROGRESS", afterId: "t2", beforeId: null });
    expect(path()).toBe("/api/v1/tasks/t1/position");
    expect(method()).toBe("PUT");
    expect(body()).toEqual({ status: "IN_PROGRESS", afterId: "t2", beforeId: null });
    expect(Object.keys(body())).not.toContain("position");
  });

  it("assigns and unassigns through one route", async () => {
    await taskRepository.assign("t1", { assigneeId: null });
    expect(path()).toBe("/api/v1/tasks/t1/assignee");
    expect(body()).toEqual({ assigneeId: null });
  });

  it("unblocks with a POST and an empty body", async () => {
    // A named route rather than a status change to a value the client worked
    // out: `blockedFrom` is the server's, and a client guessing it would send
    // somebody's card back to the backlog three weeks after they left it in
    // review.
    await taskRepository.unblock("t1");
    expect(path()).toBe("/api/v1/tasks/t1/unblock");
    expect(method()).toBe("POST");
  });

  it("sends a bulk change as one request", async () => {
    await taskRepository.bulk(["a", "b"], { priority: "LOW" });
    expect(path()).toBe("/api/v1/tasks/bulk");
    expect(body()).toEqual({ ids: ["a", "b"], priority: "LOW" });
  });
});

describe("the sub-resources", () => {
  it("nests every one under the task", async () => {
    // The nested route's parent is what the server checks the child against,
    // and a flat `/checklist/:id` would make that impossible.
    await taskRepository.addChecklistItem("t1", { text: "x" });
    expect(path(0)).toBe("/api/v1/tasks/t1/checklist");

    await taskRepository.updateChecklistItem("t1", "c1", { done: true });
    expect(path(1)).toBe("/api/v1/tasks/t1/checklist/c1");
    expect(method(1)).toBe("PATCH");

    await taskRepository.addDependency("t1", { predecessorId: "t2", type: "FS" });
    expect(path(2)).toBe("/api/v1/tasks/t1/dependencies");

    await taskRepository.removeDependency("t1", "d1");
    expect(path(3)).toBe("/api/v1/tasks/t1/dependencies/d1");
    expect(method(3)).toBe("DELETE");

    await taskRepository.addComment("t1", { body: "Frage" });
    expect(path(4)).toBe("/api/v1/tasks/t1/comments");

    await taskRepository.history("t1");
    expect(path(5)).toBe("/api/v1/tasks/t1/versions");
  });
});

describe("export", () => {
  it("asks the export route for the same query", async () => {
    /**
     * The contract, not a convenience: an export that quietly contains more
     * than the filtered view is a document somebody will act on (architecture
     * §7.2).
     */
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(
          new Response("Aufgabe;Status", {
            status: 200,
            headers: { "content-type": "text/csv" },
          }),
        );
      }),
    );
    // `download` reaches for the DOM to click an anchor; the repository's job
    // is the URL, so the failure after the response is irrelevant here.
    await taskRepository.exportCsv({ statuses: ["TODO"], discipline: "LFT" }).catch(() => {});

    expect(path()).toBe("/api/v1/tasks/export");
    const q = query();
    expect(q).toContain("filter[status]=in:TODO");
    expect(q).toContain("filter[discipline]=eq:LFT");
  });
});

describe("the pickers", () => {
  it("call the master-data endpoints directly", async () => {
    /**
     * **Not another feature's repository.** A repository may know any endpoint;
     * a feature importing a sibling is what `architecture.test.ts` refuses. The
     * first version of the dialogs imported `projectRepository`, which is the
     * violation this arrangement exists to avoid.
     */
    await taskRepository.projectOptions("guglera");
    expect(path(0)).toBe("/api/v1/projects");
    expect(query(0)).toContain("q=guglera");

    await taskRepository.employeeOptions();
    expect(path(1)).toBe("/api/v1/employees");
    // Sent rather than defaulted on the server: a list that hides rows by
    // default cannot show a record which exists.
    expect(query(1)).toContain("filter[status]=eq:ACTIVE");

    await taskRepository.disciplineOptions();
    expect(path(2)).toBe("/api/v1/disciplines");
    // Eight rows, so no pagination.
    expect(query(2)).toBe("");
  });
});
