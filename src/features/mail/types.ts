import type { HealthState } from "@/entities/system";

/**
 * The mail channel as the dashboard understands it.
 *
 * Mirrors the server's vocabulary rather than inventing a second one — the
 * category names in particular are the server's closed set, because the whole
 * point of `mail.failure.ts` is that one list decides what an operator reads.
 * A client-side re-classification would be a second answer, and the two would
 * disagree on the day somebody adds a category to one of them.
 *
 * ---
 *
 * ## There is no `dto.ts` and no `mapper.ts` here, deliberately
 *
 * Every other feature has both, and the split earns its place there: a mapper
 * is where `"2026-09-21T…"` becomes a `Date`, where four wire fields become one
 * entity, and where an API change lands instead of in twenty screens.
 *
 * **None of those applies to this feature.** It is read-only and operational:
 * the server computes the verdict, the counts and the sanitized sentences,
 * and the panel renders them. There is no entity to assemble. The timestamps
 * stay ISO strings because `relativeTime` and `formatDateTime` take strings —
 * converting to `Date` in a mapper only to format it back is a round trip
 * through a type nothing uses.
 *
 * A pass-through mapper is not a seam; it is a file that makes the layer
 * diagram look right. If this feature ever gains a write that composes a
 * request body, that is when it gains the two files — and the note above is
 * here so the absence reads as a decision rather than as an omission.
 */

export const MAIL_FAILURE_CATEGORIES = [
  "CONFIGURATION",
  "AUTHENTICATION",
  "CONNECTION",
  "TLS",
  "TIMEOUT",
  "RECIPIENT_REJECTED",
  "RATE_LIMIT",
  "PROVIDER",
  "UNKNOWN",
] as const;

export type MailFailureCategory = (typeof MAIL_FAILURE_CATEGORIES)[number];

/**
 * Five states, and `unknown` is the one worth keeping.
 *
 * It means "configured, never tested" — a real and common condition that most
 * dashboards render as green. A panel that shows healthy because a form has
 * been filled in teaches an operator that green means nothing, which costs
 * exactly the incident where it mattered.
 */
export type MailState = HealthState;

export type MailProbe = {
  at: string;
  ok: boolean;
  by: string | null;
  detail: string | null;
  category: MailFailureCategory | null;
  durationMs: number | null;
};

export type MailDeliverySummary = {
  delivered: number;
  failed: number;
  pending: number;
  processing: number;
  skipped: number;
  lastDeliveredAt: string | null;
  lastFailedAt: string | null;
  lastFailureDetail: string | null;
};

/**
 * What the status panel renders.
 *
 * **No field can hold a credential**, which is the same technique the server's
 * `MailProviderDescription` uses: the way to guarantee a password is never
 * drawn on a page is to give the page's type nowhere to put one.
 * `hasCredentials` is the boolean that replaces it.
 */
export type MailStatus = {
  provider: {
    kind: string;
    host: string;
    port: number;
    secure: boolean;
    hasCredentials: boolean;
    from: string;
    fromName: string;
    replyTo: string | null;
  };
  configured: boolean;
  /** `false` when a stored credential exists that this server cannot decrypt. */
  secretsReadable: boolean;
  state: MailState;
  lastVerify: MailProbe | null;
  lastTestSend: MailProbe | null;
  deliveries: MailDeliverySummary;
};

/** The outcome of a connection test. Three states, never a boolean. */
export type MailVerifyResult =
  | { status: "connected"; describedAs: string; durationMs: number }
  | { status: "unconfigured"; reason: string }
  | { status: "failed"; failure: { category: MailFailureCategory; message: string }; durationMs: number };

/**
 * The outcome of a test send.
 *
 * `stub` is distinct from failure: with no SMTP server configured the message
 * was written to the server log, which is neither a delivery nor a fault, and
 * calling it "sent" would be a lie the form repeats.
 */
export type MailTestResult = {
  ok: boolean;
  stub: boolean;
  host: string;
  to: string;
  durationMs: number;
  messageId?: string | null;
  category?: MailFailureCategory;
  error?: string;
};

export type MailTemplate = {
  key: string;
  label: string;
  category: string;
  description: string;
  variables: string[];
  optional: boolean;
};

export type MailTemplatePreview = {
  key: string;
  subject: string;
  text: string;
};

export type DeliveryStatus = "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED" | "SKIPPED";

export type Delivery = {
  id: string;
  channel: "IN_APP" | "EMAIL";
  status: DeliveryStatus;
  attempts: number;
  detail: string | null;
  queuedAt: string;
  settledAt: string | null;
  type: string;
  severity: string;
  recipient: string;
};

export type DeliveryPage = {
  items: Delivery[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};
