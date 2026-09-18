import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AuthUser } from "../../common/decorators";

/**
 * What is true for the whole of one request, without threading it through
 * every call.
 *
 * Foundation stage F8's precondition. Two things need to be available deep
 * inside a service that has no business taking them as parameters:
 *
 * - **`correlationId`** — one publish request writes eight audit rows (entries,
 *   versions, a snapshot, a settings read). Without a shared id they are eight
 *   unrelated facts, and "what happened when Anna pressed publish" is a
 *   question the log cannot answer. Threading it through as an argument would
 *   mean changing every signature in the call chain and remembering at each
 *   one, which is the same failure as hand-written audit calls.
 * - **the actor** — who is doing it, for the events that carry it.
 *
 * `AsyncLocalStorage` rather than a request-scoped provider: Nest's
 * `Scope.REQUEST` re-instantiates the whole injection subtree per request,
 * which is a real cost on every service, and it does not reach code called
 * from a job or a cron tick at all.
 *
 * **Everything here is optional.** A cron tick, a test and the bootstrap have
 * no request; `correlationId()` mints one rather than failing, so a caller
 * never has to ask whether it is inside one.
 */

export type RequestContext = {
  /** Ties every row one request produced together. */
  correlationId: string;
  actor: AuthUser | null;
  ip: string | null;
  userAgent: string | null;
  /**
   * Events raised during this request, held until it succeeds.
   *
   * See `EventBus.publish` — queueing them here is what makes "after the
   * transaction commits" the default rather than something each caller has to
   * remember.
   */
  queued: unknown[];
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The id for whatever is happening now.
 *
 * Mints one outside a request rather than returning null: a cron tick still
 * produces audit rows, and rows with no correlation id are rows that cannot be
 * grouped. A minted id groups one tick's work, which is the truthful answer.
 */
export function correlationId(): string {
  return currentContext()?.correlationId ?? randomUUID();
}

export function currentActor(): AuthUser | null {
  return currentContext()?.actor ?? null;
}

/** Builds a fresh context — for a request, a job run or a scheduled tick. */
export function newContext(input: Partial<RequestContext> = {}): RequestContext {
  return {
    correlationId: input.correlationId ?? randomUUID(),
    actor: input.actor ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    queued: [],
  };
}
