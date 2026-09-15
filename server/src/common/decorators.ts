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

/** The caller's IP, honouring one proxy hop. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip ?? null;
});
