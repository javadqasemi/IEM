import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "@/core/api";
import { drawingRepository } from "../repository";

/**
 * The repository against a stubbed client.
 *
 * What is checked is the one thing this layer decides: **which URL and which
 * method answer which question**, and that the screen's vocabulary becomes the
 * server's. Nothing here asserts the shape of a response — that is the mapper's
 * test, and the separation is the point of having two files.
 *
 * Two translations make this file worth its length, and both are invisible from
 * a screen:
 *
 * - `{ live: true }` is **not a server filter**. It is an `in` over five
 *   statuses, assembled here, because a second definition on the server would
 *   be one that can disagree.
 * - `{ released: false }` becomes `filter[releasedAt]=isnull:true`. The boolean
 *   inverts on the way through — right once and then quietly wrong after a
 *   refactor — so both directions are asserted.
 *
 * `environment: "node"`, so `window` is stubbed rather than provided.
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

/* ================================================================== */

describe("list", () => {
  it("translates the screen's words into the contract's", async () => {
    await drawingRepository.list({
      search: "steigzone",
      type: "GRUNDRISS",
      project: "schulhaus",
      phase: "P51",
    });

    expect(path()).toBe("/api/v1/drawings");
    expect(query()).toContain("q=steigzone");
    expect(query()).toContain("filter[type]=eq:GRUNDRISS");
    expect(query()).toContain("filter[project]=like:schulhaus");
    expect(query()).toContain("filter[phase]=eq:P51");
  });

  /**
   * *Alle Lüftungspläne* — and `eq`, not `like`.
   *
   * A Gewerk code is `LFT`, and a substring match would make a search for `EL`
   * return Elektro and Lüftung alike. The project name beside it *is* `like`,
   * because that is a name fragment.
   */
  it("matches a Gewerk code exactly, not as a substring", async () => {
    await drawingRepository.list({ discipline: "LFT" });
    expect(query()).toContain("filter[discipline]=eq:LFT");
    expect(query()).not.toContain("like");
  });

  it("sends an id filter as an equality", async () => {
    await drawingRepository.list({ projectId: "p1", buildingId: "b1", disciplineId: "g1" });
    expect(query()).toContain("filter[projectId]=eq:p1");
    expect(query()).toContain("filter[buildingId]=eq:b1");
    expect(query()).toContain("filter[disciplineId]=eq:g1");
  });

  it("expands `live` into the five statuses that are still in play", async () => {
    await drawingRepository.list({ live: true });
    expect(query()).toContain("filter[status]=in:WIP,IN_CHECK,CHECKED,RELEASED,ISSUED");
    expect(query()).not.toContain("SUPERSEDED");
    expect(query()).not.toContain("WITHDRAWN");
  });

  it("lets `live` win over a status selection rather than intersecting", async () => {
    // Both at once cannot be satisfied, and an intersection would return
    // nothing — which reads as a broken filter rather than as an impossible
    // question. The screen clears the chips to match.
    await drawingRepository.list({ live: true, statuses: ["WITHDRAWN"] });
    expect(query()).toContain("in:WIP");
    expect(query()).not.toContain("WITHDRAWN");
  });

  it("joins several statuses into one `in`", async () => {
    await drawingRepository.list({ statuses: ["WIP", "IN_CHECK"] });
    expect(query()).toContain("filter[status]=in:WIP,IN_CHECK");
  });

  it("defaults to no filters at all", async () => {
    await drawingRepository.list({});
    expect(query()).not.toContain("filter[");
  });
});

describe("revisions", () => {
  it("asks the cross-plan endpoint, not a plan's own", async () => {
    // "Was ist diese Woche freigegeben worden" is not answerable from a list
    // nested under one drawing.
    await drawingRepository.revisions({ reason: "FEHLERKORREKTUR" });
    expect(path()).toBe("/api/v1/drawings/revisions");
    expect(query()).toContain("filter[reason]=eq:FEHLERKORREKTUR");
  });

  /**
   * Both inversions, in both directions — one assertion alone would pass
   * against code that ignored the flag entirely.
   */
  it("inverts `released` into an isnull test", async () => {
    await drawingRepository.revisions({ released: true });
    expect(query(0)).toContain("filter[releasedAt]=isnull:false");

    await drawingRepository.revisions({ released: false });
    expect(query(1)).toContain("filter[releasedAt]=isnull:true");
  });

  it("inverts `superseded` the same way", async () => {
    await drawingRepository.revisions({ superseded: false });
    expect(query(0)).toContain("filter[supersededAt]=isnull:true");

    await drawingRepository.revisions({ superseded: true });
    expect(query(1)).toContain("filter[supersededAt]=isnull:false");
  });

  it("omits both filters when neither is asked", async () => {
    await drawingRepository.revisions({});
    expect(query()).not.toContain("releasedAt");
    expect(query()).not.toContain("supersededAt");
  });

  it("narrows to one plan when asked", async () => {
    await drawingRepository.revisions({ drawingId: "d1" });
    expect(query()).toContain("filter[drawingId]=eq:d1");
  });
});

