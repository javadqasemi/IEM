import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ApplicationStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../core/audit/audit.service";
import { EventBus } from "../core/events/event-bus";
import { APPLICATION_LIST } from "./applications.list";
import type { RawListQuery } from "../core/list/list.decorator";
import {
  buildOrderBy,
  buildWhere,
  paginated,
  parseListQuery,
  skipTake,
} from "../core/list/list";
import { SettingsService } from "../core/settings/settings.service";
import { MailService } from "../mail/mail.service";
import { STORAGE, type StorageAdapter } from "../media/storage";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

export type StoredFile = {
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  storageKey: string;
  checksum: string;
};

/**
 * What the site's form may attach, matching its own `accept` attribute.
 * Checked here by magic bytes, because the attribute is advisory and the
 * declared MIME type is chosen by the client.
 */
const ALLOWED_DOSSIER = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);

/**
 * The hard ceiling per file, matching the Multer limit on the controller.
 *
 * Multer enforces it before the body is buffered, which is the only place it can
 * usefully be enforced against a hostile caller — a limit checked after the
 * bytes are in memory has already cost the memory. `applications.maxFileBytes`
 * can lower the effective limit from the dashboard but never raise it past this,
 * which is why the setting is clamped rather than trusted: an operator typing a
 * gigabyte into a box must not be able to widen the public endpoint's exposure.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 5;

/**
 * Incoming job applications.
 *
 * The site's `BewerbungDialog` has always been able to POST
 * `multipart/form-data` with fields `position, vorname, nachname, email,
 * telefon, verfuegbar, nachricht` and files under `dateien` — it was disabled
 * only because nothing was listening. This is that endpoint, and it accepts
 * exactly those names so the form needs no change beyond setting
 * `VITE_BEWERBUNG_ENDPOINT`.
 *
 * Everything here is personal data under the revDSG, which shapes three
 * decisions: dossiers are stored outside the public media root and are never
 * served by URL, every record carries a deletion date from the moment it
 * arrives, and reading one is its own permission.
 */
