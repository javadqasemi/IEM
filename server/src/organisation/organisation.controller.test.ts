import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { OrganisationController } from "./organisation.controller";
import { LEGAL_FIELDS } from "../core/organisation/organisation.types";
import type { AuthUser } from "../common/decorators";

/**
 * The field-level gate, tested where it actually is.
 *
 * `organisation.updateLegal` cannot be a route decorator —
 * `@RequirePermissions` is AND across its arguments and cannot ask "only if
 * the body touches these fields" — so the check is a `permissions.has` inside
 * the handler. `docs/permissions.md` §4 calls that the `◐` pattern and
 * `permissions.agreement.test.ts` counts it as enforcement, but that test
 * reads *source text*: it proves the key is mentioned, not that the gate
 * fires.
 *
 * `e2e/security.spec.ts` proves it fires, against the live API, with the one
 * role that holds `organisation.update` and not `organisation.updateLegal`.
 * This file is the cheap half of the same guarantee — and it is worth having
 * separately because the e2e version needs a **seventh seeded account**, and
 * seven accounts is where the suite starts meeting the 10-per-minute login
 * throttle. If that account is ever dropped, this is what still covers the
 * rule.
 *
 * It is a plain method call: the handler's gate is ordinary TypeScript, so
 * there is no container, no decorator metadata and none of the
 * `emitDecoratorMetadata` problem CLAUDE.md records — the thing under test is
 * the `if`, and esbuild compiles an `if` correctly.
 */

const user = (permissions: string[], isSuperAdmin = false): AuthUser =>
  ({
    id: "u1",
    email: "adm@iem.test",
    name: "Adrian Admin",
    roles: [],
    permissions: new Set(permissions),
    isSuperAdmin,
  }) as unknown as AuthUser;

function controller() {
  const update = vi.fn(async () => ({ organisation: {}, warnings: [] }));
  const service = { update } as never;
  const versions = {} as never;
  return { controller: new OrganisationController(service, versions), update };
}

describe("PATCH /organisation gates the legal fields", () => {
  it("lets a general-only caller write a general field", async () => {
    const { controller: c, update } = controller();
    await c.update(
      { expectedVersion: 1, mainPhone: "+41 33 227 40 20" } as never,
      user(["organisation.update"]),
    );
    expect(update).toHaveBeenCalledOnce();
  });

  /**
   * Every legal field, not a representative one.
   *
   * The gate is a `some` over `LEGAL_FIELDS`, so a field missing from that
   * list is written **ungated** — which is the failure worth being exhaustive
   * about. `organisation.dto.test.ts` asserts the other direction, that each
   * of these survives the validation pipe.
   */
  it.each([...LEGAL_FIELDS])("refuses %s without organisation.updateLegal", async (field) => {
    const { controller: c, update } = controller();
    await expect(
      c.update(
        { expectedVersion: 1, [field]: "x" } as never,
        user(["organisation.update"]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Refused *before* the service, so nothing was written and no version
    // was consumed.
    expect(update).not.toHaveBeenCalled();
  });

  it("allows a legal field when the caller holds the key", async () => {
    const { controller: c, update } = controller();
    await c.update(
      { expectedVersion: 1, uid: "CHE-107.625.851" } as never,
      user(["organisation.update", "organisation.updateLegal"]),
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it("lets Super Admin through on the role, not on holding the key", async () => {
    // `JwtAuthGuard` short-circuits Super Admin on the role key everywhere
    // else; the handler has to do the same or the one account that must never
    // be locked out would be.
    const { controller: c, update } = controller();
    await c.update({ expectedVersion: 1, uid: "CHE-107.625.851" } as never, user([], true));
    expect(update).toHaveBeenCalledOnce();
  });

  it("ignores a legal key that was not sent", async () => {
    /*
      `undefined` is "not sent" and must not trip the gate.

      A validated DTO carries **every declared property** under ES2022
      class-field semantics — the trap CLAUDE.md records against
      `Object.keys(dto)` — so a gate written as "is the key present" rather
      than "is its value defined" would demand `updateLegal` for every save,
      and an administrator could change nothing at all. That is the one way
      this check can be wrong while looking right.
    */
    const { controller: c, update } = controller();
    const body = { expectedVersion: 1, mainPhone: "+41 33 227 40 20" } as Record<string, unknown>;
    for (const field of LEGAL_FIELDS) body[field] = undefined;

    await c.update(body as never, user(["organisation.update"]));
    expect(update).toHaveBeenCalledOnce();
  });

  it("refuses as soon as any one legal field is touched", async () => {
    const { controller: c } = controller();
    await expect(
      c.update(
        { expectedVersion: 1, mainPhone: "+41 33 227 40 20", copyright: "© IEM AG" } as never,
        user(["organisation.update"]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
