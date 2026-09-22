import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { CheckBadge } from "@/entities/system";
import { formatDateTime } from "@/shared/utils/format";
import { useDiagnostics } from "../hooks/useSystem";
import { formatDuration } from "../service";

/**
 * Eight active checks, run on request.
 *
 * ---
 *
 * ## Why there is a button rather than a poll
 *
 * Three of these open a connection to something outside the process and one
 * writes a file. Running them on every render would mean an SMTP handshake
 * per page view — rude to the mail server, and a fine way to have a provider
 * rate-limit the firm's address. The overview polls *counts*; this is a
 * deliberate act, and it is audited as one.
 *
 * ## The empty state is the honest one
 *
 * Nothing is shown until somebody presses the button, and the result is not
 * cached between visits. A remembered run would be served again tomorrow and
 * read as current, which is the opposite of what a diagnostic is for: its
 * entire value is that it happened just now.
 */
export function DiagnosticsScreen() {
  const diagnostics = useDiagnostics();

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Diagnose"
        description="Prüft aktiv, was die Übersicht nur zählen kann: Verbindungen, Schreibzugriff, Werkzeuge. Keine Prüfung verändert etwas, das jemandem gehört."
        action={
          <Button variant="primary" busy={diagnostics.busy} onClick={diagnostics.execute}>
            Diagnose ausführen
          </Button>
        }
      >
        {diagnostics.error ? (
          <ErrorState message={diagnostics.error} onRetry={diagnostics.execute} />
        ) : diagnostics.busy && !diagnostics.run ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : diagnostics.run ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-muted">
              Ausgeführt am {formatDateTime(diagnostics.run.startedAt)} · Gesamtdauer{" "}
              {formatDuration(diagnostics.run.durationMs)} ·{" "}
              <CheckBadge result={diagnostics.run.result} />
            </p>

            <ul className="flex flex-col divide-y divide-line">
              {diagnostics.run.checks.map((check) => (
                <li key={check.key} className="flex flex-col gap-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">
                      {check.label}
                    </span>
                    <span className="shrink-0 text-[12px] tnum text-muted">
                      {formatDuration(check.durationMs)}
                    </span>
                    <CheckBadge result={check.result} />
                  </div>
                  {/*
                    Always shown, including for a pass.

                    A green row with no sentence is a row that proves nothing —
                    "Bestanden" does not say *what* was checked, and the reader
                    who most needs this page is the one who does not already
                    know. The sentences are sanitized server-side; nothing here
                    ever renders a raw transport error.
                  */}
                  <p className="text-[13px] leading-relaxed text-muted">{check.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            title="Noch nicht ausgeführt"
            description="Die Diagnose stellt echte Verbindungen her, deshalb läuft sie nur auf Knopfdruck. Das Ergebnis wird nicht gespeichert — ein aufbewahrtes Ergebnis würde beim nächsten Besuch als aktuell gelesen."
          />
        )}
      </Card>
    </div>
  );
}
