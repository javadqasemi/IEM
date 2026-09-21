import type {
  Delivery,
  DeliveryStatus,
  MailFailureCategory,
  MailState,
  MailStatus,
  MailTemplate,
  MailTestResult,
  MailVerifyResult,
} from "./types";

/**
 * Everything the mail screens decide that is arithmetic rather than I/O.
 *
 * Pure, so it can be covered exhaustively — the same split the server's rules
 * files make. What lives here is the wording and the tone of an operational
 * panel, and that is worth testing for one reason: **a status panel that reads
 * reassuringly when it should not is worse than no panel**, and nothing about
 * that failure is visible from the code that renders it.
 */

/* ================================================================== */
/* The verdict                                                         */
/* ================================================================== */

export type StateTone = "positive" | "warning" | "danger" | "neutral";

/**
 * How each state is drawn and what it is called.
 *
 * `unknown` is `neutral`, deliberately not `positive`. It is the state of a
 * server that is configured and has never been tested, and drawing it green
 * would be the panel asserting something nobody has checked.
 */
const STATE_COPY: Record<MailState, { label: string; tone: StateTone; detail: string }> = {
  healthy: {
    label: "Betriebsbereit",
    tone: "positive",
    detail: "Verbindung geprüft, Zustellungen laufen.",
  },
  warning: {
    label: "Eingeschränkt",
    tone: "warning",
    detail: "Es gibt fehlgeschlagene Zustellungen. Das Zustellprotokoll nennt den Grund.",
  },
  critical: {
    label: "Gestört",
    tone: "danger",
    detail: "Der Versand funktioniert nicht. Prüfen Sie Verbindung und Zugangsdaten.",
  },
  not_configured: {
    label: "Nicht konfiguriert",
    tone: "neutral",
    detail: "Ohne SMTP-Server werden E-Mails nur ins Server-Protokoll geschrieben.",
  },
  unknown: {
    label: "Ungeprüft",
    tone: "neutral",
    detail: "Konfiguriert, aber noch nie getestet. „Verbindung testen“ schafft Klarheit.",
  },
};

export function describeState(state: MailState) {
  return STATE_COPY[state];
}

/**
 * The one line that goes under the heading.
 *
 * An unreadable credential is called out ahead of everything else, because it
 * is the failure that otherwise reads as success: the row exists, so the panel
 * would say "configured", while every send fails for a reason two layers away.
 */
export function headlineFor(status: MailStatus): string {
  if (!status.secretsReadable) {
    return "Ein gespeichertes Passwort kann nicht entschlüsselt werden — APP_SECRETS_ENCRYPTION_KEY fehlt oder wurde gewechselt.";
  }
  if (!status.configured) return STATE_COPY.not_configured.detail;
  return STATE_COPY[status.state].detail;
}

/* ================================================================== */
/* Probes                                                              */
/* ================================================================== */

/** What a connection test says afterwards, in one sentence. */
export function describeVerify(result: MailVerifyResult): { ok: boolean; message: string } {
  if (result.status === "connected") {
    return { ok: true, message: `Verbindung zu ${result.describedAs} steht (${result.durationMs} ms).` };
  }
  if (result.status === "unconfigured") return { ok: false, message: result.reason };
  return { ok: false, message: result.failure.message };
}

/**
 * What a test send says afterwards.
 *
 * **Never claims the message arrived in an inbox.** The provider accepted it —
 * that is what "angenommen" means and it is all that is known. Saying
 * "zugestellt" would be a claim about a mail server this application has no
 * visibility into, and the difference matters precisely when somebody is
 * debugging a message that was accepted and then silently dropped.
 */
export function describeTest(result: MailTestResult): { ok: boolean; message: string } {
  if (result.stub) {
    return {
      ok: false,
      message:
        "Kein SMTP-Server konfiguriert — die Nachricht wurde ins Server-Protokoll geschrieben, nicht versendet.",
    };
  }
  if (result.ok) {
    return {
      ok: true,
      message: `${result.host} hat die Nachricht an ${result.to} angenommen (${result.durationMs} ms). Ob sie im Posteingang ankommt, entscheidet der Empfängerserver.`,
    };
  }
  return { ok: false, message: result.error ?? "Der Versand ist fehlgeschlagen." };
}

