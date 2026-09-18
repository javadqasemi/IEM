import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, tap } from "rxjs";
import { MetricsService } from "./metrics.service";

/**
 * Latency and errors, for every route, without any module doing anything.
 *
 * The two of the firm's six figures that nothing was already recording. The
 * other four come out of tables that exist — `AuditLog`, `Job`, the entity's
 * own rows — and the event counts come off the bus.
 *
 * ---
 *
 * **The route pattern, not the URL.** `request.route.path` is
 * `/projects/:id/members/:memberId`; the URL is one project's. Recording URLs
 * would produce a bucket per record — a report nobody can read — and it is also
 * how an id ends up in a metrics label and from there in an aggregator that was
 * never meant to hold one.
 *
 * **It is the innermost interceptor**, registered after `EnvelopeInterceptor`.
 * Nest runs `APP_INTERCEPTOR`s outside-in on the way in and inside-out on the
 * way out, so being last in the list means the timer starts closest to the
 * handler and stops closest to it: what is measured is the handler and its
 * serialisation, not the envelope and the event flush wrapped around them. That
 * is the number a slow query shows up in.
 *
 * **A failure is counted where it is thrown, not where it is rendered.** `tap`
 * sees the error before `AllExceptionsFilter` turns it into a body, so a 500
 * and a deliberate 404 are both visible here — and they are counted
 * differently: see `isFailure`.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const request = context.switchToHttp().getRequest<Request & { route?: { path?: string } }>();
    const started = Date.now();

    /*
      Resolved once, at the start.

      `request.route` is set by Express when the route matched, and it is still
      there in `tap` — but reading it eagerly also means a request that never
      matched a route (a 404 from the router itself) is attributed to `unknown`
      rather than crashing the interceptor.
    */
    const route = normalise(request.route?.path);
    const method = request.method;

    return next.handle().pipe(
      tap({
        next: () => this.record(method, route, started, false),
        error: (error: unknown) => this.record(method, route, started, isFailure(error)),
      }),
    );
  }

  private record(method: string, route: string, started: number, failed: boolean): void {
    this.metrics.recordRequest(method, route, Date.now() - started, failed);
  }
}

/**
 * The route pattern, without the global prefix.
 *
 * Express hands back what Nest registered, and Nest registers the prefix too:
 * `req.route.path` is `/api/v1/projects/:id`, not `/projects/:id`. A module
 * declaring `routePrefix: "/projects"` would therefore match nothing, and the
 * failure is the quiet kind — every module reports zero requests and a null
 * p95, which reads as a quiet system rather than as a broken join.
 *
 * Stripped here rather than compensated for in `ModuleMetricsSource`, because a
 * module should not have to know how the API is mounted: the prefix is a
 * deployment decision (`main.ts`), and versioning it to `/api/v2` one day must
 * not silently unhook every module's metrics.
 */
function normalise(path: string | undefined): string {
  if (!path) return "unknown";
  return path.replace(/^\/api\/v\d+/, "") || "/";
}

/**
 * Whether a thrown error counts against the error rate.
 *
 * **A 404 is not a failure and a 403 is not a failure.** Both are the system
 * working: a caller asked for something that is not theirs or not there, and
 * was told. Counting them would make the error rate a measure of how often
 * people mistype a URL, and an alert on it would fire every time somebody
 * probed a stale link — which is the fastest way to teach an operator to ignore
 * the number.
 *
 * A 409 is the same: the optimistic lock refusing a stale write is the feature
 * behaving correctly, and two people editing one project is a Tuesday.
 *
 * What counts is **5xx and anything with no status at all** — an unhandled
 * throw, a Prisma validation error, a connection that died. Those are the
 * system failing rather than answering.
 */
function isFailure(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== "number") return true;
  return status >= 500;
}
