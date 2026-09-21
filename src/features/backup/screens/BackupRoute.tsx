import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui/primitives";
import { type Column, DataTable, DataView } from "@/shared/ui/data";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { Select } from "@/shared/ui/forms";
import { useCan } from "@/core/auth";
import { usePageTitle } from "@/core/router";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import {
  useBackupList,
  useBackupMutations,
  useBackupStatus,
  useRestoreHistory,
} from "../hooks/useBackups";
import {
  describeMode,
  describeRestoreStatus,
  describeStatus,
  describeTrigger,
  describeType,
  describeVerification,
  formatBytes,
  formatDuration,
} from "../service";
import { BackupOverviewCard } from "./BackupOverviewCard";
import { RestoreDialog } from "./RestoreDialog";
import type { BackupRun, BackupType, RestoreRun } from "../types";

/**
 * Sicherungen — the **operations** half.
 *
 * ---
 *
 * ## Why this is a destination and not a settings section
 *
 * The brief's own split, and it is the right one: *Einstellungen → Sicherung*
 * is a form that answers "what should happen", and this answers "what did
 * happen, and what do I do now". Folding a restore history and a destructive
 * action into a settings form would put the most dangerous control in the
 * application inside a page whose muscle memory is "change a field, press
 * save".
 *
 * ## Two permissions on one screen
 *
 * `system.backup` opens it. **`system.restore` is what reveals the restore
 * column** — the two are different authorities, and somebody who checks that
 * last night's backup ran should not be shown a button that replaces the
 * production database.
 */
