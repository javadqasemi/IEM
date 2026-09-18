import {
  ApiError,
  buildUrl,
  getAccessToken,
  notifyUnauthenticated,
  refreshSession,
  type ApiErrorBody,
  type QueryValue,
} from "./client";

/**
 * Fetches a non-JSON route and saves the body as a file.
 *
 * The two download routes — the audit CSV and an application dossier — were
 * plain `<a href>` links, on the belief recorded in the old comment that "the
 * link carries the session cookie and the server checks the permission on the
 * way through". It does not. The only cookie this system issues is
 * `refresh_token`, scoped to `path=/api/v1/auth`, so a browser navigating to
 * `/api/v1/audit/export` sends no credential at all; `JwtAuthGuard` had an
 * `access_token` cookie fallback that nothing ever set. **Both links returned
 * 401** — reproduced against a running server, then fixed here and in
 * `guards.ts`.
 *
 * So the credential is carried the same way every other call carries it, in the
 * `Authorization` header, which means this goes through the shared refresh-and-
 * retry path and a download started twenty minutes into a session works. The
 * cost is that the file is buffered in memory before it is saved. Both bodies
 * here are small — a CSV of the audit log and a CV — and the alternative, giving
 * the browser a credential it attaches by itself, is the one that would reopen
 * CSRF on every other route.
 *
 * The filename comes from `Content-Disposition` when the server sends one, so
 * the dossier keeps the applicant's own filename rather than becoming `4`.
 */
export async function download(
  path: string,
  options: { query?: Record<string, QueryValue>; fallbackName: string },
): Promise<void> {
  const url = buildUrl(path, options.query);

  const send = async (): Promise<Response> => {
    const token = getAccessToken();
    return fetch(url.toString(), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
  };

  let res = await send();
  if (res.status === 401) {
    // Same three-way answer as `request`: only an outright refusal ends the
    // session. A download attempted while the network is down fails as a
    // download, not as a sign-out.
    const outcome = await refreshSession();
    if (outcome === "renewed") res = await send();
    else if (outcome === "rejected") notifyUnauthenticated();
  }

  if (!res.ok) {
    let payload: ApiErrorBody | null = null;
    try {
      payload = (await res.json()) as ApiErrorBody;
    } catch {
      /* A non-JSON error body tells us nothing more than the status does. */
    }
    throw new ApiError(
      payload ?? {
        statusCode: res.status,
        code: "download_failed",
        message: `Der Download ist fehlgeschlagen (${res.status}).`,
      },
    );
  }

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filenameFrom(res.headers.get("content-disposition")) ?? options.fallbackName;
  // Firefox needs the element in the document for a programmatic click to
  // count as a user-initiated download.
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick rather than immediately: revoking synchronously
  // races the browser's own read of the URL and silently saves an empty file.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/**
 * `attachment; filename="Lebenslauf%20M.pdf"` → `Lebenslauf M.pdf`.
 *
 * Exported for its own test. The header is written by the server for a filename
 * an *applicant* chose, so it is the one string here shaped by someone outside
 * the organisation — umlauts, spaces and quotes all turn up, and getting it
 * wrong means a dossier saved as `files` with no extension.
 */
export function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  const raw = star?.[1] ?? plain?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}
