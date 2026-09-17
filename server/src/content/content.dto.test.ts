import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CreateEntryDto, UpdateEntryDto, VisibilityDto } from "./content.controller";

/**
 * The content DTOs, through the real pipe with the real options.
 *
 * `data` on both entry DTOs carries `@Allow()` because the global pipe runs
 * with `whitelist: true` and strips every property that has no decorator.
 * Undecorated, the entry's fields were removed from the body before the service
 * saw them and **every save failed** — reporting a downstream validation error
 * about missing required fields, which points at the editor's input rather than
 * at the request that never carried it. CLAUDE.md records it happening once;
 * the working tree it was fixed in was lost, and it came back.
 *
 * The same trap caught the settings DTO. Two occurrences of one mistake in one
 * codebase is the definition of something worth a test rather than a comment,
 * so this mirrors `settings.dto.test.ts` deliberately.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const through = <T>(body: unknown, metatype: unknown) =>
  pipe.transform(body, { type: "body", metatype } as never) as Promise<T>;

describe("CreateEntryDto", () => {
  it("keeps the entry's data through the whitelist", async () => {
    const out = await through<CreateEntryDto>(
      { typeKey: "team", data: { name: "A. Muster", office: "Thun" } },
      CreateEntryDto,
    );
    expect(out.data).toEqual({ name: "A. Muster", office: "Thun" });
  });

  it("keeps nested structures intact", async () => {
    // A project carries `detail.kontakt`; a stripped nesting level would be as
    // silent as a stripped field.
    const data = { name: "Guglera", detail: { kontakt: { name: "X" } }, disciplines: ["heat"] };
    const out = await through<CreateEntryDto>({ typeKey: "projects", data }, CreateEntryDto);
    expect(out.data).toEqual(data);
  });

  it("still rejects a missing typeKey", async () => {
    await expect(through({ data: {} }, CreateEntryDto)).rejects.toThrow();
  });
});

describe("UpdateEntryDto", () => {
  it("keeps the entry's data through the whitelist", async () => {
    const out = await through<UpdateEntryDto>({ data: { name: "Neu" } }, UpdateEntryDto);
    expect(out.data).toEqual({ name: "Neu" });
  });

  it("keeps an empty object, which is a legitimate cleared entry", async () => {
    const out = await through<UpdateEntryDto>({ data: {} }, UpdateEntryDto);
    expect(out.data).toEqual({});
  });
});

describe("VisibilityDto", () => {
  it("keeps false, which is how an entry comes back onto the site", async () => {
    // The value that matters: a stripped or defaulted `false` is
    // indistinguishable from "no change", and "show it again" would do nothing.
    const out = await through<VisibilityDto>({ hidden: false }, VisibilityDto);
    expect(out.hidden).toBe(false);
  });

  it("keeps true", async () => {
    const out = await through<VisibilityDto>({ hidden: true }, VisibilityDto);
    expect(out.hidden).toBe(true);
  });

  it("rejects a missing flag rather than defaulting it", async () => {
    await expect(through({}, VisibilityDto)).rejects.toThrow();
  });

  it("rejects a non-boolean", async () => {
    await expect(through({ hidden: "yes" }, VisibilityDto)).rejects.toThrow();
  });
});
