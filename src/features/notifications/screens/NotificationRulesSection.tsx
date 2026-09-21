import { useState } from "react";
import { Badge, Button, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/forms";
import { type Column, DataView } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { useCan } from "@/core/auth";
import {
  useDeliveries,
  usePreferenceMutations,
  useRetryDelivery,
  useRules,
} from "../hooks/useNotifications";
import { DELIVERY_STATUS_OPTIONS, changedRows, deliveryStatus } from "../service";
import { PreferenceTable } from "./PreferenceTable";
import type { Delivery, PreferenceRow } from "../types";

/**
 * What the **firm** notifies about, and what the channels actually did.
 *
 * ---
 *
 * The organisation half of the pair, in the Einstellungen workspace because
 * it is administration rather than a personal choice. The other half is in
 * the notification centre, with the person it belongs to. The brief insists
 * these are not merged and this is what the separation looks like once it
 * reaches navigation: two screens, two permissions, two audiences.
 *
 * **Four rows cannot be switched off**, and the screen refuses rather than
 * accepting and silently correcting. `resolveChannels` re-applies the
 * invariant on read anyway — a row saying otherwise cannot survive — so
 * accepting the click would store a configuration that does nothing and show
 * it back on after a reload. The e-mail copy of those four *is* configurable,
 * which is the half that keeps the rule proportionate.
 *
 * **The delivery log is below, not beside.** It answers a different question
 * — *did it arrive* rather than *should it be sent* — and it carries its own
 * permission, so somebody may hold one of the two and see one section.
 */
export function NotificationRulesSection() {
  const canConfigure = useCan("notification.configure");
  const canReadDeliveries = useCan("notification.readDeliveries");

  return (
    <div className="flex flex-col gap-6">
      {canConfigure ? <Rules /> : null}
      {canReadDeliveries ? <Deliveries /> : null}
      {!canConfigure && !canReadDeliveries ? (
        <Card title="Benachrichtigungen">
          <p className="text-[14px] leading-relaxed text-muted">
            Für diesen Bereich fehlt Ihnen die Berechtigung. Ihre eigenen
            Benachrichtigungseinstellungen finden Sie unter{" "}
            <a
              href="#/benachrichtigungen/einstellungen"
              className="text-brand-blue hover:text-brand-bronze"
            >
              Benachrichtigungen
            </a>
            .
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Rules() {
  const toast = useToast();
  const rows = useRules();
  const { saveRules } = usePreferenceMutations();

  const [edits, setEdits] = useState<Record<string, Partial<PreferenceRow>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rows.error) return <ErrorState message={rows.error} onRetry={rows.refetch} />;
  if (!rows.data) return <Skeleton className="h-96 rounded-lg" />;

  const changed = changedRows(rows.data, edits);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveRules(
        changed.map((row) => ({
          type: row.type,
          enabled: row.enabled ?? true,
          inApp: row.inApp,
          email: row.email,
        })),
      );
      setEdits({});
      toast.success(
        "Gespeichert",
        "Die Änderung gilt ab der nächsten Benachrichtigung.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Das Speichern hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Welche Ereignisse benachrichtigen"
      description="Gilt für die ganze Organisation. Wer eine Meldung erhält, ergibt sich aus der Berechtigung — nicht aus einer Adressliste. Einzelne Personen können darunter noch abbestellen."
      action={
        <div className="flex gap-2">
          {changed.length ? (
            <Button variant="ghost" disabled={busy} onClick={() => setEdits({})}>
              Verwerfen
            </Button>
          ) : null}
          <Button
            variant="primary"
            busy={busy}
            disabled={!changed.length}
            onClick={() => void save()}
          >
            {changed.length ? `Speichern (${changed.length})` : "Gespeichert"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-bronze ring-1 ring-brand-bronze/25"
          >
            {error}
          </p>
        ) : null}

        <PreferenceTable
          rows={rows.data}
          edits={edits}
          showEnabled
          disabled={busy}
          onChange={(type, patch) =>
            setEdits((current) => ({ ...current, [type]: { ...current[type], ...patch } }))
          }
        />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/**
 * What each channel did, for somebody diagnosing a silence.
 *
 * The smallest thing that makes `NotificationDelivery` useful rather than
 * merely present, and the reason `notification.readDeliveries` is a
 * permission with a route behind it rather than a name in
 * `KNOWN_UNENFORCED`.
 *
 * **No titles and no bodies.** An operator diagnosing SMTP does not need to
 * read everybody's messages, and a delivery log that doubled as a way to do
 * so would be a different feature with a different permission. The server
 * does not send them, so this cannot show them by accident.
 */
function Deliveries() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const deliveries = useDeliveries({ status, page });
  const { retry, retrying } = useRetryDelivery();
  const toast = useToast();

  const columns: Column<Delivery>[] = [
    {
      key: "status",
      header: "Status",
      className: "w-32",
      render: (row) => {
        const { label, tone } = deliveryStatus(row.status);
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
    {
      key: "channel",
      header: "Kanal",
      className: "w-28",
      render: (row) => (
        <span className="text-[13px] text-ink">
          {row.channel === "EMAIL" ? "E-Mail" : "Dashboard"}
        </span>
      ),
    },
    {
      key: "type",
      header: "Art",
      render: (row) => <span className="font-mono text-[12px] text-muted">{row.type}</span>,
    },
    {
      key: "recipient",
      header: "Empfänger",
      secondary: true,
      render: (row) => <span className="text-[13px] text-muted">{row.recipient}</span>,
    },
    {
      key: "when",
      header: "Eingereiht",
      className: "w-36",
      secondary: true,
      render: (row) => (
        <span title={formatDateTime(row.queuedAt.toISOString())}>
          {relativeTime(row.queuedAt.toISOString())}
        </span>
      ),
    },
    {
      /*
        The reason, and it is the column this table exists for. A `SKIPPED`
        row with no explanation is indistinguishable from a bug; with one it
        is the system telling an operator that a preference, a rule or a
        missing SMTP host decided the outcome.
      */
      key: "detail",
      header: "Grund",
      render: (row) =>
        row.detail ? (
          <span className="text-[12px] leading-snug text-muted">{row.detail}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      /*
        The one action in this table, and it is offered on almost no row.

        A retry is only meaningful for an e-mail that finally failed.
        `DELIVERED` would send a second copy of a message that arrived —
        which for a security alert is worse than the silence it was meant to
        fix. `PENDING` and `PROCESSING` are already in hand. And `SKIPPED` is
        a *deliberate* non-send, so retrying it would deliver a message the
        recipient or the firm switched off.

        The server refuses all four with `updateMany … where status: FAILED`,
        so this is the courtesy half — but the courtesy matters here, because a
        button that could only ever produce a 400 reads as an offer.
      */
      key: "action",
      header: "",
      className: "w-28",
      render: (row) =>
        row.channel === "EMAIL" && row.status === "FAILED" ? (
          <Button
            variant="ghost"
            size="sm"
            busy={retrying === row.id}
            onClick={() => {
              void retry(row.id).then(
                () =>
                  toast.success(
                    "Eingereiht",
                    "Die E-Mail wurde erneut in die Warteschlange gestellt.",
                  ),
                (err: Error) => toast.error("Erneut senden fehlgeschlagen", err.message),
              );
            }}
          >
            Erneut senden
          </Button>
        ) : null,
    },
  ];

  return (
    <Card
      title="Zustellprotokoll"
      description="Was auf welchem Kanal geschehen ist. „Übersprungen“ ist kein Fehler, sondern eine bewusste Entscheidung — die Regel oder die persönliche Einstellung hat abgelehnt."
      bodyClassName="p-5"
    >
      <DataView
        rows={deliveries.data?.items ?? []}
        columns={columns}
        rowKey={(row) => row.id}
        loading={deliveries.loading}
        caption="Zustellprotokoll"
        page={deliveries.data?.page ?? 1}
        pages={deliveries.data?.pages ?? 1}
        total={deliveries.data?.total ?? 0}
        perPage={50}
        onPageChange={setPage}
        toolbar={
          <Select
            aria-label="Nach Status filtern"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            placeholder="Alle Status"
            options={DELIVERY_STATUS_OPTIONS}
            className="w-auto"
          />
        }
        empty={
          <p className="py-6 text-center text-[13px] text-muted">
            Noch nichts zugestellt.
          </p>
        }
      />
    </Card>
  );
}
