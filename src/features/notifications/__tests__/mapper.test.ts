import { describe, expect, it } from "vitest";
import {
  toDelivery,
  toDeliveryPage,
  toNotification,
  toNotificationPage,
  toPreferenceRow,
  toRuleRow,
} from "../mapper";
import type { DeliveryDto, NotificationDto, PreferenceDto, RuleDto } from "../dto";

/**
 * The wire boundary.
 *
 * Thin, like every mapper here, so what is worth asserting is narrow: that
 * dates become dates, that a null stays null rather than becoming the epoch,
 * and — the one that carries real weight — that **nothing is recomputed**.
 * Every resolution the server performed arrives as a value, and a client that
 * re-derived one would be the second copy of a rule that eventually disagrees.
 */

const notification: NotificationDto = {
  id: "n1",
  type: "security.mfa_disabled",
  category: "Sicherheit",
  severity: "WARNING",
  title: "Zwei-Faktor-Authentisierung deaktiviert",
  body: "Ihr Konto ist jetzt nur noch durch das Passwort geschützt.",
  link: "#/profil",
  actorName: "Anna Meier",
  read: false,
  createdAt: "2026-09-21T08:30:00.000Z",
};

describe("toNotification", () => {
  it("turns the timestamp into a date", () => {
    const mapped = toNotification(notification);
    expect(mapped.createdAt).toBeInstanceOf(Date);
    expect(mapped.createdAt.toISOString()).toBe(notification.createdAt);
  });

  it("keeps the nulls null", () => {
    // A `body` of `""` and a `body` of `null` render differently — the
    // component tests for null to decide whether to draw the paragraph at
    // all — so coercing here would add an empty line to every short message.
    const mapped = toNotification({ ...notification, body: null, link: null, actorName: null });
    expect(mapped.body).toBeNull();
    expect(mapped.link).toBeNull();
    expect(mapped.actorName).toBeNull();
  });

  it("carries the category the server assigned rather than deriving one", () => {
    // The category comes from the catalogue, which only the server has. A
    // client splitting the key on `.` would produce "security" where the
    // screen needs "Sicherheit".
    expect(toNotification(notification).category).toBe("Sicherheit");
  });
});

describe("toNotificationPage", () => {
  it("carries the unread count that came with the page", () => {
    /*
      The bell and the list read the same number from the same response, so
      they cannot disagree after a "mark all read". A page that dropped it
      would send the screen back to the count endpoint and reintroduce
      exactly that gap.
    */
    const page = toNotificationPage({
      items: [notification],
      total: 1,
      page: 1,
      perPage: 20,
      pages: 1,
      unread: 7,
    });
    expect(page.unread).toBe(7);
    expect(page.items[0].createdAt).toBeInstanceOf(Date);
  });
});

describe("toPreferenceRow", () => {
  const dto: PreferenceDto = {
    type: "content.approved",
    category: "Inhalte",
    label: "Eigener Inhalt freigegeben",
    description: "Geht an die Person, die den Eintrag eingereicht hat.",
    severity: "SUCCESS",
    mandatory: false,
    inApp: true,
    email: false,
    lockedInApp: false,
    lockedEmail: true,
    disabledByOrganisation: false,
  };

  it("carries the resolved channels rather than recomputing them", () => {
    // `inApp` and `email` are the *result* of invariant → organisation →
    // person, performed once on the server. Recomputing them here would be
    // the second copy of the rule this whole module is arranged to avoid.
    const row = toPreferenceRow(dto);
    expect(row.inApp).toBe(true);
    expect(row.email).toBe(false);
    expect(row.lockedEmail).toBe(true);
  });

  it("leaves the firm's fields null, rather than inventing a default", () => {
    /*
      `enabled: null` is the type saying *this is not your screen*. A `true`
      here would eventually be rendered as a switch the person cannot
      actually set, which is the failure the nullability exists to prevent.
    */
    const row = toPreferenceRow(dto);
    expect(row.enabled).toBeNull();
    expect(row.recipients).toBeNull();
  });
});

