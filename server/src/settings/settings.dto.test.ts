import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { UpdateSettingsDto } from "./settings.controller";

/**
 * The regression guard for the bug that made the settings page unable to save.
 *
 * `SettingUpdate.value` carried no class-validator decorator. The global pipe
 * runs with `whitelist: true`, which strips every property that has none — so
 * `value` was removed from each update on the way in, the service wrote
 * `value: undefined`, and Prisma read that as "leave this column alone". The
 * endpoint answered 200, the audit log recorded `settings.updated` with the
 * key, and nothing changed.
 *
 * The test runs the **real pipe with the real options**, rather than asserting
 * that a decorator is present. Asserting the decorator would pass if someone
 * swapped it for one that does not survive whitelisting; asserting the
 * behaviour is what the caller actually depends on.
 *
 * This trap has now been sprung twice in this codebase — see CLAUDE.md on the
 * content DTOs, where it blanked the editor. If a third DTO needs to carry
 * free-form JSON, copy this test rather than trusting a review to notice.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const meta = { type: "body", metatype: UpdateSettingsDto } as const;

async function through(body: unknown): Promise<UpdateSettingsDto> {
  return (await pipe.transform(body, meta)) as UpdateSettingsDto;
}

describe("UpdateSettingsDto through the global ValidationPipe", () => {
  it("keeps a number value", async () => {
    const out = await through({
      updates: [{ key: "applications.retentionDays", value: 999 }],
    });
    expect(out.updates[0].value).toBe(999);
  });

  it("keeps a boolean value, including false", async () => {
    // `false` is the case that matters most: it is the value an operator picks
    // when switching a governance control *off*, and a stripped `false` is
    // indistinguishable from "no change" at every layer below this one.
    const out = await through({
      updates: [{ key: "workflow.requireApproval", value: false }],
    });
    expect(out.updates[0].value).toBe(false);
  });

  it("keeps a string value", async () => {
    const out = await through({
      updates: [{ key: "mail.smtpHost", value: "smtp.example.ch" }],
    });
    expect(out.updates[0].value).toBe("smtp.example.ch");
  });

  it("keeps an empty string, which means 'fall back to the environment'", async () => {
    const out = await through({ updates: [{ key: "mail.smtpHost", value: "" }] });
    expect(out.updates[0].value).toBe("");
  });

  it("keeps an array value", async () => {
    const out = await through({
      updates: [{ key: "security.allowedOrigins", value: ["https://a.example"] }],
    });
    expect(out.updates[0].value).toEqual(["https://a.example"]);
  });

  it("still strips properties the DTO does not declare", async () => {
    // The whitelist is doing its job elsewhere and must keep doing it — the fix
    // was to declare `value`, not to turn the protection off.
    const out = await through({
      updates: [{ key: "mail.from", value: "a@b.ch", injected: "nope" }],
    });
    expect(out.updates[0]).not.toHaveProperty("injected");
  });

  it("rejects an update with no key", async () => {
    await expect(through({ updates: [{ value: 1 }] })).rejects.toThrow();
  });
});
