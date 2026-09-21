import { request } from "@/core/api";
import type {
  DeliveryPageDto,
  MarkAllReadDto,
  NotificationPageDto,
  PreferenceDto,
  RuleDto,
  UnreadCountDto,
} from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * **The first six name no user**, and that is the control rather than a
 * convention: every one of them takes the account from the verified token, so
 * there is no parameter through which one person could reach another's inbox
 * or another's preferences. It is the same split `sessionRepository` and
 * `mfaRepository` document.
 *
 * The last two do name authority instead of a user — `rules` and
 * `deliveries` are behind `notification.configure` and
 * `notification.readDeliveries`. There is deliberately **no** route here for
 * reading somebody else's notifications, and there is none on the server: an
 * administrator configures who is told and can see that a delivery happened,
 * and cannot read the message.
 */
export const notificationRepository = {
  list: (query: {
    unread?: boolean;
    type?: string;
    severity?: string;
    page?: number;
    perPage?: number;
  }) =>
    request<NotificationPageDto>("/notifications", {
      query: {
        // `undefined` rather than `false`: `buildUrl` drops it, so an
        // "all" tab and an "unread" tab are two different cache keys
        // instead of one with a falsy parameter hanging off it.
        unread: query.unread ? "true" : undefined,
        type: query.type || undefined,
        severity: query.severity || undefined,
        page: query.page,
        perPage: query.perPage,
      },
    }),

  /**
   * The bell's number, on its own route.
   *
   * Separate from the list because it is polled: one indexed count against a
   * page of rows plus their deliveries is the difference between a poll that
   * costs nothing and the most expensive request the dashboard makes.
   */
  unreadCount: () => request<UnreadCountDto>("/notifications/unread-count"),

  markRead: (id: string, read: boolean) =>
    request<void>(`/notifications/${id}/read`, { body: { read } }),

  markAllRead: () =>
    request<MarkAllReadDto>("/notifications/read-all", { method: "POST", body: {} }),

  preferences: () => request<PreferenceDto[]>("/notifications/preferences"),

  /** Returns the whole recomputed list, so the screen never guesses. */
  updatePreferences: (updates: { type: string; inApp: boolean; email: boolean }[]) =>
    request<PreferenceDto[]>("/notifications/preferences", { method: "PUT", body: { updates } }),

  /* ---------------------------------------------------------------- */
  /* The firm's, for an administrator                                  */
  /* ---------------------------------------------------------------- */

  rules: () => request<RuleDto[]>("/notifications/rules"),

  updateRules: (
    updates: { type: string; enabled: boolean; inApp: boolean; email: boolean }[],
  ) => request<RuleDto[]>("/notifications/rules", { method: "PUT", body: { updates } }),

  deliveries: (query: { status?: string; page?: number; perPage?: number }) =>
    request<DeliveryPageDto>("/notifications/deliveries", {
      query: { status: query.status || undefined, page: query.page, perPage: query.perPage },
    }),
};

export type NotificationRepository = typeof notificationRepository;
