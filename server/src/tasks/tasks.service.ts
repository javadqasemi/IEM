import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { TaskStatus } from "@prisma/client";
import { EventBus } from "../core/events/event-bus";
import { VersioningService } from "../core/versioning/versioning.service";
import { VERSION_CONTROL_FIELDS, changedFields } from "../core/versioning/changed";
import type { AuthUser } from "../common/decorators";
import type { RawListQuery } from "../core/list/list.decorator";
import { paginated } from "../core/list/list";
import { TasksRepository } from "./tasks.repository";
import { ownsTask, scopeFor, seesAllTasks } from "./tasks.scope";
import {
  toAuditSnapshot,
  toChecklistItem,
  toDate,
  toHoursNumber,
  toTaskCreateData,
  toTaskDetail,
  toTaskExportRow,
  toTaskListItem,
  toTaskUpdateData,
} from "./tasks.mapper";
import {
  isOpen,
  isTerminal,
  nextPosition,
  positionBetween,
  refuseDates,
  refuseEstimate,
  refuseParentProject,
  refuseTransition,
  renumber,
  transitionsFrom,
  unblockTo,
  wouldCycle,
  wouldCycleParent,
} from "./tasks.rules";
import type {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  AssignTaskDto,
  BulkTasksDto,
  ChangeTaskStatusDto,
  CreateTaskDto,
  MoveTaskDto,
  UpdateChecklistItemDto,
  UpdateTaskDto,
} from "./tasks.dto";

