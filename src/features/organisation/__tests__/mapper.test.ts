import { describe, expect, it } from "vitest";
import type { OfficeDraft } from "@/entities/organisation";
import type { OfficeDto, OrganisationDto, SettingDto } from "../dto";
import {
  toOffice,
  toOfficeCreateBody,
  toOfficeUpdateBody,
  toOrganisation,
  toSettingGroups,
  toSystemInfo,
  toUpdateBody,
} from "../mapper";

/**
 * The seam.
 *
 * Most of this file is unremarkable shape-shifting, and one function is not:
 * `toUpdateBody` decides **which keys leave the browser**, and the server
 * reads exactly that to decide whether the request needs
 * `organisation.updateLegal`. Sending a field that did not change would
 * demand the stronger permission to save a telephone number, so anybody
 * without it could save nothing at all — a 403 with no visible cause.
 */

const dto = (over: Partial<OrganisationDto> = {}): OrganisationDto => ({
  id: "org",
  name: "IEM AG",
  shortName: "IEM",
  description: null,
  foundedYear: 1994,
  organisationType: "Aktiengesellschaft",
  defaultLocale: "de-CH",
  defaultTimezone: "Europe/Zurich",
  defaultCurrency: "CHF",
  status: "ACTIVE",
  legalName: null,
  legalForm: null,
  uid: null,
  vatId: null,
  commercialRegister: null,
  registerOffice: null,
  legalStreet: null,
  legalZip: null,
  legalCity: null,
  legalCountry: "CH",
  invoiceAddress: null,
  legalContactName: null,
  legalContactEmail: null,
  dataProtectionContactName: null,
  dataProtectionContactEmail: null,
  copyright: null,
  legalNotice: null,
  mainEmail: "info@iem.ch",
  mainPhone: null,
  recruitmentEmail: null,
  supportEmail: null,
  billingEmail: null,
  website: null,
  seoTitlePattern: null,
  seoDescription: null,
  ogImageUrl: null,
  faviconUrl: null,
  version: 7,
  updatedAt: "2026-09-19T10:00:00.000Z",
  updatedBy: { id: "u1", name: "Anna Meier" },
  ...over,
});

