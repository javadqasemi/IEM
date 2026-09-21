import type {
  Integration,
  Office,
  OfficeDraft,
  Organisation,
  OrganisationStatus,
  Setting,
  SettingGroup,
  SystemInfo,
} from "@/entities/organisation";
import type {
  CreateOfficeBody,
  OfficeDto,
  OrganisationDto,
  SettingDto,
  SettingGroupDto,
  SystemInfoDto,
  UpdateOfficeBody,
  UpdateOrganisationBody,
} from "./dto";

/**
 * Wire shapes in, entities out — and the only file besides `repository.ts`
 * allowed to name a DTO.
 *
 * The seam is what makes an API change land here rather than in every screen,
 * and `src/architecture.test.ts` is what keeps it a seam rather than a
 * decoration.
 */

export function toOrganisation(dto: OrganisationDto): Organisation {
  const { id: _id, updatedAt, updatedBy, ...rest } = dto;
  return {
    ...rest,
    status: rest.status as OrganisationStatus,
    updatedAt: new Date(updatedAt),
    updatedBy,
  };
}

/**
 * The body for a PATCH, carrying **only what changed**.
 *
 * Diffed against the record the form was opened with rather than sent whole,
 * and the reason is the permission boundary: the server decides whether a
 * request needs `organisation.updateLegal` by asking whether it *touches* a
 * legal field. A form that posted all thirty-six fields every time would
 * demand the stronger permission to change a telephone number, so anybody
 * without it could save nothing at all.
 *
 * `undefined` is "not sent" and `null` is "cleared", the same distinction the
 * server's mapper makes — an empty input therefore becomes `null` rather than
 * `""`, so a cleared field is actually cleared.
 */
export function toUpdateBody(
  before: Organisation,
  after: Organisation,
): UpdateOrganisationBody {
  const body: Record<string, unknown> = { expectedVersion: before.version };

  for (const key of Object.keys(after) as (keyof Organisation)[]) {
    if (key === "version" || key === "updatedAt" || key === "updatedBy") continue;
    const next = after[key];
    if (next === before[key]) continue;
    // A text input hands back `""` for a field the reader emptied. Stored as
    // `""` the value is "present and blank", which reads on screen exactly
    // like the unset state and sorts differently in every query that follows.
    body[key] = next === "" ? null : next;
  }

  return body as UpdateOrganisationBody;
}

export function toOffice(dto: OfficeDto): Office {
  return {
    ...dto,
    archivedAt: dto.archivedAt ? new Date(dto.archivedAt) : null,
  };
}

export function toOffices(rows: OfficeDto[]): Office[] {
  return rows.map(toOffice);
}

export function toOfficeCreateBody(draft: OfficeDraft): CreateOfficeBody {
  return {
    /*
      The three required strings are trimmed too, and that is not tidiness.

      `city` is the value the site's team grid groups its filter by and the one
      `crossCheck` compares a team member's `office` against at publish time —
      so a stray space makes every person at that office vanish from the
      filter and produces a publish warning naming a Standort that visibly
      exists. `name` and `country` are the same shape of problem one step
      further out. They were the only fields here not passing through
      `blankToNull`, which trims; a test caught it.
    */
    name: draft.name.trim(),
    kind: draft.kind.trim(),
    street: blankToNull(draft.street),
    zip: blankToNull(draft.zip),
    city: blankToNull(draft.city),
    canton: blankToNull(draft.canton),
    country: draft.country.trim().toUpperCase(),
    phone: blankToNull(draft.phone),
    email: blankToNull(draft.email),
    latitude: draft.latitude,
    longitude: draft.longitude,
    mapsUrl: blankToNull(draft.mapsUrl),
    openingHours: blankToNull(draft.openingHours),
    isHeadquarters: draft.isHeadquarters,
    isPublic: draft.isPublic,
    position: draft.position,
  };
}

/**
 * The office PATCH body — whole, not diffed, unlike the organisation's.
 *
 * The asymmetry is deliberate. An office has one permission (`office.update`)
 * covering every field, so there is no gate that a full body would trip; and
 * the dialog edits one row at a time with every field on screen, so "what the
 * form says" and "what the record should be" are the same thing. Diffing here
 * would buy nothing and add a place for a cleared field to be dropped.
 */
export function toOfficeUpdateBody(draft: OfficeDraft, expectedVersion: number): UpdateOfficeBody {
  return { ...toOfficeCreateBody(draft), expectedVersion };
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

export function toSetting(dto: SettingDto): Setting {
  return {
    key: dto.key,
    group: dto.group,
    // The description *is* the label — it is the sentence an administrator
    // reads while deciding. The key is shown beneath it as the hint, because
    // that is what a support request quotes.
    label: dto.description ?? dto.key,
    value: dto.value,
    type: dto.type,
    secret: dto.secret,
    hasValue: dto.hasValue,
    pending: dto.pending,
    min: dto.min,
    max: dto.max,
    options: dto.options,
    unit: dto.unit,
    blankMeans: dto.blankMeans,
    dangerous: dto.dangerous,
  };
}

export function toSettingGroups(rows: SettingGroupDto[]): SettingGroup[] {
  return rows.map((row) => ({ group: row.group, settings: row.settings.map(toSetting) }));
}

/* ================================================================== */
/* System                                                              */
/* ================================================================== */

export function toSystemInfo(dto: SystemInfoDto): SystemInfo {
  return {
    runtime: dto.runtime,
    database: {
      ...dto.database,
      migrations: {
        ...dto.database.migrations,
        latestAt: dto.database.migrations.latestAt
          ? new Date(dto.database.migrations.latestAt)
          : null,
      },
    },
    jobs: dto.jobs,
    storage: dto.storage,
    seed: dto.seed,
    integrations: dto.integrations.map((row): Integration => ({ ...row })),
  };
}

