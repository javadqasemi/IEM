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
  ContentApproved: { typeKey: string; key: string; decidedBy: string };
  ContentRejected: { typeKey: string; key: string; decidedBy: string; note?: string };
  ContentPublished: { version: number; entriesPublished: number; warnings: string[] };
  ContentRolledBack: { typeKey: string; key: string; toVersion: number };

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
  DrawingReleased: { projectId: string; number: string; revision: string };
  DrawingIssued: { projectId: string; number: string; revision: string; transmittalId: string };
  DrawingWithdrawn: { projectId: string; number: string; reason: string };

  /* ---- Meetings and decisions -------------------------------------- */
  MeetingHeld: { projectId: string; type: string; seriesNumber?: number };
  MeetingApproved: { meetingId: string; decision: string };
  DecisionTaken: { projectId: string; number: string; type: string };
  DecisionSuperseded: { projectId: string; number: string; bySupersedingId: string };

  /* ---- Issues ------------------------------------------------------ */
  IssueRaised: { projectId: string; number: string; kind: string; severity: string };
  IssueAssigned: { projectId: string; number: string; assigneeId: string };
  IssueResolved: { projectId: string; number: string; resolvedBy: string };
  IssueVerified: { projectId: string; number: string; verifiedBy: string };

  /* ---- Tasks and time ---------------------------------------------- */
  TaskAssigned: { projectId?: string; title: string; assigneeId: string };
  TaskCompleted: { projectId?: string; title: string };
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
  "MeetingHeld",
  "MeetingApproved",
  "DecisionTaken",
  "DecisionSuperseded",
  "IssueRaised",
  "IssueAssigned",
  "IssueResolved",
  "IssueVerified",
  "TaskAssigned",
  "TaskCompleted",
  "TimeEntryApproved",
  "TimeEntryRejected",
  "AbsenceApproved",
  "OfferSent",
  "OfferAccepted",
  "InvoiceSent",
  "PaymentRecorded",
  "CertificateExpiring",
  "RetentionPurged",
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
