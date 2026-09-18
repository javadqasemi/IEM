import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "@/core/api";
import { meetingRepository } from "../repository";

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
 * - `{ minutesPending: true }` is **not a server filter**. It is `status=HELD`
 *   plus `minutesSentAt` being null, assembled here, because a second definition
 *   on the server would be one that can disagree with this one.
 * - `{ hasTask: false }` becomes `filter[taskId]=isnull:true`. The boolean is
 *   inverted on the way through, which is exactly the kind of thing that is
 *   right once and then quietly wrong after a refactor.
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

describe("list", () => {
  it("translates the screen's words into the contract's", async () => {
    await meetingRepository.list({
      search: "lüftung",
      type: "BAUSITZUNG",
      project: "schulhaus",
      seriesNumber: 14,
    });

    expect(path()).toBe("/api/v1/meetings");
    expect(query()).toContain("q=lüftung");
    expect(query()).toContain("filter[type]=eq:BAUSITZUNG");
    // `project` is a name fragment, `projectId` is an id. Two keys because they
    // are two questions, and `like` versus `eq` is the whole difference.
    expect(query()).toContain("filter[project]=like:schulhaus");
    expect(query()).toContain("filter[seriesNumber]=eq:14");
  });

  it("sends an id filter as an equality, never as a search", async () => {
    await meetingRepository.list({ projectId: "p1" });
    expect(query()).toContain("filter[projectId]=eq:p1");
    expect(query()).not.toContain("like");
  });

  /**
   * The composite filter, and the reason it lives on this side.
   *
   * "Protokoll offen" is not a status. It is a held meeting whose minutes have
   * not gone out, and the two clauses are assembled here so that the rail badge,
   * the KPI tile and the chip cannot drift from each other.
   */
  it("expands minutesPending into its two clauses", async () => {
    await meetingRepository.list({ minutesPending: true });
    expect(query()).toContain("filter[status]=eq:HELD");
    expect(query()).toContain("filter[minutesSentAt]=isnull:true");
  });

  it("lets minutesPending win over a status selection rather than intersecting", async () => {
    // Both at once cannot be satisfied — "geplant" and "durchgeführt" are
    // exclusive — so the composite takes precedence and the screen clears the
    // chips to match. An intersection would return nothing, which reads as a
    // broken filter rather than as an impossible question.
    await meetingRepository.list({ minutesPending: true, statuses: ["PLANNED"] });
    expect(query()).toContain("filter[status]=eq:HELD");
    expect(query()).not.toContain("PLANNED");
  });

  it("joins several statuses into one `in`", async () => {
    await meetingRepository.list({ statuses: ["PLANNED", "HELD"] });
    expect(query()).toContain("filter[status]=in:PLANNED,HELD");
  });
});

describe("protocol lines", () => {
  it("asks the cross-meeting endpoint, not a meeting's own", async () => {
    await meetingRepository.protocolLines({ kind: "PENDENZ", discipline: "LFT" });
    expect(path()).toBe("/api/v1/meetings/items");
    expect(query()).toContain("filter[kind]=eq:PENDENZ");
    expect(query()).toContain("filter[discipline]=eq:LFT");
  });

  /**
   * The inversion, asserted in both directions because one of them alone would
   * pass against code that ignored the flag entirely.
   */
  it("inverts hasTask into an isnull test", async () => {
    await meetingRepository.protocolLines({ hasTask: true });
    expect(query(0)).toContain("filter[taskId]=isnull:false");

    await meetingRepository.protocolLines({ hasTask: false });
    expect(query(1)).toContain("filter[taskId]=isnull:true");
  });

  it("omits the taskId filter entirely when hasTask is not asked", async () => {
    await meetingRepository.protocolLines({});
    expect(query()).not.toContain("taskId");
  });
});

describe("decisions", () => {
  it("has its own endpoint, not a sub-path of meetings", async () => {
    await meetingRepository.listDecisions({ impact: "KOSTEN", project: "schulhaus" });
    expect(path()).toBe("/api/v1/decisions");
    expect(query()).toContain("filter[impact]=eq:KOSTEN");
    expect(query()).toContain("filter[project]=like:schulhaus");
  });

  it("expresses isReversal as a test on supersedesId", async () => {
    await meetingRepository.listDecisions({ isReversal: true });
    expect(query()).toContain("filter[supersedesId]=isnull:false");
  });

  it("fetches one decision by id", async () => {
    await meetingRepository.getDecision("d1");
    expect(path()).toBe("/api/v1/decisions/d1");
    expect(method()).toBe("GET");
  });
});

