import { Badge, Button, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { HealthBadge } from "@/entities/system";
import { formatBytes, formatDateTime, relativeTime } from "@/shared/utils/format";
import { useSystemOverview } from "../hooks/useSystem";
import { describeBuild, describeMigrations, formatUptime, sortSubjects, summarise } from "../service";
import type { SubsystemAbsence, SystemOverview as Overview } from "../types";

/**
 * One page that says whether the platform is well, and why it is not.
 *
 * ---
 *
 * ## No score, and the banner is the argument
 *
 * The obvious design is a number — *Systemzustand: 93 %* — and it is the one
 * thing this page refuses to draw. A percentage cannot be acted on without
 * expanding it back into the list it came from, it moves when nothing anybody
 * cares about has changed, and 93 % reads as "fine" on the morning the
 * backups stopped. The banner shows the **worst** subsystem and the reasons
 * beneath it, which is the same information with the arithmetic that
 * destroyed it removed.
 *
 * ## Worst first
 *
 * `sortSubjects` puts the broken card at the top. A fixed grid looks tidier
 * and buries the one tile that matters on the day it matters.
 *
 * ## Nothing is duplicated
 *
 * Mail, Sicherungen, Veröffentlichung and Audit have their own screens, and
 * each card here is a verdict plus a link rather than a second copy of the
 * module. The verdicts come from the same services those screens read —
 * `MailStatusService`, `BackupStatusService` — so the two cannot disagree.
 */
export function SystemOverviewScreen() {
  const overview = useSystemOverview();

  if (overview.error) {
    return <ErrorState message={overview.error} onRetry={overview.refetch} />;
  }
  if (!overview.data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  const info = overview.data;
  const { headline } = summarise(info.health);
  const subjects = sortSubjects(info.health.subjects);
  const build = describeBuild(info.build);
  const migrations = describeMigrations(info.database.migrations);

  return (
    <div className="flex flex-col gap-6">
      {/* ---- The banner ---- */}
      <Card
        title={headline}
        description={
          info.health.state === "healthy"
            ? "Jede Prüfung, die diese Anwendung selbst durchführen kann, ist bestanden."
            : "Die folgenden Punkte stammen aus den Teilsystemen unten — jeder nennt, was zu tun ist."
        }
        action={<HealthBadge state={info.health.state} />}
      >
        {info.health.reasons.length ? (
          <ul className="flex flex-col gap-2">
            {info.health.reasons.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-2.5 text-[14px] leading-relaxed text-ink"
              >
                {/*
                  A dot rather than a coloured icon. The banner's own badge
                  already carries the state; repeating it per line would be
                  colour doing work that the sentence does better, and the
                  sentence is what a reader without colour perception gets.
                */}
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-bronze" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] leading-relaxed text-muted">
            Es liegt nichts an. Diese Seite prüft nur, was die Anwendung selbst messen kann —
            für eine aktive Prüfung gibt es die Diagnose.
          </p>
        )}
      </Card>

      {/* ---- The subsystem grid ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {subjects.map((subject) => (
          <Card key={subject.key} title={subject.label} action={<HealthBadge state={subject.state} />}>
            <div className="flex flex-col gap-3">
              {subject.reasons.length ? (
                <ul className="flex flex-col gap-1.5">
                  {subject.reasons.map((reason) => (
                    <li key={reason} className="text-[13px] leading-relaxed text-ink">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] leading-relaxed text-muted">Keine Auffälligkeiten.</p>
              )}
              <SubsystemFigures subject={subject.key} info={info} />
              {subject.link ? (
                <a
                  href={subject.link}
                  className="self-start text-[13px] text-brand-blue hover:text-brand-bronze"
                >
                  Öffnen →
                </a>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {/* ---- Identity ---- */}
      <Card
        title="Diese Installation"
        description="Woher dieser laufende Stand kommt, und worauf er läuft."
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Pair label="Version">
            {build.known ? (
              <span className="flex flex-col gap-0.5">
                <span className="font-mono tnum">{build.version}</span>
                <span className="text-[12px] text-muted">{build.detail}</span>
              </span>
            ) : (
              /*
                The field most likely to be faked, reported as unknown.

                `package.json` says `0.0.1` and always has, so showing it
                would answer "ist der Fix deployed?" confidently and wrongly.
              */
              <span className="text-[13px] leading-snug text-muted">{build.detail}</span>
            )}
          </Pair>
          <Pair label="Umgebung">{info.build.environment}</Pair>
          <Pair label="Node">{info.runtime.node}</Pair>
          <Pair label="Laufzeit">{formatUptime(info.runtime.uptimeSeconds)}</Pair>
          <Pair label="Arbeitsspeicher">{formatBytes(info.runtime.rssBytes)}</Pair>
          <Pair label="Datenbank">
            {info.database.version ?? "—"}
            {info.database.connected ? ` · ${info.database.latencyMs} ms` : " · keine Verbindung"}
          </Pair>
          <Pair label="Schema" className="sm:col-span-2">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={migrations.state === "healthy" ? "energy" : migrations.state === "critical" ? "bronze" : "neutral"}>
                {migrations.label}
              </Badge>
              <span className="text-[13px] text-muted">{migrations.detail}</span>
            </span>
          </Pair>
        </dl>
      </Card>

      {/* ---- The two that honestly do not exist ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AbsenceCard title="Anwendungsprotokolle" absence={info.logs} />
        <AbsenceCard title="Aktualisierungen" absence={info.updates} />
      </div>
    </div>
  );
}

/* ================================================================== */

/**
 * The two or three figures that make a card's verdict concrete.
 *
 * Deliberately few. A card is a verdict and a way in; the module's own screen
 * is where the detail lives, and reproducing it here would be the duplication
 * the brief forbids and the drift CLAUDE.md keeps recording.
 */
function SubsystemFigures({ subject, info }: { subject: string; info: Overview }) {
  const rows: [string, string][] = [];

  switch (subject) {
    case "database":
      rows.push(["Antwortzeit", `${info.database.latencyMs} ms`]);
      rows.push(["Migrationen", String(info.database.migrations.applied)]);
      break;
    case "jobs":
      rows.push(["Wartend", String(info.jobs.queued)]);
      rows.push(["Aufgegeben", String(info.jobs.dead)]);
      rows.push(["Erledigt (24 h)", String(info.jobs.done24h)]);
      break;
    case "mail":
      rows.push(["Server", info.mail.configured ? info.mail.host : "—"]);
      rows.push(["Fehlgeschlagen", String(info.mail.failed)]);
      if (info.mail.lastDeliveredAt) {
        rows.push(["Zuletzt zugestellt", relativeTime(info.mail.lastDeliveredAt)]);
      }
      break;
    case "backups":
      rows.push(["Wiederherstellungspunkte", String(info.backups.recoveryPoints)]);
      rows.push([
        "Zuletzt geprüft",
        info.backups.lastVerifiedAt ? relativeTime(info.backups.lastVerifiedAt) : "nie",
      ]);
      if (info.backups.nextScheduledAt) {
        rows.push(["Nächste", formatDateTime(info.backups.nextScheduledAt)]);
      }
      break;
    case "publishing":
      rows.push(["Freigegeben", String(info.publishing.approved)]);
      rows.push(["Terminiert", String(info.publishing.scheduled)]);
      rows.push([
        "Live",
        info.publishing.liveVersion ? `Stand ${info.publishing.liveVersion}` : "nie veröffentlicht",
      ]);
      break;
    case "security":
      rows.push([
        "Zwei-Faktor",
        info.security.mfaAdoption === null
          ? "—"
          : `${info.security.withMfa} von ${info.security.activeUsers} (${info.security.mfaAdoption} %)`,
      ]);
      rows.push(["Offene Sitzungen", String(info.security.activeSessions)]);
      rows.push(["Fehlanmeldungen (24 h)", String(info.security.failedLogins24h)]);
      break;
    case "storage":
      rows.push(["Medien", `${info.storage.mediaAssets} · ${formatBytes(info.storage.mediaBytes)}`]);
      rows.push([
        "Frei",
        info.storage.freeBytes === null
          ? "nicht ermittelbar"
          : `${formatBytes(info.storage.freeBytes)}${
              info.storage.freeSharePercent === null ? "" : ` (${info.storage.freeSharePercent} %)`
            }`,
      ]);
      break;
    case "cache":
      rows.push(["Betriebsart", info.cache.configured ? "Redis" : "Einzelprozess"]);
      break;
  }

  if (!rows.length) return null;

  return (
    <dl className="flex flex-col gap-1.5 border-t border-line pt-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-[12px] text-muted">{label}</dt>
          <dd className="text-[13px] tnum text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A subsystem this application does not have.
 *
 * **Not an empty list.** A "Logs" screen listing nothing is
 * indistinguishable from a quiet system, which is the single most misleading
 * thing an operations page can do — the same argument the `unbuilt`
 * integration state makes on the System settings panel, where a missing
 * feature and a missing setting were one grey dot and the first got waited on
 * for ever.
 */
function AbsenceCard({ title, absence }: { title: string; absence: SubsystemAbsence }) {
  return (
    <Card title={title} action={<Badge tone="neutral">Nicht gebaut</Badge>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-muted">{absence.reason}</p>
        {absence.alternative ? (
          <p className="text-[13px] leading-relaxed text-ink">{absence.alternative}</p>
        ) : null}
        {absence.link ? (
          <Button href={absence.link} variant="secondary" size="sm" className="self-start">
            Audit-Log öffnen
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