const officeDto = (over: Partial<OfficeDto> = {}): OfficeDto => ({
  id: "o1",
  name: "Thun",
  kind: "Hauptsitz",
  street: "Uttigenstrasse 49",
  zip: "3600",
  city: "Thun",
  canton: "BE",
  country: "CH",
  phone: "+41 33 227 40 20",
  email: null,
  latitude: null,
  longitude: null,
  mapsUrl: null,
  openingHours: null,
  isHeadquarters: true,
  isPublic: true,
  position: 0,
  archivedAt: null,
  version: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("toOrganisation", () => {
  it("parses the timestamp and drops the singleton's id", () => {
    const entity = toOrganisation(dto());
    expect(entity.updatedAt).toBeInstanceOf(Date);
    expect(entity.updatedAt.toISOString()).toBe("2026-09-19T10:00:00.000Z");
    // The id is the literal "org" and carries no information — a field on the
    // entity would invite somebody to render it.
    expect(entity).not.toHaveProperty("id");
  });

  it("keeps the version, which every save sends back", () => {
    expect(toOrganisation(dto()).version).toBe(7);
  });
});

describe("toUpdateBody", () => {
  it("always carries the lock", () => {
    const before = toOrganisation(dto());
    expect(toUpdateBody(before, before).expectedVersion).toBe(7);
  });

  it("sends nothing but the lock when nothing changed", () => {
    const before = toOrganisation(dto());
    expect(Object.keys(toUpdateBody(before, { ...before }))).toEqual(["expectedVersion"]);
  });

  it("sends only the field that changed", () => {
    const before = toOrganisation(dto());
    const body = toUpdateBody(before, { ...before, mainPhone: "+41 33 227 40 20" });
    expect(Object.keys(body).sort()).toEqual(["expectedVersion", "mainPhone"]);
  });

  /**
   * The permission boundary, as a test.
   *
   * The server gates on whether the body *touches* a legal field. A body
   * carrying `uid: null` because the form re-sent every field would make a
   * telephone-number edit require `organisation.updateLegal`.
   */
  it("does not touch a legal field when only a contact field moved", () => {
    const before = toOrganisation(dto());
    const body = toUpdateBody(before, { ...before, supportEmail: "hilfe@iem.ch" }) as Record<
      string,
      unknown
    >;
    for (const legal of ["uid", "vatId", "legalName", "commercialRegister", "legalStreet"]) {
      expect(body, `${legal} was sent for a contact-only change`).not.toHaveProperty(legal);
    }
  });

  it("sends a legal field when one really moved", () => {
    const before = toOrganisation(dto());
    const body = toUpdateBody(before, { ...before, uid: "CHE-107.625.851" });
    expect(body.uid).toBe("CHE-107.625.851");
  });

  it("turns an emptied field into null rather than an empty string", () => {
    /*
      `""` is "present and blank": it reads on screen exactly like unset and
      sorts differently in every query after it. `null` is what the column
      means by absent, and the server's mapper writes it through.
    */
    const before = toOrganisation(dto());
    const body = toUpdateBody(before, { ...before, mainEmail: "" }) as Record<string, unknown>;
    expect(body.mainEmail).toBeNull();
  });

  it("never sends the fields the server owns", () => {
    const before = toOrganisation(dto());
    const body = toUpdateBody(before, {
      ...before,
      version: 99,
      updatedAt: new Date(0),
      updatedBy: null,
      name: "Neu AG",
    }) as Record<string, unknown>;
    expect(body).not.toHaveProperty("version");
    expect(body).not.toHaveProperty("updatedAt");
    expect(body).not.toHaveProperty("updatedBy");
    // `expectedVersion` still comes from `before`, not from the edited copy —
    // a client that could choose its own lock value has no lock.
    expect(body.expectedVersion).toBe(7);
    expect(body.name).toBe("Neu AG");
  });
});

describe("offices", () => {
  it("parses the archive timestamp", () => {
    expect(toOffice(officeDto()).archivedAt).toBeNull();
    expect(toOffice(officeDto({ archivedAt: "2026-05-01T00:00:00.000Z" })).archivedAt).toBeInstanceOf(
      Date,
    );
  });

  const draft: OfficeDraft = {
    name: " Bern ",
    kind: "Zweigbüro",
    street: "  Sandrainstrasse 3 ",
    zip: "3007",
    city: "Bern",
    canton: null,
    country: "CH",
    phone: " +41 31 688 40 20 ",
    email: "   ",
    latitude: null,
    longitude: null,
    mapsUrl: null,
    openingHours: null,
    isHeadquarters: false,
    isPublic: true,
    position: 1,
  };

  it("trims what a reader typed and blanks what they cleared", () => {
    const body = toOfficeCreateBody(draft);
    expect(body.street).toBe("Sandrainstrasse 3");
    expect(body.phone).toBe("+41 31 688 40 20");
    // A field cleared to whitespace is cleared, not " ".
    expect(body.email).toBeNull();
  });

  it("trims the required strings too, which the optional ones got for free", () => {
    /*
      `name`, `kind` and `country` were the three fields not passing through
      `blankToNull`, so they shipped whatever the reader typed. `city` is the
      value the site's team filter groups by and `crossCheck` compares against
      at publish time — a trailing space there empties the filter for everyone
      at that office and produces a warning naming a Standort that visibly
      exists.
    */
    const body = toOfficeCreateBody({ ...draft, country: " ch " });
    expect(body.name).toBe("Bern");
    expect(body.country).toBe("CH");
  });

  it("keeps isPublic false rather than dropping it", () => {
    // `false` is the whole meaning of the field — an internal office.
    expect(toOfficeCreateBody({ ...draft, isPublic: false }).isPublic).toBe(false);
  });

  it("adds the lock to an update and nothing else", () => {
    const body = toOfficeUpdateBody(draft, 4);
    expect(body.expectedVersion).toBe(4);
    expect(body.name).toBe("Bern");
  });
});

describe("toSettingGroups", () => {
  const row = (over: Partial<SettingDto> = {}): SettingDto => ({
    key: "mail.smtpHost",
    group: "E-Mail",
    description: "SMTP-Server",
    value: "",
    hasValue: false,
    secret: false,
    updatedAt: "2026-09-01T00:00:00.000Z",
    type: "string",
    pending: false,
    ...over,
  });

  it("uses the description as the label and keeps the key for the hint", () => {
    const [group] = toSettingGroups([{ group: "E-Mail", settings: [row()] }]);
    expect(group.settings[0].label).toBe("SMTP-Server");
    expect(group.settings[0].key).toBe("mail.smtpHost");
  });

  it("falls back to the key when the server sent no description", () => {
    // A control labelled `undefined` is worse than one labelled with its key.
    const [group] = toSettingGroups([{ group: "E-Mail", settings: [row({ description: null })] }]);
    expect(group.settings[0].label).toBe("mail.smtpHost");
  });

  it("carries the declaration through: type, bounds, danger", () => {
    const [group] = toSettingGroups([
      {
        group: "Bewerbungen",
        settings: [
          row({
            key: "applications.retentionDays",
            type: "number",
            min: 30,
            max: 3650,
            unit: "Tage",
            dangerous: "Löscht bestehende Bewerbungen.",
          }),
        ],
      },
    ]);
    const setting = group.settings[0];
    expect(setting.type).toBe("number");
    expect(setting.min).toBe(30);
    expect(setting.max).toBe(3650);
    expect(setting.dangerous).toContain("Löscht");
    // No `canEdit` from the server means editable, not locked.
    expect(setting.lockedBecause).toBeNull();
  });

  it("locks a setting the caller lacks the authority for, and says why (SEC-5)", () => {
    const [group] = toSettingGroups([
      {
        group: "Sicherheit",
        settings: [
          row({
            key: "workflow.requireApproval",
            type: "boolean",
            authority: "security",
            canEdit: false,
          }),
          row({ key: "mail.smtpHost", authority: "credential", canEdit: false }),
          row({ key: "mail.from", authority: "ordinary", canEdit: true }),
        ],
      },
    ]);
    expect(group.settings[0].lockedBecause).toMatch(/Sicherheitsrichtlinie/);
    expect(group.settings[1].lockedBecause).toMatch(/Mailserver/);
    expect(group.settings[2].lockedBecause).toBeNull();
  });
});

describe("toSystemInfo", () => {
  it("parses the migration timestamp and leaves a missing one null", () => {
    const base = {
      runtime: {
        node: "v22.0.0",
        environment: "development",
        uptimeSeconds: 120,
        rssBytes: 1,
        heapUsedBytes: 1,
        /*
          The absent case, kept deliberately (P2-6).

          The build identity is real now — a deployment sets `APP_VERSION`, or
          `npm run stamp` writes one — but *absent with a reason* is still a
          state the mapper has to carry unchanged, and it is the one that used
          to be hardcoded. A fixture that only exercised the happy path would
          stop guarding the row that matters: the one where the screen must
          say why it does not know rather than going blank.
        */
        version: null,
        versionReason: "kein Build-Stempel",
        commit: null,
        builtAt: null,
        buildSource: "none" as const,
      },
      database: {
        status: "ok" as const,
        latencyMs: 2,
        migrations: { applied: 13, pending: 0, latest: "x", latestAt: "2026-09-19T00:00:00.000Z" },
        snapshots: 8,
        auditRows: 100,
      },
      jobs: { PENDING: 1 },
      storage: { driver: "local", assets: 3, bytes: 10 },
      seed: { permissions: 114, contentTypes: 35, offices: 2 },
      integrations: [],
    };

    expect(toSystemInfo(base).database.migrations.latestAt).toBeInstanceOf(Date);
    expect(
      toSystemInfo({
        ...base,
        database: { ...base.database, migrations: { ...base.database.migrations, latestAt: null } },
      }).database.migrations.latestAt,
    ).toBeNull();
  });
});
