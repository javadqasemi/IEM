import { useCallback } from "react";
import { invalidate, useQuery, type Paginated } from "@/core/api";
import type {
  BuildingOption,
  CustomerOption,
  DisciplineOption,
  DisciplineScopeDraft,
  EmployeeOption,
  MemberDraft,
  MilestoneDraft,
  MilestoneEdit,
  Project,
  ProjectDetail,
  ProjectDraft,
  ProjectEdit,
  ProjectStats,
  ProjectVersion,
  StatusChange,
} from "@/entities/project";
import {
  toBuildingOption,
  toCreateBody,
  toCustomerOption,
  toDisciplineOption,
  toEmployeeOption,
  toMemberBody,
  toMilestoneCreateBody,
  toMilestoneUpdateBody,
  toProjectDetail,
  toProjectPage,
  toProjectStats,
  toProjectVersion,
  toScopeBody,
  toStatusBody,
  toUpdateBody,
} from "../mapper";
import { projectRepository, type ProjectQuery } from "../repository";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * Every function here is `repository → mapper → cache`. That order is the whole
 * contract: nothing below this file knows about React, and nothing above it has
 * seen a DTO.
 */

/**
 * The cache prefix for everything in this feature.
 *
 * One constant rather than the string repeated at a dozen call sites, because
 * invalidation is a prefix match — a typo in one key produces an entry nothing
 * ever invalidates, which shows up weeks later as a list that will not refresh.
 */
const KEY = "projects";

