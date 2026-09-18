/**
 * Swiss formatting, in one place.
 *
 * The conventions are the site's own and are not negotiable per screen:
 * apostrophe thousands (`1'450`), `de-CH` collation so Ä/Ö/Ü sort beside
 * A/O/U, and `dd.mm.yyyy`. A screen that formats a number itself is a screen
 * that will format it differently.
 *
 * These take **strings off the wire** rather than `Date` objects on purpose,
 * for now: the mapper layer (`docs/enterprise-architecture.md` §3.1) is what
 * turns an ISO string into a `Date`, and until a feature has one, its screens
 * still hold the raw value. Both overloads exist so the move does not have to
 * be atomic.
 */

/** Swiss convention: apostrophe thousands separator. */
export function formatNumber(n: number): string {
  return n.toLocaleString("de-CH");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 1 })} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 2 })} GB`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * "vor 3 Min." — relative for anything inside a week, absolute beyond it.
 *
 * Relative timestamps are easier to scan in a feed but useless for anything a
 * person might have to reference later, which is exactly what an audit trail
 * is for. Every call site pairs this with a `title` carrying the exact value.
 */
export function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} Min.`;
  if (seconds < 86400) return `vor ${Math.round(seconds / 3600)} Std.`;
  if (seconds < 604800) return `vor ${Math.round(seconds / 86400)} T.`;
  return new Date(value).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