describe("toRuleRow", () => {
  const dto: RuleDto = {
    type: "security.mfa_disabled",
    category: "Sicherheit",
    label: "Zwei-Faktor-Authentisierung deaktiviert",
    description: "Wenn der zweite Faktor Ihres Kontos entfernt wurde.",
    severity: "WARNING",
    mandatory: true,
    recipients: "Die betroffene Person",
    enabled: true,
    inApp: true,
    email: true,
    configured: false,
  };

  it("carries the firm's fields", () => {
    const row = toRuleRow(dto);
    expect(row.enabled).toBe(true);
    expect(row.recipients).toBe("Die betroffene Person");
  });

  it("locks the in-app channel of a mandatory type", () => {
    /*
      Derived here rather than sent, and the distinction matters: on the
      firm's screen the *only* thing that can lock a channel is the type
      being mandatory, and the server already says which those are.
      Deriving one boolean from another the response carries is not a second
      copy of a rule; recomputing which types are mandatory would be.
    */
    expect(toRuleRow(dto).lockedInApp).toBe(true);
    expect(toRuleRow({ ...dto, mandatory: false }).lockedInApp).toBe(false);
  });

  it("never locks the e-mail channel on the firm's screen", () => {
    // The firm may always switch the e-mail copy of anything off, including
    // a security notification. Only the in-app copy is an invariant.
    expect(toRuleRow(dto).lockedEmail).toBe(false);
  });

  it("produces the same shape as a personal row", () => {
    // One `PreferenceTable` renders both, so the two mappers have to agree
    // on the keys or the shared component grows a branch.
    expect(Object.keys(toRuleRow(dto)).sort()).toEqual(
      Object.keys(
        toPreferenceRow({
          type: "x",
          category: "Inhalte",
          label: "x",
          description: "x",
          severity: "INFO",
          mandatory: false,
          inApp: true,
          email: false,
          lockedInApp: false,
          lockedEmail: false,
          disabledByOrganisation: false,
        }),
      ).sort(),
    );
  });
});

describe("toDelivery", () => {
  const dto: DeliveryDto = {
    id: "d1",
    channel: "EMAIL",
    status: "SKIPPED",
    attempts: 0,
    detail: "Kein SMTP-Server konfiguriert.",
    queuedAt: "2026-09-21T08:30:00.000Z",
    settledAt: "2026-09-21T08:30:01.000Z",
    type: "application.received",
    severity: "INFO",
    recipient: "hr@iem.ch",
  };

  it("turns both timestamps into dates and keeps an unsettled one null", () => {
    expect(toDelivery(dto).queuedAt).toBeInstanceOf(Date);
    expect(toDelivery(dto).settledAt).toBeInstanceOf(Date);
    expect(toDelivery({ ...dto, settledAt: null }).settledAt).toBeNull();
  });

  it("keeps the reason, which is the column the table exists for", () => {
    // A `SKIPPED` row with no explanation is indistinguishable from a bug.
    expect(toDelivery(dto).detail).toBe("Kein SMTP-Server konfiguriert.");
  });

  it("has no title and no body to map", () => {
    /*
      Asserted as a property of the shape rather than trusted. An operator
      diagnosing SMTP does not need to read everybody's messages, and a
      delivery log that grew a `title` would quietly become a way to.
    */
    expect(toDelivery(dto)).not.toHaveProperty("title");
    expect(toDelivery(dto)).not.toHaveProperty("body");
  });
});

describe("toDeliveryPage", () => {
  it("maps the rows and the paging", () => {
    const page = toDeliveryPage({
      items: [],
      total: 0,
      page: 1,
      perPage: 50,
      pages: 1,
    });
    expect(page.items).toEqual([]);
    expect(page.pages).toBe(1);
  });
});
