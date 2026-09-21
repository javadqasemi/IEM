import { request } from "@/core/api";
import type {
  CreateOfficeBody,
  OfficeDto,
  OrganisationEnvelopeDto,
  OrganisationSaveDto,
  SettingGroupDto,
  SystemInfoDto,
  UpdateOfficeBody,
  UpdateOrganisationBody,
} from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * **Four endpoint groups, one repository**, and that is deliberate rather than
 * lazy. `/organisation`, `/offices`, `/settings` and `/dashboard/system` are
 * four routes serving one screen: the settings workspace. A repository is
 * allowed to know any endpoint — what is forbidden is a feature importing
 * another feature — so calling `/settings` from here is the same arrangement
 * `features/tasks` uses when it calls `/projects` rather than importing
 * `projectRepository`. Two repositories calling one endpoint is duplication;
 * one feature reaching into another is a mesh.
 */
export const organisationRepository = {
  get: () => request<OrganisationEnvelopeDto>("/organisation"),

  update: (body: UpdateOrganisationBody) =>
    request<OrganisationSaveDto>("/organisation", { method: "PATCH", body }),

  /* ---- Offices ----------------------------------------------------- */

  /**
   * Unpaginated, archived rows included.
   *
   * The server does not put this list on the `core/list` contract — two offices
   * do not need a filter bar, a saved view and a column picker. The screen
   * filters the archived ones in the client, which over a handful of rows is
   * one predicate rather than a round trip.
   */
  offices: () => request<OfficeDto[]>("/offices"),

  createOffice: (body: CreateOfficeBody) =>
    request<OfficeDto>("/offices", { method: "POST", body }),

  updateOffice: (id: string, body: UpdateOfficeBody) =>
    request<OfficeDto>(`/offices/${id}`, { method: "PATCH", body }),

  /**
   * Archive and restore are one route read in two directions — see the note on
   * the controller. `restore=true` is the only difference, so the two can never
   * disagree about what "archived" means.
   */
  setArchived: (id: string, archived: boolean) =>
    request<OfficeDto>(`/offices/${id}/archive${archived ? "" : "?restore=true"}`, {
      method: "PUT",
    }),

  deleteOffice: (id: string) =>
    request<{ deleted: boolean }>(`/offices/${id}`, { method: "DELETE" }),

  /* ---- Settings ---------------------------------------------------- */

  settings: () => request<SettingGroupDto[]>("/settings"),

  updateSettings: (updates: { key: string; value: unknown }[]) =>
    request<SettingGroupDto[]>("/settings", { method: "PATCH", body: { updates } }),

  /* ---- System ------------------------------------------------------ */

  system: () => request<SystemInfoDto>("/dashboard/system"),
};

export type OrganisationRepository = typeof organisationRepository;

