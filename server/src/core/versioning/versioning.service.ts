import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Prisma, type RevisionScheme } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { correlationId, currentContext } from "../context/request-context";
import { revisionLabel } from "./revision";

/**
 * Recording what a business record looked like, and refusing a stale write.
 *
 * Foundation stage F13, and the two halves are less related than they look —
 * which is why both are here rather than in two services:
 *
 * **The history** answers *what did this look like in March*, which is a
 * question an engineering office is asked by clients, by insurers and
 * occasionally by a court. The audit log answers *who changed what* and is a
 * different document: it records the change, not the state, and reconstructing
 * a record from a hundred audit rows is not something anybody will do under
 * pressure.
 *
 * **The lock** answers *did somebody else save while I had this open*, and it is
 * the half that pays for itself immediately. Without it the second save wins
 * silently and the first person's work is gone with nothing anywhere recording
 * that it existed — the one data-loss bug a user cannot detect, report or work
 * around.
 *
 * They are one service because the version number does both jobs: the thing
 * shown as `v12` is the same integer the `WHERE` clause matches on. Splitting
 * them would mean two numbers that must agree.
 */
@Injectable()
export class VersioningService {
  private readonly logger = new Logger(VersioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one state of one record.
   *
   * **Takes a transaction client**, and callers are expected to pass the one
   * they are already in. A version written outside the transaction that
   * produced it is a version of a row that may yet roll back — the history
   * would then contain a state that never existed, which is worse than a
   * history with a gap.
   *
   * `data` is the record as the API returns it: mapped, with `Decimal`s already
   * strings and dates already ISO. Storing the Prisma row instead would put
   * `{"s":1,"e":6,"d":[…]}` in a document somebody reads in five years, and
   * would tie the history to a schema that has since changed.
   */
  async record(
    tx: Prisma.TransactionClient,
    input: {
      entity: string;
      entityId: string;
      version: number;
      scheme?: RevisionScheme;
      data: unknown;
      /** Which fields the writer touched. Drives the history's one-line summary. */
      changed?: string[];
      note?: string | null;
    },
  ): Promise<void> {
    const scheme = input.scheme ?? "NUMERIC";
    const context = currentContext();

    await tx.entityVersion.create({
      data: {
        entity: input.entity,
        entityId: input.entityId,
        version: input.version,
        scheme,
        label: revisionLabel(scheme, input.version),
        data: input.data as Prisma.InputJsonValue,
        changed: input.changed ?? [],
        note: input.note ?? null,
        changedById: context?.actor?.id ?? null,
        changedByEmail: context?.actor?.email ?? null,
        changedByName: context?.actor?.name ?? null,
        correlationId: correlationId(),
      },
    });
  }

  /**
   * The history of one record, newest first.
   *
   * Without the payloads by default. A project's version list is a screen of
   * twenty rows and each `data` blob is several kilobytes — sending them all so
   * that one might be opened is the same mistake as an unpaginated list.
   */
  async history(entity: string, entityId: string, limit = 50) {
    const rows = await this.prisma.entityVersion.findMany({
      where: { entity, entityId },
      orderBy: { version: "desc" },
      take: limit,
      select: {
        id: true,
        version: true,
        label: true,
        changed: true,
        note: true,
        changedById: true,
        changedByEmail: true,
        changedByName: true,
        correlationId: true,
        createdAt: true,
      },
    });
    return rows;
  }

  /** One recorded state, in full. The only call that returns a payload. */
  async at(entity: string, entityId: string, version: number) {
    return this.prisma.entityVersion.findUnique({
      where: { entity_entityId_version: { entity, entityId, version } },
    });
  }

  /**
   * The message a stale write gets.
   *
   * A `ConflictException` — HTTP 409 — and **not** a 400 or a silent overwrite.
   * The status matters because the client has to tell these apart: a 400 means
   * "fix your input", a 409 means "somebody else got there first, here is what
   * they changed". They are different screens.
   *
   * The message names the person when it can. "Geändert von Anna Meier" turns
   * an error into a conversation; "Konflikt" turns it into a support ticket.
   */
  static conflict(
    label: string,
    current: number,
    by?: string | null,
    expected?: number,
  ): ConflictException {
    const who = by ? ` von ${by}` : "";
    // Both versions when the caller's is known. "Sie hatten v3, es steht auf v5"
    // tells the reader how far behind they are, which is the difference between
    // reloading and wondering how much they lost.
    const gap = expected === undefined ? `jetzt v${current}` : `Sie hatten v${expected}, jetzt v${current}`;
    return new ConflictException(
      `${label} wurde inzwischen${who} geändert (${gap}). ` +
        `Bitte die Ansicht neu laden — Ihre Änderungen würden sonst die neueren überschreiben.`,
    );
  }
}
