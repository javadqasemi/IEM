/**
 * The wire shapes, and nothing else.
 *
 * These names may appear in `repository.ts` and `mapper.ts` and nowhere above
 * them — `src/architecture.test.ts` enforces it.
 *
 * **What is not here is worth a line.** A delivery row carries a type, a
 * recipient, a status and a reason, and no `title` or `body`: the operator
 * diagnosing a mail server does not need to read everybody's messages, and a
 * delivery log that doubled as a way to do so would be a different feature
 * with a different permission. The server's `deliveries()` is written the
 * same way, so this is a shape it cannot accidentally grow.
 */

export type NotificationSeverityDto = "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";

export type NotificationDto = {
  id: string;
  type: string;
  category: string;
  severity: NotificationSeverityDto;
  title: string;
  body: string | null;
  /** A dashboard hash route, or `null` when there is nowhere to go. */
  link: string | null;
  actorName: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationPageDto = {
  items: NotificationDto[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  /**
   * The unread count, returned **with the page**.
   *
   * So the bell and the list cannot disagree after a "mark all read" — one
   * request, one answer. Reading it from a second endpoint is how a badge
   * ends up showing three over an empty inbox.
   */
  unread: number;
};

export type UnreadCountDto = { unread: number };

/** One row of the personal preferences screen. */
export type PreferenceDto = {
  type: string;
  category: string;
  label: string;
  description: string;
  severity: NotificationSeverityDto;
  /** A security notification: the in-app copy cannot be switched off. */
  mandatory: boolean;
  inApp: boolean;
  email: boolean;
  /** The firm has fixed this channel; the control is drawn disabled. */
  lockedInApp: boolean;
  lockedEmail: boolean;
  disabledByOrganisation: boolean;
};

/** One row of the organisation's configuration screen. */
export type RuleDto = {
  type: string;
  category: string;
  label: string;
  description: string;
  severity: NotificationSeverityDto;
  mandatory: boolean;
  /** One sentence naming who this type reaches. Built on the server. */
  recipients: string;
  enabled: boolean;
  inApp: boolean;
  email: boolean;
  /** Whether anything has been configured, or this is still the default. */
  configured: boolean;
};

export type DeliveryDto = {
  id: string;
  channel: "IN_APP" | "EMAIL";
  status: "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED" | "SKIPPED";
  attempts: number;
  detail: string | null;
  queuedAt: string;
  settledAt: string | null;
  type: string;
  severity: NotificationSeverityDto;
  recipient: string;
};

export type DeliveryPageDto = {
  items: DeliveryDto[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

export type MarkAllReadDto = { marked: number };
