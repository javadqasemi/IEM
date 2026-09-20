import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventBus } from "../events/event-bus";
import { VersioningService } from "../versioning/versioning.service";
import { VERSION_CONTROL_FIELDS, changedFields } from "../versioning/changed";
import type { AuthUser } from "../../common/decorators";
import { OrganisationRepository, ORG_ID } from "./organisation.repository";
import {
  toOffice,
  toOfficeCreateData,
  toOfficeUpdateData,
  toOrganisation,
  toOrganisationAudit,
  toOrganisationUpdateData,
  toSiteOffices,
} from "./organisation.mapper";
import {
  officeWarnings,
  refuseArchiveOffice,
  refuseDeleteOffice,
  refuseHeadquartersChange,
  refuseUid,
  refuseVatId,
  uidMismatchWarning,
  type OfficeFacts,
  type SiteOffice,
} from "./organisation.rules";
import type {
  CreateOfficeInput,
  OrganisationInput,
  UpdateOfficeInput,
} from "./organisation.types";

/**
 * The firm's own record.
 *
 * **In `core/`, not in the feature folder, and that placement is the rule
 * rather than a convenience.** Two callers outside `organisation/` need it:
 * `MailService` resolves the sender name from the company name, and
 * `ContentService` builds the published document's `offices` from this table.
 * CLAUDE.md states it plainly — *"when a new service is going to be injected by
 * more than the feature it sits in, it belongs in `core/` before the second
 * caller appears, not after"* — and `audit/` and `settings/` are the two
 * folders that learned it the other way round. The controller and its
 * class-validator DTOs stay in `organisation/`, which is the same split
 * `settings/settings.controller.module.ts` is named for.
 *
 * Everything else follows the Projects reference: rules are pure and live in
 * `organisation.rules.ts`, queries are the repository's, the optimistic lock is
 * one `updateMany`, the history goes into `EntityVersion` inside the same
 * transaction as the write, and **no audit row is written here** — the events
 * are, and `AuditListener` derives the rows from them.
 */
@Injectable()
export class OrganisationService {
  constructor(
    private readonly repo: OrganisationRepository,
    private readonly events: EventBus,
    private readonly versions: VersioningService,
  ) {}

  /* ================================================================ */
  /* Reads                                                             */
  /* ================================================================ */

  async get() {
    return toOrganisation(await this.repo.get());
  }

  /**
   * The company facts other server code needs, in one read.
   *
   * Deliberately narrow: `MailService` wants a sender name and nothing else,
   * and handing it the whole record would make every future field a thing the
   * mail layer could accidentally depend on.
   */
  async identity(): Promise<{ name: string; shortName: string; legalName: string | null }> {
    const row = await this.repo.get();
    return { name: row.name, shortName: row.shortName, legalName: row.legalName };
  }

  async offices() {
    return (await this.repo.listOffices()).map(toOffice);
  }

  async office(id: string) {
    const row = await this.repo.findOffice(id);
    if (!row) throw new NotFoundException("Standort nicht gefunden.");
    return toOffice(row);
  }

  /**
   * The `offices` array the published document carries.
   *
   * This is the single-source-of-truth join: `ContentService` calls it while
   * building a snapshot, so the website's header telephone number, contact
   * band, Standorte section and the `{telefonThun}` / `{standorte}` tokens all
   * resolve to these rows. Before it, the same facts existed as a separate
   * `offices` content type and the two had already drifted — the seed said
   * Thun was at Bierigutstrasse 6 while the live site said Uttigenstrasse 49.
   */
  async siteOffices(): Promise<SiteOffice[]> {
    return toSiteOffices(await this.repo.listOffices());
  }

  /** What a publish should warn about, asked early enough to be actionable. */
  async publishWarnings(): Promise<string[]> {
    return officeWarnings(await this.siteOffices());
  }

  /* ================================================================ */
  /* Writes                                                            */
  /* ================================================================ */

