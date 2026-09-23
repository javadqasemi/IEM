/**
 * The wire shapes, and nothing else.
 *
 * These names may appear in `repository.ts` and `mapper.ts` and nowhere above
 * them — `src/architecture.test.ts` enforces it, and the rule is what makes the
 * mapper a seam rather than a decoration. A renamed server field then lands in
 * two files with millisecond tests instead of in every screen.
 */

export type OrganisationDto = {
  id: string;

  name: string;
  shortName: string;
  description: string | null;
  foundedYear: number | null;
  organisationType: string;
  defaultLocale: string;
  defaultTimezone: string;
  defaultCurrency: string;
  status: "ACTIVE" | "DORMANT" | "LIQUIDATION";

  legalName: string | null;
  legalForm: string | null;
  uid: string | null;
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

  version: number;
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
};

/**
 * The envelope `GET /organisation` returns.
 *
 * `canEditLegal` travels with the record rather than being derived from the
 * client's permission set, and that is not redundancy: the server is the one
 * that decides, and a form that guessed would let somebody fill in a UID and
 * meet a 403 on save.
 */
export type OrganisationEnvelopeDto = {
  organisation: OrganisationDto;
  canEditLegal: boolean;
  officeKinds: string[];
};

/** `PATCH /organisation` answers with the record **and** its soft warnings. */
export type OrganisationSaveDto = {
  organisation: OrganisationDto;
  warnings: string[];
};

export type UpdateOrganisationBody = Partial<
  Omit<OrganisationDto, "id" | "version" | "updatedAt" | "updatedBy">
> & { expectedVersion: number };

export type OfficeDto = {
  id: string;
  name: string;
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
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateOfficeBody = Omit<
  OfficeDto,
  "id" | "archivedAt" | "version" | "createdAt" | "updatedAt"
>;

export type UpdateOfficeBody = Partial<CreateOfficeBody> & { expectedVersion: number };

/* ================================================================== */
/* Settings — the key/value half of the workspace                      */
/* ================================================================== */

export type SettingDto = {
  key: string;
  group: string;
  description: string | null;
  value: unknown;
  hasValue: boolean;
  secret: boolean;
  updatedAt: string;
  /**
   * Sent by the server from its own declaration.
   *
   * The screen used to **infer** the control from the stored value's JavaScript
   * type, which meant a setting could not render correctly until it already
   * held the right kind of value — and an operator who had stored a string in a
   * numeric setting was shown a text box confirming the mistake.
   */
  type: "string" | "text" | "email" | "url" | "number" | "boolean" | "stringList" | "select";
  pending: boolean;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  unit?: string;
  blankMeans?: string;
  /** Present when changing this weakens a control. The screen confirms first. */
  dangerous?: string;
  /** Which authority a change needs, beyond `settings.update` (P0, SEC-5). */
  authority?: "ordinary" | "security" | "credential" | "secret";
  /** Whether **this caller** holds it. Absent from an older server: editable. */
  canEdit?: boolean;
};

export type SettingGroupDto = { group: string; settings: SettingDto[] };

/* ================================================================== */
/* System                                                              */
/* ================================================================== */

export type SystemInfoDto = {
  runtime: {
    node: string;
    environment: string;
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    version: string | null;
    versionReason: string | null;
    commit: string | null;
    builtAt: string | null;
    buildSource: "environment" | "stamp" | "none";
  };
  database: {
    status: "ok" | "error";
    latencyMs: number;
    migrations: { applied: number; pending: number; latest: string | null; latestAt: string | null };
    snapshots: number;
    auditRows: number;
  };
  jobs: Record<string, number>;
  storage: { driver: string; assets: number; bytes: number };
  seed: { permissions: number; contentTypes: number; offices: number };
  integrations: {
    key: string;
    label: string;
    state: "configured" | "unconfigured" | "unbuilt";
    source: string | null;
    detail: string | null;
  }[];
};