/**
 * Orchestration: rules, transactions and events. **No queries, no Prisma.**
 *
 * The service holds a `TasksRepository`, an `EventBus` and a
 * `VersioningService`, and nothing else. It imports **no `PrismaService`, no
 * `Prisma` namespace and no `Decimal`** — only the enum *types*, which are the
 * domain's vocabulary rather than a persistence detail.
 * `architecture.test.ts` asserts the first three.
 *
 * What it owns, and nothing else does:
 *
 * - **Deciding**, by calling `tasks.rules.ts`, which is pure and tested alone.
 * - **Transactions**, where a rule spans two writes — a move that also
 *   renumbers its column, an edit that also records a version.
 * - **Announcing**, by publishing domain events. It writes **no audit rows**:
 *   `AuditListener` derives them, so a module that raises its events correctly
 *   is audited without a line of audit code.
 *
 * ---
 *
 * **The one thing here that Projects does not have: a row-level *write* check.**
 *
 * `task.updateOwn` lets an engineer move their own card and tick their own
 * checklist without being able to edit anybody else's. It cannot be a
 * `@RequirePermissions` on the route, because whether it applies depends on the
 * row — so `requireWritable` is the single gate every write passes through, and
 * every write calls it. A second path that forgot would not fail; it would
 * quietly grant the whole board.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly repo: TasksRepository,
    private readonly events: EventBus,
    private readonly versions: VersioningService,
  ) {}

  /* ================================================================ */
  /* Reads                                                             */
  /* ================================================================ */

  async list(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const { items, total } = await this.repo.list(params, await this.scope(user));
    const now = new Date();
    return paginated(items.map((row) => toTaskListItem(row, now)), total, params);
  }

  async exportRows(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const rows = await this.repo.listAll(params, await this.scope(user));
    const now = new Date();
    return rows.map((row) => toTaskExportRow(row, now));
  }

  async detail(id: string, user: AuthUser) {
    const row = await this.repo.findDetail(id, await this.scope(user));
    if (!row) throw new NotFoundException("Aufgabe nicht gefunden.");
    return {
      ...toTaskDetail(row),
      /**
       * The transitions this task can make *right now*, sent with it.
       *
       * So the status control offers exactly what the server would accept. The
       * alternative is the client holding a second copy of the transition
       * table, which is the drift the table was made data to avoid — and the
       * client's copy is the one that goes stale, because nothing fails when it
       * does.
       */
      allowedTransitions: transitionsFrom(row.status),
    };
  }

  /**
   * The counts a board header shows.
   *
   * `overdue` is counted separately rather than derived from `byStatus`, because
   * overdue cuts across every open status — a blocked task past its date is
   * overdue, and a `groupBy` on status alone cannot say so.
   */
  async stats(user: AuthUser) {
    const scope = await this.scope(user);
    const [rows, overdue] = await Promise.all([
      this.repo.countByStatus(scope),
      this.repo.countOverdue(scope),
    ]);
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row.status] = row._count._all;
    return {
      byStatus,
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      open: rows.filter((row) => isOpen(row.status)).reduce((sum, row) => sum + row._count._all, 0),
      overdue,
    };
  }

  /* ================================================================ */
  /* Writes                                                            */
  /* ================================================================ */

  async create(dto: CreateTaskDto, user: AuthUser) {
    const dateError = refuseDates(toDate(dto.startDate), toDate(dto.dueDate));
    if (dateError) throw new BadRequestException(dateError);

    this.refuseBadEstimate(dto.estimateHours);

    const missing = await this.repo.missingReferences(dto);
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    await this.refuseCrossProject(dto.projectId ?? null, dto.milestoneId, dto.parentTaskId);

    /*
      Assigning at creation needs `task.assign`, like assigning later does.

      Otherwise `task.create` is a way around it: anybody who may add a card
      could staff it, and the permission that exists to keep planning separate
      from writing would guard exactly one of the two routes that perform it.
    */
    if (dto.assigneeId) this.requireAssign(user);

    const positions = await this.repo.positionsIn(dto.projectId ?? null, TaskStatus.TODO);
    const row = await this.repo.create(
      toTaskCreateData(
        { ...dto, title: dto.title, position: nextPosition(positions.map((p) => p.position)) },
        user.id,
      ),
    );

    this.events.publish("TaskCreated", {
      entity: "task",
      entityId: row.id,
      payload: {
        projectId: row.projectId,
        title: row.title,
        assigneeId: row.assigneeId,
      },
      after: toAuditSnapshot(row),
    });

    if (row.assigneeId) {
      /*
        A second event, not a flag on the first.

        Notifications (module 9) subscribes to `TaskAssigned` to tell somebody
        work has landed on them, and it must not have to also subscribe to
        `TaskCreated` and check whether the assignee happens to be set. One fact
        per event is what makes the catalogue usable by a consumer that does not
        know this module.
      */
      this.events.publish("TaskAssigned", {
        entity: "task",
        entityId: row.id,
        payload: {
          projectId: row.projectId,
          title: row.title,
          assigneeId: row.assigneeId,
          previousAssigneeId: null,
        },
      });
    }

    return { ...toTaskDetail(row), allowedTransitions: transitionsFrom(row.status) };
  }

  async update(id: string, dto: UpdateTaskDto, user: AuthUser) {
    const current = await this.requireWritable(id, user);

    // The *resulting* dates, not the submitted ones: a body that moves only the
    // due date has to be checked against the start date already stored.
    const startDate = dto.startDate === undefined ? current.startDate : toDate(dto.startDate);
    const dueDate = dto.dueDate === undefined ? current.dueDate : toDate(dto.dueDate);
    const dateError = refuseDates(startDate, dueDate);
    if (dateError) throw new BadRequestException(dateError);

    this.refuseBadEstimate(dto.estimateHours);

    const missing = await this.repo.missingReferences(dto);
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    const projectId = dto.projectId === undefined ? current.projectId : dto.projectId;
    await this.refuseCrossProject(projectId, dto.milestoneId, dto.parentTaskId);

    /*
      Reparenting is where the tree can be broken, and the database cannot see
      it. A parent chain that closes on itself produces tasks that can never be
      completed, each of which looks fine on its own.
    */
    if (dto.parentTaskId) {
      const parents = await this.repo.parentsForProject(projectId);
      if (wouldCycleParent(parents, id, dto.parentTaskId)) {
        throw new BadRequestException(
          "Diese Zuordnung würde einen Kreis ergeben — eine Aufgabe kann sich nicht selbst übergeordnet sein.",
        );
      }
    }

    // `assigneeId` on the edit body needs `task.assign`, exactly as the
    // dedicated route does. Checked on the field, not on the route, so the two
    // paths cannot disagree — see the note on `UpdateTaskDto`.
    const reassigning = dto.assigneeId !== undefined && dto.assigneeId !== current.assigneeId;
    if (reassigning) this.requireAssign(user);

    const before = toAuditSnapshot(current);
    /*
      `changedFields`, not `Object.keys`.

      A validated DTO carries every declared property, because the build targets
      ES2022 and `ValidationPipe` transforms — so `Object.keys` reports eleven
      fields for a request that sent one. See the note on `changedFields`; it
      does not fail anywhere, it just makes the version history say that every
      edit changed everything.
    */
    const fields = changedFields(dto, VERSION_CONTROL_FIELDS);

    /*
      One transaction: the guarded write and the version it produces.

      The history has to be written where the row is, or it records a state that
      may yet roll back — a history with a gap is recoverable and a history
      containing something that never happened is not.
    */
    const row = await this.repo.transaction(async (tx) => {
      const changed = await this.repo.updateIfUnchanged(
        id,
        dto.expectedVersion,
        toTaskUpdateData(dto, user.id),
        tx,
      );
      if (changed === 0) await this.refuseStale(id, dto.expectedVersion);

      // Re-read inside the transaction: `updateMany` returns a count and not a
      // row, which is the price of being able to put the version in the `where`.
      const updated = await this.repo.findDetail(id, {}, tx);
      if (!updated) throw new NotFoundException("Aufgabe nicht gefunden.");

      await this.versions.record(tx, {
        entity: "task",
        entityId: id,
        version: dto.expectedVersion + 1,
        // The mapped record, not the Prisma row: a history read in five years
        // must not contain `{"s":1,"e":6,"d":[…]}` where an estimate should be.
        data: toTaskDetail(updated),
        changed: fields,
        note: dto.versionNote ?? null,
      });

      return updated;
    });

    this.events.publish("TaskUpdated", {
      entity: "task",
      entityId: id,
      payload: { title: row.title, fields },
      before,
      after: toAuditSnapshot(row),
    });

    if (reassigning) {
      this.events.publish("TaskAssigned", {
        entity: "task",
        entityId: id,
        payload: {
          projectId: row.projectId,
          title: row.title,
          assigneeId: row.assigneeId,
          previousAssigneeId: current.assigneeId,
        },
        before: { assigneeId: current.assigneeId },
        after: { assigneeId: row.assigneeId },
      });
    }

    return this.detail(id, user);
  }

  /**
   * Reassignment on its own route.
   *
   * No `expectedVersion`, and that is a decision rather than an omission.
   * Assignment is a single-field act performed from a board card's menu, where
   * the caller holds a card and not a loaded record; requiring a version would
   * mean a fetch before every menu click. The cost of losing a race here is one
   * reassignment overwriting another, which is visible, reversible and
   * announced — unlike a lost edit to a description, which is not.
   */
  async assign(id: string, dto: AssignTaskDto, user: AuthUser) {
    const current = await this.requireWritable(id, user);
    this.requireAssign(user);

    const assigneeId = dto.assigneeId ?? null;
    if (assigneeId === current.assigneeId) return this.detail(id, user);

    if (assigneeId) {
      const missing = await this.repo.missingReferences({ assigneeId });
      if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);
    }

    const row = await this.repo.update(id, { assigneeId, updatedById: user.id });

    this.events.publish("TaskAssigned", {
      entity: "task",
      entityId: id,
      payload: {
        projectId: row.projectId,
        title: row.title,
        assigneeId,
        previousAssigneeId: current.assigneeId,
      },
      before: { assigneeId: current.assigneeId },
      after: { assigneeId },
    });

    return this.detail(id, user);
  }

  /**
   * The transition, which is a different act from an edit.
   *
   * The precondition check and the write are **not** in a transaction, and that
   * is the same trade `ProjectsService.changeStatus` makes: `refuseTransition`
   * reads this task's own subtasks and dependencies, and the worst a concurrent
   * write can do is let two people set the same status. Wrapping it would take a
   * row lock on every card movement to prevent an outcome that is already
   * idempotent.
   */
  async changeStatus(id: string, dto: ChangeTaskStatusDto, user: AuthUser) {
    const current = await this.requireWritable(id, user);

    const refusal = refuseTransition(current.status, dto.status, {
      subtasks: current.subtasks,
      dependsOn: current.dependsOn.map((dep) => ({
        type: dep.type,
        status: dep.predecessor.status,
        title: dep.predecessor.title,
      })),
    });
    if (refusal) throw new BadRequestException(refusal);
    if (current.status === dto.status) return this.detail(id, user);

    const blocking = dto.status === TaskStatus.BLOCKED;
    if (blocking && !dto.reason?.trim()) {
      /*
        Checked here and not in the DTO.

        A conditional `@ValidateIf` would put half of what a transition means in
        the DTO and half in the rules file. More practically: a blocked column
        whose cards say nothing is a column nobody can triage, and the reason is
        the only thing that makes `BLOCKED` more useful than a card that simply
        stopped moving.
      */
      throw new BadRequestException("Zum Blockieren braucht es einen Grund.");
    }

    const completing = dto.status === TaskStatus.DONE;
    const row = await this.repo.update(id, {
      status: dto.status,
      // Where to come back to. Recorded on the way in, cleared on the way out,
      // so unblocking is a *return* rather than a reset — `unblockTo`.
      blockedFrom: blocking ? current.status : null,
      blockedReason: blocking ? dto.reason!.trim() : null,
      // Stamped by the transition rather than typed, for the reason
      // `Project.actualEndDate` is: "when was this finished" is not a field.
      completedAt: completing ? new Date() : current.status === TaskStatus.DONE ? null : undefined,
      updatedById: user.id,
    });

    this.events.publish("TaskStatusChanged", {
      entity: "task",
      entityId: id,
      payload: {
        projectId: row.projectId,
        title: row.title,
        from: current.status,
        to: dto.status,
      },
      before: { status: current.status },
      after: { status: dto.status },
      message: dto.reason,
    });

    if (completing) {
      this.events.publish("TaskCompleted", {
        entity: "task",
        entityId: id,
        payload: { projectId: row.projectId, title: row.title, assigneeId: row.assigneeId },
      });
    }
    if (blocking) {
      this.events.publish("TaskBlocked", {
        entity: "task",
        entityId: id,
        payload: { projectId: row.projectId, title: row.title, reason: dto.reason!.trim() },
      });
    }

    return this.detail(id, user);
  }

  /** What `BLOCKED` returns to. A named route, because a client should not guess. */
  async unblock(id: string, user: AuthUser) {
    const current = await this.requireWritable(id, user);
    if (current.status !== TaskStatus.BLOCKED) {
      throw new BadRequestException("Diese Aufgabe ist nicht blockiert.");
    }
    return this.changeStatus(id, { status: unblockTo(current.blockedFrom) }, user);
  }

  async remove(id: string, user: AuthUser) {
    const current = await this.requireWritable(id, user);

    /*
      `task.delete` is firm-wide and `updateOwn` does not extend to it.

      Deleting somebody's own task is reasonable; deleting it *because* it is
      theirs is how a board loses work nobody can account for. Soft delete means
      it is recoverable, and the audit row means it is attributable — but the
      permission is still the wide one.
    */
    if (!user.isSuperAdmin && !user.permissions.has("task.delete")) {
      throw new ForbiddenException("Zum Löschen von Aufgaben fehlt die Berechtigung.");
    }

    await this.repo.softDelete(id, new Date());

    this.events.publish("TaskDeleted", {
      entity: "task",
      entityId: id,
      payload: { projectId: current.projectId, title: current.title },
      before: toAuditSnapshot(current),
    });

    return { ok: true };
  }

  /**
   * The list contract's bulk action.
   *
   * Priority and assignee, both optional, at least one required — and
   * deliberately **not status**, for the reason `BulkTasksDto` states. Rows the
   * caller cannot write are skipped rather than failing the request: a selection
   * made on a board legitimately spans cards with different owners, and
   * refusing all two hundred because of one is an answer nobody can act on. The
   * response says how many of how many.
   */
  async bulk(dto: BulkTasksDto, user: AuthUser) {
    if (dto.priority === undefined && dto.assigneeId === undefined) {
      throw new BadRequestException("Es ist keine Änderung angegeben.");
    }
    if (dto.assigneeId !== undefined) this.requireAssign(user);

    const scope = await this.scope(user);
    const employeeId = await this.employeeId(user);
    let changed = 0;

    for (const id of dto.ids) {
      const row = await this.repo.findDetail(id, scope);
      if (!row || isTerminal(row.status)) continue;
      if (!this.mayWrite(row, user, employeeId)) continue;

      const previousAssigneeId = row.assigneeId;
      await this.repo.update(id, {
        priority: dto.priority,
        assigneeId: dto.assigneeId === undefined ? undefined : dto.assigneeId,
        updatedById: user.id,
      });

      this.events.publish("TaskUpdated", {
        entity: "task",
        entityId: id,
        payload: { title: row.title, fields: changedFields(dto, ["ids"]) },
        before: toAuditSnapshot(row),
        after: { priority: dto.priority ?? row.priority, assigneeId: dto.assigneeId ?? previousAssigneeId },
      });

      if (dto.assigneeId !== undefined && dto.assigneeId !== previousAssigneeId) {
        this.events.publish("TaskAssigned", {
          entity: "task",
          entityId: id,
          payload: {
            projectId: row.projectId,
            title: row.title,
            assigneeId: dto.assigneeId ?? null,
            previousAssigneeId,
          },
        });
      }
      changed += 1;
    }

    return { changed, requested: dto.ids.length };
  }

  /* ================================================================ */
  /* The board                                                         */
  /* ================================================================ */

  /**
   * A drag: a new column, a new place in it, or both.
   *
   * **The renumber is inside the same transaction as the move**, which is the
   * whole reason this is not two calls. `positionBetween` returns `null` when
   * the integers either side are adjacent; the column is then renumbered and the
   * card placed again. If those were separate requests, a failure between them
   * would leave a column renumbered with the card still in its old slot — which
   * is not corrupt, just wrong, and wrong in a way nobody would report as a bug.
   */
  async move(id: string, dto: MoveTaskDto, user: AuthUser) {
    const current = await this.requireWritable(id, user);

    const status = dto.status ?? current.status;
    if (status !== current.status) {
      const refusal = refuseTransition(current.status, status, {
        subtasks: current.subtasks,
        dependsOn: current.dependsOn.map((dep) => ({
          type: dep.type,
          status: dep.predecessor.status,
          title: dep.predecessor.title,
        })),
      });
      // The same rule as the status route. A board that could drag a card into
      // `DONE` past an open subtask would be a second, weaker door into the
      // same transition.
      if (refusal) throw new BadRequestException(refusal);
    }

    const column = await this.repo.positionsIn(current.projectId, status);
    const others = column.filter((row) => row.id !== id);
    const after = dto.afterId ? others.find((row) => row.id === dto.afterId) : undefined;
    const before = dto.beforeId ? others.find((row) => row.id === dto.beforeId) : undefined;

    if (dto.afterId && !after) throw new BadRequestException("Die Karte davor gibt es nicht mehr.");
    if (dto.beforeId && !before) throw new BadRequestException("Die Karte danach gibt es nicht mehr.");

    const completing = status === TaskStatus.DONE && current.status !== TaskStatus.DONE;

    await this.repo.transaction(async (tx) => {
      let position = positionBetween(after?.position ?? null, before?.position ?? null);

      if (position === null) {
        /*
          The gap is exhausted. Renumber the column with the card in its
          intended place, then take the slot that opens up.

          Rare — with a gap of 1024 it takes ten insertions into the same space
          — and it has to work the first time it happens, because the symptom
          otherwise is a card that silently refuses to move.
        */
        const ids = others.map((row) => row.id);
        const at = after ? ids.indexOf(after.id) + 1 : before ? ids.indexOf(before.id) : ids.length;
        ids.splice(at, 0, id);

        const renumbered = renumber(ids);
        await this.repo.renumber(renumbered, tx);
        position = renumbered.find((row) => row.id === id)!.position;
      }

      await this.repo.update(
        id,
        {
          position,
          status,
          blockedFrom: status === TaskStatus.BLOCKED ? current.status : null,
          completedAt: completing ? new Date() : status === TaskStatus.DONE ? undefined : null,
          updatedById: user.id,
        },
        tx,
      );
    });

    if (status !== current.status) {
      this.events.publish("TaskStatusChanged", {
        entity: "task",
        entityId: id,
        payload: {
          projectId: current.projectId,
          title: current.title,
          from: current.status,
          to: status,
        },
        before: { status: current.status },
        after: { status },
      });
      if (completing) {
        this.events.publish("TaskCompleted", {
          entity: "task",
          entityId: id,
          payload: {
            projectId: current.projectId,
            title: current.title,
            assigneeId: current.assigneeId,
          },
        });
      }
    }

    return this.detail(id, user);
  }

  /* ================================================================ */
  /* Dependencies                                                      */
  /* ================================================================ */

  async addDependency(id: string, dto: AddDependencyDto, user: AuthUser) {
    const current = await this.requireWritable(id, user);
    const predecessor = await this.repo.findForRules(dto.predecessorId);
    if (!predecessor) throw new BadRequestException("Die Vorgänger-Aufgabe gibt es nicht.");

    /*
      Both ends must be on the same project, and this is what keeps the cycle
      check bounded.

      `edgesForProject` reads one project's graph; a dependency reaching across
      projects would make the correct check "every edge in the firm", which is
      unbounded and would be quietly downgraded the first time it got slow. It
      is also the right rule on its own terms: a task waiting on another
      project's work is a *milestone* dependency, which the milestone link
      expresses.
    */
    if (predecessor.projectId !== current.projectId) {
      throw new BadRequestException(
        "Eine Abhängigkeit verbindet zwei Aufgaben desselben Projekts. Projektübergreifend ist es ein Meilenstein.",
      );
    }

    const edges = await this.repo.edgesForProject(current.projectId);
    if (wouldCycle(edges, dto.predecessorId, id)) {
      throw new BadRequestException(
        "Diese Abhängigkeit würde einen Kreis schliessen — dann könnte keine der beteiligten Aufgaben je fertig werden.",
      );
    }

    await this.repo.addDependency({
      predecessorId: dto.predecessorId,
      successorId: id,
      type: dto.type ?? "FS",
      lagDays: dto.lagDays ?? 0,
    });

    this.events.publish("TaskDependencyAdded", {
      entity: "task",
      entityId: id,
      payload: { taskId: id, predecessorId: dto.predecessorId, type: dto.type ?? "FS" },
    });

    return this.detail(id, user);
  }

  async removeDependency(id: string, dependencyId: string, user: AuthUser) {
    await this.requireWritable(id, user);
    const dependency = await this.repo.findDependency(dependencyId);
    // The dependency has to belong to *this* task, and checking it is what stops
    // `/tasks/<mine>/dependencies/<somebody-else's>` from working — the nested
    // route whose parent is checked and whose child is not.
    if (!dependency || dependency.successorId !== id) {
      throw new NotFoundException("Abhängigkeit nicht gefunden.");
    }
    await this.repo.removeDependency(dependencyId);
    return this.detail(id, user);
  }

  /* ================================================================ */
  /* Checklist                                                         */
  /* ================================================================ */

  async checklist(id: string, user: AuthUser) {
    await this.require(id, user);
    const rows = await this.repo.checklistFor(id);
    return rows.map(toChecklistItem);
  }

  async addChecklistItem(id: string, dto: AddChecklistItemDto, user: AuthUser) {
    await this.requireWritable(id, user);
    const position = await this.repo.nextChecklistPosition(id);
    const row = await this.repo.addChecklistItem({ taskId: id, text: dto.text.trim(), position });
    return toChecklistItem(row);
  }

  async updateChecklistItem(
    id: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
    user: AuthUser,
  ) {
    await this.requireWritable(id, user);
    const item = await this.repo.findChecklistItem(itemId);
    if (!item || item.taskId !== id) throw new NotFoundException("Punkt nicht gefunden.");

    const employeeId = await this.employeeId(user);
    const row = await this.repo.updateChecklistItem(itemId, {
      text: dto.text?.trim(),
      done: dto.done,
      // Stamped, not typed — and cleared when the tick comes off, so a
      // re-opened point does not keep claiming somebody finished it.
      doneAt: dto.done === undefined ? undefined : dto.done ? new Date() : null,
      doneById: dto.done === undefined ? undefined : dto.done ? employeeId : null,
    });
    return toChecklistItem(row);
  }

  async removeChecklistItem(id: string, itemId: string, user: AuthUser) {
    await this.requireWritable(id, user);
    const item = await this.repo.findChecklistItem(itemId);
    if (!item || item.taskId !== id) throw new NotFoundException("Punkt nicht gefunden.");
    await this.repo.removeChecklistItem(itemId);
    return { ok: true };
  }

  /* ================================================================ */
  /* Comments                                                          */
  /* ================================================================ */

  async comments(id: string, user: AuthUser) {
    await this.require(id, user);
    const rows = await this.repo.commentsFor("task", id);
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      authorId: row.authorId,
      authorName: row.authorName,
      parentId: row.parentId,
      mentionedIds: row.mentionedIds,
      editedAt: row.editedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * A comment needs `task.comment` and **read access, not write access**.
   *
   * The one place in this module where the two come apart, and it is deliberate:
   * asking a question on somebody else's card is the point of a thread. Requiring
   * `task.update` to comment would mean an engineer can see a blocked card and
   * not ask why it is blocked.
   */
  async addComment(id: string, dto: AddCommentDto, user: AuthUser) {
    const task = await this.require(id, user);

    if (!user.isSuperAdmin && !user.permissions.has("task.comment")) {
      throw new ForbiddenException("Zum Kommentieren fehlt die Berechtigung.");
    }

    /*
      Mentions are validated before they are announced.

      The ids come from the client's picker, and an id that names nobody would
      otherwise reach `TaskCommented` and from there the notification module,
      which would look up a person who does not exist. Filtering rather than
      refusing: a stale mention should not lose the comment somebody wrote.
    */
    const mentionedIds: string[] = [];
    for (const employeeId of dto.mentionedIds ?? []) {
      const missing = await this.repo.missingReferences({ assigneeId: employeeId });
      if (!missing.length) mentionedIds.push(employeeId);
    }

    const row = await this.repo.addComment({
      entity: "task",
      entityId: id,
      body: dto.body.trim(),
      parentId: dto.parentId ?? null,
      mentionedIds,
      // Denormalised like the audit log's: the account may be deleted, and a
      // thread that says "unknown" about who raised the question is not a thread.
      authorId: user.id,
      authorEmail: user.email,
      authorName: user.name,
    });

    this.events.publish("TaskCommented", {
      entity: "task",
      entityId: id,
      payload: { taskId: id, projectId: task.projectId, mentionedIds },
    });

    return {
      id: row.id,
      body: row.body,
      authorId: row.authorId,
      authorName: row.authorName,
      parentId: row.parentId,
      mentionedIds: row.mentionedIds,
      editedAt: null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Deleting a comment: the author, or somebody with `task.delete`.
   *
   * Not `task.update`. Removing what somebody else wrote is a moderation act,
   * and folding it into the permission that edits a card would give every
   * Projektleiter silent removal rights over their team's questions.
   */
  async removeComment(id: string, commentId: string, user: AuthUser) {
    await this.require(id, user);
    const comment = await this.repo.findComment(commentId);
    if (!comment || comment.entity !== "task" || comment.entityId !== id) {
      throw new NotFoundException("Kommentar nicht gefunden.");
    }

    const mine = comment.authorId === user.id;
    if (!mine && !user.isSuperAdmin && !user.permissions.has("task.delete")) {
      throw new ForbiddenException("Fremde Kommentare kann nur die Projektleitung entfernen.");
    }

    await this.repo.softDeleteComment(commentId, new Date());
    return { ok: true };
  }

  /* ================================================================ */
  /* Version history                                                   */
  /* ================================================================ */

  async history(id: string, user: AuthUser) {
    await this.require(id, user);
    return this.versions.history("task", id);
  }

  async versionAt(id: string, version: number, user: AuthUser) {
    await this.require(id, user);
    const row = await this.versions.at("task", id, version);
    if (!row) throw new NotFoundException(`Version v${version} gibt es nicht.`);
    return row;
  }

  /* ================================================================ */
  /* Shared                                                            */
  /* ================================================================ */

  /**
   * The caller's visibility, as a `where` fragment.
   *
   * Resolved per request rather than cached on the session: somebody assigned a
   * task should see it without signing out, which is the same reason permissions
   * are read from the database on every request.
   */
  private async scope(user: AuthUser) {
    if (seesAllTasks(user)) return {};
    return scopeFor(user, await this.employeeId(user), user.id);
  }

  private async employeeId(user: AuthUser): Promise<string | null> {
    return this.repo.employeeIdForUser(user.id);
  }

  /** Fetch-or-404, with the caller's scope applied. Every read of one task starts here. */
  private async require(id: string, user: AuthUser) {
    const task = await this.repo.findForRules(id);
    if (!task) throw new NotFoundException("Aufgabe nicht gefunden.");

    // The scope is re-applied by hand, because `findForRules` deliberately does
    // not take one — its job is the rule inputs, and a rule check must see the
    // real row. A 404 rather than a 403: whether a task exists is itself
    // information a caller outside its project should not get.
    if (!seesAllTasks(user)) {
      const visible = await this.repo.findDetail(id, await this.scope(user));
      if (!visible) throw new NotFoundException("Aufgabe nicht gefunden.");
    }
    return task;
  }

  /**
   * Fetch-or-404, **and** the row-level write check. Every write starts here.
   *
   * The gate `task.updateOwn` needs. It is one method rather than a check
   * repeated in fourteen places for the reason the whole module has one
   * `require`: a write path that forgot it would not fail — it would silently
   * grant the whole board to anybody who can see it.
   */
  private async requireWritable(id: string, user: AuthUser) {
    const task = await this.require(id, user);
    if (isTerminal(task.status)) {
      throw new ForbiddenException("Eine abgebrochene Aufgabe ist schreibgeschützt.");
    }
    if (!this.mayWrite(task, user, await this.employeeId(user))) {
      throw new ForbiddenException("Diese Aufgabe gehört jemand anderem.");
    }
    return task;
  }

  /**
   * Whether this caller may write this row.
   *
   * `task.update` is firm-wide; `task.updateOwn` is the narrow grant and is
   * checked against the row. Somebody holding neither reached here through a
   * route guard that required one of them, so the `false` case is a caller with
   * `updateOwn` on a card that is not theirs.
   */
  private mayWrite(
    task: { assigneeId: string | null; createdById: string | null },
    user: AuthUser,
    employeeId: string | null,
  ): boolean {
    if (user.isSuperAdmin || user.permissions.has("task.update")) return true;
    if (!user.permissions.has("task.updateOwn")) return false;
    return ownsTask(task, employeeId, user.id);
  }

  /**
   * The estimate, checked in two steps because they are two different errors.
   *
   * `toHours` refuses a *shape* — `4,25`, `vier`, `4:15` — and names the field
   * while doing it. `refuseEstimate` refuses a *magnitude*. Folding them would
   * mean one message covering both, and "ungültiger Aufwand" tells somebody who
   * typed `4,25` nothing about the comma.
   *
   * `undefined` and `null` both mean "no estimate", which is the normal state of
   * a task in a backlog.
   */
  private refuseBadEstimate(value: string | null | undefined): void {
    if (value === undefined || value === null || value === "") return;
    const refusal = refuseEstimate(toHoursNumber(value, "Aufwand"));
    if (refusal) throw new BadRequestException(refusal);
  }

  private requireAssign(user: AuthUser): void {
    if (!user.isSuperAdmin && !user.permissions.has("task.assign")) {
      throw new ForbiddenException("Zum Zuweisen von Aufgaben fehlt die Berechtigung.");
    }
  }

  /**
   * A milestone and a parent task belong to the same project as the task.
   *
   * Neither is a foreign key the database can check, and both failures are
   * invisible: a task delivering against another project's milestone counts
   * toward that project's progress, and a subtask on another project's board is
   * completed by somebody who has never seen its parent.
   */
  private async refuseCrossProject(
    projectId: string | null,
    milestoneId?: string | null,
    parentTaskId?: string | null,
  ): Promise<void> {
    if (milestoneId) {
      const owner = await this.repo.milestoneProject(milestoneId);
      if (owner !== projectId) {
        throw new BadRequestException(
          "Der Meilenstein gehört zu einem anderen Projekt als die Aufgabe.",
        );
      }
    }
    if (parentTaskId) {
      const parent = await this.repo.findForRules(parentTaskId);
      const refusal = refuseParentProject(parent?.projectId ?? null, projectId);
      if (refusal) throw new BadRequestException(refusal);
    }
  }

  /**
   * Turns a failed guarded write into the right refusal.
   *
   * Two things make `updateIfUnchanged` match nothing and they are different
   * answers: the row is at a later version (**409**, somebody saved first) or it
   * is gone (**404**). Reporting a conflict for a deleted task would send the
   * reader to reload a card that no longer exists.
   */
  private async refuseStale(id: string, expected: number): Promise<never> {
    const now = await this.repo.versionOf(id);
    if (!now) throw new NotFoundException("Aufgabe nicht gefunden.");

    const by = now.updatedById ? await this.repo.nameOfUser(now.updatedById) : null;
    throw VersioningService.conflict(now.title, now.version, by, expected);
  }
}