  /**
   * One PATCH for the whole record, with the legal half gated inside.
   *
   * The permission split could not be two routes: a form that saves general
   * and legal fields in one request has to be authorised as one request, and
   * splitting it would mean the client deciding which half to send — a decision
   * a client must never be trusted with. `@RequirePermissions` is AND and
   * cannot ask "only if the body touches these fields", so the check is in the
   * controller before this is called. That is the documented `◐` pattern from
   * `docs/permissions.md` §4, and `permissions.agreement.test.ts` counts it.
   */
  async update(input: OrganisationInput, actor: AuthUser) {
    const uidError = refuseUid(input.uid) ?? refuseVatId(input.vatId);
    if (uidError) throw new BadRequestException(uidError);

    const current = await this.repo.get();
    const before = toOrganisationAudit(current);
    /*
      `changedFields` with the *ignore* list, not an allow list — the second
      argument is what to leave out. A validated DTO carries every declared
      property under ES2022 class-field semantics, so `Object.keys` here would
      report all thirty-six fields for a request that changed one, and every
      row of the Verlauf would say so. See the note on `changedFields`.
    */
    const fields = changedFields(input, VERSION_CONTROL_FIELDS);

    if (fields.length === 0) {
      // Not an error — a form that saves with nothing changed should not
      // produce a version row saying so, and should not bump the lock under
      // whoever else has the record open.
      return { organisation: toOrganisation(current), warnings: [] as string[] };
    }

    const row = await this.repo.transaction(async (tx) => {
      const changed = await this.repo.updateIfUnchanged(
        input.expectedVersion,
        toOrganisationUpdateData(input, actor.id),
        tx,
      );
      if (changed === 0) await this.refuseStale(input.expectedVersion);

      const updated = await this.repo.get(tx);
      await this.versions.record(tx, {
        entity: "organisation",
        entityId: ORG_ID,
        version: input.expectedVersion + 1,
        data: toOrganisationAudit(updated),
        changed: fields,
      });
      return updated;
    });

    this.events.publish("OrganisationUpdated", {
      entity: "organisation",
      entityId: ORG_ID,
      payload: { fields },
      before,
      after: toOrganisationAudit(row),
    });

    /*
      A warning, beside the saved record rather than instead of it.

      The UID and the MWST number are the same number wearing a suffix, and a
      firm whose Impressum and invoices disagree looks careless — but refusing
      the save would make the correct data impossible to enter in the window
      where only one of the two is known. Same shape as the Planversand's
      `priorIssueWarnings`: the dialog becomes a report rather than closing.
    */
    const mismatch = uidMismatchWarning(row.uid, row.vatId);
    return { organisation: toOrganisation(row), warnings: mismatch ? [mismatch] : [] };
  }

  private async refuseStale(expected: number): Promise<never> {
    const now = await this.repo.versionOf();
    if (now === null) throw new NotFoundException("Unternehmensangaben nicht gefunden.");
    // A **singular** label: `VersioningService.conflict` templates
    // `${label} wurde inzwischen geändert`, so "Die Unternehmensangaben"
    // produced "Die Unternehmensangaben wurde". Every other caller passes a
    // singular noun for the same reason.
    throw VersioningService.conflict("Das Unternehmen", now, null, expected);
  }

  /* ---- Offices ----------------------------------------------------- */

  async createOffice(input: CreateOfficeInput, actor: AuthUser) {
    const row = await this.repo.transaction(async (tx) => {
      const created = await this.repo.createOffice(toOfficeCreateData(input, actor.id), tx);
      if (created.isHeadquarters) {
        await this.repo.demoteOtherHeadquarters(created.id, tx);
      }
      await this.versions.record(tx, {
        entity: "office",
        entityId: created.id,
        version: 1,
        data: toOffice(created),
        changed: [],
      });
      return created;
    });

    this.events.publish("OfficeCreated", {
      entity: "office",
      entityId: row.id,
      payload: { name: row.name, city: row.city },
      after: toOffice(row),
    });

    return toOffice(row);
  }

