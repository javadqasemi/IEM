import { Badge, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { formatBytes, formatDateTime } from "@/shared/utils/format";
import {
  IntegrationStateBadge,
  formatUptime,
  type SystemInfo,
} from "@/entities/organisation";
import { useSystemInfo } from "../hooks/useOrganisation";
import type { SettingsSection } from "../service";

/**
 * The operational read-out: runtime, database, queue, storage, integrations.
 *
 * **Read-only, and everything on it is measured.** That is the rule the
 * executive dashboard's `missingMetrics` already follows and the reason this
 * panel is worth opening: an integration reported as "konfiguriert" because
 * somebody filled in a form is not a status, and a backup tile showing
 * "letzte Sicherung: —" beside a green tick is worse than no tile.
 *
 * Three things the brief asks for are therefore shown as **absent with a
 * reason** rather than faked: the application version (nothing stamps a
 * build), backups (no backup system exists), and analytics and maps (no
 * integration). Each says so in its own words, in the row where a reader
 * would look for it.
 */
export function SystemSection({ section }: { section: SettingsSection }) {
  const system = useSystemInfo(true);

  if (system.error) return <ErrorState message={system.error} onRetry={system.refetch} />;
  if (!system.data) {
    return (
      <div className="flex flex-col gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    );
  }

  const info: SystemInfo = system.data;
  const jobs = Object.entries(info.jobs);

  return (
    <div className="flex flex-col gap-6">
      <Card title={section.title} description={section.description}>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Pair label="Umgebung">{info.runtime.environment}</Pair>
          <Pair label="Node">{info.runtime.node}</Pair>
          <Pair label="Laufzeit">{formatUptime(info.runtime.uptimeSeconds)}</Pair>
          <Pair label="Arbeitsspeicher">{formatBytes(info.runtime.rssBytes)}</Pair>
          {/*
            `className` on the group rather than a wrapping `<div>`.

            A `div` inside a `dl` has to *be* a dt/dd group; one that contains
            a nested `<dl>` is an axe `definition-list` violation, which is how
            this was written first and how the suite caught it.
          */}
          {/*
            Version, commit and build time — real since P2-6, and the fallback
            is still the point.

            This row carried a hardcoded "Kein Build-Stempel" for three
            slices, because `package.json`'s `0.0.1` never changes and would
            answer "ist der Fix deployed?" confidently and wrongly. Now there
            is something true to show, and the absent case still says why.

            **The `||` chain matters.** A deployment may set `APP_COMMIT` and
            no `APP_VERSION`, which is a legitimate and common shape — and
            `version ?? reason` would then render *nothing*, because both are
            null. A silently blank row is worse than either answer.
          */}
          <Pair label="Anwendungsversion" className="sm:col-span-2">
            {info.runtime.version || info.runtime.commit ? (
              <span className="flex flex-col gap-0.5">
                <span className="font-mono tnum">
                  {info.runtime.version ?? "ohne Versionsnummer"}
                </span>
                <span className="text-[12px] text-muted">
                  {[
                    info.runtime.commit ? `Commit ${info.runtime.commit}` : null,
                    info.runtime.builtAt ? `gebaut am ${info.runtime.builtAt.slice(0, 10)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            ) : (
              <span className="text-[13px] leading-snug text-muted">
                {info.runtime.versionReason ?? "Version unbekannt."}
              </span>
            )}
          </Pair>
        </dl>
      </Card>

      <Card
        title="Datenbank"
        description="Erreichbarkeit, Migrationsstand und die beiden Tabellen, an denen sich das Alter einer Installation ablesen lässt."
        action={
          <Badge tone={info.database.status === "ok" ? "energy" : "bronze"}>
            {info.database.status === "ok" ? "Erreichbar" : "Fehler"}
          </Badge>
        }
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Pair label="Antwortzeit">{info.database.latencyMs} ms</Pair>
          <Pair label="Migrationen">
            <span className="flex flex-wrap items-center gap-2">
              {info.database.migrations.applied} angewendet
              {/*
                A migration row with no `finished_at` failed part-way. It is
                the one thing on this panel that is an *alarm* rather than a
                figure, so it is a badge and not a number in a list.
              */}
              {info.database.migrations.pending > 0 ? (
                <Badge tone="bronze">{info.database.migrations.pending} unvollständig</Badge>
              ) : null}
            </span>
          </Pair>
          <Pair label="Letzte Migration">{info.database.migrations.latest ?? "—"}</Pair>
          <Pair label="Angewendet am">
            {info.database.migrations.latestAt
              ? formatDateTime(info.database.migrations.latestAt)
              : "—"}
          </Pair>
          <Pair label="Snapshots">{info.database.snapshots}</Pair>
          <Pair label="Audit-Einträge">{info.database.auditRows.toLocaleString("de-CH")}</Pair>
        </dl>
      </Card>

      <Card
        title="Warteschlange"
        description="Hintergrundaufgaben nach Zustand. Noch ohne eigene Bedienoberfläche — siehe docs/ENTERPRISE_ROADMAP.md, P2-1."
      >
        {jobs.length === 0 ? (
          <p className="text-[13px] text-muted">Keine Aufgaben in der Warteschlange.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            {jobs.map(([status, count]) => (
              <Pair key={status} label={status}>
                {count}
              </Pair>
            ))}
          </dl>
        )}
      </Card>

      <Card title="Ablage" description="Medienbibliothek und der Treiber, der sie speichert.">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
          <Pair label="Treiber">{info.storage.driver}</Pair>
          <Pair label="Dateien">{info.storage.assets.toLocaleString("de-CH")}</Pair>
          <Pair label="Belegt">{formatBytes(info.storage.bytes)}</Pair>
        </dl>
      </Card>

      <Card
        title="Integrationen"
        description="Ob etwas konfiguriert ist und woher der Wert kommt — nie der Wert selbst."
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-line">
          {info.integrations.map((integration) => (
            <li key={integration.key} className="flex flex-col gap-1.5 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{integration.label}</span>
                <span className="flex items-center gap-2">
                  {integration.source ? (
                    <span className="text-[12px] text-muted">{integration.source}</span>
                  ) : null}
                  <IntegrationStateBadge state={integration.state} />
                </span>
              </div>
              {integration.detail ? (
                <p className="text-[13px] leading-snug text-muted">{integration.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Katalogstand"
        description="Was der Code deklariert, verglichen mit dem, was die Datenbank hält. Weicht es ab, ist der Seed nicht durchgelaufen."
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
          <Pair label="Berechtigungen">{info.seed.permissions}</Pair>
          <Pair label="Inhaltstypen">{info.seed.contentTypes}</Pair>
          <Pair label="Aktive Standorte">{info.seed.offices}</Pair>
        </dl>
      </Card>
    </div>
  );
}
