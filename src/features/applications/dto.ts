/**
 * The wire shapes. **This file and `mapper.ts` are the only two that may name
 * them** (`docs/enterprise-architecture.md` §3.1), and `boundary.test.ts`
 * enforces that rather than leaving it to review.
 *
 * Everything here is exactly what `/api/v1/applications` sends, including the
 * parts that are wrong for the domain and right for JSON: dates as ISO
 * strings, the status as an open `string`, `files` as an array the server
 * builds from a `jsonb` column.
 */

export type ApplicationFileDto = {
  originalName: string;
  size: number;
  mimeType: string;
};

export type ApplicationDto = {
  id: string;
  position: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  availableFrom: string | null;
  message: string | null;
  files: ApplicationFileDto[];
  /**
   * An open string, not the union.
   *
   * The server's enum and this client's union are two declarations of the same
   * set and nothing keeps them in step — the server may ship a seventh status
   * before this bundle is redeployed. Typing it as the union *here* would be a
   * lie the compiler believes; `mapper.ts` is where the narrowing happens and
   * where an unknown value has somewhere to go.
   */
  status: string;
  note: string | null;
  createdAt: string;
  retainUntil: string | null;
};

export type ApplicationStatsDto = {
  total: number;
  byStatus: Record<string, number>;
};

export type ApplicationPatchDto = {
  status?: string;
  note?: string;
};
