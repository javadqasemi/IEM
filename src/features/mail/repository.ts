import { request } from "@/core/api";
import type {
  MailStatus,
  MailTemplate,
  MailTemplatePreview,
  MailTestResult,
  MailVerifyResult,
} from "./types";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * **Nothing here can fetch a credential**, and that is a property of the API
 * rather than a discipline observed on this side: there is no route that
 * returns a secret setting's value, so there is no call to leave out. `status`
 * carries `hasCredentials` as a boolean; the SMTP password has no
 * representation in this file at all.
 *
 * Two write calls and neither takes a message. `verify` sends nothing;
 * `sendTest` takes at most a recipient, because the body is fixed on the
 * server — what stops this becoming an authenticated relay is the absence of a
 * subject and body parameter, here and there.
 */
export const mailRepository = {
  status: () => request<MailStatus>("/settings/mail/status"),

  /** DNS, TCP, TLS and AUTH. Puts nothing in anybody's inbox. */
  verify: () => request<MailVerifyResult>("/settings/mail/verify", { method: "POST", body: {} }),

  /** The fixed diagnostic note. `to` omitted means the caller's own address. */
  sendTest: (to?: string) =>
    request<MailTestResult>("/settings/mail/test", {
      method: "POST",
      body: to ? { to } : {},
    }),

  templates: () => request<{ items: MailTemplate[] }>("/settings/mail/templates"),

  preview: (key: string) =>
    request<MailTemplatePreview>(`/settings/mail/templates/${encodeURIComponent(key)}/preview`),

  /**
   * Clears a stored credential.
   *
   * Its own route rather than a blank write, because no spelling of an empty
   * field may destroy one — see `classifySecretWrite` on the server.
   */
  removeSecret: (key: string) =>
    request<unknown>(`/settings/secrets/${encodeURIComponent(key)}`, { method: "DELETE" }),

  /*
    There is deliberately **no delivery log here**.

    `NotificationDelivery` is the notification platform's table and
    `features/notifications` already renders it as the Zustellprotokoll,
    complete with its status filter, its tone mapping and the argument for why
    `SKIPPED` is neutral rather than amber. A second table over the same rows
    would be the "second email-delivery-history system" the brief names, and
    the two would drift the first time somebody added a column.

    It is also not *possible* from here: `src/architecture.test.ts` forbids a
    feature importing another feature, which is the rule doing its job — the
    duplication it would have taken to work around it is exactly what it exists
    to prevent. The mail panel shows the **summary** that
    `/settings/mail/status` computes and points at the full protocol.
  */
};
