import { describe, expect, it, vi } from "vitest";
import {
  DOMAIN_EVENT_NAMES,
  auditActionFor,
  type DomainEvent,
  type DomainEventName,
} from "./catalogue";
import { EventBus } from "./event-bus";
import { MetricsService } from "../metrics/metrics.service";
import { newContext, runWithContext } from "../context/request-context";

/**
 * The bus, and the two rules whose failures are silent.
 *
 * Neither is checkable by reading the code that uses it: a publisher cannot
 * tell whether its event was delivered before or after its transaction, and a
 * failing listener that is swallowed correctly looks exactly like one that was
 * never called.
 */

const envelope = { entity: "project", entityId: "p1", payload: {} as never };

describe("the catalogue", () => {
  it("lists a name for every declared event", () => {
    // The runtime list and the type are two declarations of one vocabulary.
    // A missing line produces a trigger nobody can select in the workflow
    // editor and an event the agreement test cannot see.
    const names: DomainEventName[] = [...DOMAIN_EVENT_NAMES];
    expect(new Set(names).size).toBe(DOMAIN_EVENT_NAMES.length);
    expect(DOMAIN_EVENT_NAMES.length).toBeGreaterThan(40);
  });

  /**
   * Past tense, always.
   *
   * A present-tense name is a command in disguise — `SendInvoice` on a bus is
   * one module telling another what to do, which is the coupling the bus
   * exists to remove. `…ing` is the same mistake wearing a different suffix,
   * with one deliberate exception.
   */
  it("names every event in the past tense", () => {
    const EXPECTED_PRESENT_PARTICIPLE = ["CertificateExpiring"];
    const offenders = DOMAIN_EVENT_NAMES.filter(
      (name) => name.endsWith("ing") && !EXPECTED_PRESENT_PARTICIPLE.includes(name),
    );
    expect(offenders).toEqual([]);
  });

  it("derives the audit action from the name", () => {
    expect(auditActionFor("ProjectCreated")).toBe("project.created");
    expect(auditActionFor("PhaseApproved")).toBe("phase.approved");
    expect(auditActionFor("ContentEntryUpdated")).toBe("content_entry.updated");
    expect(auditActionFor("TimeEntryApproved")).toBe("time_entry.approved");
  });

  it("produces a distinct audit action for every event", () => {
    // Two events collapsing to one action would make the log ambiguous in
    // exactly the place it is read: `drawing.released` meaning two things.
    const actions = DOMAIN_EVENT_NAMES.map(auditActionFor);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

/**
 * A metrics service the bus can count into, with no database behind it.
 *
 * The bus counts what it dispatches so that no module has to remember to —
 * which means it now needs one. Constructing the real service with a `null`
 * Prisma is enough: `recordEvent` touches nothing but a `Map`, and the
 * alternative — a hand-written stub — would stop matching the real one the
 * first time its signature changed.
 */
const metrics = () => new MetricsService(null as never);

describe("events are queued until the request succeeds", () => {
  it("does not deliver inside the request", async () => {
    const bus = new EventBus(metrics());
    const seen: DomainEvent[] = [];
    bus.on("ProjectCreated", (e) => void seen.push(e));

    await runWithContext(newContext(), async () => {
      bus.publish("ProjectCreated", {
        ...envelope,
        payload: { number: "P-1", name: "x", customerId: "c1" },
      });
      // A listener firing here would read the row before the transaction that
      // wrote it has committed.
      expect(seen).toHaveLength(0);
      await bus.flush();
      expect(seen).toHaveLength(1);
    });
  });

  it("delivers immediately when there is no request", async () => {
    // A cron tick or a job: the caller is responsible for publishing after its
    // own transaction, and there is no request end to wait for.
    const bus = new EventBus(metrics());
    const seen: DomainEvent[] = [];
    bus.on("RetentionPurged", (e) => void seen.push(e));

    bus.publish("RetentionPurged", {
      entity: "job_application",
      entityId: "-",
      payload: { entity: "job_application", count: 3 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
  });

  it("throws away what a failed request queued", async () => {
    const bus = new EventBus(metrics());
    const seen: DomainEvent[] = [];
    bus.on("*", (e) => void seen.push(e));

    await runWithContext(newContext(), async () => {
      bus.publish("ProjectArchived", { ...envelope, payload: { number: "P-1" } });
      expect(bus.discard()).toBe(1);
      await bus.flush();
    });

    // An event announcing work that errored out is a fact that is not true,
    // and the four consumers downstream cannot find that out.
    expect(seen).toHaveLength(0);
  });

  it("lets a handler publish without appending to the array being drained", async () => {
    const bus = new EventBus(metrics());
    const order: string[] = [];
    bus.on("ProjectCreated", () => {
      order.push("first");
      bus.publish("ProjectArchived", { ...envelope, payload: { number: "P-1" } });
    });
    bus.on("ProjectArchived", () => void order.push("second"));

    await runWithContext(newContext(), async () => {
      bus.publish("ProjectCreated", {
        ...envelope,
        payload: { number: "P-1", name: "x", customerId: "c1" },
      });
      await bus.flush();
      // The nested one lands on the queue; a second flush sends it. Without
      // the splice this would have been an infinite loop over a growing array.
      await bus.flush();
    });

    expect(order).toEqual(["first", "second"]);
  });
});

describe("a listener never fails its publisher", () => {
  it("logs a rejecting handler and runs the others", async () => {
    const bus = new EventBus(metrics());
    const errors = vi.spyOn(
      (bus as unknown as { logger: { error: (m: string) => void } }).logger,
      "error",
    ).mockImplementation(() => {});

    const ran: string[] = [];
    bus.on("IssueResolved", () => Promise.reject(new Error("Finance ist offline")));
    bus.on("IssueResolved", () => void ran.push("second"));

    await runWithContext(newContext(), async () => {
      bus.publish("IssueResolved", {
        ...envelope,
        payload: { projectId: "p1", number: "I-1", resolvedBy: "u1" },
      });
      // The flush itself must not reject — Finance being down cannot roll back
      // a resolved issue.
      await expect(bus.flush()).resolves.toBeUndefined();
    });

    expect(ran).toEqual(["second"]);
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});

describe("what an event carries", () => {
  it("takes the actor and the correlation id from the context", async () => {
    const bus = new EventBus(metrics());
    let captured: DomainEvent | null = null;
    bus.on("*", (e) => void (captured = e));

    const context = newContext({ correlationId: "corr-123" });
    context.actor = {
      id: "u1",
      email: "anna@iem.ch",
      name: "Anna",
      roles: [],
      permissions: new Set<string>(),
      isSuperAdmin: false,
    };

    await runWithContext(context, async () => {
      bus.publish("ProjectCreated", {
        ...envelope,
        payload: { number: "P-1", name: "x", customerId: "c1" },
      });
      await bus.flush();
    });

    expect(captured!.correlationId).toBe("corr-123");
    expect(captured!.actor?.email).toBe("anna@iem.ch");
  });

  it("lets a caller name a different actor", async () => {
    // A scheduled publish is not attributable to whoever scheduled it: the
    // decision and its effect are different moments.
    const bus = new EventBus(metrics());
    let captured: DomainEvent | null = null;
    bus.on("*", (e) => void (captured = e));

    bus.publish("ContentPublished", {
      entity: "content_snapshot",
      entityId: "8",
      payload: { version: 8, entriesPublished: 3, warnings: [] },
      actor: { id: null, email: null, name: "Zeitsteuerung" },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(captured!.actor?.name).toBe("Zeitsteuerung");
  });

  it("mints a correlation id outside a request rather than leaving it empty", () => {
    // Rows with no correlation id cannot be grouped; a minted one groups the
    // tick, which is the truthful answer.
    const bus = new EventBus(metrics());
    let captured: DomainEvent | null = null;
    bus.on("*", (e) => void (captured = e));
    bus.publish("RetentionPurged", {
      entity: "job_application",
      entityId: "-",
      payload: { entity: "job_application", count: 1 },
    });
    expect(captured!.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
