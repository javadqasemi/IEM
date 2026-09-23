import { useState } from "react";
import { toFailure } from "@/core/api";
import { Link, usePageTitle } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  AcknowledgementBadge,
  PurposeBadge,
  RevisionBadge,
  mediumLabel,
  recipientRoleLabel,
  type TransmittalDetail as Transmittal,
} from "@/entities/drawing";
import { DisciplineDot } from "@/entities/project";
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, formatDateTime } from "@/shared/utils/format";
import { useDrawingMutations, useTransmittal } from "../hooks/useDrawings";
import { sheetCount, splitAcknowledgement, supersededSince } from "../service";

/**
 * One Planversand — **a statement about the past**.
 *
 * There is no edit and no delete, here or on the server, and that is the design
 * rather than an omission: correcting a Planversand means issuing another, the
 * same reason `AuditLog` has no route to edit a row. The only write on this
 * screen is recording that somebody confirmed receipt, which is a *new* fact
 * rather than a change to an old one.
 */
export function TransmittalDetail({ transmittalId }: { transmittalId: string }) {
  const transmittal = useTransmittal(transmittalId);

  const record = transmittal.data ?? null;
  usePageTitle(record?.number ?? null);

  if (transmittal.error) {
    return <ErrorState message={transmittal.error} onRetry={transmittal.refetch} />;
  }

  if (!record) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const stale = supersededSince(record);
  const { confirmed, outstanding } = splitAcknowledgement(record.recipients);

  return (
    <>
      <PageHeader
        eyebrow={record.project ? `${record.project.number} · ${record.project.name}` : undefined}
        title={record.number}
        description={`${formatDateTime(record.sentAt)} · ${mediumLabel(record.medium)} · ${sheetCount(
          record.items,
        )} Blatt an ${record.recipients.length} ${
          record.recipients.length === 1 ? "Empfänger" : "Empfänger"
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PurposeBadge purpose={record.purpose} />
            {record.sentBy ? <Badge tone="neutral">{record.sentBy.name}</Badge> : null}
          </div>
        }
      />

      {/*
        The flag an old Planversand most needs.

        Somebody opening this six months later is asking "is this still
        current", and the answer is on the items rather than on the record.
        Above everything, because it changes what the rest of the page means.
      */}
      {stale.length ? (
        <div className="rounded-lg bg-surface-sunken px-4 py-3 text-[13px] leading-relaxed ring-1 ring-line">
          <strong className="font-medium text-ink">
            {stale.length === 1
              ? "Eine dieser Revisionen ist inzwischen überholt."
              : `${stale.length} dieser Revisionen sind inzwischen überholt.`}
          </strong>{" "}
          Wer nur diesen Versand hat, baut nach einem alten Stand —{" "}
          {stale.map((item) => `${item.drawing.number} Rev. ${item.revision}`).join(", ")}.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card
          title="Pläne"
          description={`${record.items.length} ${record.items.length === 1 ? "Plan" : "Pläne"} · ${sheetCount(record.items)} Blatt`}
        >
          <ul className="flex flex-col divide-y divide-line">
            {record.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <Link
                  to={`/plaene/${item.drawing.id}`}
                  className="font-mono text-[13px] text-ink underline"
                >
                  {item.drawing.number}
                </Link>
                <span className="min-w-0 flex-1 text-[14px]">{item.drawing.title}</span>

                {item.drawing.discipline ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                    <DisciplineDot colour={item.drawing.discipline.colour} />
                    {item.drawing.discipline.code}
                  </span>
                ) : null}

                <RevisionBadge revision={item.revision} superseded={item.supersededAt !== null} />

                {item.copies > 1 ? (
                  <span className="text-[12px] text-muted">{item.copies} Exemplare</span>
                ) : null}
                {item.format ? <span className="text-[12px] text-muted">{item.format}</span> : null}
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-5">
          <Card
            title="Empfänger"
            description={
              outstanding.length
                ? `${confirmed.length} von ${record.recipients.length} bestätigt`
                : "Alle haben bestätigt."
            }
          >
            <ul className="flex flex-col divide-y divide-line">
              {record.recipients.map((recipient) => (
                <RecipientRow
                  key={recipient.id}
                  transmittalId={record.id}
                  recipient={recipient}
                />
              ))}
            </ul>

            {/*
              Two groups and not three, unlike attendance: everybody here was
              sent it. `acknowledgedAt` records only whether they said so.
            */}
            {outstanding.length ? (
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                Nicht bestätigt heisst nicht „nicht erhalten“ — es heisst, es liegt keine Rückmeldung
                vor.
              </p>
            ) : null}
          </Card>

          <Card title="Eckdaten">
            <div className="flex flex-col gap-3">
              <Pair label="Nummer">
                <span className="font-mono">{record.number}</span>
              </Pair>
              <Pair label="Versandt">{formatDateTime(record.sentAt)}</Pair>
              <Pair label="Weg">{mediumLabel(record.medium)}</Pair>
              <Pair label="Durch">{record.sentBy?.name ?? "—"}</Pair>
              <Pair label="Erfasst">
                {record.createdAt ? formatDate(record.createdAt) : "—"}
              </Pair>
            </div>

            {record.note ? (
              <p className="mt-4 whitespace-pre-line text-[13px] leading-relaxed text-ink">
                {record.note}
              </p>
            ) : null}

            <p className="mt-4 text-[12px] leading-relaxed text-muted">
              Ein Planversand wird nicht geändert und nicht gelöscht. Was falsch war, wird durch
              einen neuen Versand richtiggestellt.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function RecipientRow({
  transmittalId,
  recipient,
}: {
  transmittalId: string;
  recipient: Transmittal["recipients"][number];
}) {
  const { can } = useAuth();
  const toast = useToast();
  const mutations = useDrawingMutations();
  const [busy, setBusy] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1">
        <span className="text-[14px] font-medium text-ink">{recipient.name}</span>
        {recipient.organisation ? (
          <span className="ml-2 text-[13px] text-muted">{recipient.organisation}</span>
        ) : null}
        {recipient.role === "CC" ? (
          <Badge tone="neutral" className="ml-2">
            {recipientRoleLabel(recipient.role)}
          </Badge>
        ) : null}
        {recipient.externalMail ? (
          <span className="mt-0.5 block text-[12px] text-muted">{recipient.externalMail}</span>
        ) : null}
      </div>

      <AcknowledgementBadge at={recipient.acknowledgedAt} />

      {!recipient.acknowledgedAt && can("transmittal.acknowledge") ? (
        <Button
          size="sm"
          variant="ghost"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await mutations.acknowledge(transmittalId, { recipientId: recipient.id });
              toast.success("Empfang bestätigt");
            } catch (err) {
              toast.error(toFailure(err).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Bestätigen
        </Button>
      ) : null}
    </li>
  );
}
