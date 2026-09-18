import type { Response } from "express";

/**
 * One CSV, written one way.
 *
 * **This is the fourth module that needed it**, which is one past the point the
 * rule in `CLAUDE.md` names: *"when a new service is going to be injected by
 * more than the feature it sits in, it belongs in `core/` before the second
 * caller appears, not after."* `csvCell` is not a service — it is a pure
 * function, so it lives in `common/` rather than `core/` — but the argument is
 * the same and it had already been made three times.
 *
 * `tasks.controller.ts`, `projects.controller.ts` and `meetings.controller.ts`
 * each still carry their own copy. They are **deliberately not migrated here**:
 * the module that needed a fourth copy is the one that pays for the extraction,
 * and rewriting three working controllers inside a commit about Pläne is how a
 * change nobody asked for reaches production. They are debt, they are counted,
 * and the list may only shrink.
 *
 * ---
 *
 * Three things this does that a `join(";")` does not, and each is a bug:
 *
 * - **The leading apostrophe on `=`, `+`, `-` and `@` is not formatting.** A
 *   field beginning `=` is executed by Excel on open, so a plan titled
 *   `=Steigzone` is a formula in somebody's spreadsheet. This is CSV injection
 *   and it is the reason this helper exists rather than a template string.
 * - **The BOM is what makes Excel read UTF-8** instead of the system codepage.
 *   Without it `Massstab` arrives as `MassstabÃ¶` and the firm concludes the
 *   export is broken.
 * - **`;` rather than `,`**, because Excel in a de-CH locale splits on the
 *   semicolon and would otherwise put the whole row in column A.
 */
export function csvCell(value: string): string {
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}

/**
 * Sends `rows` as a CSV attachment.
 *
 * `fallbackHeaders` is used when there are no rows: an empty export should
 * still open as a table with the right columns rather than as an empty file,
 * because an empty file reads as a failed download.
 *
 * The caller must use `@Res()` **without** `passthrough`, which bypasses
 * `EnvelopeInterceptor` — a CSV wrapped in `{ data: … }` is not a CSV.
 *
 * `Content-Disposition` is safe here and is **not** safe on a PDF body: see the
 * note in `CLAUDE.md` about Chromium 153, where the pair produces a 204 with an
 * empty body same-origin. A CSV triggers none of it.
 */
export function sendCsv(
  res: Response,
  rows: readonly Record<string, string | number | null | undefined>[],
  fallbackHeaders: readonly string[],
  name: string,
): void {
  const headers = rows.length ? Object.keys(rows[0]) : [...fallbackHeaders];
  const body = [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => csvCell(String(row[header] ?? ""))).join(";")),
  ].join("\r\n");

  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    })
    .send("﻿" + body);
}
