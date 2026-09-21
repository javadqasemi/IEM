import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_NAMES, auditActionFor } from "../events/catalogue";
import { JOB_NAMES } from "../jobs/catalogue";
import { NOTIFICATION_TYPE_KEYS, NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES } from "./catalogue";
import { NOTIFIED_EVENTS, PRODUCED_TYPES } from "./notifications.listener";

/**
 * The catalogue against its producers, in both directions.
 *
 * The same shape `permissions.agreement.test.ts` has, for the same reason and
 * against the same two silent failures:
 *
 * 1. **A declared type nothing raises.** It appears in the settings screen as
 *    a switch governing nothing, an administrator turns it on, and nothing
 *    happens. That is the dead-permission problem with a different noun, and
 *    it is invisible — a declaration is syntactically perfect.
 * 2. **A listener producing a type the catalogue does not have.**
 *    `dispatch` refuses it and logs, so nobody is notified and the only
 *    evidence is a line in a process log nobody is reading at the time.
 *
 * Neither can be caught by reading one file, which is why this reads three.
 */

describe("every notification type has a producer", () => {
  it("finds both lists, so the assertions below are not vacuous", () => {
    expect(NOTIFICATION_TYPE_KEYS.length).toBeGreaterThan(5);
    expect(PRODUCED_TYPES.length).toBeGreaterThan(5);
  });

  it("has no declared type that nothing raises", () => {
    const orphans = NOTIFICATION_TYPE_KEYS.filter((key) => !PRODUCED_TYPES.includes(key));
    expect(
      orphans,
      "declared in catalogue.ts and produced by no event in notifications.listener.ts",
    ).toEqual([]);
  });

  it("has no produced type the catalogue does not declare", () => {
    const unknown = PRODUCED_TYPES.filter((key) => !NOTIFICATION_TYPE_KEYS.includes(key));
    expect(unknown, "produced by the listener and not declared — dispatch would drop it").toEqual(
      [],
    );
  });
});

describe("every consumed event exists", () => {
  it("names only events in the domain catalogue", () => {
    /*
      A listener registered for a name the bus does not have is the quietest
      failure in the system: `EventBus.on` accepts it, nothing ever fires it,
      and the notification simply never arrives. Nothing logs.
    */
    const unknown = NOTIFIED_EVENTS.filter(
      (name) => !(DOMAIN_EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(unknown).toEqual([]);
  });

  it("consumes at least one event from each area the module claims", () => {
    // Guards against a map that silently lost a whole integration — the
    // four areas are the ones `docs/ENTERPRISE_ROADMAP.md` promises.
    const names = NOTIFIED_EVENTS.join(" ");
    expect(names).toMatch(/Mfa/);
    expect(names).toMatch(/Content/);
    expect(names).toMatch(/Application/);
    expect(names).toMatch(/Job/);
  });
});

describe("the delivery job", () => {
  it("is declared in the job catalogue", () => {
    // `JobService.register` throws at boot on an unknown name, so this only
    // moves the failure earlier — but it moves it from a runtime crash on a
    // developer's machine to a red unit test.
    expect(JOB_NAMES as readonly string[]).toContain("notification.deliver");
  });

  it("no longer declares the slot it replaced", () => {
    // `mail.send` was renamed rather than added beside, so that there is one
    // housekeeping job for getting a message out rather than a live one and
    // a dead one somebody would copy.
    expect(JOB_NAMES as readonly string[]).not.toContain("mail.send");
  });
});

describe("the settings screen can render the whole catalogue", () => {
  it("puts every type in a category the screen knows", () => {
    // A type in an unlisted category would be declared, governable in theory
    // and drawn nowhere — invisible in exactly the way an orphan is.
    const unknown = NOTIFICATION_TYPES.filter(
      (def) => !NOTIFICATION_CATEGORIES.includes(def.category),
    );
    expect(unknown.map((d) => d.key)).toEqual([]);
  });

  it("leaves no category empty", () => {
    const empty = NOTIFICATION_CATEGORIES.filter(
      (category) => !NOTIFICATION_TYPES.some((def) => def.category === category),
    );
    expect(empty, "a heading with nothing under it").toEqual([]);
  });
});

describe("the audit actions the new events derive", () => {
  /**
   * The four MFA events replaced four hand-written `audit.record` calls, and
   * the whole safety of that migration rests on the derived action names
   * being the ones the log already used.
   *
   * Pinned to literals rather than recomputed, so a change to
   * `auditActionFor` or to an event's name fails here — where the reason is
   * written down — rather than in three months when somebody filters the
   * audit log for `mfa.disabled` and finds nothing.
   */
  it.each([
    ["MfaEnabled", "mfa.enabled"],
    ["MfaDisabled", "mfa.disabled"],
    ["MfaReset", "mfa.reset"],
    ["MfaRecoveryRegenerated", "mfa_recovery.regenerated"],
    ["ContentSubmitted", "content.submitted"],
    ["ContentApproved", "content.approved"],
    ["ContentRejected", "content.rejected"],
    ["ContentPublished", "content.published"],
    ["JobFailed", "job.failed"],
    ["NotificationSettingsUpdated", "notification_settings.updated"],
  ] as const)("%s → %s", (event, action) => {
    expect(auditActionFor(event)).toBe(action);
  });

  it("keeps the four content actions byte-identical to the hand-written ones", () => {
    /*
      The migration's whole claim. `content.service.ts` wrote these four
      strings by hand before P2-3 and now publishes events instead; if the
      derivation produced anything else, three months of log would be split
      across two spellings of the same fact.
    */
    const before = ["content.submitted", "content.approved", "content.rejected", "content.published"];
    const after = ["ContentSubmitted", "ContentApproved", "ContentRejected", "ContentPublished"].map(
      (name) => auditActionFor(name as never),
    );
    expect(after).toEqual(before);
  });
});
