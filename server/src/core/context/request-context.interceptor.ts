import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, catchError, from, switchMap, throwError } from "rxjs";
import type { AuthedRequest } from "../../common/decorators";
import { EventBus } from "../events/event-bus";
import { currentContext } from "./request-context";

/**
 * Decides what happens to the events a request queued.
 *
 * The context itself is opened by `RequestContextMiddleware` — see the note
 * there for why that cannot be done here. This runs *inside* it and owns two
 * things:
 *
 * **The actor.** `intercept()` runs after the guards, so `req.user` is the
 * first thing available that says who is acting. Written into the context the
 * middleware created, so a service five calls deep can produce a complete
 * audit row without taking three more parameters.
 *
 * **Flush on success, discard on failure.** An event announcing work that then
 * errored out is worse than no event: it is a fact that is not true, and the
 * consumers downstream — notifications, audit, reporting, workflow — have no
 * way to find that out.
 */
@Injectable()
export class EventFlushInterceptor implements NestInterceptor {
  constructor(private readonly bus: EventBus) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const context = currentContext();
    if (context) context.actor = req.user ?? null;

    return next.handle().pipe(
      /*
        `switchMap` rather than `tap`, because the flush is asynchronous and
        the response must not be sent before the listeners have been
        dispatched. `AuditService.record` is itself fire-and-forget, so this
        awaits the dispatch rather than the database write — which is the right
        place to stop: a slow audit insert must not slow the response, but a
        response that races the dispatch would lose the row entirely on a
        process that exits straight after.
      */
      switchMap((value) => from(this.bus.flush()).pipe(switchMap(() => [value]))),
      catchError((err: unknown) => {
        this.bus.discard();
        return throwError(() => err);
      }),
    );
  }
}
