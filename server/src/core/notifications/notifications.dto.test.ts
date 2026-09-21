import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  ListDeliveriesQuery,
  ListNotificationsQuery,
  MarkReadDto,
  UpdatePreferencesDto,
  UpdateRulesDto,
} from "./notifications.controller";

/**
 * The notification DTOs through the **real pipe with the real options**.
 *
 * The third copy of `settings.dto.test.ts`, and the trap is the same one:
 * `whitelist: true` does not reject an undecorated property, it **removes**
 * it — so the service receives a body missing the thing the caller sent, and
 * the endpoint answers 200.
 *
 * It matters more here than almost anywhere, because **every meaningful value
 * in this module is a boolean and half of them are `false`**. A stripped
 * `false` is indistinguishable from "no change" at every layer below this
 * one: somebody switches a notification off, the row is written with the old
 * value, the screen re-renders it as still on, and the only explanation
 * available to them is that the dashboard is broken.
 *
 * Nested arrays are the second half. `@ValidateNested` without
 * `@Type(() => …)` silently validates nothing — the pipe has no constructor
 * to transform into, so every element passes whatever it contains. That is a
 * validation decorator that looks present and does nothing, which is the
 * shape CLAUDE.md warns about in the toolchain table.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const through = async <T>(metatype: new () => T, body: unknown): Promise<T> =>
  (await pipe.transform(body, { type: "body", metatype })) as T;

const query = async <T>(metatype: new () => T, value: unknown): Promise<T> =>
  (await pipe.transform(value, { type: "query", metatype })) as T;

describe("UpdatePreferencesDto", () => {
  it("keeps `false` on both channels", () => {
    // The value somebody sends when switching a notification off, and the
    // one a missing decorator would silently drop.
    return through(UpdatePreferencesDto, {
      updates: [{ type: "content.approved", inApp: false, email: false }],
    }).then((out) => {
      expect(out.updates[0].inApp).toBe(false);
      expect(out.updates[0].email).toBe(false);
      expect(out.updates[0].type).toBe("content.approved");
    });
  });

  it("keeps `true` as well, so the test above is not passing on a default", () => {
    return through(UpdatePreferencesDto, {
      updates: [{ type: "content.approved", inApp: true, email: true }],
    }).then((out) => {
      expect(out.updates[0].inApp).toBe(true);
      expect(out.updates[0].email).toBe(true);
    });
  });

  it("validates inside the array rather than only around it", async () => {
    // Proof that `@Type` is wired: without it these would pass.
    await expect(
      through(UpdatePreferencesDto, { updates: [{ type: "x", inApp: "yes", email: false }] }),
    ).rejects.toThrow();
    await expect(
      through(UpdatePreferencesDto, { updates: [{ inApp: true, email: false }] }),
    ).rejects.toThrow();
  });

  it("refuses a body with no updates array at all", async () => {
    await expect(through(UpdatePreferencesDto, {})).rejects.toThrow();
  });

  it("accepts an empty array, which is a save that changes nothing", async () => {
    const out = await through(UpdatePreferencesDto, { updates: [] });
    expect(out.updates).toEqual([]);
  });

  it("strips anything the caller invented", async () => {
    const out = await through(UpdatePreferencesDto, {
      updates: [{ type: "content.approved", inApp: true, email: true, userId: "somebody-else" }],
    });
    expect(out.updates[0]).not.toHaveProperty("userId");
  });
});

describe("UpdateRulesDto", () => {
  it("keeps all three booleans, including `false`", async () => {
    const out = await through(UpdateRulesDto, {
      updates: [{ type: "content.published", enabled: false, inApp: false, email: false }],
    });
    expect(out.updates[0]).toEqual({
      type: "content.published",
      enabled: false,
      inApp: false,
      email: false,
    });
  });

  it("requires every field — a partial rule has no meaning", async () => {
    await expect(
      through(UpdateRulesDto, { updates: [{ type: "content.published", enabled: false }] }),
    ).rejects.toThrow();
  });
});

describe("MarkReadDto", () => {
  it("keeps `false`, which is how somebody un-reads one to deal with later", async () => {
    expect((await through(MarkReadDto, { read: false })).read).toBe(false);
  });

  it("requires the flag rather than defaulting it", async () => {
    // Defaulting would make an empty body mean "mark read", so a stray POST
    // would clear somebody's inbox.
    await expect(through(MarkReadDto, {})).rejects.toThrow();
  });
});

describe("ListNotificationsQuery", () => {
  it("coerces the page numbers and keeps the filters", async () => {
    const out = await query(ListNotificationsQuery, {
      unread: "true",
      type: "security.mfa_disabled",
      severity: "CRITICAL",
      page: "2",
      perPage: "10",
    });
    expect(out.unread).toBe("true");
    expect(out.type).toBe("security.mfa_disabled");
    expect(out.severity).toBe("CRITICAL");
    expect(out.page).toBe(2);
    expect(out.perPage).toBe(10);
  });

  it("refuses a severity that is not one", async () => {
    await expect(query(ListNotificationsQuery, { severity: "URGENT" })).rejects.toThrow();
  });

  it("refuses a page size that would read the table into memory", async () => {
    await expect(query(ListNotificationsQuery, { perPage: "5000" })).rejects.toThrow();
  });

  it("accepts an empty query", async () => {
    const out = await query(ListNotificationsQuery, {});
    expect(out.page).toBeUndefined();
  });
});

describe("ListDeliveriesQuery", () => {
  it("accepts a real status and refuses an invented one", async () => {
    expect((await query(ListDeliveriesQuery, { status: "FAILED" })).status).toBe("FAILED");
    await expect(query(ListDeliveriesQuery, { status: "BOUNCED" })).rejects.toThrow();
  });
});
