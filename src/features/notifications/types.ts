/**
 * Notifications, as the dashboard thinks about them.
 *
 * Local to this feature rather than in `entities/`, which is the rule: a type
 * moves up when a *second* module needs it. Nothing else in the dashboard
 * knows what a notification is, and the day something does — a project view
 * showing "everything that happened here" — is the day it moves.
 *
 * Dates are `Date` here and ISO strings on the wire; `mapper.ts` is the only
 * thing that has seen both.
 */

export type Severity = "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";

export type Notification = {
  id: string;
  type: string;
  category: string;
  severity: Severity;
  title: string;
  body: string | null;
  link: string | null;
  actorName: string | null;
  read: boolean;
  createdAt: Date;
};

export type NotificationPage = {
  items: Notification[];
  total: number;
  page: number;
  pages: number;
  unread: number;
};

/**
 * One row of either settings screen.
 *
 * The same shape for the person's preferences and the firm's rules, because
 * the screens genuinely differ in one field — `enabled`, which only the firm
 * has — and two near-identical types would be two places to add the next
 * column. `enabled` is `null` on a personal row, which is the honest way to
 * say "this is not yours to set" rather than defaulting it to `true` and
 * hoping nothing reads it.
 */
export type PreferenceRow = {
  type: string;
  category: string;
  label: string;
  description: string;
  severity: Severity;
  /** A security notification: the in-app copy cannot be switched off. */
  mandatory: boolean;
  inApp: boolean;
  email: boolean;
  /** Fixed by a layer above this screen — drawn disabled, with a reason. */
  lockedInApp: boolean;
  lockedEmail: boolean;
  /** Only on the firm's screen. `null` on a personal row. */
  enabled: boolean | null;
  /** Only on the firm's screen: who this type reaches, in one sentence. */
  recipients: string | null;
  /** Only on a personal row: the firm has switched this type off entirely. */
  disabledByOrganisation: boolean;
};

export type Delivery = {
  id: string;
  channel: "IN_APP" | "EMAIL";
  status: "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED" | "SKIPPED";
  attempts: number;
  detail: string | null;
  queuedAt: Date;
  settledAt: Date | null;
  type: string;
  severity: Severity;
  recipient: string;
};

export type DeliveryPage = {
  items: Delivery[];
  total: number;
  page: number;
  pages: number;
};
