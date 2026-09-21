/**
 * Every domain event, by name, with the shape of its payload.
 *
 * Foundation stage F7, and the firm's review is right that the distinction
 * matters: **a named catalogue, not just a bus.** A bus with free-text event
 * names is a mesh that has learned to use strings, and a typo produces two
 * silent failures at once — a listener that never fires, and an event nobody
 * handles. Neither shows up as an error.
 *
 * So the map below is the whole vocabulary. `EventBus.publish` is typed against
 * it and accepts nothing else, which makes a typo a compile error and makes
 * "what can I listen for" a question answered by reading one file.
 *
 * **What belongs here.** A fact about the domain, in the past tense, that
 * somebody other than the module that caused it might care about. Not every
 * state change: `ProjectDescriptionEdited` is a field write and belongs in the
 * audit trail, which this feeds anyway. The test is whether a *different*
 * module would plausibly react.
 *
 * Four consumers are already known and none may be reached by an import:
 * notifications, the audit log, reporting, and the workflow engine
 * (`docs/data-model.md` §3.24).
 *
 * The entities most of these name do not exist yet — this is the foundation
 * shipping before the modules, deliberately (`docs/roadmap.md` §2.3). They are
 * declared now because the alternative is ten modules that already import each
 * other by the time a bus arrives.
 */

/** Who did it. Denormalised, because an actor may be deleted later. */
export type EventActor = {
  id: string | null;
  email: string | null;
  name: string | null;
};

/**
 * The payload every event carries, on top of its own.
 *
 * `before`/`after` are what make the audit trail derivable: a listener that has
 * both versions needs nothing from the service that changed them. They are
 * optional because a creation has no before and a deletion has no after.
 */
export type EventEnvelope<Payload> = {
  /** The table-ish name the audit row records — `project`, `content_entry`. */
  entity: string;
  entityId: string;
  payload: Payload;
  before?: unknown;
  after?: unknown;
  /** Overrides the ambient actor — a cron tick naming itself, for instance. */
  actor?: EventActor | null;
  /** Free text for the audit row, when the event name is not enough. */
  message?: string;
};

/**
 * The vocabulary.
 *
 * Grouped by the module that raises them. Adding a module means adding a
 * block; `events.test.ts` asserts that the names stay unique and that each one
 * is past tense, because a present-tense event name is a command in disguise
 * and commands do not belong on a bus.
 */
