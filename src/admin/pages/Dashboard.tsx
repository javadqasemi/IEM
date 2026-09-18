import { formatBytes, formatDateTime, relativeTime } from "@/shared/utils/format";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { KpiCard, KpiUnavailable } from "@/shared/ui/data";
import { WorkflowBadge } from "@/entities/content";
import { ActivityFeed } from "@/widgets/activity";
import { api } from "../lib/api";
import { useAuth } from "@/core/auth";
import { useAsync } from "../lib/useAsync";
import { Link } from "@/core/router";

/**
 * The executive dashboard.
 *
 * Every figure here is counted from this database. The four the spec asks for
 * that have no source — visitors, conversions, revenue, customers — are shown
 * as explicitly unavailable rather than as zeros, because this project's whole
 * argument is that its numbers are checkable and a fabricated KPI would undo
 * that on the first screen.
 */
export function DashboardPage() {
  const { user, can } = useAuth();
  /**
   * `GET /dashboard/overview` requires `system.health`, which three of the
   * eleven seeded roles do not hold — Content Editor, Viewer and Guest. This is
   * also the landing page, so for those roles signing in used to end at a
   * full-page error where the dashboard should be.
   *
   * Asked for only when it can be had, and the page renders without it
   * otherwise: the greeting, the shortcuts and whatever else the reader *can*
   * see. A missing figure is a missing figure, not a broken screen — the same
   * judgement the KPI tiles already make about metrics with no data source.
   */
  const mayReadOverview = can("system.health");
  const overview = useAsync(
    () => (mayReadOverview ? api.overview() : Promise.resolve(null)),
    [mayReadOverview],
  );
  const health = useAsync(() => (can("system.health") ? api.health() : Promise.resolve(null)), []);

  // A genuine failure still gets an error state; a *refused* one does not,
  // because for these roles it is the expected answer rather than a fault.
  if (overview.error && mayReadOverview) {
    return <ErrorState message={overview.error} onRetry={overview.reload} />;
  }

  const data = overview.data;
  const ready = data?.content.readyToPublish ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={greeting()}
        title={user?.name ?? "Dashboard"}
        description="Was seit Ihrem letzten Besuch passiert ist — und was auf eine Entscheidung wartet."
        actions={
          can("content.publish") && ready > 0 ? (
            <Button variant="primary" href="#/veroeffentlichen" trailing={<span aria-hidden>→</span>}>
              {ready} {ready === 1 ? "Eintrag" : "Einträge"} veröffentlichen
            </Button>
          ) : null
        }
      />

      {/* ---- Waiting on someone ---- */}
      {data && (data.content.inReview > 0 || ready > 0) ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-brand-navy px-5 py-4 text-inverse">
          <p className="min-w-0 flex-1 text-[14px] leading-snug">
            {data.content.inReview > 0 ? (
              <>
                <span className="font-medium">{data.content.inReview}</span>{" "}
                {data.content.inReview === 1 ? "Eintrag wartet" : "Einträge warten"} auf Freigabe.{" "}
              </>
            ) : null}
            {ready > 0 ? (
              <>
                <span className="font-medium">{ready}</span>{" "}
                {ready === 1 ? "ist freigegeben und" : "sind freigegeben und"} noch nicht
                veröffentlicht.
              </>
            ) : null}
          </p>
          {data.content.inReview > 0 && can("content.approve") ? (
            // `subtle` on the navy panel: the admin `Button` has no inverse
            // variant, and a white-on-navy chip is what this needs.
            <Button
              size="sm"
              href="#/freigaben"
              className="bg-surface text-accent hover:bg-brand-sand"
            >
              Zur Prüfung
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ---- KPIs ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="eyebrow text-muted">Kennzahlen</h2>
        {overview.loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[116px] rounded-lg" />
            ))}
          </div>
        ) : data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Referenzprojekte" value={data.kpis.projects} href="/inhalte/projects" />
            <KpiCard label="Mitarbeitende" value={data.kpis.team} tone="water" href="/inhalte/team" />
            <KpiCard label="Offene Stellen" value={data.kpis.openings} tone="gold" href="/inhalte/openings" />
            <KpiCard
              label="Bewerbungen"
              value={data.kpis.applications}
              note={data.kpis.applicationsNew ? `${data.kpis.applicationsNew} neu` : "keine neuen"}
              tone="energy"
              href="/bewerbungen"
            />
            <KpiCard
              label="Medien"
              value={data.kpis.mediaCount}
              note={formatBytes(data.kpis.mediaBytes)}
              tone="neutral"
              href="/medien"
            />
            <KpiCard label="Benutzer" value={data.kpis.users} tone="neutral" href="/benutzer" />
            <KpiCard
              label="Inhalte gesamt"
              value={data.content.total}
              note={`${data.content.published} veröffentlicht`}
              tone="navy"
              href="/inhalte"
            />
            <KpiCard
              label="Entwürfe"
              value={data.content.draft}
              note="noch nicht eingereicht"
              tone="bronze"
              href="/inhalte?status=DRAFT"
            />
          </div>
        ) : null}
      </section>

      {/* ---- The honest gaps ---- */}
      {data?.missingMetrics.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="eyebrow text-muted">Ohne Datenquelle</h2>
            <p className="text-[13px] leading-snug text-muted">
              Diese Kennzahlen sind nicht angebunden. Sie stehen hier als Lücke und nicht als Null —
              eine erfundene Zahl wäre schlimmer als gar keine.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.missingMetrics.map((m) => (
              <KpiUnavailable key={m.key} label={m.label} reason={m.reason} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---- Activity ---- */}
        <Card
          className="lg:col-span-2"
          title="Letzte Aktivitäten"
          description="Aus dem Audit-Log."
          action={
            can("audit.read") ? (
              <Button size="sm" variant="ghost" href="#/audit">
                Alle ansehen
              </Button>
            ) : null
          }
          bodyClassName="px-5 py-1"
        >
          {overview.loading ? (
            <div className="flex flex-col gap-3 py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : (
            <ActivityFeed
              items={(data?.recentActivity ?? []).map((a) => ({
                id: a.id,
                action: a.action,
                actor: a.actor?.name ?? a.actorEmail ?? "System",
                target: a.resource,
                message: a.message,
                outcome: a.outcome,
                at: a.createdAt,
              }))}
            />
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {/* ---- Last publish ---- */}
          <Card title="Zuletzt veröffentlicht">
            {overview.loading ? (
              <Skeleton className="h-16" />
            ) : data?.lastPublish ? (
              <dl className="flex flex-col gap-2.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Version</dt>
                  <dd className="font-mono tnum text-ink">{data.lastPublish.version}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Zeitpunkt</dt>
                  <dd className="text-ink" title={formatDateTime(data.lastPublish.publishedAt)}>
                    {relativeTime(data.lastPublish.publishedAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Durch</dt>
                  <dd className="truncate text-ink">{data.lastPublish.publishedBy?.name ?? "—"}</dd>
                </div>
                {data.lastPublish.note ? (
                  <div className="flex flex-col gap-1 border-t border-line pt-2.5">
                    <dt className="text-muted">Notiz</dt>
                    <dd className="leading-snug text-ink">{data.lastPublish.note}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted">
                Noch nichts veröffentlicht. Die Website zeigt bis dahin den Stand, der im Build
                mitgeliefert wurde.
              </p>
            )}
          </Card>

          {/* ---- Recently edited ---- */}
          <Card title="Zuletzt bearbeitet" bodyClassName="px-5 py-1">
            {overview.loading ? (
              <div className="flex flex-col gap-3 py-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-7" />
                ))}
              </div>
            ) : data?.recentEdits.length ? (
              <ul className="flex flex-col">
                {data.recentEdits.map((entry) => (
                  <li key={entry.id} className="border-b border-line py-2.5 last:border-0">
                    <Link
                      to={`/inhalte/${entry.typeKey}/${entry.id}`}
                      className="flex items-center gap-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {entry.key}
                      </span>
                      <WorkflowBadge state={entry.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-[13px] text-muted">In den letzten sieben Tagen nichts.</p>
            )}
          </Card>

          {/* ---- Health ---- */}
          {health.data ? (
            <Card title="Systemzustand">
              <dl className="flex flex-col gap-2.5 text-[13px]">
                <Row label="Datenbank">
                  <span
                    className={
                      health.data.database.status === "ok" ? "text-disc-energy" : "text-brand-bronze"
                    }
                  >
                    {health.data.database.status === "ok" ? "erreichbar" : "Fehler"}
                  </span>
                  <span className="ml-1.5 font-mono tnum text-muted">
                    {health.data.database.latencyMs} ms
                  </span>
                </Row>
                <Row label="Seed">
                  {health.data.seed.inSync ? (
                    <span className="text-disc-energy">aktuell</span>
                  ) : (
                    // Not decoration: a mismatch means the catalogue in code
                    // and the rows in the database disagree, which shows up
                    // later as a permission that grants nothing.
                    <span className="text-brand-bronze">
                      abweichend — {health.data.seed.permissions.actual}/
                      {health.data.seed.permissions.expected} Rechte
                    </span>
                  )}
                </Row>
                <Row label="Snapshots">
                  <span className="font-mono tnum">{health.data.snapshots}</span>
                </Row>
                <Row label="Laufzeit">
                  <span className="font-mono tnum">{formatUptime(health.data.uptimeSeconds)}</span>
                </Row>
                <Row label="Speicher">
                  <span className="font-mono tnum">{formatBytes(health.data.memory.rssBytes)}</span>
                </Row>
                <Row label="Node">
                  <span className="font-mono">{health.data.node}</span>
                </Row>
              </dl>
            </Card>
          ) : null}
        </div>
      </div>

      {!overview.loading && !data ? (
        mayReadOverview ? (
          <EmptyState
            title="Keine Daten"
            description="Der Server hat keine Übersicht geliefert."
            action={<Button onClick={overview.reload}>Nochmals versuchen</Button>}
          />
        ) : (
          /* Not an error: this role is not meant to see the figures. Saying so
             plainly beats an empty page that looks like a fault, and it tells
             the reader what would change it. */
          <EmptyState
            title="Kennzahlen sind für Ihre Rolle nicht freigegeben."
            description="Die Übersicht zeigt Zahlen aus dem ganzen System. Ihre Arbeitsbereiche erreichen Sie über das Menü."
          />
        )
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} T ${h} Std`;
  if (h) return `${h} Std ${m} Min`;
  return `${m} Min`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}