describe("transmittals", () => {
  it("has its own endpoint, not a sub-path of drawings", async () => {
    // A Planversand is found by its own number months later; nesting it would
    // make its URL depend on a plan it happens to contain several of.
    await drawingRepository.listTransmittals({ purpose: "ZUR_AUSFUEHRUNG" });
    expect(path()).toBe("/api/v1/transmittals");
    expect(query()).toContain("filter[purpose]=eq:ZUR_AUSFUEHRUNG");
  });

  /** *"Alles was an Müller ging"* — the question the module exists for. */
  it("filters by recipient as a name fragment", async () => {
    await drawingRepository.listTransmittals({ recipient: "Müller" });
    expect(query()).toContain("filter[recipient]=like:Müller");
  });

  it("filters by the date something went out", async () => {
    await drawingRepository.listTransmittals({ sentAfter: "2026-03-14" });
    expect(query()).toContain("filter[sentAt]=gte:2026-03-14");
  });

  it("fetches one by id", async () => {
    await drawingRepository.getTransmittal("t1");
    expect(path()).toBe("/api/v1/transmittals/t1");
    expect(method()).toBe("GET");
  });
});

describe("the writes", () => {
  it("creates a plan with POST", async () => {
    await drawingRepository.create({
      number: "4723-HZG-EG-101",
      title: "Grundriss",
      projectId: "p1",
      disciplineId: "g1",
      type: "GRUNDRISS",
    });
    expect(path()).toBe("/api/v1/drawings");
    expect(method()).toBe("POST");
    expect(body().number).toBe("4723-HZG-EG-101");
  });

  it("updates with PATCH and carries the expected version", async () => {
    await drawingRepository.update("d1", { expectedVersion: 7, title: "Korrigiert" });
    expect(path()).toBe("/api/v1/drawings/d1");
    expect(method()).toBe("PATCH");
    expect(body().expectedVersion).toBe(7);
  });

  it("changes status through its own route with PUT", async () => {
    // A separate route because it is a separate act with separate permissions —
    // check, release and withdraw are three different people's authority.
    await drawingRepository.changeStatus("d1", { status: "IN_CHECK" });
    expect(path()).toBe("/api/v1/drawings/d1/status");
    expect(method()).toBe("PUT");
  });

  it("nests a revision under its plan", async () => {
    await drawingRepository.createRevision("d1", {
      changeNote: "Steigzone verschoben",
      storageKey: "k",
      fileName: "f.pdf",
      size: 1,
      checksum: "c",
      mimeType: "application/pdf",
    });
    expect(path()).toBe("/api/v1/drawings/d1/revisions");
    expect(method()).toBe("POST");
  });

  it("issues plans by posting a transmittal", async () => {
    await drawingRepository.createTransmittal({
      projectId: "p1",
      items: [{ drawingRevisionId: "r1" }],
      recipients: [{ externalName: "Müller AG" }],
    });
    expect(path()).toBe("/api/v1/transmittals");
    expect(method()).toBe("POST");
    expect(body().items).toHaveLength(1);
    expect(body().recipients).toHaveLength(1);
  });

  it("acknowledges against the transmittal, naming the recipient", async () => {
    await drawingRepository.acknowledge("t1", { recipientId: "rc1" });
    expect(path()).toBe("/api/v1/transmittals/t1/acknowledge");
    expect(method()).toBe("POST");
    expect(body().recipientId).toBe("rc1");
  });

  it("deletes a plan", async () => {
    await drawingRepository.remove("d1");
    expect(method()).toBe("DELETE");
  });
});

describe("the pickers", () => {
  it("reaches the master-data endpoints directly", async () => {
    // A repository may know any endpoint. Importing another feature's
    // repository is what `architecture.test.ts` refuses.
    await drawingRepository.projectOptions("schul");
    expect(path(0)).toBe("/api/v1/projects");

    await drawingRepository.employeeOptions("mei");
    expect(path(1)).toBe("/api/v1/employees");
    // Only people who still work here can be named as having drawn something.
    expect(query(1)).toContain("filter[status]=eq:ACTIVE");

    await drawingRepository.disciplineOptions();
    expect(path(2)).toBe("/api/v1/disciplines");

    await drawingRepository.buildingOptions();
    expect(path(3)).toBe("/api/v1/buildings");
  });
});
