import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";

/** The authenticated caller, attached by `JwtAuthGuard`. */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Set<string>;
  isSuperAdmin: boolean;
};

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = "iem:isPublic";

/**
 * Opts a route out of authentication.
 *
 * The guard is global and denies by default, which is the right way round: a
 * new controller written by someone who has not read this file is protected,
 * not exposed. Making a route public is then a visible, greppable decision.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = "iem:permissions";

/**
 * Requires every listed permission. Keys come from `permissions.catalog.ts`.
 *
 * AND rather than OR: a route that needs two capabilities needs both, and the
 * cases that genuinely want "either" are rare enough to be worth writing out
 * in the service instead of hiding in a decorator.
 */
export const RequirePermissions = (...keys: string[]) => SetMetadata(PERMISSIONS_KEY, keys);

/** Injects the authenticated caller, or a named field of it. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return field ? req.user?.[field] : req.user;
  },
);

/**
 * The caller's IP.
 *
 * `req.ip` alone, deliberately. This used to read `X-Forwarded-For` directly and
 * take its first entry, which meant any client could choose the address that
 * ended up in the audit log — on failed sign-ins and replay detections above
 * all, which are the rows the log exists to answer questions about.
 *
 * Express derives `req.ip` from that header only when `trust proxy` is set, and
 * then correctly: the left-most address that is not itself a trusted hop.
 * `configureProxyTrust` in `main.ts` sets it from `TRUST_PROXY`. Reading `req.ip`
 * here rather than the header keeps this decorator and the rate limiter — which
 * has always used `req.ip` — on the same answer.
 */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? null;
});
