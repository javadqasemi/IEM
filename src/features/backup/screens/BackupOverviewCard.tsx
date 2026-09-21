import { Badge, Card } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { describeState, describeType, formatBytes } from "../service";
import type { BackupOverview } from "../types";

/**
 * The verdict and the evidence for it.
 *
 * Every figure is measured — the runs, the storage, the settings. Nothing on
 * this card is declared, which is the brief's "never fabricate health" applied
 * at the point where it is easiest to break.
 */
export function BackupOverviewCard({ status }: { status: BackupOverview }) {
  const state = describeState(status.state);

  return (
    <Card
      title="Status"
      description={state.detail}
      action={<Badge tone={state.tone}>{state.label}</Badge>}
    >
      {!status.toolsAvailable ? (
        /*
          First, because nothing else on this card matters if it is true: with
          no `pg_dump` there is no backup, whatever the history says.
        */
        <p className="mb-4 rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-ink ring-1 ring-brand-bronze/40">
          <strong>Die PostgreSQL-Werkzeuge fehlen.</strong> Ohne <code>pg_dump</code> und{" "}
          <code>pg_restore</code> kann nichts gesichert werden. Setzen Sie{" "}
          <code className="font-mono text-[12px]">PG_BIN_PATH</code>.
        </p>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Pair label="Wiederherstellungspunkte">
          <span className="text-[15px] font-semibold tabular-nums">{status.recoveryPoints}</span>
        </Pair>
        <Pair label="Letzte erfolgreiche Sicherung">
          {status.lastSuccessAt ? (
            <span title={formatDateTime(status.lastSuccessAt)}>
              {relativeTime(status.lastSuccessAt)}
              {status.lastSuccessType ? ` · ${describeType(status.lastSuccessType)}` : ""}
            </span>
          ) : (
            <span className="text-muted">— noch nie —</span>
          )}
        </Pair>
        <Pair label="Zuletzt geprüft">
          {status.lastVerifiedAt ? (
            <span title={formatDateTime(status.lastVerifiedAt)}>
              {relativeTime(status.lastVerifiedAt)}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Pair>
        <Pair label="Nächste geplante">
          {status.nextScheduledAt ? (
            <span title={formatDateTime(status.nextScheduledAt)}>
              {formatDateTime(status.nextScheduledAt)}
            </span>
          ) : (
            <span className="text-muted">Automatik ist aus</span>
          )}
        </Pair>
        <Pair label="Letzter Fehler">
          {status.lastFailureAt ? (
            <span title={formatDateTime(status.lastFailureAt)}>
              {relativeTime(status.lastFailureAt)}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Pair>
        <Pair label="Belegt / frei">
          {formatBytes(status.storage.usedBytes)} /{" "}
          {status.storage.freeBytes === null ? "—" : formatBytes(status.storage.freeBytes)}
        </Pair>
      </dl>

      {status.lastFailureDetail ? (
        <p className="mt-4 text-[13px] leading-relaxed text-muted">{status.lastFailureDetail}</p>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Pair label="Ablage">
            <span className="font-mono text-[12px]">{status.storage.location}</span>
          </Pair>
          <Pair label="Werkzeuge">
            {status.toolVersion ?? <span className="text-muted">nicht gefunden</span>}
          </Pair>
        </dl>

        {status.offSiteWarning ? (
          /*
            The sentence the brief insists on, and it comes from the API rather
            than being written here — so a future client cannot ship without
            it and this one cannot quietly soften it.

            It is not styled as an error, deliberately: local backups are a
            real and useful protection against the failures they *do* cover,
            and drawing them red would make an operator distrust the thing that
            is working.
          */
          <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-muted ring-1 ring-line">
            <strong className="text-ink">Keine Katastrophenvorsorge.</strong>{" "}
            {status.offSiteWarning}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