export type DomainEvents = {
  /* ---- Content (exists today) ------------------------------------- */
  ContentEntryCreated: { typeKey: string; key: string };
  ContentEntryUpdated: { typeKey: string; key: string; version: number };
  ContentEntryDeleted: { typeKey: string; key: string };
  ContentSubmitted: { typeKey: string; key: string };
  /**
   * `requestedBy` is on both, and it is the payload settling a rule again.
   *
   * A decision has to reach **the person who asked for it**, and without the
   * id on the event the only consumer that could find them would be one
   * reaching into `ReviewRequest` — a notification listener querying another
   * module's tables, which is the coupling the bus exists to remove. Who
   * should be told is part of the fact.
   */
  ContentApproved: {
    typeKey: string;
    key: string;
    decidedBy: string;
    /**
     * `null` when the submitter's account has since been deleted —
     * `ReviewRequest.requestedById` is `SetNull`, because a review outlives
     * the person who asked for it. The consumer is expected to notify nobody
     * rather than to invent a recipient, which is why the nullability is on
     * the payload rather than papered over with an empty string.
     */
    requestedBy: string | null;
  };
  ContentRejected: {
    typeKey: string;
    key: string;
    decidedBy: string;
    requestedBy: string | null;
    note?: string;
  };
  ContentPublished: { version: number; entriesPublished: number; warnings: string[] };
  ContentRolledBack: { typeKey: string; key: string; toVersion: number };

  /* ---- The firm itself --------------------------------------------- */
  /**
   * The organisation is a singleton, so there is no `Created` and no `Deleted`
   * — the row is upserted into existence and never removed. `fields` rather
   * than the whole record for the same reason `ProjectUpdated` carries it: a
   * rule that wants to react to "somebody changed the VAT number" should not
   * have to diff the payload, and the `before`/`after` pair is on the envelope
   * anyway.
   */
  OrganisationUpdated: { fields: string[] };
  OfficeCreated: { name: string; city: string | null };
  OfficeUpdated: { name: string; fields: string[] };
  /**
   * Archiving is not deleting, and both exist because they are different
   * facts. An office that closed still has employees and projects pointing at
   * it; a deleted one was created by mistake.
   */
  OfficeArchived: { name: string };
  OfficeRestored: { name: string };
  OfficeDeleted: { name: string };
  /**
   * Recorded whether it succeeded, which is the point of testing it.
   *
   * **`mode` separates the two probes**, which are different operations:
   * `verify` opens a connection and hangs up, `send` puts the fixed diagnostic
   * message in somebody's inbox. `MailStatusService` reports them on their own
   * lines, because a green connection check beside "no message has ever gone
   * out" is a real and common state that one conflated "last tested" would
   * hide.
   *
   * **`category` is the sanitized classification, never the provider's text.**
   * `classifyMailError` maps a raw SMTP or nodemailer error onto a closed set
   * before it reaches here — an audit payload is read by people who are not
   * operators, and a raw failure routinely names the host, the username and
   * the AUTH mechanism. `to` is absent on a `verify` because nothing was
   * addressed.
   */
  MailTested: {
    mode: "verify" | "send";
    ok: boolean;
    to?: string;
    category?: string;
    durationMs?: number;
  };

  /* ---- Authentication: the second factor --------------------------- */
  /**
   * The four MFA facts that happen **to a record**, and the reason they are
   * events at all.
   *
   * This file's rule — restated by `AuditListener` — is that *events describe
   * things that happened to records; direct audit calls describe things that
   * happened to nobody*. A failed sign-in has no record it is about. A second
   * factor being switched off has one: the user. P2-2 wrote all of them as
   * direct `audit.record` calls out of consistency with the rest of `auth/`,
   * which predates F8, and that was the wrong consistency to pick — the log
   * is identical either way (`auditActionFor` derives the same action names),
   * and the version that goes through the bus is also the one Notifications
   * can hear.
   *
   * The **failures** stayed direct, correctly: `auth.mfa_failed` and
   * `auth.mfa_challenged` are attempts, not changes.
   *
   * `entityId` is the **affected account** on all four, never the actor —
   * which is what lets a notification reach the person whose protection
   * changed rather than the administrator who changed it.
   */
  MfaEnabled: { email: string };
  MfaDisabled: { email: string };
  /** By an administrator, for account recovery. `sessionsRevoked` is the cost. */
  MfaReset: { email: string; byEmail: string; sessionsRevoked: number };
  MfaRecoveryRegenerated: { email: string; codes: number };

  /* ---- Media, users, applications (exist today) -------------------- */
  MediaUploaded: { filename: string; mimeType: string; size: number };
  MediaDeleted: { filename: string };
  UserInvited: { email: string };
  UserRolesChanged: { email: string; roles: string[] };
  UserDeleted: { email: string };
  ApplicationReceived: { position: string; files: number };
  ApplicationStatusChanged: { from: string; to: string };
  ApplicationDeleted: { position: string };

  /* ---- Projects (Wave 1) ------------------------------------------ */
  ProjectCreated: { number: string; name: string; customerId: string };
  /**
   * The field write, deliberately separate from `ProjectStatusChanged`.
   *
   * The distinction this file opens with, made concrete: a status change is a
   * *state transition* that other modules react to, and editing the notes is
   * a field write that only the audit log cares about. Both are audited —
   * `before`/`after` on the envelope carry the diff — but a workflow rule can
   * trigger on the transition without also firing every time somebody fixes a
   * typo in the description.
   */
  ProjectUpdated: { number: string; fields: string[] };
  ProjectStatusChanged: { number: string; from: string; to: string };
  ProjectArchived: { number: string };
  ProjectDeleted: { number: string; name: string };
  ProjectMemberAdded: { projectId: string; employeeId: string; role: string };
  ProjectMemberRemoved: { projectId: string; employeeId: string };
  ProjectDisciplineScoped: { projectId: string; code: string; status: string };

  /* ---- Milestones -------------------------------------------------- */
  /** `isBillingTrigger` is what Finance listens for — `data-model.md` §3.10. */
  MilestoneReached: { projectId: string; name: string; isBillingTrigger: boolean };
  MilestoneMissed: { projectId: string; name: string; dueDate: string };

  /* ---- SIA phases -------------------------------------------------- */
  PhaseApproved: { projectId: string; phase: string; decidedBy: string };
  PhaseSkipped: { projectId: string; phase: string; note: string };
  DeliverableReleased: { projectPhaseId: string; name: string };

  /* ---- Drawings ---------------------------------------------------- */
  /**
   * These three were declared during F7, before the module existed, and the
   * module was built to them rather than beside them.
   *
   * That is what the catalogue is for: `DrawingWithdrawn.reason` is a `string`
   * and not `string | null`, which turned out to be a rule — withdrawing a plan
   * people are building from without saying why is exactly the thing that
   * should not be possible. The payload settled the question before the service
   * asked it.
   *
   * `DrawingReleased` is internal and `DrawingIssued` is external, matching the
   * two statuses; `DrawingIssued` carries the revision *and* the transmittal
   * because "which revision, to whom, when" is one question.
   */
  DrawingReleased: { projectId: string; number: string; revision: string };
  DrawingIssued: { projectId: string; number: string; revision: string; transmittalId: string };
  DrawingWithdrawn: { projectId: string; number: string; reason: string };

  /* ---- Meetings and decisions (Wave 2) ------------------------------ */
  MeetingScheduled: { projectId: string | null; title: string; type: string; startsAt: string };
  MeetingUpdated: { title: string; fields: string[] };
  /**
   * The transition, and the one a Pendenz hangs off.
   *
   * `pendenzen` is on the payload because the number of tasks a Bausitzung
   * produced is the figure somebody reads the morning after — and a listener
   * that had to count them would have to load the protocol.
   */
  MeetingHeld: {
    projectId: string | null;
    type: string;
    seriesNumber: number | null;
    pendenzen: number;
  };
  MeetingCancelled: { projectId: string | null; title: string; reason?: string };
  MeetingDeleted: { projectId: string | null; title: string };
  /** `decision` is `APPROVED` or `AMENDED`; an amendment is a fact, not an edit. */
  MeetingApproved: { meetingId: string; decision: string; note: string | null };
  MinutesSent: { meetingId: string; projectId: string | null; recipients: number };
  /**
   * A protocol line became work.
   *
   * Separate from `TaskCreated`, which the tasks module raises for the task
   * itself: this one says *where the work came from*, which is what a
   * notification needs to say "aus Bausitzung 14" rather than "eine neue
   * Aufgabe".
   */
  MeetingItemToTask: { meetingId: string; itemKey: string; taskId: string };
  DecisionTaken: { projectId: string; number: string; type: string; impact: string };
  DecisionUpdated: { projectId: string; number: string; fields: string[] };
  DecisionStatusChanged: { projectId: string; number: string; from: string; to: string };
  DecisionSuperseded: { projectId: string; number: string; bySupersedingId: string };

  /* ---- Pläne und Planversand (Wave 2) ------------------------------ */
  /**
   * What the F7 block above did not anticipate, added when the module was
   * built rather than renamed into it.
   *
   * `DrawingReleased`, `DrawingIssued` and `DrawingWithdrawn` are up there and
   * are the three that matter; these are the ordinary record events plus the
   * two the Planversand needs.
   */
  DrawingCreated: { projectId: string; number: string; disciplineId: string; type: string };
  DrawingUpdated: { projectId: string; number: string; fields: string[] };
  DrawingStatusChanged: { projectId: string; number: string; from: string; to: string };
  DrawingDeleted: { projectId: string; number: string };
  /** A new revision exists. `supersedes` is the letter it replaced, if any. */
  RevisionCreated: {
    projectId: string;
    number: string;
    revision: string;
    reason: string;
    supersedes: string | null;
  };
  /** The Planversand itself, once, beside the per-drawing `DrawingIssued`. */
  TransmittalSent: {
    projectId: string;
    transmittalNumber: string;
    drawings: number;
    recipients: number;
    purpose: string;
  };
  /**
   * Raised when a transmittal supersedes a revision somebody already holds.
   *
   * It is a **warning, not a refusal** — reissuing a revised plan is the normal
   * case — and it is an event so that Notifications (module 9) can tell the
   * person holding the old one without this module knowing it exists.
   */
  PriorRevisionSuperseded: {
    projectId: string;
    number: string;
    previousRevision: string;
    newRevision: string;
    recipientLabel: string;
  };
  TransmittalAcknowledged: { projectId: string; transmittalNumber: string; recipientLabel: string };

  /* ---- Issues ------------------------------------------------------ */
  IssueRaised: { projectId: string; number: string; kind: string; severity: string };
  IssueAssigned: { projectId: string; number: string; assigneeId: string };
  IssueResolved: { projectId: string; number: string; resolvedBy: string };
  IssueVerified: { projectId: string; number: string; verifiedBy: string };

  /* ---- Tasks (Wave 2) ---------------------------------------------- */
  TaskCreated: { projectId: string | null; title: string; assigneeId: string | null };
  /** The field write, separate from the transition — the `ProjectUpdated` rule. */
  TaskUpdated: { title: string; fields: string[] };
  TaskStatusChanged: { projectId: string | null; title: string; from: string; to: string };
  /**
   * Reassignment, and it carries **both** ends.
   *
   * A notification has to reach the person who just gained the work *and* the
   * one who lost it — "das liegt nicht mehr bei dir" is the half that gets
   * forgotten, and a payload with only `assigneeId` cannot express it. `null`
   * on either side is a real value: a task can be unassigned back to the
   * backlog.
   */
  TaskAssigned: {
    projectId: string | null;
    title: string;
    assigneeId: string | null;
    previousAssigneeId: string | null;
  };
  TaskCompleted: { projectId: string | null; title: string; assigneeId: string | null };
  TaskBlocked: { projectId: string | null; title: string; reason: string };
  TaskDeleted: { projectId: string | null; title: string };
  /**
   * Raised **once per due date** by the nightly sweep, not every night.
   *
   * `Task.overdueNotifiedAt` is what makes that true; the reason is written on
   * the column. `daysOverdue` is on the payload so a listener can escalate
   * without recomputing it from a date it would have to parse.
   */
  TaskOverdue: { projectId: string | null; title: string; assigneeId: string | null; daysOverdue: number };
  TaskDependencyAdded: { taskId: string; predecessorId: string; type: string };
  /** Comments are their own event because a mention is a notification trigger. */
  TaskCommented: { taskId: string; projectId: string | null; mentionedIds: string[] };

  /* ---- Time -------------------------------------------------------- */
  TimeEntryApproved: { employeeId: string; projectId?: string; minutes: number };
  TimeEntryRejected: { employeeId: string; minutes: number; note?: string };
  AbsenceApproved: { employeeId: string; from: string; to: string };

  /* ---- Commercial --------------------------------------------------- */
  OfferSent: { number: string; customerId: string };
  OfferAccepted: { number: string; customerId: string; grossAmount: string };
  InvoiceSent: { number: string; customerId: string; grossAmount: string };
  PaymentRecorded: { invoiceNumber: string; amount: string };

  /* ---- Compliance and housekeeping ---------------------------------- */
  CertificateExpiring: { employeeId: string; name: string; expiresAt: string };
  RetentionPurged: { entity: string; count: number };

  /* ---- The queue itself --------------------------------------------- */
  /**
   * A background job has **given up** — raised once, when it goes `DEAD`, and
   * never on the retries before it.
   *
   * Named `Failed` rather than `Dead` because the catalogue is past tense and
   * "dead" is not a verb; the terminality is in when it is raised rather than
   * in the word. An event per attempt would announce three times that
   * something might be wrong and once that it is, which is the wrong ratio for
   * the only message an operator has to act on.
   *
   * `error` is the job's own truncated message. It reaches an audit row and,
   * through Notifications, an operator — so it must never be a stack trace,
   * which is why `JobService.fail` already caps it.
   */
  JobFailed: { job: string; jobId: string; attempts: number; error: string };

  /* ---- Notifications ------------------------------------------------- */
  /**
   * The firm changed which events produce notifications and through which
   * channels.
   *
   * One event for a whole save rather than one per switch: an administrator
   * ticking six boxes has taken one decision, and six audit rows would make
   * the log harder to read than the screen it describes. `types` names what
   * actually moved, so the row is still specific.
   */
  NotificationSettingsUpdated: { types: string[] };
};

