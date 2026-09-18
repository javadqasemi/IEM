import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { newContext, runWithContext } from "./request-context";

/**
 * Opens the request's context, and it has to be a **middleware**.
 *
 * The first version of this was an interceptor, and it did not work. The
 * failure is worth recording because it is not visible by reading the code:
 *
 * `AsyncLocalStorage.run(store, fn)` propagates the store to whatever `fn`
 * starts — synchronously or asynchronously. An interceptor's `intercept()`
 * merely *builds* the observable chain; Nest subscribes to it after
 * `intercept` returns, so the route handler runs **outside** the `run()` call
 * that created the context. Everything typechecked, every unit test passed
 * (they call `runWithContext` themselves), and in a live request every
 * `correlationId()` minted a fresh id instead of sharing one. The symptom was
 * an audit row that simply never appeared, because the event queue it was
 * supposed to be on belonged to a context nothing could see.
 *
 * Express middleware calls `next()` synchronously inside the scope, so the
 * whole downstream request — guards, handler, interceptors, the flush — runs
 * within it. That is the only placement that works.
 *
 * The actor is filled in later, by `EventFlushInterceptor`: the guard that
 * populates `req.user` has not run yet at this point, and an actor read here
 * would be null on every row.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    /*
      An inbound id is honoured so a request traced through a proxy or from the
      dashboard keeps its identity, and validated because it lands in a
      database column and in a response header. Anything that is not a plain
      token gets a fresh one rather than an error: a malformed trace header is
      not a reason to refuse a request.
    */
    const inbound = req.headers["x-correlation-id"];
    const id =
      typeof inbound === "string" && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();

    const context = newContext({
      correlationId: id,
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    // Echoed back, because an operator reading a failure in the browser's
    // network tab needs the id to search the audit log with.
    res.setHeader("X-Correlation-Id", id);

    runWithContext(context, () => next());
  }
}