export function BackupRoute() {
  usePageTitle("Sicherungen");
  const toast = useToast();
  const canRestore = useCan("system.restore");

  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const list = useBackupList({ status: statusFilter, page });
  const status = useBackupStatus(list.data && list.data.items.some((r) => r.status === "RUNNING") ? 3000 : 0);
  const restores = useRestoreHistory();
  const { create, remove, setProtectedFlag, busy } = useBackupMutations();

  const [restoring, setRestoring] = useState<BackupRun | null>(null);
  const [deleting, setDeleting] = useState<BackupRun | null>(null);

  const columns: Column<BackupRun>[] = [
    {
      key: "status",
      header: "Status",
      className: "w-36",
      render: (row) => {
        const s = describeStatus(row.status);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    {
      key: "verification",
      header: "Prüfung",
      className: "w-36",
      render: (row) => {
        /*
          Its own column, never folded into the status.

          "Written" and "proved readable" are different claims and the whole
          module turns on keeping them apart — a file existing is not
          recoverability.
        */
        const v = describeVerification(row.verification);
        return <Badge tone={v.tone}>{v.label}</Badge>;
      },
    },
    {
      key: "type",
      header: "Umfang",
      render: (row) => (
        <span className="text-[13px] text-ink">
          {describeType(row.type)}
          {row.protected ? (
            <Badge tone="navy" className="ml-2">
              Geschützt
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Erstellt",
      className: "w-40",
      render: (row) => (
        <span title={formatDateTime(row.createdAt)}>
          {relativeTime(row.createdAt)}
          <span className="block text-[12px] text-muted">
            {describeTrigger(row.trigger)}
            {row.triggeredBy ? ` · ${row.triggeredBy}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "size",
      header: "Grösse",
      className: "w-28",
      secondary: true,
      render: (row) => (
        <span className="tabular-nums">
          {formatBytes(row.sizeBytes)}
          <span className="block text-[12px] text-muted">{formatDuration(row.durationMs)}</span>
        </span>
      ),
    },
    {
      key: "detail",
      header: "Ergebnis",
      render: (row) => (
        <span className="text-[12px] leading-snug text-muted">
          {row.failureDetail ?? row.verificationDetail ?? "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-56",
      render: (row) => (
        <span className="flex flex-wrap justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            busy={busy === row.id}
            onClick={() => {
              void setProtectedFlag(row.id, !row.protected).then(
                () =>
                  toast.success(
                    row.protected ? "Schutz aufgehoben" : "Geschützt",
                    row.protected
                      ? "Die Aufbewahrungsregel darf diese Sicherung wieder löschen."
                      : "Die Aufbewahrungsregel lässt diese Sicherung stehen.",
                  ),
                (err: Error) => toast.error("Nicht möglich", err.message),
              );
            }}
          >
            {row.protected ? "Freigeben" : "Schützen"}
          </Button>
          {canRestore && row.status === "SUCCESS" && row.verification === "PASSED" ? (
            <Button variant="secondary" size="sm" onClick={() => setRestoring(row)}>
              Einspielen
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setDeleting(row)}>
            Löschen
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sicherungen"
        description="Wiederherstellungspunkte, ihre Prüfung und das Einspielen."
        actions={
          <span className="flex flex-wrap gap-2">
            {(["FULL", "DATABASE", "MEDIA"] as BackupType[]).map((type) => (
              <Button
                key={type}
                variant={type === "FULL" ? "primary" : "secondary"}
                busy={busy === "create"}
                onClick={() => {
                  void create(type).then(
                    () =>
                      toast.success(
                        "Sicherung eingereiht",
                        "Sie läuft im Hintergrund; der Status aktualisiert sich hier.",
                      ),
                    (err: Error) => toast.error("Nicht möglich", err.message),
                  );
                }}
              >
                {type === "FULL" ? "Jetzt sichern" : describeType(type)}
              </Button>
            ))}
          </span>
        }
      />

      {status.error ? (
        <ErrorState message="Der Sicherungsstatus konnte nicht geladen werden." />
      ) : status.data ? (
        <BackupOverviewCard status={status.data} />
      ) : (
        <Skeleton className="h-64" />
      )}

      <Card
        title="Verlauf"
        description="Jede Sicherung, ihr Ergebnis und ob sie sich lesen lässt."
        action={
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Nach Status filtern"
            options={[
              { value: "", label: "Alle" },
              { value: "SUCCESS", label: "Erfolgreich" },
              { value: "FAILED", label: "Fehlgeschlagen" },
              { value: "RUNNING", label: "Läuft" },
              { value: "EXPIRED", label: "Abgelaufen" },
            ]}
          />
        }
      >
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={list.loading}
          caption="Sicherungsverlauf"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 25}
          onPageChange={setPage}
          empty={
            <EmptyState
              title="Noch keine Sicherung"
              description="Es gibt keinen Wiederherstellungspunkt. „Jetzt sichern“ erstellt den ersten."
            />
          }
        />
      </Card>

      <RestoreHistory items={restores.data?.items ?? []} loading={restores.loading} />

      <RestoreDialog
        run={restoring}
        onClose={() => setRestoring(null)}
        onStarted={() => restores.refetch?.()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Sicherung löschen?"
        confirmLabel="Löschen"
        destructive
        message={
          <>
            Dieser Wiederherstellungspunkt wird entfernt, die Dateien werden gelöscht. Die letzte
            geprüfte Sicherung einer Art lässt sich nicht löschen — sonst bliebe kein
            Wiederherstellungspunkt übrig.
          </>
        }
        onConfirm={() => {
          const row = deleting;
          if (!row) return;
          void remove(row.id).then(
            () => {
              toast.success("Gelöscht", "Die Sicherung und ihre Dateien sind entfernt.");
              setDeleting(null);
            },
            (err: Error) => {
              toast.error("Nicht möglich", err.message);
              setDeleting(null);
            },
          );
        }}
      />
    </div>
  );
}

/**
 * What has been restored, and what the validation found.
 *
 * The drills are the interesting rows: each one is evidence that the backups
 * are recoverable rather than merely present, which is the difference between
 * a recovery system and an assumption.
 */
function RestoreHistory({ items, loading }: { items: RestoreRun[]; loading: boolean }) {
  const columns: Column<RestoreRun>[] = [
    {
      key: "status",
      header: "Status",
      className: "w-56",
      render: (row) => {
        const s = describeRestoreStatus(row.status);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    {
      key: "mode",
      header: "Art",
      className: "w-32",
      render: (row) => <span className="text-[13px]">{describeMode(row.mode).label}</span>,
    },
    {
      key: "target",
      header: "Zieldatenbank",
      render: (row) => <span className="font-mono text-[12px] text-muted">{row.targetDatabase}</span>,
    },
    {
      key: "when",
      header: "Wann",
      className: "w-36",
      secondary: true,
      render: (row) => (
        <span title={formatDateTime(row.createdAt)}>
          {relativeTime(row.createdAt)}
          {row.requestedBy ? <span className="block text-[12px] text-muted">{row.requestedBy}</span> : null}
        </span>
      ),
    },
    {
      key: "result",
      header: "Ergebnis",
      render: (row) =>
        row.failureDetail ? (
          <span className="text-[12px] leading-snug text-muted">{row.failureDetail}</span>
        ) : row.validation ? (
          <span className="text-[12px] leading-snug text-muted">
            {row.validation.checks.filter((c) => c.ok).length}/{row.validation.checks.length} Prüfungen
            bestanden · {row.validation.counts.contentEntries} Inhalte ·{" "}
            {row.validation.counts.users} Benutzer
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  return (
    <Card
      title="Wiederherstellungen"
      description="Übungen und echte Einspielungen. Eine bestandene Übung ist der Beleg, dass die Sicherungen brauchbar sind."
    >
      {/*
        `DataTable`, not `DataView`: there is no pagination here.

        The restore history is bounded at 25 by the server and is meant to be
        read whole — a page control over a list that is almost always shorter
        than a screen is a control that does nothing and one more thing to
        reach past.
      */}
      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        caption="Wiederherstellungen"
        empty={
          <EmptyState
            title="Noch nie wiederhergestellt"
            description="Eine Sicherung, die nie eingespielt wurde, ist eine Annahme. Starten Sie eine Übung — sie verändert nichts."
          />
        }
      />
    </Card>
  );
}
