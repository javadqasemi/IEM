import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WorkflowState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../core/audit/audit.service";
import { SettingsService } from "../core/settings/settings.service";
import { OrganisationService } from "../core/organisation/organisation.service";
import { contentTypeByKey } from "./content-types";
import { validateEntry } from "./content.validator";
import {
  assertComplete,
  buildSnapshot,
  crossCheck,
  diffDocuments,
  rowsForNextPublish,
} from "./snapshot.builder";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

/**
 * The transitions the workflow allows.
 *
 * Written as a table rather than as `if` chains in each method, because the
 * question an auditor asks is "can an editor move something from IN_REVIEW
 * straight to PUBLISHED?" and a table answers it by being read. The answer is
 * no: publishing is only reachable from APPROVED, and only by someone holding
 * `content.publish`, which in the seeded roles is Super Admin alone.
 */
const TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["PUBLISHED", "DRAFT", "REJECTED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  REJECTED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    /**
     * The firm's offices, which the published document carries and no content
     * entry holds any more.
     *
     * A *second* caller of `OrganisationService` outside its own routes —
     * `MailService` is the first — which is what put that service in `core/`
     * rather than in the feature folder. This module may inject it for the
     * same reason it may inject `SettingsService`: it is infrastructure, not a
     * sibling feature, and `architecture.test.ts` distinguishes the two.
     */
    private readonly organisation: OrganisationService,
  ) {}

  /* ================================================================ */
  /* Types                                                             */
  /* ================================================================ */

  listTypes() {
    return this.prisma.contentType.findMany({ orderBy: { rank: "asc" } });
  }

  async getType(key: string) {
    const type = await this.prisma.contentType.findUnique({ where: { key } });
    if (!type) throw new NotFoundException(`Unbekannter Inhaltstyp „${key}“.`);
    return type;
  }

  /* ================================================================ */
  /* Reading                                                           */
  /* ================================================================ */

  async listEntries(params: {
    typeKey?: string;
    status?: WorkflowState;
    search?: string;
    page?: number;
    perPage?: number;
    includeDeleted?: boolean;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));

    const where: Prisma.ContentEntryWhereInput = {
      ...(params.typeKey ? { typeKey: params.typeKey } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.includeDeleted ? {} : { deletedAt: null }),
      // The searchable text lives inside a JSON column, so this matches on the
      // entry key and falls back to a raw JSON containment search. It is not a
      // full-text index and does not pretend to be — the collections here run
      // to a few dozen rows, and the dashboard filters client-side after this.
      ...(params.search
        ? {
            OR: [
              { key: { contains: params.search, mode: "insensitive" } },
              {
                data: {
                  path: ["name"],
                  string_contains: params.search,
                },
              },
              {
                data: {
                  path: ["title"],
                  string_contains: params.search,
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contentEntry.findMany({
        where,
        orderBy: [{ typeKey: "asc" }, { position: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          updatedBy: { select: { id: true, name: true, email: true } },
          _count: { select: { versions: true } },
        },
      }),
      this.prisma.contentEntry.count({ where }),
    ]);

    return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
  }

  async getEntry(id: string) {
    const entry = await this.prisma.contentEntry.findUnique({
      where: { id },
      include: {
        type: true,
        createdBy: { select: { id: true, name: true } },
        updatedBy: { select: { id: true, name: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 20,
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });
    if (!entry) throw new NotFoundException("Eintrag nicht gefunden.");
    return entry;
  }

  /* ================================================================ */
  /* Writing                                                           */
  /* ================================================================ */

  async createEntry(
    input: { typeKey: string; key?: string; data: unknown; position?: number },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const def = contentTypeByKey(input.typeKey);
    if (!def) throw new NotFoundException(`Unbekannter Inhaltstyp „${input.typeKey}“.`);

    if (def.kind === "SINGLETON") {
      const existing = await this.prisma.contentEntry.count({
        where: { typeKey: def.key, deletedAt: null },
      });
      if (existing > 0) {
        throw new BadRequestException(
          `„${def.name}“ ist ein Einzelblock und existiert bereits — bearbeiten statt neu anlegen.`,
        );
      }
    }

    const data = validateEntry(def, input.data);
    const key = (input.key ?? this.deriveKey(def.key, data)).trim();

    const position =
      input.position ??
      ((await this.prisma.contentEntry.aggregate({
        where: { typeKey: def.key, deletedAt: null },
        _max: { position: true },
      }))._max.position ?? -1) + 1;

    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentEntry.create({
        data: {
          typeKey: def.key,
          key,
          data: data as Prisma.InputJsonValue,
          status: WorkflowState.DRAFT,
          position,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await tx.contentVersion.create({
        data: {
          entryId: created.id,
          version: 1,
          data: data as Prisma.InputJsonValue,
          status: WorkflowState.DRAFT,
          note: "Angelegt",
          authorId: actor.id,
        },
      });
      return created;
    });

    this.audit.record({
      actor,
      action: "content.created",
      resource: "content_entry",
      resourceId: entry.id,
      after: { typeKey: def.key, key, data },
      ...ctx,
    });
    return entry;
  }

  /**
   * Saves a new working copy and snapshots it as a version.
   *
   * Editing something that is already PUBLISHED does **not** change what is
   * live: `data` moves, `publishedData` does not, and the entry drops back to
   * DRAFT so the change has to go through review again. That is the property
   * that lets an editor work on next month's copy on a Tuesday afternoon
   * without anything reaching the public site.
   */
  async updateEntry(
    id: string,
    input: { data: unknown; note?: string },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const entry = await this.prisma.contentEntry.findUnique({
      where: { id },
      include: { type: true },
    });
    if (!entry || entry.deletedAt) throw new NotFoundException("Eintrag nicht gefunden.");

    const def = contentTypeByKey(entry.typeKey);
    if (!def) throw new NotFoundException(`Unbekannter Inhaltstyp „${entry.typeKey}“.`);

    const data = validateEntry(def, input.data);
    const nextVersion = entry.version + 1;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.contentEntry.update({
        where: { id },
        data: {
          data: data as Prisma.InputJsonValue,
          version: nextVersion,
          updatedById: actor.id,
          status:
            entry.status === WorkflowState.PUBLISHED ||
            entry.status === WorkflowState.APPROVED ||
            entry.status === WorkflowState.REJECTED
              ? WorkflowState.DRAFT
              : entry.status,
        },
      });
      await tx.contentVersion.create({
        data: {
          entryId: id,
          version: nextVersion,
          data: data as Prisma.InputJsonValue,
          status: row.status,
          note: input.note ?? null,
          authorId: actor.id,
        },
      });
      return row;
    });

    this.audit.record({
      actor,
      action: "content.updated",
      resource: "content_entry",
      resourceId: id,
      before: entry.data,
      after: data,
      message: input.note,
      ...ctx,
    });
    return updated;
  }

  /** Soft delete. The version history and the audit trail stay intact. */
  async deleteEntry(id: string, actor: AuthUser, ctx: Ctx) {
    const entry = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!entry || entry.deletedAt) throw new NotFoundException("Eintrag nicht gefunden.");

    const def = contentTypeByKey(entry.typeKey);
    if (def?.kind === "SINGLETON") {
      throw new BadRequestException(
        `„${def.name}“ ist ein Einzelblock der Seite und kann nicht gelöscht werden.`,
      );
    }

    await this.prisma.contentEntry.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actor.id },
    });
    this.audit.record({
      actor,
      action: "content.deleted",
      resource: "content_entry",
      resourceId: id,
      before: entry.data,
      ...ctx,
    });
  }

  async restoreEntry(id: string, actor: AuthUser, ctx: Ctx) {
    const entry = await this.prisma.contentEntry.update({
      where: { id },
      data: { deletedAt: null, status: WorkflowState.DRAFT, updatedById: actor.id },
    });
    this.audit.record({
      actor,
      action: "content.restored",
      resource: "content_entry",
      resourceId: id,
      ...ctx,
    });
    return entry;
  }

  /**
   * Takes an entry off the site, or puts it back.
   *
   * Not a delete and not a workflow step. The row keeps its data, its
   * versions, its review state and its position; `buildSnapshot` simply leaves
   * it out of the document. That is what makes it reversible at no cost — the
   * switch back is the same call.
   *
   * It changes the *draft*, like every other edit here, so the entry stays on
   * the live site until someone publishes. `GET /content/pending` reports it
   * correctly because that compares built documents rather than counting
   * approved rows, and a hidden entry changes the document it would produce.
   *
   * `status` is deliberately left alone. Hiding is not an editorial change to
   * the content and should not drag an approved entry back into review — the
   * same reasoning that leaves a deletion's status untouched.
   */
  async setEntryHidden(id: string, hidden: boolean, actor: AuthUser, ctx: Ctx) {
    const entry = await this.prisma.contentEntry.findFirst({
      where: { id, deletedAt: null },
    });
    if (!entry) throw new NotFoundException("Eintrag nicht gefunden.");

    const updated = await this.prisma.contentEntry.update({
      where: { id },
      data: { hidden, updatedById: actor.id },
    });

    this.audit.record({
      actor,
      action: hidden ? "content.hidden" : "content.shown",
      resource: "content_entry",
      resourceId: id,
      ...ctx,
    });
    return updated;
  }

  async duplicateEntry(id: string, actor: AuthUser, ctx: Ctx) {
    const src = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!src) throw new NotFoundException("Eintrag nicht gefunden.");

    const def = contentTypeByKey(src.typeKey);
    if (def?.kind === "SINGLETON") {
      throw new BadRequestException("Einzelblöcke können nicht dupliziert werden.");
    }

    // Suffix until free, rather than a random id: a duplicate that reads
    // `alterszentrum-lebensart-kopie-2` tells an editor what it came from.
    let key = `${src.key}-kopie`;
    for (let i = 2; await this.keyTaken(src.typeKey, key); i++) key = `${src.key}-kopie-${i}`;

    const created = await this.createEntry(
      { typeKey: src.typeKey, key, data: src.data, position: src.position + 1 },
      actor,
      ctx,
    );
    this.audit.record({
      actor,
      action: "content.duplicated",
      resource: "content_entry",
      resourceId: created.id,
      message: `Kopie von ${src.key}`,
      ...ctx,
    });
    return created;
  }

  /** Bulk reorder, applied in one transaction so the list is never half-sorted. */
  async reorder(typeKey: string, ids: string[], actor: AuthUser, ctx: Ctx) {
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.contentEntry.update({
          where: { id },
          data: { position, updatedById: actor.id },
        }),
      ),
    );
    this.audit.record({
      actor,
      action: "content.reordered",
      resource: "content_type",
      resourceId: typeKey,
      after: { order: ids },
      ...ctx,
    });
  }

  /* ================================================================ */
  /* Versions                                                          */
  /* ================================================================ */

  listVersions(entryId: string) {
    return this.prisma.contentVersion.findMany({
      where: { entryId },
      orderBy: { version: "desc" },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  }

  /**
   * A field-level diff between two versions.
   *
   * Computed on the server so both the entry editor and the review screen show
   * the same comparison — a reviewer deciding whether to approve is looking at
   * exactly what the editor was looking at.
   */
  async diff(entryId: string, fromVersion: number, toVersion: number) {
    const [from, to] = await Promise.all([
      this.prisma.contentVersion.findUnique({
        where: { entryId_version: { entryId, version: fromVersion } },
      }),
      this.prisma.contentVersion.findUnique({
        where: { entryId_version: { entryId, version: toVersion } },
      }),
    ]);
    if (!from || !to) throw new NotFoundException("Version nicht gefunden.");

    const a = from.data as Record<string, unknown>;
    const b = to.data as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

    return {
      from: { version: from.version, createdAt: from.createdAt },
      to: { version: to.version, createdAt: to.createdAt },
      changes: keys
        .map((key) => ({
          key,
          before: a[key],
          after: b[key],
          changed: JSON.stringify(a[key]) !== JSON.stringify(b[key]),
        }))
        .filter((c) => c.changed),
    };
  }

  /**
   * Restores an earlier version as a *new* version.
   *
   * Never rewrites history: rolling back to version 3 writes version 9 whose
   * content equals version 3's. The log of what the entry said when stays
   * complete, which is the only reason to keep versions at all.
   */
  async rollback(entryId: string, version: number, actor: AuthUser, ctx: Ctx) {
    const target = await this.prisma.contentVersion.findUnique({
      where: { entryId_version: { entryId, version } },
    });
    if (!target) throw new NotFoundException("Version nicht gefunden.");

    const updated = await this.updateEntry(
      entryId,
      { data: target.data, note: `Zurückgesetzt auf Version ${version}` },
      actor,
      ctx,
    );
    this.audit.record({
      actor,
      action: "content.rolled_back",
      resource: "content_entry",
      resourceId: entryId,
      message: `auf Version ${version}`,
      ...ctx,
    });
    return updated;
  }

  /* ================================================================ */
  /* Workflow                                                          */
  /* ================================================================ */

  private assertTransition(from: WorkflowState, to: WorkflowState) {
    if (!TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `Ein Eintrag im Status „${from}“ kann nicht direkt nach „${to}“ wechseln.`,
      );
    }
  }

  async submitForReview(id: string, message: string | undefined, actor: AuthUser, ctx: Ctx) {
    const entry = await this.prisma.contentEntry.findUniqueOrThrow({ where: { id } });
    this.assertTransition(entry.status, WorkflowState.IN_REVIEW);

    const version = await this.prisma.contentVersion.findFirstOrThrow({
      where: { entryId: id },
      orderBy: { version: "desc" },
    });

    await this.prisma.$transaction([
      this.prisma.contentEntry.update({
        where: { id },
        data: { status: WorkflowState.IN_REVIEW, updatedById: actor.id },
      }),
      this.prisma.reviewRequest.create({
        data: {
          entryId: id,
          versionId: version.id,
          requestedById: actor.id,
          message: message ?? null,
        },
      }),
    ]);

    this.audit.record({
      actor,
      action: "content.submitted",
      resource: "content_entry",
      resourceId: id,
      message,
      ...ctx,
    });
  }

  async decideReview(
    reviewId: string,
    decision: "APPROVED" | "REJECTED",
    note: string | undefined,
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const review = await this.prisma.reviewRequest.findUnique({
      where: { id: reviewId },
      include: { entry: true },
    });
    if (!review) throw new NotFoundException("Freigabeanfrage nicht gefunden.");
    if (review.state !== "PENDING") {
      throw new BadRequestException("Diese Anfrage wurde bereits entschieden.");
    }
    /**
     * Reviewing one's own submission defeats the point of having the step.
     *
     * Two exemptions, and they are different in kind. **Super Admin** is exempt
     * because on a small team they are often the only person who can act at all,
     * and the audit log records that they did both halves.
     * **`workflow.requireApproval`** is the operator's own decision to run
     * without the four-eyes principle — the setting has always been described as
     * exactly that ("Ausschalten hebt den Vier-Augen-Grundsatz auf") and was
     * read by nothing, so switching it off changed nothing and an operator could
     * as easily have believed they had switched it *on*.
     *
     * Turning it off does not remove the review step; it only allows the same
     * person to take both actions. The submission, the decision and the
     * decider are still recorded, which is what makes the exemption auditable
     * rather than invisible.
     */
    const selfReview = review.requestedById === actor.id;
    if (selfReview && !actor.isSuperAdmin) {
      const fourEyes = await this.settings.flag("workflow.requireApproval", true);
      if (fourEyes) {
        throw new ForbiddenException(
          "Eigene Einreichungen können nicht selbst freigegeben werden. " +
            "Das Vier-Augen-Prinzip lässt sich in den Einstellungen aufheben.",
        );
      }
    }

    const next = decision === "APPROVED" ? WorkflowState.APPROVED : WorkflowState.REJECTED;
    this.assertTransition(review.entry.status, next);

    await this.prisma.$transaction([
      this.prisma.reviewRequest.update({
        where: { id: reviewId },
        data: {
          state: decision,
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        },
      }),
      this.prisma.contentEntry.update({
        where: { id: review.entryId },
        data: { status: next, updatedById: actor.id },
      }),
    ]);

    this.audit.record({
      actor,
      action: decision === "APPROVED" ? "content.approved" : "content.rejected",
      resource: "content_entry",
      resourceId: review.entryId,
      message: note,
      ...ctx,
    });
  }

  listPendingReviews() {
    return this.prisma.reviewRequest.findMany({
      where: { state: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        entry: { select: { id: true, key: true, typeKey: true, status: true } },
        version: { select: { version: true, data: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /* ================================================================ */
  /* Publishing                                                        */
  /* ================================================================ */

  /**
   * Freezes every approved entry and writes a new site snapshot.
   *
   * Two things happen in one transaction, and both matter:
   *
   * 1. Each APPROVED entry's `data` is copied into `publishedData` and its
   *    status becomes PUBLISHED. Entries still in DRAFT keep whatever they
   *    were last published with, so an unfinished draft cannot ride along.
   * 2. The full document is rebuilt and stored as a new `ContentSnapshot`.
   *
   * If the resulting document is incomplete the whole thing rolls back —
   * `assertComplete` throws inside the transaction on purpose. A partial
   * publish would mean a live page with a missing section, discovered by a
   * visitor rather than by us.
   */
  async publish(note: string | undefined, actor: AuthUser, ctx: Ctx) {
    /*
      Read *before* the transaction, not inside it.

      The offices come from a different module's table and nothing in this
      transaction writes them, so holding the publish transaction open across
      that read buys no consistency and lengthens the one transaction in the
      system that locks the whole content table. The window it opens is real
      and tiny — an office edited between this line and the commit would land
      in the next publish — and a publish is a deliberate act somebody is
      watching, which is the case where "the next one" is an acceptable answer.
    */
    const offices = await this.organisation.siteOffices();
    const officeWarnings = await this.organisation.publishWarnings();

    const result = await this.prisma.$transaction(async (tx) => {
      const approved = await tx.contentEntry.findMany({
        where: { status: WorkflowState.APPROVED, deletedAt: null },
      });

      for (const entry of approved) {
        await tx.contentEntry.update({
          where: { id: entry.id },
          data: {
            publishedData: entry.data as Prisma.InputJsonValue,
            status: WorkflowState.PUBLISHED,
            publishedAt: new Date(),
          },
        });
      }

      const rows = await tx.contentEntry.findMany({
        where: { deletedAt: null, publishedData: { not: Prisma.DbNull } },
        select: {
          typeKey: true,
          key: true,
          position: true,
          data: true,
          publishedData: true,
          status: true,
          // Selected because uildSnapshot filters on it. Omit it and Prisma
          // returns undefined, the filter passes everything, and hiding an
          // entry silently stops working.
          hidden: true,
        },
      });

      const content = buildSnapshot(rows, { source: "published", offices });
      assertComplete(content);
      const warnings = [...crossCheck(content), ...officeWarnings];

      const last = await tx.contentSnapshot.findFirst({ orderBy: { version: "desc" } });
      const snapshot = await tx.contentSnapshot.create({
        data: {
          version: (last?.version ?? 0) + 1,
          content: content as Prisma.InputJsonValue,
          note: note ?? null,
          publishedById: actor.id,
        },
      });

      return { snapshot, published: approved.length, warnings };
    });

    this.audit.record({
      actor,
      action: "content.published",
      resource: "content_snapshot",
      resourceId: String(result.snapshot.version),
      message: `${result.published} Eintrag/Einträge veröffentlicht${
        note ? ` — ${note}` : ""
      }`,
      ...ctx,
    });

    if (result.warnings.length) {
      this.logger.warn(
        `Snapshot ${result.snapshot.version} veröffentlicht mit ${result.warnings.length} Hinweis(en).`,
      );
    }

    return {
      version: result.snapshot.version,
      publishedAt: result.snapshot.publishedAt,
      entriesPublished: result.published,
      warnings: result.warnings,
    };
  }

  /** The live document, as the public site consumes it. */
  async published() {
    const snapshot = await this.prisma.contentSnapshot.findFirst({
      orderBy: { version: "desc" },
    });
    if (!snapshot) {
      throw new NotFoundException(
        "Es wurde noch nichts veröffentlicht. Die Website zeigt bis dahin ihren eingebauten Stand.",
      );
    }
    return {
      version: snapshot.version,
      publishedAt: snapshot.publishedAt.toISOString(),
      content: snapshot.content,
    };
  }

  /**
   * Whether publishing now would change the live site, and where.
   *
   * The publish screen used to answer this by counting `APPROVED` entries, and
   * that count is not the question. A **deletion** never reaches `APPROVED` —
   * the row is marked deleted and its status is left alone — so removing a team
   * member left the screen reporting nothing to do while the live page still
   * showed the person, with the publish button disabled for good measure.
   *
   * This compares the stored snapshot against the document the next publish
   * would build, so a deletion, a reordering and an approved edit all show up
   * the same way: as an area that differs.
   */
  async pendingChanges() {
    const [rows, last, offices, officeWarnings] = await Promise.all([
      this.prisma.contentEntry.findMany({
        where: { deletedAt: null },
        select: {
          typeKey: true,
          key: true,
          position: true,
          data: true,
          publishedData: true,
          status: true,
          // Selected because uildSnapshot filters on it. Omit it and Prisma
          // returns undefined, the filter passes everything, and hiding an
          // entry silently stops working.
          hidden: true,
        },
      }),
      this.prisma.contentSnapshot.findFirst({ orderBy: { version: "desc" } }),
      this.organisation.siteOffices(),
      this.organisation.publishWarnings(),
    ]);

    const next = buildSnapshot(rowsForNextPublish(rows), { source: "published", offices });
    const live = (last?.content ?? null) as Record<string, unknown> | null;
    const changes = diffDocuments(live, next);

    return {
      liveVersion: last?.version ?? null,
      publishedAt: last?.publishedAt.toISOString() ?? null,
      changed: changes.length > 0,
      changes,
      approved: rows.filter((r) => r.status === WorkflowState.APPROVED).length,
      /**
       * Read before the publish rather than after it.
       *
       * An incomplete Standort does not fail `assertComplete` — the array is
       * non-empty, it just has a blank telephone number in it — so without
       * this the first anyone hears of it is a visitor looking at a contact
       * band with no number. `crossCheck`'s warnings are only available once a
       * document has been built; these are available on the screen where
       * somebody is deciding whether to publish.
       */
      warnings: officeWarnings,
    };
  }

  /**
   * The document as it *would* be, drafts included. Drives the live preview.
   *
   * Falls back to `data` for every entry rather than `publishedData`, so an
   * editor sees their unpublished work in place on the real page.
   */
  async preview() {
    const rows = await this.prisma.contentEntry.findMany({
      where: { deletedAt: null },
      select: {
        typeKey: true,
        key: true,
        position: true,
        data: true,
        publishedData: true,
        status: true,
        // Selected because uildSnapshot filters on it. Omit it and Prisma
        // returns undefined, the filter passes everything, and hiding an
        // entry silently stops working.
        hidden: true,
      },
    });
    /*
      The offices are the *live* ones even in the draft preview, and there is
      no draft version of them to show: `Office` has no draft/published split
      — a change to a Standort is immediate in the register and reaches the
      site at the next publish. Showing the live rows here is therefore what
      the preview would produce, which is the property a preview is for.
    */
    const offices = await this.organisation.siteOffices();
    const content = buildSnapshot(rows, { source: "draft", offices });
    return {
      version: -1,
      publishedAt: new Date().toISOString(),
      content,
      warnings: [...crossCheck(content), ...(await this.organisation.publishWarnings())],
    };
  }

  listSnapshots(limit = 50) {
    return this.prisma.contentSnapshot.findMany({
      orderBy: { version: "desc" },
      take: limit,
      select: {
        id: true,
        version: true,
        note: true,
        restoredFrom: true,
        publishedAt: true,
        publishedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Publishes an earlier snapshot again, as a new one.
   *
   * Append-only, like the version history and for the same reason: after a
   * rollback it must still be answerable what was live last Tuesday.
   */
  async restoreSnapshot(version: number, actor: AuthUser, ctx: Ctx) {
    const target = await this.prisma.contentSnapshot.findUnique({ where: { version } });
    if (!target) throw new NotFoundException(`Snapshot ${version} nicht gefunden.`);

    const last = await this.prisma.contentSnapshot.findFirstOrThrow({
      orderBy: { version: "desc" },
    });
    const created = await this.prisma.contentSnapshot.create({
      data: {
        version: last.version + 1,
        content: target.content as Prisma.InputJsonValue,
        note: `Wiederhergestellt aus Version ${version}`,
        restoredFrom: version,
        publishedById: actor.id,
      },
    });

    this.audit.record({
      actor,
      action: "content.snapshot_restored",
      resource: "content_snapshot",
      resourceId: String(created.version),
      message: `aus Version ${version}`,
      ...ctx,
    });
    return { version: created.version, restoredFrom: version, publishedAt: created.publishedAt };
  }

  /* ================================================================ */
  /* Helpers                                                           */
  /* ================================================================ */

  private async keyTaken(typeKey: string, key: string): Promise<boolean> {
    const n = await this.prisma.contentEntry.count({ where: { typeKey, key } });
    return n > 0;
  }

  /**
   * A readable, stable key from whichever field the entry calls itself by.
   *
   * Slugs rather than ids because the key shows up in URLs (`?id=gpl-hlks`),
   * in duplicate names and in the publish log, and a cuid tells nobody
   * anything. Falls back to a timestamp only when an entry has no nameable
   * field at all.
   */
  private deriveKey(typeKey: string, data: Record<string, unknown>): string {
    const source =
      (data.id as string) ??
      (data.key as string) ??
      (data.name as string) ??
      (data.title as string) ??
      (data.label as string) ??
      (data.role as string) ??
      (data.city as string) ??
      `${typeKey}-${Date.now()}`;
    return slugify(String(source));
  }
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
