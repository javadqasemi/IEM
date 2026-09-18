import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ProjectStatus } from "@prisma/client";
import { EventBus } from "../core/events/event-bus";
import type { AuthUser } from "../common/decorators";
import type { RawListQuery } from "../core/list/list.decorator";
import { paginated } from "../core/list/list";
import { ProjectsRepository } from "./projects.repository";
import { scopeFor, seesAllProjects } from "./projects.scope";
import {
  toAuditSnapshot,
  toDate,
  toMilestone,
  toMoney,
  toProjectCreateData,
  toProjectDetail,
  toProjectExportRow,
  toProjectListItem,
  toProjectUpdateData,
} from "./projects.mapper";
import {
  deriveHealth,
  deriveProgress,
  formatProjectNumber,
  isTerminal,
  nextSequence,
  refuseDates,
  refuseFeeShares,
  refuseTransition,
  transitionsFrom,
} from "./projects.rules";
import type {
  AddMemberDto,
  BulkProjectsDto,
  ChangeStatusDto,
  CreateMilestoneDto,
  CreateProjectDto,
  ScopeDisciplineDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from "./projects.dto";

/**
 * Orchestration: rules, transactions and events. **No queries, no Prisma.**
 *
 * The service holds a `ProjectsRepository` and an `EventBus` and nothing else.
 * It imports **no `PrismaService`, no `Prisma` namespace and no `Decimal`** —
 * only the enum *types*, which are the domain's vocabulary rather than a
 * persistence detail. `architecture.test.ts` asserts the first three, because
 * this is the layer that decays: a service with a `PrismaService` in scope
 * grows one convenient `findFirst`, then a second, and within a release the
 * rules cannot be reasoned about — or tested — without a database.
 *
 * What it does own:
 *
 * - **Deciding**, by calling `projects.rules.ts`, which is pure and tested on
 *   its own.
 * - **Transactions**, where a rule spans two writes.
 * - **Announcing**, by publishing domain events. It writes **no audit rows**:
 *   `AuditListener` derives them from the events, so a module that raises its
 *   events correctly is audited without a line of audit code. The rule, from
 *   `audit.listener.ts`: events describe things that happened to records;
 *   direct audit calls describe things that happened to nobody.
 *
 * **The derived figures are recomputed here, on every write that can move
 * them.** `progressPercent` and `health` are stored — see the schema — and the
 * discipline that keeps a stored derivation honest is that exactly one place
 * writes it. `recompute()` is that place, `projects.reconcile.ts` runs it
 * nightly over everything, and a test asserts the two agree.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly events: EventBus,
  ) {}

  /* ================================================================ */
  /* Reads                                                             */
  /* ================================================================ */

  async list(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const { items, total } = await this.repo.list(params, await this.scope(user));
    return paginated(items.map(toProjectListItem), total, params);
  }

  async exportRows(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const rows = await this.repo.listAll(params, await this.scope(user));
    return rows.map(toProjectExportRow);
  }

  async detail(id: string, user: AuthUser) {
    const row = await this.repo.findDetail(id, await this.scope(user));
    if (!row) throw new NotFoundException("Projekt nicht gefunden.");
    return {
      ...toProjectDetail(row),
      /**
       * The transitions this project can make *right now*, sent with it.
       *
       * So the status dropdown offers exactly what the server would accept.
       * The alternative is the client holding a second copy of the transition
       * table, which is the drift the table was made data to avoid — and the
       * client's copy is the one that goes stale, because nothing fails when
       * it does.
       */
      allowedTransitions: transitionsFrom(row.status),
    };
  }

  async stats(user: AuthUser) {
    const rows = await this.repo.countByStatus(await this.scope(user));
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row.status] = row._count._all;
    return { byStatus, total: rows.reduce((sum, row) => sum + row._count._all, 0) };
  }

  /* ================================================================ */
  /* Writes                                                            */
  /* ================================================================ */

  async create(dto: CreateProjectDto, user: AuthUser) {
    const dateError = refuseDates(toDate(dto.startDate), toDate(dto.plannedEndDate));
    if (dateError) throw new BadRequestException(dateError);

    const missing = await this.repo.missingReferences(dto);
    if (missing.length) {
      throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);
    }

    /*
      The number, allocated from the year already issued.

      There is a race here and it is worth naming rather than pretending
      otherwise: two creates in the same millisecond can read the same maximum
      and both try `P-2026-014`. The `@unique` column is what actually decides
      — the loser gets a constraint violation, retries once, and takes 015. A
      counter table would remove the retry and add a hot row that every create
      serialises on; at this firm's rate (some tens of projects a year) the
      constraint is the right mechanism and the retry never runs.
    */
    const year = new Date().getFullYear();
    const numbers = await this.repo.numbersForYear(year);
    const number = formatProjectNumber(year, nextSequence(numbers, year));

    const row = await this.repo.create(
      toProjectCreateData({ ...dto, number, name: dto.name, customerId: dto.customerId }, user.id),
    );

    this.events.publish("ProjectCreated", {
      entity: "project",
      entityId: row.id,
      payload: { number: row.number, name: row.name, customerId: dto.customerId },
      after: { number: row.number, name: row.name, status: row.status },
    });

    return { ...toProjectDetail(row), allowedTransitions: transitionsFrom(row.status) };
  }

  async update(id: string, dto: UpdateProjectDto, user: AuthUser) {
    const current = await this.require(id, user);
    this.refuseWhenArchived(current.status);

    // The *resulting* dates, not the submitted ones: a body that moves only the
    // end date has to be checked against the start date already stored.
    const startDate = dto.startDate === undefined ? current.startDate : toDate(dto.startDate);
    const plannedEndDate =
      dto.plannedEndDate === undefined ? current.plannedEndDate : toDate(dto.plannedEndDate);
    const dateError = refuseDates(startDate, plannedEndDate);
    if (dateError) throw new BadRequestException(dateError);

    const missing = await this.repo.missingReferences(dto);
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    const before = toAuditSnapshot(current);
    const row = await this.repo.update(id, toProjectUpdateData(dto, user.id));

    /*
      `fields`, not the whole body.

      A workflow rule that wants to react to "somebody changed the deadline"
      needs to know which field moved, and an event carrying only `after` makes
      every listener diff it themselves. The `before`/`after` pair is still on
      the envelope — that is what the audit row stores.
    */
    this.events.publish("ProjectUpdated", {
      entity: "project",
      entityId: id,
      payload: { number: current.number, fields: Object.keys(dto) },
      before,
      after: toAuditSnapshot(row),
    });

    await this.recompute(id);
    return this.detail(id, user);
  }

  /**
   * The transition, which is a different act from an edit.
   *
   * Its own route, its own permission and its own event — see the note on
   * `UpdateProjectDto`. The precondition check and the write are **not** in a
   * transaction, deliberately: `refuseTransition` reads only this project's own
   * rows, and the worst a concurrent write can do is let two people set the
   * same status. Wrapping it would take a row lock on every status change to
   * prevent an outcome that is already idempotent.
   */
  async changeStatus(id: string, dto: ChangeStatusDto, user: AuthUser) {
    const current = await this.require(id, user);

    /*
      The second permission, checked here rather than on the route.

      `project.update` opens the status route; closing a project is a different
      act from moving its deadline, and `project.archive` is what a
      Projektleiter needs to finish their own work without also being able to
      delete anything. It cannot be a `@RequirePermissions` because one route
      serves every transition and only two of them are terminal — which is the
      case `permissions.md` calls a rule inside a handler, and the agreement
      test reads `permissions.has(...)` as enforcement precisely so that this
      key does not read as dead.
    */
    const terminal = dto.status === "COMPLETED" || dto.status === "ARCHIVED";
    if (terminal && !user.isSuperAdmin && !user.permissions.has("project.archive")) {
      throw new ForbiddenException(
        "Zum Abschliessen oder Archivieren eines Projekts fehlt die Berechtigung.",
      );
    }

    const refusal = refuseTransition(current.status, dto.status, {
      managerId: current.managerId,
      startDate: current.startDate,
      milestones: current.milestones,
    });
    if (refusal) throw new BadRequestException(refusal);
    if (current.status === dto.status) return this.detail(id, user);

    const archiving = dto.status === "ARCHIVED";
    const completing = dto.status === "COMPLETED";

    await this.repo.update(id, {
      status: dto.status,
      updatedById: user.id,
      archivedAt: archiving ? new Date() : undefined,
      // The date the work actually stopped, stamped by the transition rather
      // than typed: "when did we finish" should not be a field somebody
      // remembers to fill in.
      actualEndDate: completing ? new Date() : undefined,
    });

    this.events.publish("ProjectStatusChanged", {
      entity: "project",
      entityId: id,
      payload: { number: current.number, from: current.status, to: dto.status },
      before: { status: current.status },
      after: { status: dto.status },
      message: dto.reason,
    });

    if (archiving) {
      this.events.publish("ProjectArchived", {
        entity: "project",
        entityId: id,
        payload: { number: current.number },
      });
    }

    await this.recompute(id);
    return this.detail(id, user);
  }

  /**
   * Deletion, which is refused more often than it succeeds.
   *
   * A project with hours or invoices booked against it is **archived, never
   * deleted** — `docs/data-model.md` §3.8. Those tables do not exist yet
   * (Waves 2 and 3), so the check that will refuse is not written; what is
   * written is the refusal that already applies, and the guard is stated here
   * so the day `TimeEntry` arrives the missing clause is findable rather than
   * forgotten.
   */
  async remove(id: string, user: AuthUser) {
    const current = await this.require(id, user);

    if (current.status === "ACTIVE" || current.status === "ON_HOLD") {
      throw new BadRequestException(
        "Ein laufendes Projekt kann nicht gelöscht werden. Abschliessen oder abbrechen.",
      );
    }

    await this.repo.softDelete(id, new Date());

    this.events.publish("ProjectDeleted", {
      entity: "project",
      entityId: id,
      payload: { number: current.number, name: current.name },
      before: toAuditSnapshot(current),
    });

    return { ok: true };
  }

  /**
   * The list contract's bulk action.
   *
   * Priority and nothing else, on purpose. A bulk *status* change would run
   * `refuseTransition` two hundred times and either fail the whole request on
   * one bad row or half-apply it — and "half of what you selected changed" is
   * the worst possible answer. A field with no preconditions is what bulk
   * editing is actually for.
   */
  async bulkPriority(dto: BulkProjectsDto, user: AuthUser) {
    const scope = await this.scope(user);
    let changed = 0;
    for (const id of dto.ids) {
      const row = await this.repo.findDetail(id, scope);
      if (!row || isTerminal(row.status)) continue;
      await this.repo.update(id, { priority: dto.priority, updatedById: user.id });
      this.events.publish("ProjectUpdated", {
        entity: "project",
        entityId: id,
        payload: { number: row.number, fields: ["priority"] },
        before: { priority: row.priority },
        after: { priority: dto.priority },
      });
      changed += 1;
    }
    return { changed, requested: dto.ids.length };
  }

  /* ================================================================ */
  /* Team                                                              */
  /* ================================================================ */

  async addMember(projectId: string, dto: AddMemberDto, user: AuthUser) {
    const project = await this.require(projectId, user);
    this.refuseWhenArchived(project.status);

    if (!(await this.repo.employeeExists(dto.employeeId))) {
      throw new BadRequestException("Unbekannte Person.");
    }

    const from = toDate(dto.from) ?? new Date();
    const to = toDate(dto.to);
    if (to && to.getTime() <= from.getTime()) {
      throw new BadRequestException("Das Ende der Mitarbeit muss nach dem Beginn liegen.");
    }

    const member = await this.repo.addMember({
      projectId,
      employeeId: dto.employeeId,
      role: dto.role ?? "ENGINEER",
      allocationPercent: dto.allocationPercent ?? 100,
      from,
      to,
    });

    this.events.publish("ProjectMemberAdded", {
      entity: "project_member",
      entityId: member.id,
      payload: { projectId, employeeId: dto.employeeId, role: member.role },
      after: { role: member.role, allocationPercent: member.allocationPercent },
    });

    return this.detail(projectId, user);
  }

  async removeMember(projectId: string, memberId: string, user: AuthUser) {
    const project = await this.require(projectId, user);
    this.refuseWhenArchived(project.status);

    const member = await this.repo.findMember(memberId);
    // The `projectId` comparison is the guard, not decoration: without it,
    // `DELETE /projects/<one I can see>/members/<id from another>` removes a
    // row the caller has no access to. A nested route's parent must be checked
    // against the child, every time.
    if (!member || member.projectId !== projectId) {
      throw new NotFoundException("Teammitglied nicht gefunden.");
    }

    await this.repo.removeMember(memberId, new Date());

    this.events.publish("ProjectMemberRemoved", {
      entity: "project_member",
      entityId: memberId,
      payload: { projectId, employeeId: member.employeeId },
      before: { role: member.role },
    });

    return this.detail(projectId, user);
  }

  /* ================================================================ */
  /* Gewerke                                                           */
  /* ================================================================ */

  async scopeDiscipline(projectId: string, dto: ScopeDisciplineDto, user: AuthUser) {
    const project = await this.require(projectId, user);
    this.refuseWhenArchived(project.status);

    const discipline = await this.repo.disciplineExists(dto.disciplineId);
    if (!discipline) throw new BadRequestException("Unbekanntes Gewerk.");

    /*
      The fee-share rule is checked against the *result*, which is why the
      existing rows are read and the incoming one substituted rather than
      simply added. A correction that lowers one Gewerk's share from 60 to 30
      must not be refused because 60 + the others already exceeded 100.
    */
    const existing = await this.repo.feeSharesFor(projectId);
    const proposed = existing
      .filter((row) => row.disciplineId !== dto.disciplineId)
      .map((row) => ({
        feeShare: row.feeShare === null ? null : Number(row.feeShare),
        feeShareOverride: row.feeShareOverride,
      }));
    proposed.push({
      feeShare: dto.feeShare ?? null,
      feeShareOverride: dto.feeShareOverride ?? false,
    });

    const refusal = refuseFeeShares(proposed);
    if (refusal) throw new BadRequestException(refusal);

    const row = await this.repo.upsertDiscipline(projectId, dto.disciplineId, {
      status: dto.status ?? "PLANNED",
      leadEngineerId: dto.leadEngineerId ?? null,
      feeShare: dto.feeShare ?? null,
      feeShareOverride: dto.feeShareOverride ?? false,
      budgetHours: dto.budgetHours ?? null,
      budgetCost: toMoney(dto.budgetCost, "Budget"),
      hourlyRate: toMoney(dto.hourlyRate, "Stundensatz"),
      scopeNote: dto.scopeNote ?? null,
    });

    this.events.publish("ProjectDisciplineScoped", {
      entity: "project_discipline",
      entityId: row.id,
      payload: { projectId, code: discipline.code, status: row.status },
      after: { status: row.status, feeShare: dto.feeShare ?? null },
    });

    return this.detail(projectId, user);
  }

  /* ================================================================ */
  /* Meilensteine                                                      */
  /* ================================================================ */

  async listMilestones(projectId: string, query: RawListQuery, user: AuthUser) {
    await this.require(projectId, user);
    const params = this.repo.parseMilestoneList(query);
    const { items, total } = await this.repo.listMilestones(projectId, params);
    return paginated(items.map(toMilestone), total, params);
  }

  async createMilestone(projectId: string, dto: CreateMilestoneDto, user: AuthUser) {
    const project = await this.require(projectId, user);
    this.refuseWhenArchived(project.status);

    await this.repo.createMilestone({
      projectId,
      name: dto.name,
      dueDate: toDate(dto.dueDate)!,
      phase: dto.phase ?? null,
      isBillingTrigger: dto.isBillingTrigger ?? false,
    });

    // No event: creating a milestone is a planning edit, not a thing that
    // happened to the project. `MilestoneReached` and `MilestoneMissed` are the
    // two facts other modules care about, and both come from `updateMilestone`.
    await this.recompute(projectId);
    return this.detail(projectId, user);
  }

  async updateMilestone(
    projectId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
    user: AuthUser,
  ) {
    const project = await this.require(projectId, user);
    this.refuseWhenArchived(project.status);

    const milestone = await this.repo.findMilestone(milestoneId);
    if (!milestone || milestone.projectId !== projectId) {
      throw new NotFoundException("Meilenstein nicht gefunden.");
    }

    const reaching = dto.status === "MET" && milestone.status !== "MET";
    const missing = dto.status === "MISSED" && milestone.status !== "MISSED";

    const updated = await this.repo.updateMilestone(milestoneId, {
      name: dto.name,
      dueDate: dto.dueDate === undefined ? undefined : toDate(dto.dueDate)!,
      status: dto.status,
      phase: dto.phase === undefined ? undefined : dto.phase,
      isBillingTrigger: dto.isBillingTrigger,
      // Stamped by the transition rather than typed, for the same reason
      // `actualEndDate` is: the date a commitment was met is not a field.
      metAt: reaching ? new Date() : dto.status && dto.status !== "MET" ? null : undefined,
    });

    if (reaching) {
      this.events.publish("MilestoneReached", {
        entity: "milestone",
        entityId: milestoneId,
        payload: {
          projectId,
          name: updated.name,
          isBillingTrigger: updated.isBillingTrigger,
        },
        before: { status: milestone.status },
        after: { status: updated.status, metAt: updated.metAt },
      });
    }
    if (missing) {
      this.events.publish("MilestoneMissed", {
        entity: "milestone",
        entityId: milestoneId,
        payload: {
          projectId,
          name: updated.name,
          dueDate: updated.dueDate.toISOString(),
        },
        before: { status: milestone.status },
        after: { status: updated.status },
      });
    }

    await this.recompute(projectId);
    return this.detail(projectId, user);
  }

  /* ================================================================ */
  /* The derived figures                                               */
  /* ================================================================ */

  /**
   * Recompute `progressPercent` and `health`, and write them if they moved.
   *
   * **The only writer of either.** Called after every write that can move them,
   * and by `ProjectsReconciler` nightly over every live project — because two
   * of the inputs are *time*, not data: a project with no writes at all goes
   * amber on its own as its deadline approaches, and a per-write recomputation
   * would never notice.
   *
   * The write is skipped when nothing changed. Not for the query saved, but for
   * `updatedAt`: touching the row would move the project to the top of the
   * default sort every night, and the list's whole promise is "what you were
   * last working on".
   */
  async recompute(id: string): Promise<boolean> {
    const project = await this.repo.findForRules(id);
    if (!project) return false;

    const progressPercent = deriveProgress(project.milestones);
    const health = deriveHealth({
      status: project.status,
      progressPercent,
      startDate: project.startDate,
      plannedEndDate: project.plannedEndDate,
      milestones: project.milestones,
    });

    if (progressPercent === project.progressPercent && health === project.health) return false;
    await this.repo.update(id, { progressPercent, health });
    return true;
  }

  /* ================================================================ */
  /* Shared                                                            */
  /* ================================================================ */

  /**
   * The caller's visibility, as a `where` fragment.
   *
   * Resolved per request rather than cached on the session: a user added to a
   * project should see it without signing out, which is the same reason
   * permissions are read from the database on every request.
   */
  private async scope(user: AuthUser) {
    if (seesAllProjects(user)) return {};
    return scopeFor(user, await this.repo.employeeIdForUser(user.id));
  }

  /** Fetch-or-404, with the caller's scope applied. Every write starts here. */
  private async require(id: string, user: AuthUser) {
    const project = await this.repo.findForRules(id);
    if (!project) throw new NotFoundException("Projekt nicht gefunden.");

    // The scope is re-applied by hand, because `findForRules` deliberately does
    // not take one — its job is the rule inputs, and a rule check must see the
    // real row. A 404 rather than a 403: whether a project exists is itself
    // information a caller outside its team should not get.
    if (!seesAllProjects(user)) {
      const visible = await this.repo.findDetail(id, await this.scope(user));
      if (!visible) throw new NotFoundException("Projekt nicht gefunden.");
    }
    return project;
  }

  private refuseWhenArchived(status: ProjectStatus): void {
    if (isTerminal(status)) {
      throw new ForbiddenException("Ein archiviertes Projekt ist schreibgeschützt.");
    }
  }

}
