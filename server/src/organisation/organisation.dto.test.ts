import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CreateOfficeDto, UpdateOfficeDto, UpdateOrganisationDto } from "./organisation.dto";
import { LEGAL_FIELDS } from "../core/organisation/organisation.types";

/**
 * The DTOs, through the **real pipe with the real options**.
 *
 * Asserting that a decorator is present would pass if somebody swapped it for
 * one that does not survive whitelisting — which is exactly how the settings
 * page spent a release reporting success while saving nothing. What a caller
 * depends on is the behaviour.
 *
 * **What this test cannot see**, and the reason the important guards are
 * elsewhere: vitest transforms with esbuild, which does not emit
 * `useDefineForClassFields`. Under `tsc` every declared optional field is
 * *defined* on the instance as `undefined`; here only the sent keys exist. So
 * an assertion about which keys a transformed DTO carries would pass under
 * vitest and be wrong in the build. That is what `changedFields` exists for,
 * and `changed.test.ts` is the template. The assertions below are about
 * **values and refusals**, which both toolchains agree on.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const through = async <T>(metatype: unknown, body: unknown): Promise<T> =>
  (await pipe.transform(body, { type: "body", metatype } as never)) as T;

const org = (body: Record<string, unknown>) =>
  through<UpdateOrganisationDto>(UpdateOrganisationDto, { expectedVersion: 1, ...body });

describe("UpdateOrganisationDto", () => {
  it("requires the optimistic lock", async () => {
    // A lock a caller may omit is one every caller omits exactly once, and the
    // failure is the one data-loss bug a user cannot detect or report.
    await expect(
      through(UpdateOrganisationDto, { name: "IEM AG" }),
    ).rejects.toThrow();
  });

  it("keeps a changed name", async () => {
    const out = await org({ name: "IEM AG" });
    expect(out.name).toBe("IEM AG");
  });

  it("accepts null to clear an optional field", async () => {
    // `null` is "cleared" and `undefined` is "not sent". The mapper depends on
    // the difference, so the pipe has to let a real `null` through rather than
    // rejecting it as a bad e-mail address.
    const out = await org({ mainPhone: null, supportEmail: null });
    expect(out.mainPhone).toBeNull();
    expect(out.supportEmail).toBeNull();
  });

  it("refuses a malformed e-mail", async () => {
    await expect(org({ mainEmail: "info@iem" })).rejects.toThrow();
  });

  it("refuses a website without a scheme", async () => {
    await expect(org({ website: "www.iem.ch" })).rejects.toThrow();
  });

  it("accepts a website with one", async () => {
    const out = await org({ website: "https://www.iem.ch" });
    expect(out.website).toBe("https://www.iem.ch");
  });

  it("refuses a founding year outside the plausible range", async () => {
    await expect(org({ foundedYear: 1200 })).rejects.toThrow();
    await expect(org({ foundedYear: 2200 })).rejects.toThrow();
  });

  it("refuses a status it does not know", async () => {
    await expect(org({ status: "PLEITE" })).rejects.toThrow();
  });

  it("takes the UID as a string and leaves the check digit to the rules", async () => {
    // A regex in a decorator cannot do modulo-11 arithmetic. The pipe checks
    // that it is a short string; `refuseUid` decides whether it is a UID.
    const out = await org({ uid: "CHE-107.625.851" });
    expect(out.uid).toBe("CHE-107.625.851");
  });

  it("strips a property it does not declare", async () => {
    const out = (await org({ version: 99, name: "IEM AG" })) as unknown as Record<string, unknown>;
    // `version` is the server's, not the caller's — writing it would let a
    // client set its own lock value and defeat the lock.
    expect(out).not.toHaveProperty("version");
  });

  it("declares every field the legal gate checks for", async () => {
    /*
      The permission boundary depends on this agreement.

      `OrganisationController.update` decides whether the request needs
      `organisation.updateLegal` by asking whether any `LEGAL_FIELDS` key is
      present on the body. A legal field that the DTO does not declare is
      stripped by the whitelist before the gate ever sees it — so the gate
      would pass, and the field would also never be written. A legal field the
      DTO declares and the list omits is worse: it writes, ungated.

      Checked by sending each one and reading it back rather than by
      reflection, because reflection over a class is exactly the thing this
      file's header says the two toolchains disagree about.
    */
    const sample: Record<string, unknown> = {
      legalName: "IEM AG",
      legalForm: "Aktiengesellschaft",
      uid: "CHE-107.625.851",
      vatId: "CHE-107.625.851 MWST",
      commercialRegister: "CH-036.3.010.101-1",
      registerOffice: "Bern",
      legalStreet: "Uttigenstrasse 49",
      legalZip: "3600",
      legalCity: "Thun",
      legalCountry: "CH",
      invoiceAddress: "IEM AG, Kreditoren",
      legalContactName: "M. Muster",
      legalContactEmail: "recht@iem.ch",
      dataProtectionContactName: "M. Muster",
      dataProtectionContactEmail: "datenschutz@iem.ch",
      copyright: "© IEM AG",
      legalNotice: "Alle Angaben ohne Gewähr.",
    };

    // Every declared legal field has a sample, or the assertion below is
    // testing nothing for that key.
    expect(Object.keys(sample).sort()).toEqual([...LEGAL_FIELDS].sort());

    const out = (await org(sample)) as unknown as Record<string, unknown>;
    const stripped = LEGAL_FIELDS.filter((field) => out[field] === undefined);
    expect(stripped, "declared in LEGAL_FIELDS, stripped by the whitelist").toEqual([]);
  });
});