export function useProjectList(query: ProjectQuery) {
  return useQuery<Paginated<Project>>(
    [
      KEY,
      "list",
      query.search ?? "",
      (query.statuses ?? []).join(",") || (query.status ?? ""),
      query.health ?? "",
      query.priority ?? "",
      query.phase ?? "",
      query.customerId ?? "",
      query.customer ?? "",
      query.managerId ?? "",
      query.discipline ?? "",
      query.dueBefore ?? "",
      `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
      query.page ?? 1,
      query.perPage ?? 25,
    ],
    () => projectRepository.list(query).then(toProjectPage),
  );
}

export function useProjectStats(enabled = true) {
  return useQuery<ProjectStats>(enabled ? [KEY, "stats"] : null, () =>
    projectRepository.stats().then(toProjectStats),
  );
}

/**
 * The rail's badge: how many projects are live.
 *
 * Exported through the feature's `index.ts` so the shell can read one number
 * without importing a screen, a repository or a DTO — which is what the public
 * surface is for. It shares `[projects, stats]` with the list screen's filter
 * chips, so opening the page costs **no** extra request.
 *
 * `undefined` when it has not loaded or the call failed. A missing badge is the
 * right failure — the rail still renders, and an error screen because a count
 * is unavailable would be worse than the count being unavailable.
 */
export function useActiveProjectCount(enabled: boolean): number | undefined {
  const stats = useProjectStats(enabled).data;
  if (!stats) return undefined;
  return stats.byStatus.ACTIVE + stats.byStatus.ON_HOLD;
}

/** `null` disables the query — a detail route with no id fetches nothing. */
export function useProject(id: string | null) {
  return useQuery<ProjectDetail>(id ? [KEY, "detail", id] : null, () =>
    projectRepository.get(id!).then(toProjectDetail),
  );
}

/**
 * The record's version history (F13).
 *
 * `null` disables it, so the tab fetches nothing until it is opened. A history
 * is the one sub-resource nobody looks at on most visits, and loading it with
 * the detail would put a request on every project opening for the few that want
 * it.
 */
export function useProjectHistory(id: string | null) {
  return useQuery<ProjectVersion[]>(id ? [KEY, "versions", id] : null, () =>
    projectRepository.history(id!).then((rows) => rows.map(toProjectVersion)),
  );
}

/* ---- The pickers --------------------------------------------------- */

/**
 * Cached under `masterdata`, **not** under `projects`.
 *
 * Deliberate, and it is the one place the "invalidate the whole feature" rule
 * below would be wrong: saving a project must not evict the customer list, and
 * the three pickers are read by a form that reopens constantly. They will move
 * to their own features in Wave 1 modules 1–3, and the key is already theirs.
 */
const MASTER = "masterdata";

export function useCustomerOptions(search?: string) {
  return useQuery<CustomerOption[]>([MASTER, "customers", search ?? ""], () =>
    projectRepository.customerOptions(search).then((page) => page.items.map(toCustomerOption)),
  );
}

export function useBuildingOptions(search?: string, customerId?: string) {
  return useQuery<BuildingOption[]>(
    [MASTER, "buildings", search ?? "", customerId ?? ""],
    () =>
      projectRepository
        .buildingOptions(search, customerId)
        .then((page) => page.items.map(toBuildingOption)),
  );
}

export function useEmployeeOptions(search?: string) {
  return useQuery<EmployeeOption[]>([MASTER, "employees", search ?? ""], () =>
    projectRepository.employeeOptions(search).then((page) => page.items.map(toEmployeeOption)),
  );
}

export function useDisciplineOptions() {
  return useQuery<DisciplineOption[]>([MASTER, "disciplines"], () =>
    projectRepository.disciplineOptions().then((rows) => rows.map(toDisciplineOption)),
  );
}

/* ---- The writes ---------------------------------------------------- */

export type ProjectMutations = {
  create: (draft: ProjectDraft) => Promise<ProjectDetail>;
  update: (id: string, edit: ProjectEdit) => Promise<ProjectDetail>;
  changeStatus: (id: string, change: StatusChange) => Promise<ProjectDetail>;
  remove: (id: string) => Promise<void>;
  bulkPriority: (ids: string[], priority: string) => Promise<number>;
  exportCsv: (query: ProjectQuery) => Promise<void>;
  addMember: (id: string, draft: MemberDraft) => Promise<ProjectDetail>;
  removeMember: (id: string, memberId: string) => Promise<ProjectDetail>;
  scopeDiscipline: (id: string, draft: DisciplineScopeDraft) => Promise<ProjectDetail>;
  createMilestone: (id: string, draft: MilestoneDraft) => Promise<ProjectDetail>;
  updateMilestone: (
    id: string,
    milestoneId: string,
    edit: MilestoneEdit,
  ) => Promise<ProjectDetail>;
};

/**
 * The writes.
 *
 * Each one invalidates the whole feature rather than the key it touched.
 * Deliberate, and more so here than anywhere: **every sub-resource write moves
 * the project's derived figures.** Marking a milestone met changes
 * `progressPercent`, which changes `health`, which changes the row's position
 * in a list sorted by health and two numbers in the stats tile. The set of
 * affected keys is not knowable from the mutation. Invalidating a dozen entries
 * costs one round trip per mounted screen; getting the set wrong costs a number
 * that is quietly false.
 *
 * Every sub-resource route returns the **whole project**, which is why each of
 * these resolves to a `ProjectDetail`: the caller gets the recomputed figures
 * in the same round trip rather than racing the invalidation.
 *
 * Errors are **not** swallowed. The screen wraps the call in `useMutation`,
 * which turns an `ApiError`'s per-field messages into messages beside the
 * inputs — a hook that caught them would throw that away.
 */
export function useProjectMutations(): ProjectMutations {
  const create = useCallback(async (draft: ProjectDraft) => {
    const dto = await projectRepository.create(toCreateBody(draft));
    invalidate(KEY);
    return toProjectDetail(dto);
  }, []);

  const update = useCallback(async (id: string, edit: ProjectEdit) => {
    const dto = await projectRepository.update(id, toUpdateBody(edit));
    invalidate(KEY);
    return toProjectDetail(dto);
  }, []);

  const changeStatus = useCallback(async (id: string, change: StatusChange) => {
    const dto = await projectRepository.changeStatus(id, toStatusBody(change));
    invalidate(KEY);
    return toProjectDetail(dto);
  }, []);

  const remove = useCallback(async (id: string) => {
    await projectRepository.remove(id);
    invalidate(KEY);
  }, []);

  const bulkPriority = useCallback(async (ids: string[], priority: string) => {
    const result = await projectRepository.bulkPriority(ids, priority);
    invalidate(KEY);
    return result.changed;
  }, []);

  const exportCsv = useCallback((query: ProjectQuery) => projectRepository.exportCsv(query), []);

  const addMember = useCallback(async (id: string, draft: MemberDraft) => {
    const dto = await projectRepository.addMember(id, toMemberBody(draft));
    invalidate(KEY);
    return toProjectDetail(dto);
  }, []);

  const removeMember = useCallback(async (id: string, memberId: string) => {
    const dto = await projectRepository.removeMember(id, memberId);
    invalidate(KEY);
    return toProjectDetail(dto);
  }, []);

  const scopeDiscipline = useCallback(async (id: string, draft: DisciplineScopeDraft) => {
    const dto = await projectRepository.scopeDiscipline(id, toScopeBody(draft));
    invalidate(KEY);
    return toProjectDetail(dto);
  }, []);

  const createMilestone = useCallback(async (id: string, draft: MilestoneDraft) => {
    const dto = await projectRepository.createMilestone(id, toMilestoneCreateBody(draft));
    invalidate(KEY);
    return toProjectDetail(dto);
  }, []);

  const updateMilestone = useCallback(
    async (id: string, milestoneId: string, edit: MilestoneEdit) => {
      const dto = await projectRepository.updateMilestone(
        id,
        milestoneId,
        toMilestoneUpdateBody(edit),
      );
      invalidate(KEY);
      return toProjectDetail(dto);
    },
    [],
  );

  return {
    create,
    update,
    changeStatus,
    remove,
    bulkPriority,
    exportCsv,
    addMember,
    removeMember,
    scopeDiscipline,
    createMilestone,
    updateMilestone,
  };
}
