import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonTable } from "@/shared/ui/primitives";
import { DataTable, type Column } from "@/shared/ui/data";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { Checkbox } from "@/shared/ui/forms";
import type { Office, OfficeDraft } from "@/entities/organisation";
import { OfficeStateBadge, officeAddressLine } from "@/entities/organisation";
import { useOfficeMutations, useOffices } from "../hooks/useOrganisation";
import { publicOffices, type SettingsSection } from "../service";
import { OfficeDialog } from "./OfficeDialog";

/**
 * The Standorte register.
 *
 * **No filter bar, no saved views, no column picker, no pagination**, and that
 * is a decision rather than an omission. `core/list` earns its keep over five
 * hundred projects; this firm has two offices and will plausibly never have
 * twenty. Forcing the machinery onto a list that fits on a phone screen would
 * add three controls that answer no question — which the brief's own rule
 * about enterprise tables says not to do.
 *
 * What it does have is the thing a small list still needs: the archived rows
 * are hidden by default and reachable with one checkbox, because "which
 * offices have we had" is a question the archive exists to answer.
 */
export function OfficesSection({
  section,
  kinds,
  can,
}: {
  section: SettingsSection;
  kinds: string[];
  can: (permission: string) => boolean;
}) {
  const toast = useToast();
  const offices = useOffices();
  const mutations = useOfficeMutations();

  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Office | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "archive" | "restore" | "delete"; office: Office } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    `?? []` inside the memo, not beside it.

    Read out as a bare `const all = offices.data ?? []`, the fallback is a
    fresh array literal on every render, so both memos below would recompute
    every time and be a more expensive way of writing nothing.
  */
  const all = useMemo(() => offices.data ?? [], [offices.data]);
  const rows = useMemo(
    () => (showArchived ? all : all.filter((office) => !office.archivedAt)),
    [all, showArchived],
  );
  const onSite = useMemo(() => publicOffices(all), [all]);

  const canCreate = can("office.create");
  const canUpdate = can("office.update");
  const canArchive = can("office.archive");
  const canDelete = can("office.delete");

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(success);
      setConfirm(null);
    } catch (err) {
      /*
        The server's message, verbatim, and shown **in place** rather than as a
        toast.

        Every refusal from `organisation.rules.ts` names the repair — "bitte
        zuerst einen anderen Standort als Hauptsitz festlegen", "3 Mitarbeitende
        verweisen darauf". A toast puts that sentence where it disappears after
        four seconds; this keeps it beside the register until the reader has
        acted on it.
      */
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Office>[] = [
    {
      key: "name",
      header: "Standort",
      render: (office) => (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2 font-medium text-ink">
            {office.name}
            <OfficeStateBadge office={office} />
          </span>
          <span className="text-[12px] text-muted">{office.kind}</span>
        </div>
      ),
    },
    {
      key: "address",
      header: "Adresse",
      render: (office) => (
        <span className="text-[13px] text-muted">{officeAddressLine(office) || "—"}</span>
      ),
    },
    {
      key: "contact",
      header: "Kontakt",
      render: (office) => (
        <div className="flex flex-col text-[13px] text-muted">
          <span>{office.phone ?? "—"}</span>
          {office.email ? <span>{office.email}</span> : null}
        </div>
      ),
    },
    {
      key: "position",
      header: "Reihenfolge",
      numeric: true,
      secondary: true,
      render: (office) => <span className="tabular-nums text-muted">{office.position}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (office) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {canUpdate ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(office)}>
              Bearbeiten
            </Button>
          ) : null}
          {canArchive ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setConfirm({ kind: office.archivedAt ? "restore" : "archive", office })
              }
            >
              {office.archivedAt ? "Wiederherstellen" : "Archivieren"}
            </Button>
          ) : null}
          {canDelete ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "delete", office })}>
              Löschen
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (offices.error) {
    return <ErrorState message={offices.error} onRetry={offices.refetch} />;
  }

  return (
    <>
      <Card
        title={section.title}
        description={section.description}
        action={
          canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Standort anlegen
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        {error ? (
          <p
            role="alert"
            className="m-5 rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-bronze ring-1 ring-brand-bronze/25"
          >
            {error}
          </p>
        ) : null}

        {offices.loading && !offices.data ? (
          <div className="p-5">
            <SkeletonTable rows={3} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Keine Standorte"
              description="Ohne einen öffentlichen Standort hat die Website keine Adresse und keine Telefonnummer."
            />
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(office) => office.id}
            caption="Standorte der Firma"
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <Checkbox
            label="Archivierte anzeigen"
            checked={showArchived}
            onChange={setShowArchived}
          />
          {/*
            What the website will actually show, said here rather than left to
            be discovered after a publish.

            `publicOffices` mirrors the server's `toSiteOffices` — public, not
            archived, in `position` order — so the sentence is the same
            predicate the snapshot uses.
          */}
          <p className="text-[12px] leading-snug text-muted">
            {onSite.length === 0 ? (
              <Badge tone="bronze">Kein öffentlicher Standort</Badge>
            ) : (
              <>
                Auf der Website:{" "}
                <span className="text-ink">{onSite.map((o) => o.city || o.name).join(" · ")}</span>
                {" — "}ab der nächsten Veröffentlichung.
              </>
            )}
          </p>
        </div>
      </Card>

      <OfficeDialog
        open={creating || editing !== null}
        office={editing}
        kinds={kinds}
        existing={all}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={async (draft: OfficeDraft, office) => {
          if (office) {
            await mutations.update(office.id, draft, office.version);
            toast.success("Gespeichert", `„${draft.name}“ wurde aktualisiert.`);
          } else {
            await mutations.create(draft);
            toast.success("Angelegt", `„${draft.name}“ wurde angelegt.`);
          }
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        busy={busy}
        onClose={() => {
          setConfirm(null);
          setError(null);
        }}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, office } = confirm;
          if (kind === "delete") {
            void run(() => mutations.remove(office.id), `„${office.name}“ wurde gelöscht.`);
          } else {
            void run(
              () => mutations.setArchived(office.id, kind === "archive"),
              kind === "archive"
                ? `„${office.name}“ wurde archiviert.`
                : `„${office.name}“ ist wieder aktiv.`,
            );
          }
        }}
        destructive={confirm?.kind !== "restore"}
        confirmLabel={
          confirm?.kind === "delete"
            ? "Löschen"
            : confirm?.kind === "restore"
              ? "Wiederherstellen"
              : "Archivieren"
        }
        title={
          confirm?.kind === "delete"
            ? `„${confirm.office.name}“ löschen?`
            : confirm?.kind === "restore"
              ? `„${confirm?.office.name}“ wiederherstellen?`
              : `„${confirm?.office.name}“ archivieren?`
        }
        message={
          confirm?.kind === "delete"
            ? "Löschen ist für einen Eintrag gedacht, der versehentlich angelegt wurde. Ein geschlossener Standort wird archiviert — dann bleiben Mitarbeitende, Projekte und Gebäude, die darauf verweisen, auflösbar."
            : confirm?.kind === "restore"
              ? "Der Standort wird wieder aktiv und erscheint, wenn er öffentlich ist, mit der nächsten Veröffentlichung wieder auf der Website."
              : "Der Standort verschwindet mit der nächsten Veröffentlichung von der Website. Mitarbeitende, Projekte und Gebäude, die darauf verweisen, bleiben unverändert."
        }
      />
    </>
  );
}
