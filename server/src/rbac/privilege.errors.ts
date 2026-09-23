import { ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "../common/decorators";
import type { Principal } from "./privilege.rules";

/**
 * The HTTP face of `privilege.rules.ts`, kept apart so the rules stay pure.
 *
 * `privilege_ceiling` is the error `code` a refusal carries. Not a generic
 * "Fehlende Berechtigung": the caller holds the key the route asks for, and
 * what they lack is authority over this particular role or account — which is
 * worth a sentence rather than a key name, and a code the dashboard can
 * recognise.
 */
export const PRIVILEGE_CEILING = "privilege_ceiling";

export function privilegeCeiling(message: string): ForbiddenException {
  return new ForbiddenException({ message, code: PRIVILEGE_CEILING });
}

/** The acting user as the rules read them. */
export function principalOf(user: AuthUser): Principal {
  return { isSuperAdmin: user.isSuperAdmin, permissions: user.permissions };
}
