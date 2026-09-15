import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ApplicationStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
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
    private readonly audit: AuditService,
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

    for (const file of files.slice(0, MAX_FILES)) {
      if (file.size > MAX_FILE_BYTES) {
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

    const retentionDays = await this.settings.value<number>("applications.retentionDays", 180);

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

    this.audit.record({
      action: "application.received",
      resource: "job_application",
      resourceId: application.id,
      after: { position: application.position, files: stored.length },
      ...ctx,
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

  async list(params: { status?: ApplicationStatus; search?: string; page?: number; perPage?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));

    const where: Prisma.JobApplicationWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              { firstName: { contains: params.search, mode: "insensitive" } },
              { lastName: { contains: params.search, mode: "insensitive" } },
              { email: { contains: params.search, mode: "insensitive" } },
              { position: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.jobApplication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.jobApplication.count({ where }),
    ]);

    return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
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

  async update(
    id: string,
    input: { status?: ApplicationStatus; note?: string },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const before = await this.prisma.jobApplication.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.jobApplication.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    this.audit.record({
      actor,
      action: "application.updated",
      resource: "job_application",
      resourceId: id,
      before: { status: before.status },
      after: { status: after.status },
      ...ctx,
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
  async remove(id: string, actor: AuthUser, ctx: Ctx) {
    const application = await this.prisma.jobApplication.findUniqueOrThrow({ where: { id } });
    for (const file of application.files as unknown as StoredFile[]) {
      await this.storage.delete(file.storageKey);
    }
    await this.prisma.jobApplication.delete({ where: { id } });
    this.audit.record({
      actor,
      action: "application.deleted",
      resource: "job_application",
      resourceId: id,
      // Name and position only. Deleting a record and then keeping its full
      // contents in the audit log would defeat the deletion.
      before: { position: application.position, name: `${application.firstName} ${application.lastName}` },
      ...ctx,
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
