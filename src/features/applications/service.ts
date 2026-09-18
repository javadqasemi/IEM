import type { Application, ApplicationStatus } from "@/entities/application";

/**
 * Domain only. Pure functions over entity types — no React, no fetch, and
 * therefore testable with no mocks at all.
 *
 * This is the layer that matters most and the one easiest to skip. Everything
 * here would otherwise be an inline expression in a screen, where it is
 * untestable, and where the second screen that needs it writes its own
 * slightly different copy.
 */

/**
 * Which statuses still need someone to do something.
 *
 * `HIRED`, `REJECTED` and `WITHDRAWN` are the end of the conversation: the
 * decision is made and the record is waiting out its retention period. The
 * distinction drives the "offen" count and the default filter, and it is the
 * reason an HR dashboard tile can say something truthful without a second
 * endpoint.
 */
const OPEN_STATUSES: readonly ApplicationStatus[] = ["NEW", "IN_REVIEW", "INTERVIEW"];

export function isOpen(status: ApplicationStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * The transitions the form offers.
 *
 * **This is guidance, not a control, and the difference is worth stating.**
 * The server validates that the value is a member of the enum and nothing
 * else — `applications.controller.ts` has `@IsIn(Object.values(ApplicationStatus))`
 * and no transition rule — so a request moving a `HIRED` application back to
 * `NEW` is accepted today. The authoritative copy of this table belongs in
 * `server/src/applications/domain/`, and until it is there, this narrows the
 * select and stops an accidental click; it does not stop a determined one.
 *
 * Every status can reach `WITHDRAWN`, including the closed ones: an applicant
 * who withdraws after an offer is a real event and refusing to record it
 * would push it into the note field.
 */
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  NEW: ["IN_REVIEW", "REJECTED", "WITHDRAWN"],
  IN_REVIEW: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["HIRED", "REJECTED", "WITHDRAWN"],
  HIRED: ["WITHDRAWN"],
  REJECTED: ["IN_REVIEW", "WITHDRAWN"],
  WITHDRAWN: [],
};

/** The current status is always included — a form must be able to save unchanged. */
export function allowedNextStatuses(from: ApplicationStatus): ApplicationStatus[] {
  return [from, ...TRANSITIONS[from]];
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function displayName(application: Application): string {
  return `${application.firstName} ${application.lastName}`.trim();
}

/** `Nachname Vorname`, which is how a list of people is sorted and scanned. */
export function sortName(application: Application): string {
  return `${application.lastName} ${application.firstName}`.trim();
}

export function totalFileBytes(application: Application): number {
  return application.files.reduce((sum, file) => sum + file.size, 0);
}

/**
 * Whole days until the record is deleted. Negative once the date has passed.
 *
 * Deletion is real: a nightly job removes the row and its files on
 * `retainUntil`. `null` means the server sent no date, which the seed does not
 * allow — treated as "unknown", never as "never".
 */
export function retentionDaysLeft(application: Application, now: Date = new Date()): number | null {
  if (!application.retainUntil) return null;
  const ms = application.retainUntil.getTime() - now.getTime();
  // Rounded up: a record deleted later today has one day left, not zero. The
  // number is read as "you have until", and flooring it turns the last day
  // into a deadline that has already passed.
  return Math.ceil(ms / 86_400_000);
}

/**
 * Warns before personal data disappears.
 *
 * 30 days, because that is roughly how long a hiring process takes to restart
 * and because a dossier deleted mid-conversation cannot be recovered — there
 * is no recycle bin for personal data, by design.
 */
export function isRetentionExpiring(
  application: Application,
  now: Date = new Date(),
  withinDays = 30,
): boolean {
  const left = retentionDaysLeft(application, now);
  return left !== null && left <= withinDays;
}

/** The count the "offen" chip and an HR dashboard tile both want. */
export function openCount(byStatus: Record<ApplicationStatus, number>): number {
  return OPEN_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
}
