import { Badge, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { useBackupStatus, useRetentionPreview } from "../hooks/useBackups";
import { describeState, formatBytes } from "../service";

/**
 * The panel under *Einstellungen → Sicherung*.
 *
 * ---
 *
 * ## Configuration here, operations elsewhere
 *
 * The brief's split, and the reason is muscle memory: a settings page trains
 * "change a field, press save", and the most dangerous control in the
 * application must not live inside that. So this shows what the configuration
 * *means* — when the next backup runs, what retention would do, where the
 * files go — and points at `/sicherungen` for the history and the restore.
 *
 * ## The retention preview is the point of this panel
 *
 * A retention policy is three numbers whose effect is invisible until the
 * night it deletes something. Showing "43 vorhanden, 22 bleiben, 21 würden
 * gelöscht" against the numbers currently in the form is the difference
 * between configuring a rule and guessing at one — and it is computed by the
 * **same function the job uses**, so it cannot disagree with what actually
 * happens.
 */
export function BackupSettingsPanel() {
  const status = useBackupStatus();
  const retention = useRetentionPreview();

  if (status.error) {
    return <ErrorState message="Der Sicherungsstatus konnte nicht geladen werden." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Wirkung dieser Einstellungen"
        description="Was mit den gespeicherten Werten tatsächlich passiert."
        action={
          status.data ? (
            <Badge tone={describeState(status.data.state).tone}>
              {describeState(status.data.state).label}
            </Badge>
          ) : null
        }
      >
        {status.data ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Pair label="Automatik">
              {status.data.automatic ? "Eingeschaltet" : "Ausgeschaltet"}
            </Pair>
            <Pair label="Nächste Sicherung">
              {status.data.nextScheduledAt
                ? new Date(status.data.nextScheduledAt).toLocaleString("de-CH")
                : "—"}
            </Pair>
            <Pair label="Wiederherstellungspunkte">{status.data.recoveryPoints}</Pair>
            <Pair label="Ablage">
              <span className="font-mono text-[12px]">{status.data.storage.location}</span>
            </Pair>
            <Pair label="Belegt">{formatBytes(status.data.storage.usedBytes)}</Pair>
            <Pair label="Frei">
              {status.data.storage.freeBytes === null
                ? "—"
                : formatBytes(status.data.storage.freeBytes)}
            </Pair>
          </dl>
        ) : (
          <Skeleton className="h-24" />
        )}

        {status.data?.offSiteWarning ? (
          <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-muted ring-1 ring-line">
            <strong className="text-ink">Keine Katastrophenvorsorge.</strong>{" "}
            {status.data.offSiteWarning}
          </p>
        ) : null}
      </Card>

      <Card
        title="Aufbewahrung — Vorschau"
        description="Was die Regel beim nächsten Durchlauf täte, gerechnet mit den gespeicherten Werten."
      >
        {retention.error ? (
          <ErrorState message="Die Vorschau konnte nicht berechnet werden." />
        ) : retention.data ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Count label="Vorhanden" value={retention.data.total} />
              <Count label="Bleiben" value={retention.data.keep} />
              <Count label="Würden gelöscht" value={retention.data.remove} />
            </div>

            {retention.data.spared.length ? (
              <div className="mt-5">
                <h4 className="field-label">Ausgenommen</h4>
                <ul className="mt-2 flex flex-col gap-1">
                  {/*
                    The reasons, listed. "Why is this one still here" is the
                    question an operator asks about a retention rule, and a
                    preview that only gave counts would not answer it.
                  */}
                  {dedupe(retention.data.spared.map((s) => s.reason)).map((reason) => (
                    <li key={reason} className="text-[13px] leading-relaxed text-muted">
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="mt-5 text-[13px] leading-relaxed text-muted">
              Die letzte geprüfte Sicherung jeder Art bleibt immer stehen, auch wenn die Anzahl auf
              0 steht — eine falsch gesetzte Zahl ist kein Grund, ohne Wiederherstellungspunkt
              dazustehen.
            </p>
          </>
        ) : (
          <Skeleton className="h-24" />
        )}
      </Card>

      <Card title="Betrieb">
        <p className="text-[13px] leading-relaxed text-muted">
          Der Verlauf, das manuelle Sichern und das Einspielen stehen unter{" "}
          <a className="link" href="#/sicherungen">
            Sicherungen
          </a>
          . Sie liegen bewusst nicht hier: eine Einstellungsseite lädt dazu ein, ein Feld zu ändern
          und zu speichern, und der gefährlichste Vorgang der Anwendung gehört nicht in diese
          Bewegung.
        </p>
      </Card>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 ring-1 ring-line">
      <span className="text-[13px] font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </span>
  );
}

const dedupe = (values: string[]): string[] => [...new Set(values)];