/* ================================================================== */
/* Deliveries                                                          */
/* ================================================================== */

const DELIVERY_COPY: Record<DeliveryStatus, { label: string; tone: StateTone }> = {
  DELIVERED: { label: "Zugestellt", tone: "positive" },
  FAILED: { label: "Fehlgeschlagen", tone: "danger" },
  PENDING: { label: "In Warteschlange", tone: "warning" },
  PROCESSING: { label: "Wird gesendet", tone: "warning" },
  /*
    Neutral, not amber.

    A skip is a deliberate non-send — a preference, a firm rule, or no SMTP
    server — and colouring it as a fault puts a wall of amber in front of every
    operator on every development machine, which is how somebody learns to
    ignore the colour that matters.
  */
  SKIPPED: { label: "Übersprungen", tone: "neutral" },
};

export function describeDelivery(status: DeliveryStatus) {
  return DELIVERY_COPY[status];
}

/**
 * Whether the retry button is offered at all.
 *
 * Mirrors the server's rule rather than guessing at it — the server is the
 * control and this is the courtesy, the same relationship every permission
 * check on this client has. Offering a button that can only produce a 400
 * reads as an offer.
 */
export function canRetry(delivery: Delivery): boolean {
  return delivery.channel === "EMAIL" && delivery.status === "FAILED";
}

/**
 * Why the button is absent, for the one case somebody will ask about.
 *
 * `SKIPPED` is the case: it looks like a failure in a list and is not one, so
 * the panel says why rather than leaving a gap where a control is on the row
 * above.
 */
export function retryRefusal(delivery: Delivery): string | null {
  if (canRetry(delivery)) return null;
  if (delivery.channel === "IN_APP") return "In-App-Meldungen brauchen keine Zustellung.";
  switch (delivery.status) {
    case "DELIVERED":
      return "Bereits zugestellt.";
    case "PENDING":
    case "PROCESSING":
      return "Läuft noch.";
    case "SKIPPED":
      return "Bewusst nicht versendet — kein Fehler.";
    default:
      return null;
  }
}

/* ================================================================== */
/* Templates                                                           */
/* ================================================================== */

/** The catalogue grouped for display, in a declared order. */
const CATEGORY_ORDER = ["Diagnose", "Konto", "Bewerbungen", "Benachrichtigungen"];

export function groupTemplates(
  items: MailTemplate[],
): { category: string; items: MailTemplate[] }[] {
  const groups = new Map<string, MailTemplate[]>();
  for (const item of items) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      // An unknown category sorts last rather than first, so adding one
      // cannot silently push the diagnostic template off the top.
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([category, list]) => ({ category, items: list }));
}

/* ================================================================== */
/* Failure categories                                                  */
/* ================================================================== */

/**
 * What an operator should do about each category.
 *
 * The server already sends a sentence of diagnosis; this is the *next step*,
 * which is the part a panel can add without repeating the message underneath
 * it. A category with no remedy is not in this map and renders nothing.
 */
const REMEDY: Partial<Record<MailFailureCategory, string>> = {
  CONFIGURATION: "Ergänzen Sie die fehlenden Felder und speichern Sie.",
  AUTHENTICATION: "Setzen Sie das SMTP-Passwort neu.",
  CONNECTION: "Prüfen Sie Server und Port; fragen Sie nach einer Firewall-Freigabe.",
  TLS: "Schalten Sie „TLS ab Verbindungsaufbau“ um — Port 465 ein, Port 587 aus.",
  TIMEOUT: "Meist eine Firewall. Erhöhen Sie notfalls das Zeitlimit.",
  RECIPIENT_REJECTED: "Die Konfiguration stimmt; prüfen Sie die Empfängeradresse.",
  RATE_LIMIT: "Warten Sie einen Moment und versuchen Sie es erneut.",
};

export function remedyFor(category: MailFailureCategory | null | undefined): string | null {
  return category ? (REMEDY[category] ?? null) : null;
}
