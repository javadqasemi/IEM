import { Badge, type BadgeTone } from "@/shared/ui/primitives";
import {
  ORGANISATION_STATUSES,
  type IntegrationState,
  type Office,
  type OrganisationStatus,
} from "./types";

/**
 * Every enum this domain has, with its German label and its tone.
 *
 * One declaration per enum, read by the badge, the select and the filter alike
 * — the drift `entities/` exists to remove is a filter offering a value the
 * badge has no label for. The option list at the foot is built from the
 * **union constant**, not from this table's keys, so a value added to the union
 * and forgotten here is a type error rather than a dropdown quietly short of
 * one entry.
 */

const ORGANISATION_STATUS_META: Record<OrganisationStatus, { tone: BadgeTone; label: string }> = {
  ACTIVE: { tone: "energy", label: "Aktiv" },
  DORMANT: { tone: "neutral", label: "Ruhend" },
  LIQUIDATION: { tone: "bronze", label: "In Liquidation" },
};

export function organisationStatusLabel(status: string): string {
  return ORGANISATION_STATUS_META[status as OrganisationStatus]?.label ?? status;
}

export const ORGANISATION_STATUS_OPTIONS = ORGANISATION_STATUSES.map((value) => ({
  value,
  label: ORGANISATION_STATUS_META[value].label,
}));

/**
 * What an office is, at a glance.
 *
 * Three facts compete for the same space and only one badge is drawn, in this
 * order: archived beats internal beats headquarters. The order is the reader's
 * question — "why is this one not on the website" is answered by the first two,
 * and an archived headquarters cannot exist (`refuseArchiveOffice`), so the
 * precedence never hides something it should not.
 */
export function OfficeStateBadge({ office }: { office: Office }) {
  if (office.archivedAt) return <Badge tone="neutral">Archiviert</Badge>;
  if (!office.isPublic) return <Badge tone="gold">Intern</Badge>;
  if (office.isHeadquarters) return <Badge tone="navy">Hauptsitz</Badge>;
  return null;
}

/**
 * The single line an address occupies in a table.
 *
 * Joined with what is present rather than with placeholders: an office missing
 * its postcode should read as "Uttigenstrasse 49, Thun", not as
 * "Uttigenstrasse 49, — Thun". The gaps are reported by the publish warnings,
 * which is a place somebody can act on them.
 */
export function officeAddressLine(office: Office): string {
  const town = [office.zip, office.city].filter(Boolean).join(" ");
  return [office.street, town].filter(Boolean).join(", ");
}

const INTEGRATION_META: Record<IntegrationState, { tone: BadgeTone; label: string }> = {
  configured: { tone: "energy", label: "Konfiguriert" },
  unconfigured: { tone: "gold", label: "Nicht konfiguriert" },
  /**
   * Distinct from "not configured", and the distinction is the point — see the
   * note on `IntegrationState`. A grey "—" for both is how a missing feature
   * gets mistaken for a missing setting and waited on for ever.
   */
  unbuilt: { tone: "neutral", label: "Nicht gebaut" },
};

export function IntegrationStateBadge({ state }: { state: IntegrationState }) {
  const meta = INTEGRATION_META[state] ?? INTEGRATION_META.unbuilt;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/*
  There is no `formatBytes` here on purpose: `shared/utils/format.ts` already
  has one, and the media library and the executive dashboard both read it. A
  second copy in this folder would be the fourth place bytes are spelled and
  the first place they are spelled differently.
*/

/** `93'812 s` → `1 T 2 Std 3 Min`. Whole units only; seconds are noise here. */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return `${Math.max(0, Math.round(seconds))} Sek`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days} T`, hours && `${hours} Std`, minutes && `${minutes} Min`]
    .filter(Boolean)
    .join(" ");
}
