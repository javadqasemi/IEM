import type { Paginated } from "@/core/api";
import {
  APPLICATION_STATUSES,
  isApplicationStatus,
  type Application,
  type ApplicationStats,
  type ApplicationStatus,
} from "@/entities/application";
import type { ApplicationDto, ApplicationPatchDto, ApplicationStatsDto } from "./dto";

/**
 * DTO ⇄ entity. **The last file in which a DTO type is legal.**
 *
 * The layer the firm's review added, and the one that makes the split real
 * rather than decorative: without it `repository.ts` returns wire shapes
 * straight into the hooks and the DTO reaches the components anyway.
 *
 * Four translations happen here, and each one is a bug that otherwise happens
 * somewhere else:
 *
 * | Wire | Entity | What goes wrong without it |
 * | --- | --- | --- |
 * | `"2026-03-14T…"` | `Date` | `"2026-03-14" < someDate` compares a string to an object and never throws |
 * | `status: string` | closed union | a `switch` with no case for a value the server already sends |
 * | `retainUntil: null` | `Date \| null` | `new Date(null)` is 1 January 1970, silently |
 * | `availableFrom` | left a string | see below — the one date-looking field that is not one |
 *
 * `availableFrom` is **not** parsed. The public form's `verfuegbar` field is
 * 120 characters the applicant types; "ab sofort" and "nach Absprache" are the
 * two most common values. Turning those into `Invalid Date` in order to be
 * consistent would be consistency at the cost of the data.
 */

/** `null` in, `null` out — `new Date(null)` is the epoch, which is not "unknown". */
function toDate(iso: string): Date;
function toDate(iso: string | null): Date | null;
function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/**
 * Narrows the server's open string to the client's union.
 *
 * An unrecognised status becomes `NEW` **and says so in the console**, which
 * is the least-bad of three options. Throwing would blank a list because one
 * row is from a newer server; leaving it as `string` would push the problem
 * into every `switch`; silently mapping it would hide a real deployment skew.
 * The row still renders, the badge falls through to the raw key
 * (`ApplicationBadge` does that deliberately), and the mismatch is visible.
 */
function toStatus(value: string): ApplicationStatus {
  if (isApplicationStatus(value)) return value;
  console.warn(
    `[applications] Unbekannter Status "${value}" vom Server — erwartet: ${APPLICATION_STATUSES.join(", ")}`,
  );
  return "NEW";
}

export function toApplication(dto: ApplicationDto): Application {
  return {
    id: dto.id,
    position: dto.position,
    firstName: dto.firstName,
    lastName: dto.lastName,
    email: dto.email,
    phone: dto.phone,
    availableFrom: dto.availableFrom,
    message: dto.message,
    // Copied rather than passed through: the DTO array is the cache's, and an
    // entity that shares an array with its wire shape is one `push` away from
    // mutating something two screens are reading.
    files: dto.files.map((file) => ({ ...file })),
    status: toStatus(dto.status),
    note: dto.note,
    receivedAt: toDate(dto.createdAt),
    retainUntil: toDate(dto.retainUntil),
  };
}

export function toApplicationPage(page: Paginated<ApplicationDto>): Paginated<Application> {
  return { ...page, items: page.items.map(toApplication) };
}

/**
 * Fills every status, including the ones the server left out.
 *
 * The stats endpoint returns only statuses that have at least one row, so a
 * fresh database sends `{ NEW: 3 }`. The filter chips read this map directly,
 * and `undefined` renders as nothing where `0` is the truthful answer.
 */
export function toApplicationStats(dto: ApplicationStatsDto): ApplicationStats {
  const byStatus = Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, dto.byStatus[status] ?? 0]),
  ) as Record<ApplicationStatus, number>;
  return { total: dto.total, byStatus };
}

/** The other direction. The only place an entity becomes a request body. */
export function toPatchDto(patch: { status?: ApplicationStatus; note?: string }): ApplicationPatchDto {
  const dto: ApplicationPatchDto = {};
  if (patch.status !== undefined) dto.status = patch.status;
  if (patch.note !== undefined) dto.note = patch.note;
  return dto;
}
