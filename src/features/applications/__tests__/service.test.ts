import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from "@/entities/application";
import {
  allowedNextStatuses,
  canTransition,
  displayName,
  isOpen,
  isRetentionExpiring,
  openCount,
  retentionDaysLeft,
  sortName,
  totalFileBytes,
} from "../service";

/**
 * The domain layer: pure functions, no mocks, no network, no React.
 *
 * That is the whole argument for `service.ts`. Every one of these would
 * otherwise be an expression inside JSX, where it is untestable and where the
 * second screen that needs it writes its own slightly different copy.
 */

const base: Application = {
  id: "app_1",
  position: "Fachplaner:in HLK",
  firstName: "Anna",
  lastName: "Meier",
  email: "anna.meier@example.ch",
  phone: null,
  availableFrom: null,
  message: null,
  files: [],
  status: "NEW",
  note: null,
  receivedAt: new Date("2026-09-01T08:30:00.000Z"),
  retainUntil: new Date("2026-10-01T00:00:00.000Z"),
};

describe("isOpen", () => {
  it("counts the three statuses that still need a decision", () => {
    expect(isOpen("NEW")).toBe(true);
    expect(isOpen("IN_REVIEW")).toBe(true);
    expect(isOpen("INTERVIEW")).toBe(true);
  });

  it("does not count the three that are the end of the conversation", () => {
    expect(isOpen("HIRED")).toBe(false);
    expect(isOpen("REJECTED")).toBe(false);
    expect(isOpen("WITHDRAWN")).toBe(false);
  });
});

describe("transitions", () => {
  it("always allows staying where you are, so a form can save unchanged", () => {
    for (const status of APPLICATION_STATUSES) {
      expect(canTransition(status, status)).toBe(true);
      expect(allowedNextStatuses(status)[0]).toBe(status);
    }
  });

  it("walks the normal path", () => {
    expect(canTransition("NEW", "IN_REVIEW")).toBe(true);
    expect(canTransition("IN_REVIEW", "INTERVIEW")).toBe(true);
    expect(canTransition("INTERVIEW", "HIRED")).toBe(true);
  });

  it("refuses a step that skips a stage", () => {
    expect(canTransition("NEW", "HIRED")).toBe(false);
    expect(canTransition("NEW", "INTERVIEW")).toBe(false);
  });

  /**
   * Someone who withdraws after an offer is a real event. Refusing to record it
   * would push the fact into the note field, where nothing can count it.
   */
  it("lets an applicant withdraw from anywhere, including after a hire", () => {
    for (const status of APPLICATION_STATUSES) {
      if (status === "WITHDRAWN") continue;
      expect(canTransition(status, "WITHDRAWN")).toBe(true);
    }
  });

  it("treats WITHDRAWN as final", () => {
    expect(allowedNextStatuses("WITHDRAWN")).toEqual(["WITHDRAWN"]);
  });

  it("lets a rejection be reopened, because rejections get reconsidered", () => {
    expect(canTransition("REJECTED", "IN_REVIEW")).toBe(true);
  });

  it("names a reachable status for every status", () => {
    // Guards the table itself: a typo that emptied a row would otherwise only
    // show up as a select with one option.
    for (const status of APPLICATION_STATUSES) {
      expect(allowedNextStatuses(status).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("names", () => {
  it("displays given name first", () => {
    expect(displayName(base)).toBe("Anna Meier");
  });

  it("sorts by family name", () => {
    expect(sortName(base)).toBe("Meier Anna");
  });
});

describe("totalFileBytes", () => {
  it("is zero with no dossier", () => {
    expect(totalFileBytes(base)).toBe(0);
  });

  it("adds the files up", () => {
    const withFiles: Application = {
      ...base,
      files: [
        { originalName: "a.pdf", size: 100, mimeType: "application/pdf" },
        { originalName: "b.pdf", size: 250, mimeType: "application/pdf" },
      ],
    };
    expect(totalFileBytes(withFiles)).toBe(350);
  });
});

describe("retention", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");

  it("counts the whole days left", () => {
    // 15 Sep 12:00 → 1 Oct 00:00 is 15.5 days.
    expect(retentionDaysLeft(base, now)).toBe(16);
  });

  /**
   * Rounded up, not down. The number is read as "you have until", and flooring
   * it turns the last day into a deadline that has already passed.
   */
  it("reports one day, not zero, on the final day", () => {
    const application = { ...base, retainUntil: new Date("2026-09-15T23:00:00.000Z") };
    expect(retentionDaysLeft(application, now)).toBe(1);
  });

  it("goes negative once the date has passed", () => {
    const application = { ...base, retainUntil: new Date("2026-09-10T12:00:00.000Z") };
    expect(retentionDaysLeft(application, now)).toBe(-5);
  });

  /** "Unknown", never "never" — the seed does not allow a null retention. */
  it("reports null when there is no retention date", () => {
    expect(retentionDaysLeft({ ...base, retainUntil: null }, now)).toBeNull();
    expect(isRetentionExpiring({ ...base, retainUntil: null }, now)).toBe(false);
  });

  it("warns inside thirty days", () => {
    expect(isRetentionExpiring(base, now)).toBe(true);
  });

  it("does not warn outside thirty days", () => {
    const application = { ...base, retainUntil: new Date("2027-03-01T00:00:00.000Z") };
    expect(isRetentionExpiring(application, now)).toBe(false);
  });

  it("still warns once the date has passed", () => {
    // A record past its date is the most urgent case, not the least: the
    // nightly job has not run yet and this is the last chance to act.
    const application = { ...base, retainUntil: new Date("2026-09-01T00:00:00.000Z") };
    expect(isRetentionExpiring(application, now)).toBe(true);
  });
});

describe("openCount", () => {
  const byStatus: Record<ApplicationStatus, number> = {
    NEW: 3,
    IN_REVIEW: 2,
    INTERVIEW: 1,
    HIRED: 4,
    REJECTED: 9,
    WITHDRAWN: 1,
  };

  it("adds only the statuses that still need work", () => {
    expect(openCount(byStatus)).toBe(6);
  });
});
