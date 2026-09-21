/**
 * The firm, as shared vocabulary.
 *
 * `features/organisation` is the only reader today. It is an entity rather
 * than a feature-local type because the company's identity is what every
 * future module names: an offer's letterhead, an invoice's VAT line, a
 * transmittal's sender block and a PDF title block all need it, and each would
 * otherwise invent its own shape.
 */
export {
  ORGANISATION_STATUSES,
  type IntegrationState,
  type Integration,
  type Office,
  type OfficeDraft,
  type Organisation,
  type OrganisationStatus,
  type Setting,
  type SettingGroup,
  type SettingType,
  type SystemInfo,
} from "./types";

export {
  IntegrationStateBadge,
  OfficeStateBadge,
  ORGANISATION_STATUS_OPTIONS,
  formatUptime,
  officeAddressLine,
  organisationStatusLabel,
} from "./labels";