export type DomainEventName = keyof DomainEvents;

/** What a listener receives. */
export type DomainEvent<N extends DomainEventName = DomainEventName> = {
  name: N;
  entity: string;
  entityId: string;
  payload: DomainEvents[N];
  before?: unknown;
  after?: unknown;
  actor: EventActor | null;
  correlationId: string;
  occurredAt: Date;
  message?: string;
};

/**
 * The names, at runtime.
 *
 * A type alone cannot be iterated, and three things need to: the agreement
 * test, the workflow engine's trigger dropdown (`data-model.md` §3.24), and the
 * `job`/notification kind lists. Written out rather than generated, and
 * `events.test.ts` asserts it matches the type exactly — so forgetting a line
 * fails the build rather than producing a trigger nobody can select.
 */
export const DOMAIN_EVENT_NAMES = [
  "ContentEntryCreated",
  "ContentEntryUpdated",
  "ContentEntryDeleted",
  "ContentSubmitted",
  "ContentApproved",
  "ContentRejected",
  "ContentPublished",
  "ContentRolledBack",
  "OrganisationUpdated",
  "OfficeCreated",
  "OfficeUpdated",
  "OfficeArchived",
  "OfficeRestored",
  "OfficeDeleted",
  "MailTested",
  "MfaEnabled",
  "MfaDisabled",
  "MfaReset",
  "MfaRecoveryRegenerated",
  "MediaUploaded",
  "MediaDeleted",
  "UserInvited",
  "UserRolesChanged",
  "UserDeleted",
  "ApplicationReceived",
  "ApplicationStatusChanged",
  "ApplicationDeleted",
  "ProjectCreated",
  "ProjectUpdated",
  "ProjectStatusChanged",
  "ProjectArchived",
  "ProjectDeleted",
  "ProjectMemberAdded",
  "ProjectMemberRemoved",
  "ProjectDisciplineScoped",
  "MilestoneReached",
  "MilestoneMissed",
  "PhaseApproved",
  "PhaseSkipped",
  "DeliverableReleased",
  "DrawingReleased",
  "DrawingIssued",
  "DrawingWithdrawn",
  "MeetingScheduled",
  "MeetingUpdated",
  "MeetingHeld",
  "MeetingCancelled",
  "MeetingDeleted",
  "MeetingApproved",
  "MinutesSent",
  "MeetingItemToTask",
  "DecisionTaken",
  "DecisionUpdated",
  "DecisionStatusChanged",
  "DecisionSuperseded",
  "DrawingCreated",
  "DrawingUpdated",
  "DrawingStatusChanged",
  "DrawingDeleted",
  "RevisionCreated",
  "TransmittalSent",
  "PriorRevisionSuperseded",
  "TransmittalAcknowledged",
  "IssueRaised",
  "IssueAssigned",
  "IssueResolved",
  "IssueVerified",
  "TaskCreated",
  "TaskUpdated",
  "TaskStatusChanged",
  "TaskAssigned",
  "TaskCompleted",
  "TaskBlocked",
  "TaskDeleted",
  "TaskOverdue",
  "TaskDependencyAdded",
  "TaskCommented",
  "TimeEntryApproved",
  "TimeEntryRejected",
  "AbsenceApproved",
  "OfferSent",
  "OfferAccepted",
  "InvoiceSent",
  "PaymentRecorded",
  "CertificateExpiring",
  "RetentionPurged",
  "JobFailed",
  "NotificationSettingsUpdated",
] as const satisfies readonly DomainEventName[];

/**
 * The audit action an event writes.
 *
 * `ProjectCreated` → `project.created`. Derived rather than declared: a second
 * list mapping one to the other is a second list to forget. The snake_case is
 * what `entities/audit/labels.ts` on the client already keys its German
 * phrases by, so the two vocabularies stay one.
 */
export function auditActionFor(name: DomainEventName): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  const verb = words.pop()!.toLowerCase();
  const subject = words.join("").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return `${subject}.${verb}`;
}
