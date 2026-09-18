/**
 * The application, as the dashboard thinks about it.
 *
 * This is the **entity**, not the wire shape. The difference is the point of
 * `entities/`: dates are `Date`, the status is a closed union rather than
 * `string`, and nothing here carries a field that exists only because of how
 * the API happens to serialise. `features/applications/dto.ts` holds the wire
 * shape and `mapper.ts` is the only thing that has seen both.
 *
 * It lives here rather than in the feature because three things will read it —
 * the applications module, the HR dashboard widget and, later, an Employee
 * created from a hire — and a type that crosses features is shared vocabulary
 * by definition.
 */

export const APPLICATION_STATUSES = [
  "NEW",
  "IN_REVIEW",
  "INTERVIEW",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export type ApplicationFile = {
  originalName: string;
  /** Bytes. */
  size: number;
  mimeType: string;
};

export type Application = {
  id: string;
  position: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  /**
   * **Free text, not a date.** The public form's `verfuegbar` field is a
   * 120-character string the applicant types — "ab sofort", "nach Absprache",
   * "01.03.2027" all arrive here. Parsing it would turn two of those three
   * into `Invalid Date` and the third into a false precision.
   */
  availableFrom: string | null;
  message: string | null;
  files: ApplicationFile[];
  status: ApplicationStatus;
  /** Internal, never shown to the applicant. */
  note: string | null;
  receivedAt: Date;
  /**
   * When the record and its files are deleted. Null only if the retention
   * period is unset on the server, which the seed does not allow.
   */
  retainUntil: Date | null;
};

export type ApplicationStats = {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
};
