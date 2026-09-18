import { Injectable, Logger } from "@nestjs/common";
import { currentActor, currentContext, correlationId } from "../context/request-context";
import { MetricsService } from "../metrics/metrics.service";
import type {
  DomainEvent,
  DomainEventName,
  DomainEvents,
  EventEnvelope,
} from "./catalogue";

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * The in-process domain event bus (weakness W10, foundation stage F7).
 *
 * Without it, `TimeTrackingService` imports `FinanceService` so that approving
 * an hour can update a project's cost, and by the tenth module the graph is the
 * mesh `features/README.md` forbids on the client. With it, Time Tracking
 * announces a fact and Finance decides whether it cares.
 *
 * Two rules, and both failures they prevent are quiet:
 *
 * **1. An event is published after its transaction commits.**
 *
 * `publish()` therefore *queues* by default: the event goes onto the request
 * context and is flushed when the request completes successfully. A listener
 * that ran inside the transaction would read the old row or deadlock on it,
 * and one that sent an e-mail for a transaction that then rolled back would
 * have told the world about something that did not happen.
 *
 * The honest limitation: with two transactions in one request, the first one's
 * events wait for the second. That is *later*, never earlier, so no listener
 * ever sees uncommitted data — which is the property that matters.
 *
 * Outside a request — a cron tick, a job — there is no context to queue onto,
 * so `publish` dispatches immediately. The caller is then responsible for
 * calling it after its own transaction, and `ScheduledTasks` does.
 *
 * **2. A listener never fails its publisher.**
 *
 * Handlers are awaited as a group and their rejections are logged, not
 * propagated. Finance being unreachable must not roll back an approved time
 * entry, and the audit log failing must not turn a successful publish into a
 * 500 — which is the same rule `AuditService` already states for itself.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<DomainEventName | "*", EventHandler[]>();

  /**
   * The bus counts what it dispatches, so no module counts its own events.
   *
   * The same argument as the audit listener one line further down: a figure a
   * module has to remember to report is a figure that is wrong in the modules
   * that forgot.
   */
  constructor(private readonly metrics: MetricsService) {}

  /**
   * Subscribes to one event, or to `"*"` for all of them.
   *
   * The wildcard exists for exactly two consumers — the audit listener and,
   * later, the workflow engine — and both need *every* event by definition. A
   * third wildcard subscriber is a sign that something should be reacting to
   * named events instead.
   */
  on(name: DomainEventName | "*", handler: EventHandler): void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
  }

  /**
   * Announces a fact.
   *
   * Queued onto the request context when there is one, dispatched immediately
   * when there is not. Returns nothing: a publisher that awaited its listeners
   * would be coupled to them again, which is the thing the bus exists to
   * prevent.
   */
  publish<N extends DomainEventName>(name: N, envelope: EventEnvelope<DomainEvents[N]>): void {
    const event: DomainEvent<N> = {
      name,
      entity: envelope.entity,
      entityId: envelope.entityId,
      payload: envelope.payload,
      before: envelope.before,
      after: envelope.after,
      actor:
        envelope.actor !== undefined
          ? envelope.actor
          : toActor(),
      correlationId: correlationId(),
      occurredAt: new Date(),
      message: envelope.message,
    };

    const context = currentContext();
    if (context) {
      context.queued.push(event);
      return;
    }
    void this.dispatch([event as DomainEvent]);
  }

  /**
   * Sends everything the request queued.
   *
   * Called by `RequestContextInterceptor` when the request has succeeded, and
   * by the job runner when a job has. Draining before dispatch matters: a
   * handler that publishes an event of its own must not append to the array
   * being iterated.
   */
  async flush(): Promise<void> {
    const context = currentContext();
    if (!context?.queued.length) return;
    const events = context.queued.splice(0) as DomainEvent[];
    await this.dispatch(events);
  }

  /**
   * Throws away what the request queued.
   *
   * Called when a request fails. An event announcing work that errored out is
   * worse than no event: it is a fact that is not true, and the four consumers
   * downstream have no way to know that.
   */
  discard(): number {
    const context = currentContext();
    if (!context) return 0;
    return context.queued.splice(0).length;
  }

  private async dispatch(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      /*
        Counted here, at dispatch, and not in `publish`.

        `publish` queues; the request may still fail, and a discarded event
        describes something that did not happen. "Wie viele ProjectUpdated gab
        es heute" has to mean committed ones, or the figure disagrees with the
        audit log built from the same events — and an operator comparing two
        numbers that should match is an operator losing an afternoon.
      */
      this.metrics.recordEvent(event.name);

      const listeners = [
        ...(this.handlers.get(event.name) ?? []),
        ...(this.handlers.get("*") ?? []),
      ];
      // `allSettled`, so one failing listener does not stop the others. A
      // notification failing must not also lose the audit row.
      const results = await Promise.allSettled(listeners.map((fn) => fn(event)));
      for (const result of results) {
        if (result.status === "rejected") {
          this.logger.error(
            `Listener für ${event.name} fehlgeschlagen: ${
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            }`,
          );
        }
      }
    }
  }

  /** For tests and the health endpoint: how many listeners are attached. */
  listenerCount(name: DomainEventName | "*"): number {
    return (this.handlers.get(name) ?? []).length;
  }
}

function toActor() {
  const actor = currentActor();
  if (!actor) return null;
  return { id: actor.id, email: actor.email, name: actor.name };
}