@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Both, and the split is the rule (architecture §7.5).
     *
     * **Events** describe things that happened to records: received, status
     * changed, deleted. `AuditListener` turns each into a row, so the audit
     * trail is a consequence of raising the event rather than a second call
     * somebody has to remember.
     *
     * **`audit` directly** is for the two that are not changes at all —
     * opening a dossier and downloading one. Those are *accesses*: there is no
     * before, no after, and nothing for a notification or a report to react
     * to. They are in the log because personal data was looked at, which is a
     * revDSG matter and exactly the kind of thing an event-shaped record would
     * distort.
     */
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
  ) {}

  /* ---- Receiving ------------------------------------------------- */

  async receive(
    body: Record<string, string>,
    files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[],
    ctx: Ctx,
  ) {
    const stored: StoredFile[] = [];
    let total = 0;

    // The configured limit, never above the hard one. The setting was labelled
    // "Grösse pro Datei" from the start and read by nothing — the only limit in
    // force was the constant.
    const maxFileBytes = await this.settings.number(
      "applications.maxFileBytes",
      MAX_FILE_BYTES,
      64 * 1024,
      MAX_FILE_BYTES,
    );

    for (const file of files.slice(0, MAX_FILES)) {
      if (file.size > maxFileBytes) {
        this.logger.warn(`Bewerbungsanhang zu gross, übersprungen: ${file.originalname}`);
        continue;
      }
      total += file.size;
      if (total > MAX_TOTAL_BYTES) break;

      const sniffed = sniffDossier(file.buffer, file.mimetype);
      const ext = ALLOWED_DOSSIER.get(sniffed);
      if (!ext) {
        this.logger.warn(`Bewerbungsanhang mit unerlaubtem Typ ${sniffed}, übersprungen.`);
        continue;
      }

      const checksum = createHash("sha256").update(file.buffer).digest("hex");
      // Deliberately *not* under the media root: these must never be reachable
      // by guessing a URL, so they live in their own prefix that nothing
      // serves statically and are only ever handed out through a permission-
      // checked download route.
      const storageKey = `bewerbungen/${new Date().getFullYear()}/${checksum.slice(0, 16)}.${ext}`;
      await this.storage.put(storageKey, file.buffer, sniffed);

      stored.push({
        filename: `${checksum.slice(0, 8)}.${ext}`,
        originalName: file.originalname,
        size: file.size,
        mimeType: sniffed,
        storageKey,
        checksum,
      });
    }

    /*
      Clamped, like `maxFileBytes` above it — and the fact that this line was
      the one raw `value<number>()` read in the codebase is exactly why it was
      the dangerous one.

      `retainUntil` is a **deletion deadline**: the 03:00 purge removes every
      application past it, with its files, permanently. Read unclamped, a `0`
      in the settings table deleted every dossier received that day and a
      non-numeric value produced `new Date(NaN)`, which Prisma rejects — so the
      public application form 500'd and candidates silently could not apply.

      Writes are validated now (`settings.rules.ts`), which stops the value
      being stored. This stops it being *read*, which is the guard that also
      covers a row written before the type existed or edited straight in the
      database. The bounds are the ones the setting declares.
    */
    const retentionDays = await this.settings.number(
      "applications.retentionDays",
      180,
      30,
      3650,
    );

    const application = await this.prisma.jobApplication.create({
      data: {
        openingId: body.openingId || null,
        position: (body.position ?? "Spontanbewerbung").slice(0, 200),
        firstName: (body.vorname ?? "").slice(0, 120),
        lastName: (body.nachname ?? "").slice(0, 120),
        email: (body.email ?? "").slice(0, 200).toLowerCase(),
        phone: body.telefon?.slice(0, 60) || null,
        availableFrom: body.verfuegbar?.slice(0, 120) || null,
        message: body.nachricht?.slice(0, 5000) || null,
        files: stored as unknown as Prisma.InputJsonValue,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        retainUntil: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000),
      },
    });

    /*
      An event, not an audit call (foundation stage F8).

      The audit row is written by `AuditListener` from this — one fact, one
      publication, and three other consumers (notifications, reporting, the
      workflow engine) get it for free without this service knowing they exist.
      The actor is null here on purpose: an applicant has no account, and
      `RequestContextInterceptor` has nobody to record.
    */
    this.events.publish("ApplicationReceived", {
      entity: "job_application",
      entityId: application.id,
      after: { position: application.position, files: stored.length },
      payload: { position: application.position, files: stored.length },
    });

    // Notification and confirmation are sent after the record is committed, so
    // a mail outage cannot lose an application that was successfully stored.
    void this.notify(application.id);

    return {
      id: application.id,
      received: stored.length,
      skipped: files.length - stored.length,
    };
  }

  private async notify(id: string) {
    try {
      const application = await this.prisma.jobApplication.findUniqueOrThrow({ where: { id } });
      const to = await this.settings.value<string>("applications.notifyEmail", "info@iem.ch");
      await this.mail.sendApplicationNotice(to, application);
      await this.mail.sendApplicationConfirmation(application.email, application);
    } catch (err) {
      this.logger.error(
        `Benachrichtigung für Bewerbung ${id} fehlgeschlagen: ${(err as Error).message}`,
      );
    }
  }

  /* ---- Administration -------------------------------------------- */

  /**
   * The list, through the shared contract (foundation stage F11).
   *
   * What it replaces: a hand-rolled page/perPage/search/where, the fifth of
   * five slightly different copies (weakness W5). What it gains beyond
   * deduplication — and every one of these was missing here — is server-side
   * sorting, filtering by any of six fields with ten operators, a refusal that
   * names what *is* allowed instead of silently ignoring a parameter, and a
   * `pages: 0` for an empty result rather than the `Math.max(1, …)` that told
   * the client there was one page of nothing.
   *
   * `APPLICATION_LIST` is the allowlist. A field that is not in it cannot be
   * filtered or sorted by, which is what keeps a query parameter away from
   * Prisma unchecked.
   */
  async list(query: RawListQuery) {
    const params = parseListQuery(query, APPLICATION_LIST);
    const where = buildWhere(params, APPLICATION_LIST) as Prisma.JobApplicationWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.jobApplication.findMany({
        where,
        orderBy: buildOrderBy(params, APPLICATION_LIST) as Prisma.JobApplicationOrderByWithRelationInput,
        ...skipTake(params),
      }),
      this.prisma.jobApplication.count({ where }),
    ]);

    return paginated(items, total, params);
  }

  /**
   * The same query, every matching row, as CSV.
   *
   * **It takes the same parameters as `list`**, and that is the whole point:
   * an export that quietly contains more than the filtered view on screen is a
   * document somebody will act on. Architecture §7.2 makes it a rule rather
   * than a per-module decision.
   *
   * No `skip`/`take`: the export *is* how a caller legitimately gets
   * everything, which is why `perPage` is capped on the list route.
   */
  async exportRows(query: RawListQuery) {
    const params = parseListQuery(query, APPLICATION_LIST);
    const where = buildWhere(params, APPLICATION_LIST) as Prisma.JobApplicationWhereInput;
    return this.prisma.jobApplication.findMany({
      where,
      orderBy: buildOrderBy(params, APPLICATION_LIST) as Prisma.JobApplicationOrderByWithRelationInput,
    });
  }

  /**
   * Sets the status on several at once.
   *
   * One `updateMany` and one event per row, not one event for the batch: the
   * audit log records what happened to *records*, and a single row saying
   * "twelve applications changed" cannot answer "what happened to this one".
   * Twelve rows sharing a correlation id can answer both.
   */
  async bulkStatus(ids: string[], status: ApplicationStatus) {
    const before = await this.prisma.jobApplication.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });

    await this.prisma.jobApplication.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    for (const row of before) {
      if (row.status === status) continue;
      this.events.publish("ApplicationStatusChanged", {
        entity: "job_application",
        entityId: row.id,
        before: { status: row.status },
        after: { status },
        payload: { from: row.status, to: status },
      });
    }

    return { changed: before.filter((r) => r.status !== status).length };
  }

  async get(id: string, actor: AuthUser, ctx: Ctx) {
    const application = await this.prisma.jobApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException("Bewerbung nicht gefunden.");
    // Reading a dossier is itself worth recording: these are personal data,
    // and "who looked at this" is a question the DSG expects an answer to.
    this.audit.record({
      actor,
      action: "application.viewed",
      resource: "job_application",
      resourceId: id,
      ...ctx,
    });
    return application;
  }

  /**
   * No `actor` and no `ctx` any more.
   *
   * They were passed in solely to be forwarded to `audit.record`, and the
   * event carries neither: `EventBus` reads the actor, the IP and the user
   * agent from the ambient request context. That is the concrete payoff of
   * foundation stage F8 — two parameters that existed only to be threaded
   * through a call chain are gone, and the same will be true of every module
   * that raises events instead of writing audit calls.
   */
  async update(id: string, input: { status?: ApplicationStatus; note?: string }) {
    const before = await this.prisma.jobApplication.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.jobApplication.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    this.events.publish("ApplicationStatusChanged", {
      entity: "job_application",
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
      payload: { from: before.status, to: after.status },
    });
    return after;
  }

  /** Streams one attachment. Never a public URL — see the note on `receive`. */
  async file(id: string, index: number, actor: AuthUser, ctx: Ctx) {
    const application = await this.prisma.jobApplication.findUniqueOrThrow({ where: { id } });
    const files = application.files as unknown as StoredFile[];
    const file = files[index];
    if (!file) throw new NotFoundException("Anhang nicht gefunden.");

    this.audit.record({
      actor,
      action: "application.file_downloaded",
      resource: "job_application",
      resourceId: id,
      message: file.originalName,
      ...ctx,
    });

    return { file, stream: await this.storage.stream(file.storageKey) };
  }

  /** Hard delete — this is personal data, so there is no soft form of it. */
  async remove(id: string) {
    const application = await this.prisma.jobApplication.findUniqueOrThrow({ where: { id } });
    for (const file of application.files as unknown as StoredFile[]) {
      await this.storage.delete(file.storageKey);
    }
    await this.prisma.jobApplication.delete({ where: { id } });
    this.events.publish("ApplicationDeleted", {
      entity: "job_application",
      entityId: id,
      // Name and position only. Deleting a record and then keeping its full
      // contents in the audit log would defeat the deletion.
      before: { position: application.position, name: `${application.firstName} ${application.lastName}` },
      payload: { position: application.position },
    });
  }

  /**
   * Deletes everything past its retention date, files included.
   *
   * Run nightly by the scheduler. This is the mechanism behind the retention
   * setting — without it the setting would be a number in a form that did
   * nothing, which is worse than not offering it.
   */
  async purgeExpired(): Promise<number> {
    const due = await this.prisma.jobApplication.findMany({
      where: { retainUntil: { lte: new Date() } },
      select: { id: true, files: true },
    });
    for (const application of due) {
      for (const file of application.files as unknown as StoredFile[]) {
        await this.storage.delete(file.storageKey);
      }
    }
    if (due.length) {
      await this.prisma.jobApplication.deleteMany({
        where: { id: { in: due.map((a) => a.id) } },
      });
      await this.audit.writeSync({
        action: "application.retention_purge",
        resource: "job_application",
        message: `${due.length} Bewerbung(en) nach Ablauf der Aufbewahrungsfrist gelöscht`,
      });
    }
    return due.length;
  }

  async stats() {
    const rows = await this.prisma.jobApplication.groupBy({ by: ["status"], _count: true });
    const total = rows.reduce((n, r) => n + r._count, 0);
    return {
      total,
      byStatus: Object.fromEntries(rows.map((r) => [r.status, r._count])),
    };
  }
}

/** Magic-byte check; see `sniff` in `media.service.ts` for why. */
function sniffDossier(buffer: Buffer, declared: string): string {
  const b = buffer;
  if (b.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  // .docx is a zip; .doc is an OLE compound file. Neither can be told apart
  // from another zip or OLE document by magic bytes alone, so the declared
  // type decides between them — acceptable because both are on the allowlist
  // and neither is ever served back to a browser.
  if (b.subarray(0, 2).toString("ascii") === "PK" && declared.includes("wordprocessingml")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (
    b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) &&
    declared === "application/msword"
  ) {
    return "application/msword";
  }
  return "application/octet-stream";
}
