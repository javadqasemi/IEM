import type {
  DeliveryDto,
  DeliveryPageDto,
  NotificationDto,
  NotificationPageDto,
  PreferenceDto,
  RuleDto,
} from "./dto";
import type {
  Delivery,
  DeliveryPage,
  Notification,
  NotificationPage,
  PreferenceRow,
} from "./types";

/**
 * Wire shapes in, entities out — the only file besides `repository.ts`
 * allowed to name a DTO.
 *
 * Thin on purpose. Every decision that could be taken here has already been
 * taken on the server and taken *once*: which channels resolved, whether a
 * type is locked, who a rule reaches, which category a row belongs to. A
 * client that recomputed any of them would be a second copy of a rule — and
 * the copy that drifts is always the one nobody runs against real data.
 *
 * What is left is turning ISO strings into `Date`s, which is exactly the
 * boundary this layer exists for.
 */

export function toNotification(dto: NotificationDto): Notification {
  return {
    id: dto.id,
    type: dto.type,
    category: dto.category,
    severity: dto.severity,
    title: dto.title,
    body: dto.body,
    link: dto.link,
    actorName: dto.actorName,
    read: dto.read,
    createdAt: new Date(dto.createdAt),
  };
}

export function toNotificationPage(dto: NotificationPageDto): NotificationPage {
  return {
    items: dto.items.map(toNotification),
    total: dto.total,
    page: dto.page,
    pages: dto.pages,
    unread: dto.unread,
  };
}

/**
 * A personal preference row.
 *
 * `enabled` is `null` and `recipients` is `null`, which is the type saying
 * *this is not the firm's screen* rather than inventing a `true` that a
 * component might later render as a switch the person cannot actually set.
 */
export function toPreferenceRow(dto: PreferenceDto): PreferenceRow {
  return {
    type: dto.type,
    category: dto.category,
    label: dto.label,
    description: dto.description,
    severity: dto.severity,
    mandatory: dto.mandatory,
    inApp: dto.inApp,
    email: dto.email,
    lockedInApp: dto.lockedInApp,
    lockedEmail: dto.lockedEmail,
    enabled: null,
    recipients: null,
    disabledByOrganisation: dto.disabledByOrganisation,
  };
}

/**
 * A rule row, in the same shape.
 *
 * `lockedInApp` is derived here and not sent: on the firm's screen the only
 * thing that can lock a channel is the notification being mandatory, and the
 * server already says which those are. Deriving one boolean from another the
 * response carries is not a second copy of a rule — recomputing *which types
 * are mandatory* would be.
 */
export function toRuleRow(dto: RuleDto): PreferenceRow {
  return {
    type: dto.type,
    category: dto.category,
    label: dto.label,
    description: dto.description,
    severity: dto.severity,
    mandatory: dto.mandatory,
    inApp: dto.inApp,
    email: dto.email,
    lockedInApp: dto.mandatory,
    lockedEmail: false,
    enabled: dto.enabled,
    recipients: dto.recipients,
    disabledByOrganisation: false,
  };
}

export function toDelivery(dto: DeliveryDto): Delivery {
  return {
    id: dto.id,
    channel: dto.channel,
    status: dto.status,
    attempts: dto.attempts,
    detail: dto.detail,
    queuedAt: new Date(dto.queuedAt),
    settledAt: dto.settledAt ? new Date(dto.settledAt) : null,
    type: dto.type,
    severity: dto.severity,
    recipient: dto.recipient,
  };
}

export function toDeliveryPage(dto: DeliveryPageDto): DeliveryPage {
  return {
    items: dto.items.map(toDelivery),
    total: dto.total,
    page: dto.page,
    pages: dto.pages,
  };
}