  async updateOffice(id: string, input: UpdateOfficeInput, actor: AuthUser) {
    const current = await this.repo.findOffice(id);
    if (!current) throw new NotFoundException("Standort nicht gefunden.");

    if (input.isHeadquarters !== undefined) {
      const all = await this.facts();
      const error = refuseHeadquartersChange(facts(current), input.isHeadquarters, all);
      if (error) throw new BadRequestException(error);
    }

    const before = toOffice(current);
    const fields = changedFields(input, VERSION_CONTROL_FIELDS);
    if (fields.length === 0) return before;

    const row = await this.repo.transaction(async (tx) => {
      const changed = await this.repo.updateOfficeIfUnchanged(
        id,
        input.expectedVersion,
        toOfficeUpdateData(input, actor.id),
        tx,
      );
      if (changed === 0) await this.refuseStaleOffice(id, input.expectedVersion);

      if (input.isHeadquarters === true) {
        await this.repo.demoteOtherHeadquarters(id, tx);
      }

      const updated = await this.repo.findOffice(id, tx);
      if (!updated) throw new NotFoundException("Standort nicht gefunden.");

      await this.versions.record(tx, {
        entity: "office",
        entityId: id,
        version: input.expectedVersion + 1,
        data: toOffice(updated),
        changed: fields,
      });
      return updated;
    });

    this.events.publish("OfficeUpdated", {
      entity: "office",
      entityId: id,
      payload: { name: row.name, fields },
      before,
      after: toOffice(row),
    });

    return toOffice(row);
  }

  private async refuseStaleOffice(id: string, expected: number): Promise<never> {
    const now = await this.repo.officeVersionOf(id);
    if (now === null) throw new NotFoundException("Standort nicht gefunden.");
    throw VersioningService.conflict("Der Standort", now, null, expected);
  }

  async archiveOffice(id: string, archived: boolean) {
    const current = await this.repo.findOffice(id);
    if (!current) throw new NotFoundException("Standort nicht gefunden.");

    if (archived) {
      const error = refuseArchiveOffice(facts(current), await this.facts());
      if (error) throw new BadRequestException(error);
    } else if (!current.archivedAt) {
      throw new BadRequestException(`„${current.name}“ ist nicht archiviert.`);
    }

    await this.repo.transaction((tx) =>
      this.repo.setArchived(id, archived ? new Date() : null, tx),
    );

    this.events.publish(archived ? "OfficeArchived" : "OfficeRestored", {
      entity: "office",
      entityId: id,
      payload: { name: current.name },
    });

    return this.office(id);
  }

  async deleteOffice(id: string) {
    const current = await this.repo.findOffice(id);
    if (!current) throw new NotFoundException("Standort nicht gefunden.");

    const error = refuseDeleteOffice(
      facts(current),
      await this.repo.officeReferences(id),
      await this.facts(),
    );
    if (error) throw new BadRequestException(error);

    await this.repo.transaction((tx) => this.repo.softDeleteOffice(id, new Date(), tx));

    this.events.publish("OfficeDeleted", {
      entity: "office",
      entityId: id,
      payload: { name: current.name },
      before: toOffice(current),
    });

    return { deleted: true };
  }

  /** The offices as the rules see them — id, flags, nothing else. */
  private async facts(): Promise<OfficeFacts[]> {
    return (await this.repo.listOffices()).map(facts);
  }

  async counts() {
    return this.repo.counts();
  }
}

function facts(row: {
  id: string;
  name: string;
  isHeadquarters: boolean;
  isPublic: boolean;
  archivedAt: Date | string | null;
}): OfficeFacts {
  return {
    id: row.id,
    name: row.name,
    isHeadquarters: row.isHeadquarters,
    isPublic: row.isPublic,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
  };
}
