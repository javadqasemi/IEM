import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { AuditService } from "../../audit/audit.service";
import { auditActionFor, type DomainEvent } from "./catalogue";
import { EventBus } from "./event-bus";
import { currentContext } from "../context/request-context";

/**
 * Audit, derived from events (foundation stage F8).
 *
 * `AuditService` argues — correctly — that an interceptor logging every request
 * would produce a log full of `GET /api/v1/content/entries` and still miss what
 * anyone actually asks the log about: what a record looked like before and
 * after. That argument is sound, and it is also why the log has holes. Calling
 * `audit.record(...)` by hand is a step someone can forget, and the ones nobody
 * wrote are invisible — there is no failing test for an action that was never
 * logged.
 *
 * So the write moves to where the fact already is. A domain event carries
 * `entity`, `entityId`, `before`, `after`, the actor and the correlation id;
 * this listener turns it into a row. **A module that raises its events
 * correctly is audited without writing a line of audit code.**
 *
 * ---
 *
 * **What still calls `AuditService` directly, and why.**
 *
 * Failures and denials. `auth.login_failed` has no entity, no before and no
 * after — there is no record it is *about*, which is the whole shape an event
 * assumes. Forcing one would mean inventing an entity id for a login that did
 * not happen. Those stay explicit, and `AuditService` keeps its method for
 * them.
 *
 * The distinction is worth stating as a rule: **events describe things that
 * happened to records; direct audit calls describe things that happened to
 * nobody.**
 */
@Injectable()
export class AuditListener implements OnModuleInit {
  private readonly logger = new Logger(AuditListener.name);

  constructor(
    private readonly bus: EventBus,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.bus.on("*", (event) => this.write(event));
  }

  private write(event: DomainEvent): void {
    const context = currentContext();
    this.audit.record({
      actor: event.actor
        ? {
            id: event.actor.id ?? "",
            email: event.actor.email ?? "",
            name: event.actor.name ?? "",
            roles: [],
            permissions: new Set<string>(),
            isSuperAdmin: false,
          }
        : null,
      action: auditActionFor(event.name),
      resource: event.entity,
      resourceId: event.entityId,
      before: event.before,
      after: event.after,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      correlationId: event.correlationId,
      message: event.message,
    });
  }
}
