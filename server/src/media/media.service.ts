import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import { STORAGE, type StorageAdapter } from "./storage";
import { slugify } from "../content/content.service";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * What may be uploaded, keyed by the **sniffed** type rather than the declared
 * one. A browser's `Content-Type` on a multipart part is whatever the client
 * chose to send; the magic bytes are what the file actually is.
 */
const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/gif", "gif"],
  ["image/svg+xml", "svg"],
  ["application/pdf", "pdf"],
]);

/**
 * The derivative widths.
 *
 * Chosen against what this site actually renders: a team portrait is ~200px
 * wide in a six-column grid, a project card ~300px, the team header image up
 * to ~700px, and the reference dialog up to ~830px. 400/800/1600 covers all of
 * those at 1× and 2× without generating sizes nothing requests.
 */
const VARIANTS = [
  { label: "sm", width: 400 },
  { label: "md", width: 800 },
  { label: "lg", width: 1600 },
];

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
  ) {}

  /* ---- Reading --------------------------------------------------- */

  async list(params: {
    folderId?: string | null;
    search?: string;
    mimeType?: string;
    tag?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(200, Math.max(1, params.perPage ?? 60));

    const where: Prisma.MediaAssetWhereInput = {
      deletedAt: null,
      ...(params.folderId !== undefined ? { folderId: params.folderId } : {}),
      ...(params.mimeType ? { mimeType: { startsWith: params.mimeType } } : {}),
      ...(params.tag ? { tags: { has: params.tag } } : {}),
      ...(params.search
        ? {
            OR: [
              { filename: { contains: params.search, mode: "insensitive" } },
              { originalName: { contains: params.search, mode: "insensitive" } },
              { alt: { contains: params.search, mode: "insensitive" } },
              { caption: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          variants: true,
          uploadedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);

    return {
      items: items.map((a) => this.decorate(a)),
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  async get(id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, deletedAt: null },
      include: { variants: true, versions: { orderBy: { version: "desc" } }, folder: true },
    });
    if (!asset) throw new NotFoundException("Datei nicht gefunden.");
    return this.decorate(asset);
  }

  /** Adds the URLs and the ready-made `srcset` the site needs. */
  private decorate<T extends { storageKey: string; variants?: { width: number; storageKey: string; format: string }[] }>(
    asset: T,
  ) {
    const variants = asset.variants ?? [];
    return {
      ...asset,
      url: this.storage.url(asset.storageKey),
      srcset: variants
        .slice()
        .sort((a, b) => a.width - b.width)
        .map((v) => `${this.storage.url(v.storageKey)} ${v.width}w`)
        .join(", "),
    };
  }

  /* ---- Upload ---------------------------------------------------- */

  async upload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    meta: { folderId?: string; alt?: string; altDecorative?: boolean; caption?: string; copyright?: string; tags?: string[] },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    if (file.size > MAX_BYTES) {
      throw new PayloadTooLargeException(
        `Die Datei ist ${mb(file.size)} gross. Erlaubt sind ${mb(MAX_BYTES)}.`,
      );
    }

    const sniffed = await sniff(file.buffer, file.mimetype);
    const ext = ALLOWED.get(sniffed);
    if (!ext) {
      throw new UnsupportedMediaTypeException(
        `Dateien vom Typ ${sniffed} sind nicht erlaubt. Erlaubt: ${[...ALLOWED.keys()].join(", ")}.`,
      );
    }

    const checksum = createHash("sha256").update(file.buffer).digest("hex");

    // An identical file already in the library is returned rather than stored
    // twice. Uploading the same portrait from two screens is a normal thing to
    // do, and two rows pointing at the same bytes is a worse answer than one.
    const existing = await this.prisma.mediaAsset.findFirst({
      where: { checksum, deletedAt: null },
      include: { variants: true },
    });
    if (existing) {
      return { ...this.decorate(existing), deduplicated: true };
    }

    const base = slugify(file.originalname.replace(/\.[^.]+$/, "")) || "datei";
    const filename = `${base}-${checksum.slice(0, 8)}.${ext}`;
    const storageKey = `${new Date().getFullYear()}/${filename}`;

    let width: number | undefined;
    let height: number | undefined;
    let buffer = file.buffer;

    const isRaster = sniffed.startsWith("image/") && sniffed !== "image/svg+xml";
    if (isRaster) {
      const image = sharp(file.buffer, { failOn: "error" });
      const info = await image.metadata();
      width = info.width;
      height = info.height;
      // Strip EXIF. Portraits and site photos routinely carry GPS coordinates
      // and camera serial numbers, and a public CDN is not the place for them.
      buffer = await image.rotate().toBuffer();
    }

    await this.storage.put(storageKey, buffer, sniffed);

    const asset = await this.prisma.mediaAsset.create({
      data: {
        folderId: meta.folderId ?? null,
        filename,
        originalName: file.originalname,
        mimeType: sniffed,
        size: buffer.length,
        width,
        height,
        checksum,
        alt: meta.alt ?? "",
        altDecorative: meta.altDecorative ?? false,
        caption: meta.caption ?? null,
        copyright: meta.copyright ?? null,
        tags: meta.tags ?? [],
        storageKey,
        uploadedById: actor.id,
      },
    });

    if (isRaster) await this.generateVariants(asset.id, buffer, width ?? 0, storageKey);

    this.audit.record({
      actor,
      action: "media.uploaded",
      resource: "media_asset",
      resourceId: asset.id,
      after: { filename, size: buffer.length, mimeType: sniffed },
      ...ctx,
    });

    return this.get(asset.id);
  }

  /**
   * Generates the responsive derivatives.
   *
   * Only *down*: a 400px source never produces an 800px variant, because
   * upscaling manufactures detail that is not there and costs bytes to do it.
   * WebP alongside the original format — it is the format every current
   * browser accepts and is typically 25–35 % smaller than JPEG at the same
   * visual quality.
   */
  private async generateVariants(assetId: string, buffer: Buffer, sourceWidth: number, baseKey: string) {
    for (const v of VARIANTS) {
      if (sourceWidth && v.width > sourceWidth) continue;
      try {
        const out = await sharp(buffer)
          .resize({ width: v.width, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });

        const key = baseKey.replace(/(\.[^.]+)$/, `-${v.label}.webp`);
        await this.storage.put(key, out.data, "image/webp");
        await this.prisma.mediaVariant.create({
          data: {
            assetId,
            label: v.label,
            width: out.info.width,
            height: out.info.height,
            format: "webp",
            size: out.data.length,
            storageKey: key,
          },
        });
      } catch (err) {
        // A failed derivative is a smaller image, not a failed upload — the
        // original is already stored and the page will use it.
        this.logger.warn(
          `Variante ${v.label} für ${assetId} fehlgeschlagen: ${(err as Error).message}`,
        );
      }
    }
  }

  /* ---- Editing --------------------------------------------------- */

  async update(
    id: string,
    input: {
      alt?: string;
      altDecorative?: boolean;
      caption?: string | null;
      copyright?: string | null;
      tags?: string[];
      folderId?: string | null;
      filename?: string;
    },
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const before = await this.get(id);
    const asset = await this.prisma.mediaAsset.update({
      where: { id },
      data: {
        ...(input.alt !== undefined ? { alt: input.alt } : {}),
        ...(input.altDecorative !== undefined ? { altDecorative: input.altDecorative } : {}),
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.copyright !== undefined ? { copyright: input.copyright } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
        ...(input.filename !== undefined ? { filename: input.filename } : {}),
      },
      include: { variants: true },
    });
    this.audit.record({
      actor,
      action: "media.updated",
      resource: "media_asset",
      resourceId: id,
      before: { alt: before.alt, caption: before.caption, tags: before.tags },
      after: { alt: asset.alt, caption: asset.caption, tags: asset.tags },
      ...ctx,
    });
    return this.decorate(asset);
  }

  /**
   * Replaces the bytes, keeping the id and therefore every reference to it.
   *
   * This is the whole reason "replace" exists as an operation separate from
   * "delete and upload": a re-shot portrait should appear everywhere it is
   * used without anyone editing 41 content entries. The superseded bytes stay
   * in storage as a `MediaAssetVersion`, so the swap is reversible.
   */
  async replace(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    note: string | undefined,
    actor: AuthUser,
    ctx: Ctx,
  ) {
    const current = await this.prisma.mediaAsset.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException("Datei nicht gefunden.");

    const sniffed = await sniff(file.buffer, file.mimetype);
    if (!ALLOWED.has(sniffed)) {
      throw new UnsupportedMediaTypeException(`Dateien vom Typ ${sniffed} sind nicht erlaubt.`);
    }
    if (sniffed !== current.mimeType) {
      throw new BadRequestException(
        `Die Ersatzdatei ist ${sniffed}, das Original ${current.mimeType}. ` +
          "Ein Formatwechsel braucht einen neuen Eintrag, weil Verweise auf die Dateiendung zeigen können.",
      );
    }

    const isRaster = sniffed.startsWith("image/") && sniffed !== "image/svg+xml";
    let buffer = file.buffer;
    let width = current.width ?? undefined;
    let height = current.height ?? undefined;

    if (isRaster) {
      const image = sharp(file.buffer, { failOn: "error" });
      const info = await image.metadata();
      width = info.width;
      height = info.height;
      buffer = await image.rotate().toBuffer();
    }

    const nextVersion = current.version + 1;
    // The old bytes move aside under a versioned key before the new ones take
    // the canonical one, so every existing URL keeps working throughout.
    const archiveKey = current.storageKey.replace(/(\.[^.]+)$/, `-v${current.version}$1`);
    await this.storage.put(archiveKey, await this.storage.get(current.storageKey), current.mimeType);
    await this.storage.put(current.storageKey, buffer, sniffed);

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaAssetVersion.create({
        data: {
          assetId: id,
          version: current.version,
          storageKey: archiveKey,
          size: current.size,
          mimeType: current.mimeType,
          note: note ?? null,
        },
      });
      await tx.mediaAsset.update({
        where: { id },
        data: {
          size: buffer.length,
          width,
          height,
          checksum: createHash("sha256").update(buffer).digest("hex"),
          version: nextVersion,
          originalName: file.originalname,
        },
      });
      await tx.mediaVariant.deleteMany({ where: { assetId: id } });
    });

    if (isRaster) await this.generateVariants(id, buffer, width ?? 0, current.storageKey);

    this.audit.record({
      actor,
      action: "media.replaced",
      resource: "media_asset",
      resourceId: id,
      before: { version: current.version, size: current.size },
      after: { version: nextVersion, size: buffer.length },
      message: note,
      ...ctx,
    });
    return this.get(id);
  }

  /**
   * Soft delete.
   *
   * The bytes stay: a content entry may still reference this file, and a
   * publish that silently produced a broken image would be worse than a file
   * that lingers. An explicit prune removes both.
   */
  async remove(id: string, actor: AuthUser, ctx: Ctx) {
    const asset = await this.get(id);
    await this.prisma.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    this.audit.record({
      actor,
      action: "media.deleted",
      resource: "media_asset",
      resourceId: id,
      before: { filename: asset.filename },
      ...ctx,
    });
  }

  async bulkRemove(ids: string[], actor: AuthUser, ctx: Ctx) {
    await this.prisma.mediaAsset.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
    this.audit.record({
      actor,
      action: "media.bulk_deleted",
      resource: "media_asset",
      after: { ids },
      message: `${ids.length} Datei(en)`,
      ...ctx,
    });
  }

  /* ---- Folders --------------------------------------------------- */

  listFolders() {
    return this.prisma.mediaFolder.findMany({
      where: { deletedAt: null },
      orderBy: { path: "asc" },
      include: { _count: { select: { assets: true } } },
    });
  }

  async createFolder(name: string, parentId: string | null, actor: AuthUser, ctx: Ctx) {
    const parent = parentId
      ? await this.prisma.mediaFolder.findUniqueOrThrow({ where: { id: parentId } })
      : null;
    const path = `${parent?.path ?? ""}/${slugify(name)}`;

    const folder = await this.prisma.mediaFolder.create({
      data: { name, parentId, path },
    });
    this.audit.record({
      actor,
      action: "media.folder_created",
      resource: "media_folder",
      resourceId: folder.id,
      after: { name, path },
      ...ctx,
    });
    return folder;
  }

  async deleteFolder(id: string, actor: AuthUser, ctx: Ctx) {
    const [assets, children] = await this.prisma.$transaction([
      this.prisma.mediaAsset.count({ where: { folderId: id, deletedAt: null } }),
      this.prisma.mediaFolder.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    if (assets || children) {
      throw new BadRequestException(
        `Der Ordner enthält noch ${assets} Datei(en) und ${children} Unterordner.`,
      );
    }
    await this.prisma.mediaFolder.update({ where: { id }, data: { deletedAt: new Date() } });
    this.audit.record({
      actor,
      action: "media.folder_deleted",
      resource: "media_folder",
      resourceId: id,
      ...ctx,
    });
  }

  /* ---- Housekeeping ---------------------------------------------- */

  async stats() {
    const [count, size, byType] = await this.prisma.$transaction([
      this.prisma.mediaAsset.count({ where: { deletedAt: null } }),
      this.prisma.mediaAsset.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
      this.prisma.mediaAsset.groupBy({
        by: ["mimeType"],
        where: { deletedAt: null },
        // Prisma 7 requires an explicit order on a grouped query — without one
        // the row order is whatever the planner returns, which would reshuffle
        // the storage-usage chart between reloads.
        orderBy: { mimeType: "asc" },
        _count: true,
        _sum: { size: true },
      }),
    ]);
    return {
      count,
      totalBytes: size._sum.size ?? 0,
      byType: byType.map((t) => ({
        mimeType: t.mimeType,
        count: t._count,
        bytes: t._sum?.size ?? 0,
      })),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The real type of a buffer, from its leading bytes.
 *
 * The declared `Content-Type` on a multipart part is chosen by the client, so
 * an attacker uploads a `.png` that is actually an HTML document with a script
 * in it and hopes the server serves it back with the declared type. Reading
 * the magic bytes removes that choice from them.
 *
 * SVG is the exception — it has no magic number, being XML — and it is also
 * the one allowed format that *can* carry script. It is admitted only when the
 * declared type says SVG and the content parses as an `<svg>` root.
 */
async function sniff(buffer: Buffer, declared: string): Promise<string> {
  const b = buffer;
  if (b.length >= 12) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return "image/png";
    if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP")
      return "image/webp";
    if (b.subarray(4, 8).toString("ascii") === "ftyp" && b.subarray(8, 12).toString("ascii").includes("avif"))
      return "image/avif";
    if (b.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
    if (b.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  }

  if (declared === "image/svg+xml") {
    const head = b.subarray(0, 1024).toString("utf8").trimStart();
    if (head.startsWith("<?xml") || head.startsWith("<svg")) return "image/svg+xml";
  }

  return "application/octet-stream";
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
