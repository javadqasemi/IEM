/**
 * The firm and its offices, as the dashboard thinks about them.
 *
 * The **entity**, not the wire shape: dates are `Date`, the status is a closed
 * union, and nothing here exists only because of how the API serialises.
 * `features/organisation/dto.ts` holds the wire shape and `mapper.ts` is the
 * only thing that has seen both.
 *
 * Here rather than in the feature because the company's identity is the one
 * piece of vocabulary every future module needs — an offer, an invoice, a
 * transmittal letterhead and a PDF title block all name the firm, and each
 * would otherwise invent its own shape for it.
 */

export const ORGANISATION_STATUSES = ["ACTIVE", "DORMANT", "LIQUIDATION"] as const;
export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number];

/** What the firm *is*: identity, legal record, contacts, website defaults. */
export type Organisation = {
  name: string;
  shortName: string;
  description: string | null;
  foundedYear: number | null;
  organisationType: string;
  defaultLocale: string;
  defaultTimezone: string;
  defaultCurrency: string;
  status: OrganisationStatus;

  legalName: string | null;
  legalForm: string | null;
  /** Swiss business identification number, `CHE-123.456.789`. */
  uid: string | null;
  /** The same number with its ` MWST` suffix, when VAT-registered. */
  vatId: string | null;
  commercialRegister: string | null;
  registerOffice: string | null;
  legalStreet: string | null;
  legalZip: string | null;
  legalCity: string | null;
  legalCountry: string;
  invoiceAddress: string | null;
  legalContactName: string | null;
  legalContactEmail: string | null;
  dataProtectionContactName: string | null;
  dataProtectionContactEmail: string | null;
  copyright: string | null;
  legalNotice: string | null;

  mainEmail: string | null;
  mainPhone: string | null;
  recruitmentEmail: string | null;
  supportEmail: string | null;
  billingEmail: string | null;
  website: string | null;

  seoTitlePattern: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  faviconUrl: string | null;

  /** The optimistic lock. Every form carries it back. */
  version: number;
  updatedAt: Date;
  updatedBy: { id: string; name: string } | null;
};

/**
 * A branch office — master data *and* website content.
 *
 * `isPublic` is what lets those two live in one table: a registered address
 * nobody should visit is a real row that simply does not reach the site.
 */
export type Office = {
  id: string;
  name: string;
  /** Printed opposite the city on the site — "Hauptsitz", "Zweigbüro". */
  kind: string;
  street: string | null;
  zip: string | null;
  city: string | null;
  canton: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  openingHours: string | null;
  isHeadquarters: boolean;
  isPublic: boolean;
  position: number;
  /** Closed, but still pointed at by employees and projects. Not deleted. */
  archivedAt: Date | null;
  version: number;
};

/** The fields an office form writes. No id, no version, no timestamps. */
export type OfficeDraft = Omit<Office, "id" | "archivedAt" | "version">;

/**
 * One configurable value, with everything needed to render a control for it.
 *
 * `type` comes from the **server's declaration**, not from the stored value's
 * JavaScript type. Inferring it was the old behaviour and it meant a setting
 * could not be rendered correctly until it already held the right kind of
 * value — so an operator who had stored a string in a numeric setting was
 * shown a text box confirming the mistake.
 */
export type SettingType =
  | "string"
  | "text"
  | "email"
  | "url"
  | "number"
  | "boolean"
  | "stringList"
  | "select";

export type Setting = {
  key: string;
  group: string;
  label: string;
  value: unknown;
  type: SettingType;
  secret: boolean;
  /** For a secret: whether one is stored at all. The value never leaves. */
  hasValue: boolean;
  /** Stored and editable, read by no code yet. Drawn as such, never hidden. */
  pending: boolean;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  unit?: string;
  /** What clearing the field means, when it means something. */
  blankMeans?: string;
  /** Set when changing this weakens a control — the screen confirms first. */
  dangerous?: string;
};

export type SettingGroup = { group: string; settings: Setting[] };

export type MailTestResult = {
  ok: boolean;
  /** No SMTP server configured, so the message was logged rather than sent. */
  stub: boolean;
  host: string;
  error?: string;
  to: string;
};

/* ================================================================== */
/* System                                                              */
/* ================================================================== */

/**
 * Three states, not two.
 *
 * "Not configured" and "not built" are different answers — the first is a form
 * somebody can fill in, the second is work on the roadmap — and showing them as
 * the same grey dot is how a missing feature gets mistaken for a missing
 * setting and waited on for ever.
 */
export type IntegrationState = "configured" | "unconfigured" | "unbuilt";

export type Integration = {
  key: string;
  label: string;
  state: IntegrationState;
  source: string | null;
  detail: string | null;
};

export type SystemInfo = {
  runtime: {
    node: string;
    environment: string;
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    /** Null: nothing stamps a build here. `versionReason` says so on screen. */
    version: string | null;
    versionReason: string;
  };
  database: {
    status: "ok" | "error";
    latencyMs: number;
    migrations: {
      applied: number;
      /** Rows with no `finished_at` — a migration that failed part-way. */
      pending: number;
      latest: string | null;
      latestAt: Date | null;
    };
    snapshots: number;
    auditRows: number;
  };
  jobs: Record<string, number>;
  storage: { driver: string; assets: number; bytes: number };
  seed: { permissions: number; contentTypes: number; offices: number };
  integrations: Integration[];
};
