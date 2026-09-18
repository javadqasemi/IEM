import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationDto } from "../dto";
import { toApplication, toApplicationPage, toApplicationStats, toPatchDto } from "../mapper";

/**
 * The mapper, in both directions.
 *
 * This is the layer the firm's review added, and the test that justifies it:
 * every case below is a bug that happens *somewhere else* without this file —
 * in a comparison, in a `switch`, or in a date that silently became 1970.
 */

const dto: ApplicationDto = {
  id: "app_1",
  position: "Fachplaner:in HLK",
  firstName: "Anna",
  lastName: "Meier",
  email: "anna.meier@example.ch",
  phone: "+41 79 000 00 00",
  availableFrom: "nach Absprache",
  message: "Guten Tag\n\nIch interessiere mich …",
  files: [{ originalName: "Lebenslauf.pdf", size: 240_000, mimeType: "application/pdf" }],
  status: "IN_REVIEW",
  note: null,
  createdAt: "2026-09-01T08:30:00.000Z",
  retainUntil: "2027-03-01T00:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("toApplication", () => {
  it("turns the ISO timestamps into Dates", () => {
    const application = toApplication(dto);
    expect(application.receivedAt).toBeInstanceOf(Date);
    expect(application.receivedAt.toISOString()).toBe("2026-09-01T08:30:00.000Z");
    expect(application.retainUntil).toBeInstanceOf(Date);
  });

  /**
   * `new Date(null)` is 1 January 1970 — a real date, in the past, that no
   * comparison will flag. Without this branch a record with no retention date
   * would show as deleted six weeks before the company was founded.
   */
  it("keeps a null date null instead of turning it into the epoch", () => {
    expect(toApplication({ ...dto, retainUntil: null }).retainUntil).toBeNull();
  });

  it("narrows the status to the union", () => {
    expect(toApplication(dto).status).toBe("IN_REVIEW");
  });

  /**
   * Deployment skew: the server ships a seventh status before this bundle is
   * redeployed. Throwing would blank the list because of one row; leaving it as
   * a raw string would push the problem into every `switch`.
   */
  it("falls back for a status this client does not know, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const application = toApplication({ ...dto, status: "SHORTLISTED" });
    expect(application.status).toBe("NEW");
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("SHORTLISTED");
  });

  /**
   * `availableFrom` is the one date-looking field that is **not** a date: the
   * public form's `verfuegbar` is 120 characters the applicant types, and
   * "nach Absprache" is as common as "01.03.2027".
   */
  it("leaves availableFrom as the text it is", () => {
    expect(toApplication(dto).availableFrom).toBe("nach Absprache");
    expect(toApplication({ ...dto, availableFrom: "ab sofort" }).availableFrom).toBe("ab sofort");
  });

  it("copies the files array rather than sharing it with the DTO", () => {
    // The DTO belongs to the cache. An entity holding the same array is one
    // `push` away from mutating what another screen is rendering.
    const application = toApplication(dto);
    expect(application.files).not.toBe(dto.files);
    expect(application.files[0]).not.toBe(dto.files[0]);
    expect(application.files[0]).toEqual(dto.files[0]);
  });
});

describe("toApplicationPage", () => {
  it("maps the items and keeps the pagination as it is", () => {
    const page = toApplicationPage({ items: [dto], total: 1, page: 1, perPage: 50, pages: 1 });
    expect(page.total).toBe(1);
    expect(page.items[0].receivedAt).toBeInstanceOf(Date);
  });
});

describe("toApplicationStats", () => {
  /**
   * The endpoint only returns statuses that have rows, so a fresh database
   * sends `{ NEW: 3 }`. The filter chips read the map directly and `undefined`
   * renders as nothing where `0` is the truthful answer.
   */
  it("fills every status with zero", () => {
    const stats = toApplicationStats({ total: 3, byStatus: { NEW: 3 } });
    expect(stats.byStatus).toEqual({
      NEW: 3,
      IN_REVIEW: 0,
      INTERVIEW: 0,
      HIRED: 0,
      REJECTED: 0,
      WITHDRAWN: 0,
    });
  });

  it("ignores a status the server sends that this client does not have", () => {
    const stats = toApplicationStats({ total: 4, byStatus: { NEW: 3, SHORTLISTED: 1 } });
    expect(Object.keys(stats.byStatus)).toHaveLength(6);
    expect(stats.total).toBe(4);
  });
});

describe("toPatchDto", () => {
  it("sends only what was set", () => {
    expect(toPatchDto({ status: "HIRED" })).toEqual({ status: "HIRED" });
  });

  /**
   * An empty note is a real value — it clears the field. `undefined` means
   * "leave it alone", and collapsing the two is how a save wipes something the
   * form never showed.
   */
  it("distinguishes an empty note from an absent one", () => {
    expect(toPatchDto({ note: "" })).toEqual({ note: "" });
    expect(toPatchDto({ status: "HIRED" })).not.toHaveProperty("note");
  });
});
