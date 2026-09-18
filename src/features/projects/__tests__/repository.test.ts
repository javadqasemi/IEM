import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "@/core/api";
import { projectRepository } from "../repository";

/**
 * The repository against a stubbed client.
 *
 * What is checked is the one thing this layer decides: **which URL and which
 * method answer which question**, and that the screen's vocabulary becomes the
 * server's. Nothing here asserts the shape of a response — that is the mapper's
 * test, and the separation is the point of having two files.
 *
 * The filter translation is the reason this file is worth its length.
 * `{ customer: "gemeinde" }` has to become `filter[customer]=like:gemeinde`,
 * and a screen never learns that. When the server's spelling changed in
 * foundation stage F11 it reached two functions in one file and no screen at
 * all — these assertions are what keep that true.
 *
 * `environment: "node"`, so `window` is stubbed rather than provided: the
 * client reads `window.location.origin` to resolve a relative base, which is
 * the whole of its dependency on a DOM.
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

describe("the list query", () => {
  it("sends nothing when nothing was asked for", async () => {
    await projectRepository.list({});
    // Not `?page=1&perPage=25&q=`: an empty parameter is a parameter, and the
    // server's allowlist would have to decide what an empty filter means.
    expect(query()).toBe("");
  });

  it("turns a search into q", async () => {
    await projectRepository.list({ search: "guglera" });
    expect(query()).toContain("q=guglera");
  });

  it("uses eq for one status and in for several", async () => {
    // Both are the same chip control on screen. `in:` with one value would
    // work; `eq:` with several would silently match none.
    await projectRepository.list({ status: "ACTIVE" });
    expect(query()).toContain("filter[status]=eq:ACTIVE");

    calls = [];
    await projectRepository.list({ statuses: ["ACTIVE", "ON_HOLD"] });
    expect(query()).toContain("filter[status]=in:ACTIVE,ON_HOLD");
  });

  it("prefers the multi-select when both are given", async () => {
    await projectRepository.list({ status: "PLANNED", statuses: ["ACTIVE"] });
    expect(query()).toContain("filter[status]=in:ACTIVE");
    expect(query()).not.toContain("eq:PLANNED");
  });

  it("filters a customer by name with like and by id with eq", async () => {
    await projectRepository.list({ customer: "gemeinde" });
    expect(query()).toContain("filter[customer]=like:gemeinde");

    calls = [];
    await projectRepository.list({ customerId: "c1" });
    expect(query()).toContain("filter[customerId]=eq:c1");
  });

  it("filters by Gewerk code", async () => {
    await projectRepository.list({ discipline: "LFT" });
    expect(query()).toContain("filter[discipline]=eq:LFT");
  });

  it("turns a deadline into lte", async () => {
    await projectRepository.list({ dueBefore: "2026-12-31" });
    expect(query()).toContain("filter[plannedEndDate]=lte:2026-12-31");
  });

  it("serialises the sort as field:dir", async () => {
    await projectRepository.list({ sort: { field: "plannedEndDate", dir: "asc" } });
    expect(query()).toContain("sort=plannedEndDate:asc");
  });

  it("combines everything into one request", async () => {
    await projectRepository.list({
      search: "schulhaus",
      statuses: ["ACTIVE"],
      health: "RED",
      page: 3,
      perPage: 50,
    });
    const q = query();
    expect(q).toContain("q=schulhaus");
    expect(q).toContain("filter[status]=in:ACTIVE");
    expect(q).toContain("filter[health]=eq:RED");
    expect(q).toContain("page=3");
    expect(q).toContain("perPage=50");
    expect(calls).toHaveLength(1);
  });
});

describe("the routes", () => {
  it("reads one project from its own path", async () => {
    await projectRepository.get("p1");
    expect(new URL(calls[0].url).pathname).toMatch(/\/projects\/p1$/);
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });

  it("creates with POST", async () => {
    await projectRepository.create({ name: "Neu", customerId: "c1" });
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: "Neu", customerId: "c1" });
  });

  it("edits with PATCH and changes the status with PUT", async () => {
    // The separation is the server's contract, not a style choice: a transition
    // has preconditions, its own permission and its own event.
    await projectRepository.update("p1", { name: "Anders" });
    expect(calls[0].init?.method).toBe("PATCH");

    calls = [];
    await projectRepository.changeStatus("p1", { status: "ON_HOLD" });
    expect(calls[0].init?.method).toBe("PUT");
    expect(new URL(calls[0].url).pathname).toMatch(/\/projects\/p1\/status$/);
  });

  it("upserts a Gewerk with PUT", async () => {
    // A Gewerk is either in scope or not; `PUT` is what "make this the state"
    // means, and `POST` would fail the second time somebody corrects a budget.
    await projectRepository.scopeDiscipline("p1", { disciplineId: "d1" });
    expect(calls[0].init?.method).toBe("PUT");
    expect(new URL(calls[0].url).pathname).toMatch(/\/projects\/p1\/disciplines$/);
  });

  it("scopes a member removal to its project", async () => {
    await projectRepository.removeMember("p1", "m1");
    expect(new URL(calls[0].url).pathname).toMatch(/\/projects\/p1\/members\/m1$/);
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("nests milestones under the project", async () => {
    await projectRepository.createMilestone("p1", { name: "Abgabe", dueDate: "2026-05-01" });
    expect(new URL(calls[0].url).pathname).toMatch(/\/projects\/p1\/milestones$/);

    calls = [];
    await projectRepository.updateMilestone("p1", "s1", { status: "MET" });
    expect(new URL(calls[0].url).pathname).toMatch(/\/projects\/p1\/milestones\/s1$/);
    expect(calls[0].init?.method).toBe("PATCH");
  });
});

describe("the master-data pickers", () => {
  it("asks for active employees explicitly", async () => {
    // Sent rather than defaulted on the server: a list that hides rows by
    // default is a list that cannot show a record which exists.
    await projectRepository.employeeOptions("meier");
    const q = query();
    expect(q).toContain("filter[status]=eq:ACTIVE");
    expect(q).toContain("q=meier");
  });

  it("narrows buildings to one customer when asked", async () => {
    await projectRepository.buildingOptions(undefined, "c1");
    expect(query()).toContain("filter[customerId]=eq:c1");
  });

  it("asks for disciplines without pagination", async () => {
    // Eight rows of master data. Wrapping them in a paginated envelope would
    // make every caller unwrap one to draw a dropdown.
    await projectRepository.disciplineOptions();
    expect(query()).toBe("");
    expect(new URL(calls[0].url).pathname).toMatch(/\/disciplines$/);
  });
});