describe("the writes", () => {
  it("creates a meeting with POST", async () => {
    await meetingRepository.create({ title: "Bausitzung", startsAt: "2026-09-18T14:00:00.000Z" });
    expect(path()).toBe("/api/v1/meetings");
    expect(method()).toBe("POST");
    expect(body().title).toBe("Bausitzung");
  });

  it("updates with PATCH and carries the expected version", async () => {
    await meetingRepository.update("m1", { expectedVersion: 7, title: "Verschoben" });
    expect(path()).toBe("/api/v1/meetings/m1");
    expect(method()).toBe("PATCH");
    expect(body().expectedVersion).toBe(7);
  });

  it("changes status through its own route with PUT", async () => {
    // A separate route because it is a separate act with separate
    // preconditions — the same split the server makes.
    await meetingRepository.changeStatus("m1", { status: "HELD" });
    expect(path()).toBe("/api/v1/meetings/m1/status");
    expect(method()).toBe("PUT");
  });

  it("nests attendance, agenda and protocol under the meeting", async () => {
    await meetingRepository.addAttendee("m1", { employeeId: "e1" });
    expect(path(0)).toBe("/api/v1/meetings/m1/attendees");

    await meetingRepository.addAgendaItem("m1", { title: "Stand Lüftung" });
    expect(path(1)).toBe("/api/v1/meetings/m1/agenda");

    await meetingRepository.addItem("m1", { text: "Steigzone wird verschoben" });
    expect(path(2)).toBe("/api/v1/meetings/m1/items");
  });

  it("records attendance in one request for the whole list", async () => {
    // Attendance is taken once, round the table. A request per person would be
    // twelve requests and twelve chances for one to fail unnoticed.
    await meetingRepository.recordAttendance("m1", {
      attendance: [
        { attendeeId: "a1", attended: true },
        { attendeeId: "a2", attended: false, apologised: true },
      ],
    });
    expect(path()).toBe("/api/v1/meetings/m1/attendance");
    // `PUT`, not `POST`: recording attendance twice has to be the same room
    // rather than the room twice.
    expect(method()).toBe("PUT");
    expect(body().attendance).toHaveLength(2);
  });

  it("approves through its own route", async () => {
    await meetingRepository.approve("m1", { decision: "APPROVED" });
    expect(path()).toBe("/api/v1/meetings/m1/approval");
    expect(method()).toBe("POST");
  });

  it("sends minutes as an act with no body to compose", async () => {
    // `minutesSentAt` is stamped by this route and typed nowhere — which is what
    // makes "welche Protokolle muss ich noch versenden" answerable at all.
    await meetingRepository.sendMinutes("m1");
    expect(path()).toBe("/api/v1/meetings/m1/minutes/sent");
    expect(method()).toBe("POST");
  });

  /**
   * The arrow, asserted because it is the one call in this module where getting
   * the direction backwards would still typecheck: both arguments are ids.
   */
  it("supersedes by calling the replacement and naming the target", async () => {
    await meetingRepository.supersede("new", { supersedesId: "old" });
    expect(path()).toBe("/api/v1/decisions/new/supersedes");
    expect(body().supersedesId).toBe("old");
  });
});

describe("the pickers", () => {
  it("reaches the master-data endpoints directly", async () => {
    // A repository may know any endpoint. Importing another feature's
    // repository is what `architecture.test.ts` refuses — see the note there.
    await meetingRepository.projectOptions("schul");
    expect(path(0)).toBe("/api/v1/projects");

    await meetingRepository.employeeOptions("mei");
    expect(path(1)).toBe("/api/v1/employees");
    // Only people who still work here can be put in a room.
    expect(query(1)).toContain("filter[status]=eq:ACTIVE");

    await meetingRepository.disciplineOptions();
    expect(path(2)).toBe("/api/v1/disciplines");
  });
});
