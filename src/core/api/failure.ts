import { ApiError } from "./client";

/**
 * What went wrong with a write, in the vocabulary a screen acts on.
 *
 * ---
 *
 * The dashboard used to have one shape for this — `string | null` on
 * `useMutation` — and a `null` result that callers were free to ignore. Most
 * did: fourteen call sites showed a success toast straight after an `await`
 * that had just failed, because nothing about a `null` says "stop". The kind
 * is here so a screen can tell the six answers apart without reading a status
 * code, and so the one answer that must not be handled like the others — a
 * conflict — is a value a `switch` has to consider.
 *
 * | Kind | From | What the screen does |
 * | --- | --- | --- |
 * | `validation` | 400/422 with field messages | puts each message beside its field |
 * | `permission` | 403 | says so; retrying will not help |
 * | `conflict` | 409 | stops, keeps the input, offers the newer record |
 * | `notFound` | 404 | the record is gone or out of reach — both are one answer |
 * | `unavailable` | no response, 5xx, 429 | keeps the input; trying again may work |
 * | `rejected` | any other 4xx | a domain rule said no, and its sentence says why |
 */
export type FailureKind =
  | "validation"
  | "permission"
  | "conflict"
  | "notFound"
  | "unavailable"
  | "rejected";

export type MutationFailure = {
  kind: FailureKind;
  /** A German sentence a person can act on. Never a stack trace or a status line. */
  message: string;
  /** Per-field messages, keyed as the server named the fields. Empty when none. */
  fields: Record<string, string[]>;
  /** The server's machine code when there is one — `reauth_required`, `privilege_ceiling`. */
  code: string | null;
  /** The HTTP status, or `0` when no response arrived. */
  status: number;
};

/**
 * The result of a write. Narrow on `ok` before touching `data`.
 *
 * A discriminated union rather than `T | null`, and the difference is the
 * point: `null` is a value a caller can forget to check, while `data` on a
 * failed result does not exist, so reading it without narrowing is a type
 * error rather than a success toast.
 */
export type MutationResult<T> = { ok: true; data: T } | { ok: false; failure: MutationFailure };

/**
 * The sentences used when the server's own is not one to show.
 *
 * A 4xx from this API carries a German sentence written for the person who
 * caused it — `organisation.rules.ts` names the repair, `refuseTransition`
 * says what to do instead — and those are passed through. A 5xx carries
 * whatever the framework produced (`Internal server error`), and a failed
 * `fetch` carries the browser's (`Failed to fetch`, `NetworkError when
 * attempting to fetch resource.`). Neither is written for anybody, both are
 * English, and neither says the one thing a person needs to know: **their
 * input is still there.**
 */
export const FAILURE_MESSAGES = {
  offline:
    "Der Server ist nicht erreichbar. Ihre Eingaben sind noch da — bitte in einem Moment erneut versuchen.",
  server:
    "Der Server hat einen Fehler gemeldet. Ihre Eingaben sind noch da — bitte erneut versuchen.",
  throttled:
    "Zu viele Anfragen in kurzer Zeit. Bitte einen Moment warten und dann erneut versuchen.",
  session:
    "Ihre Anmeldung konnte nicht bestätigt werden. Ihre Eingaben sind noch da — bitte erneut versuchen.",
  permission: "Dafür fehlt Ihnen die Berechtigung.",
  notFound: "Der Eintrag wurde nicht gefunden. Möglicherweise wurde er inzwischen gelöscht.",
  conflict:
    "Der Eintrag wurde inzwischen von jemand anderem geändert. Ihre Eingaben sind nicht gespeichert.",
  unknown: "Das hat nicht geklappt. Bitte erneut versuchen.",
} as const;

/**
 * Classifies anything a write can throw.
 *
 * Pure, and the only place the status codes are read — so the day the API
 * starts answering 423 for a locked record, this is the one line that learns
 * it, and every screen follows.
 */
export function toFailure(err: unknown): MutationFailure {
  if (err instanceof ApiError) {
    const status = err.status;
    const code = err.code || null;
    const fields = err.fields ?? {};
    const serverSentence = usable(err.message);

    if (status === 409) {
      return { kind: "conflict", message: serverSentence ?? FAILURE_MESSAGES.conflict, fields, code, status };
    }
    if (status === 403) {
      return { kind: "permission", message: serverSentence ?? FAILURE_MESSAGES.permission, fields, code, status };
    }
    if (status === 404) {
      return { kind: "notFound", message: serverSentence ?? FAILURE_MESSAGES.notFound, fields, code, status };
    }
    if (status === 401) {
      // The client has already tried to refresh. If that was refused the shell
      // is on its way to the login screen; if the refresh never arrived, the
      // session may be fine and the next attempt will say so.
      return { kind: "unavailable", message: FAILURE_MESSAGES.session, fields: {}, code, status };
    }
    if (status === 429) {
      return { kind: "unavailable", message: FAILURE_MESSAGES.throttled, fields, code, status };
    }
    if (status >= 500 || status === 0) {
      // The server's text is deliberately dropped: a 5xx body is the
      // framework's, not a sentence anybody wrote for this reader.
      return { kind: "unavailable", message: FAILURE_MESSAGES.server, fields: {}, code, status };
    }
    if (err.isValidation || Object.keys(fields).length > 0) {
      return {
        kind: "validation",
        message: serverSentence ?? "Bitte die markierten Felder prüfen.",
        fields,
        code,
        status,
      };
    }
    return { kind: "rejected", message: serverSentence ?? FAILURE_MESSAGES.unknown, fields, code, status };
  }

  /*
    Not an `ApiError`, so the request never produced a response: `fetch`
    rejects with a `TypeError` for a refused connection, DNS, CORS and a
    dropped network, and an `AbortError` for a cancelled call. All of those
    are "we could not ask", which is the `offline` sentence.
  */
  if (err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError")) {
    return { kind: "unavailable", message: FAILURE_MESSAGES.offline, fields: {}, code: null, status: 0 };
  }

  /*
    Anything else was thrown by our own code on the way — a mapper, a
    validation in a hook — and its message *was* written for a reader. Kept
    unless it is one of the framework's English defaults; otherwise the
    generic sentence.
  */
  const own = err instanceof Error ? usable(err.message) : null;
  return { kind: "rejected", message: own ?? FAILURE_MESSAGES.unknown, fields: {}, code: null, status: 0 };
}

/**
 * Whether a server or client message is fit to put in front of somebody.
 *
 * Refuses the empty string and the handful of framework defaults that reach
 * this layer in English. A blocklist rather than a language detector, because
 * the API's own messages are German by construction and the leak is always
 * one of these few strings.
 */
function usable(message: string | undefined | null): string | null {
  const text = message?.trim();
  if (!text) return null;
  if (/^(internal server error|bad request|forbidden|not found|conflict|unauthorized|failed to fetch|networkerror|load failed)\b/i.test(text)) {
    return null;
  }
  if (/^Die Anfrage ist fehlgeschlagen \(\d+\)\.?$/.test(text)) return null;
  return text;
}

/** Runs a write and returns its result instead of throwing. */
export async function attempt<T>(fn: () => Promise<T>): Promise<MutationResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, failure: toFailure(err) };
  }
}