describe("CreateOfficeDto", () => {
  it("requires a name", async () => {
    await expect(through(CreateOfficeDto, { city: "Thun" })).rejects.toThrow();
  });

  it("accepts a minimal office", async () => {
    const out = await through<CreateOfficeDto>(CreateOfficeDto, { name: "Thun" });
    expect(out.name).toBe("Thun");
  });

  it("refuses coordinates outside the globe", async () => {
    await expect(
      through(CreateOfficeDto, { name: "Thun", latitude: 120 }),
    ).rejects.toThrow();
    await expect(
      through(CreateOfficeDto, { name: "Thun", longitude: -200 }),
    ).rejects.toThrow();
  });

  it("accepts real coordinates", async () => {
    const out = await through<CreateOfficeDto>(CreateOfficeDto, {
      name: "Thun",
      latitude: 46.7512,
      longitude: 7.6266,
    });
    expect(out.latitude).toBeCloseTo(46.7512);
  });

  it("refuses a country code that is not two letters", async () => {
    await expect(through(CreateOfficeDto, { name: "Thun", country: "CHE" })).rejects.toThrow();
  });

  it("keeps isPublic false rather than dropping it", async () => {
    // `false` is the whole point of the field — an internal office — and a
    // stripped `false` is indistinguishable from "not sent".
    const out = await through<CreateOfficeDto>(CreateOfficeDto, {
      name: "Lager",
      isPublic: false,
    });
    expect(out.isPublic).toBe(false);
  });
});

describe("UpdateOfficeDto", () => {
  it("requires the optimistic lock", async () => {
    await expect(through(UpdateOfficeDto, { name: "Thun" })).rejects.toThrow();
  });

  it("does not require a name, unlike create", async () => {
    const out = await through<UpdateOfficeDto>(UpdateOfficeDto, {
      expectedVersion: 3,
      phone: "+41 33 227 40 20",
    });
    expect(out.expectedVersion).toBe(3);
    expect(out.phone).toBe("+41 33 227 40 20");
  });

  it("refuses version zero", async () => {
    // Versions start at 1. A `0` is a client that computed rather than read
    // it, which is the client most likely to get it wrong.
    await expect(through(UpdateOfficeDto, { expectedVersion: 0 })).rejects.toThrow();
  });
});

