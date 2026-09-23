import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import { Link, navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import { usePageTitle } from "@/core/router";
import {
  DECISION_STATUS_OPTIONS,
  DecisionStatusBadge,
  decisionStatusLabel,
  decisionTypeLabel,
  impactSummary,
  type DecisionDetail as Decision,
  type DecisionStatus,
} from "@/entities/meeting";
import { DisciplineDot } from "@/entities/project";
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { ConfirmDialog, Modal } from "@/shared/ui/overlays";
import { EntityPicker, Field, Form, Select, Textarea, type EntityOption } from "@/shared/ui/forms";
import { Pair } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, formatDateTime, relativeTime } from "@/shared/utils/format";
import {
  useDecision,
  useDecisionHistory,
  useMeetingMutations,
} from "../hooks/useMeetings";
import { meetingRepository } from "../repository";
import { isReadOnly, supersessionNotice } from "../service";
import { DecisionEditDialog } from "./DecisionDialogs";
import { FIELD_LABELS } from "./fieldLabels";

/**
 * One decision, and the question it exists to answer.
 *
 * **The rationale is the page**, not a field on it. Everything else — the type,
 * the Gewerk, the cost, who decided — is metadata around one paragraph that
 * says why, and the layout says so: the rationale is set at reading width above
 * the fold and the facts sit beside it.
 *
 * **A route with a real URL**, because that is the whole point of the module:
 * `E-2026-017` gets cited in a letter, and a citation that cannot be opened is a
 * number somebody has to go and ask about.
 */
export function DecisionDetail({ decisionId }: { decisionId: string }) {
  const { can } = useAuth();
  const decision = useDecision(decisionId);

  const record = decision.data ?? null;
  usePageTitle(record ? `${record.number} — ${record.title}` : null);

  if (decision.error) return <ErrorState message={decision.error} onRetry={decision.refetch} />;

  if (!record) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const readOnly = isReadOnly(record);
  const notice = supersessionNotice(record);

  return (
    <>
      <PageHeader
        eyebrow={record.project ? `${record.project.number} · ${record.project.name}` : undefined}
        title={record.title}
        description={impactSummary(record)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" className="font-mono">
              {record.number}
            </Badge>
            <DecisionStatusBadge status={record.status} />
            {can("decision.update") && !readOnly ? <EditButton decision={record} /> : null}
            {can("decision.update") && !readOnly ? <StatusButton decision={record} /> : null}
            {can("decision.supersede") && !readOnly ? <SupersedeButton decision={record} /> : null}
            {can("decision.delete") ? <DeleteButton decision={record} /> : null}
          </div>
        }
      />

      {/*
        The supersession notice, above everything.

        Somebody opening an old decision needs to be told *before* they act on
        it, and "Aufgehoben" as a badge in a row of badges is easy to miss on a
        page that is mostly prose. The sentence names the successor, because the
        next question is always "by what".
      */}
      {notice ? (
        <div className="rounded-lg bg-surface-sunken px-4 py-3 text-[13px] leading-relaxed ring-1 ring-line">
          {notice}{" "}
          {record.supersededBy ? (
            <Link to={`/entscheide/${record.supersededBy.id}`} className="underline">
              {record.supersededBy.number} öffnen
            </Link>
          ) : record.supersedes ? (
            <Link to={`/entscheide/${record.supersedes.id}`} className="underline">
              {record.supersedes.number} öffnen
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Begründung">
          <p className="max-w-prose whitespace-pre-line text-[14px] leading-relaxed text-ink">
            {record.rationale}
          </p>
        </Card>

        <div className="flex flex-col gap-5">
          <Card title="Eckdaten">
            <div className="flex flex-col gap-3">
              <Pair label="Art">{decisionTypeLabel(record.type)}</Pair>
              <Pair label="Status">{decisionStatusLabel(record.status)}</Pair>
              <Pair label="Entschieden am">{formatDate(record.decidedAt)}</Pair>
              <Pair label="Entschieden durch">
                {record.decidedBy?.name ?? record.decidedByExternal ?? "—"}
              </Pair>
              <Pair label="Gewerk">
                {record.discipline ? (
                  <span className="inline-flex items-center gap-1.5">
                    <DisciplineDot colour={record.discipline.colour} />
                    {record.discipline.code} · {record.discipline.name}
                  </span>
                ) : (
                  "—"
                )}
              </Pair>
              <Pair label="Auswirkung">{impactSummary(record)}</Pair>
            </div>
          </Card>

          <Card title="Herkunft">
            {record.meeting ? (
              <div className="flex flex-col gap-2 text-[13px]">
                <Link
                  to={`/sitzungen/${record.meeting.id}/protokoll`}
                  className="font-medium text-ink underline"
                >
                  {record.meeting.seriesNumber === null
                    ? record.meeting.title
                    : `${record.meeting.title} ${record.meeting.seriesNumber}`}
                </Link>
                <span className="text-muted">{formatDate(record.meeting.startsAt)}</span>
                {record.item ? (
                  <span className="text-muted">
                    Protokollzeile {record.item.order} — im Protokoll verlinkt.
                  </span>
                ) : (
                  /*
                    A decision can exist without a protocol line: it was taken in
                    a meeting but nobody wrote the line, or it was taken on site.
                    Said rather than left blank, because "no line" and "line not
                    loaded" look identical.
                  */
                  <span className="text-muted">Keine Protokollzeile verknüpft.</span>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                Ausserhalb einer Sitzung entschieden — auf dem Bauplatz, am Telefon, per E-Mail.
                Das ist kein Mangel; es macht den Eintrag hier nur umso nötiger.
              </p>
            )}
          </Card>

          <HistoryCard decision={record} />
        </div>
      </div>
    </>
  );
}

function EditButton({ decision }: { decision: Decision }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Korrigieren
      </Button>
      {open ? (
        <DecisionEditDialog
          decision={decision}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setOpen(false);
            toast.success(`Gespeichert — ${decision.number} v${next.version}`);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Moving a decision along its own lifecycle — offen → entschieden → umgesetzt.
 *
 * **`AUFGEHOBEN` is not in this list and cannot be**, which is the rule worth
 * stating: the server refuses it as a direct transition, because a decision that
 * reached that status without a successor would be a reversal nobody can trace.
 * The only way there is `supersede`, which always attaches the replacement.
 */
function StatusButton({ decision }: { decision: Decision }) {
  const toast = useToast();
  const mutations = useMeetingMutations();
  const ids = { status: useId(), reason: useId() };
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DecisionStatus>(decision.status);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = DECISION_STATUS_OPTIONS.filter(
    (option) => option.value !== "AUFGEHOBEN" && option.value !== decision.status,
  );
  if (!options.length) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Status ändern
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title="Status ändern"
        description={`Aktuell: ${decisionStatusLabel(decision.status)}. Aufheben ist kein Status, sondern ein eigener Vorgang.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button
              busy={busy}
              onClick={async () => {
                setError(null);
                setBusy(true);
                try {
                  await mutations.changeDecisionStatus(decision.id, {
                    status,
                    reason: reason.trim() || undefined,
                  });
                  toast.success(`Status: ${decisionStatusLabel(status)}`);
                  setOpen(false);
                } catch (err) {
                  setError(toFailure(err).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ändern
            </Button>
          </>
        }
      >
        <Form onSubmit={() => undefined} error={error}>
          <Field label="Neuer Status" htmlFor={ids.status}>
            <Select
              id={ids.status}
              value={status}
              onChange={(event) => setStatus(event.target.value as DecisionStatus)}
              options={options}
            />
          </Field>
          <Field label="Begründung" htmlFor={ids.reason} optional hint="Steht im Audit-Log.">
            <Textarea
              id={ids.reason}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </Form>
      </Modal>
    </>
  );
}

/**
 * Aufheben und ersetzen — the module's one irreversible act.
 *
 * **The replacement has to exist first**, and the dialog says so instead of
 * offering to create one inline. That is the server's arrow: `supersede` is
 * called on the *new* decision naming the old one, so a reversal always has a
 * successor attached and `AUFGEHOBEN` is a verifiable fact rather than a claim.
 * A dialog that created the replacement as a side effect would be writing a
 * decision — with its own number and its own rationale — inside a confirmation
 * step, which is exactly the shortcut that produces empty rationales.
 *
 * The picker is **scoped to this decision's project**, because the server
 * refuses a cross-project reversal: the number encodes the project, and a
 * decision on the Schulhaus cannot overrule one on the Gewerbehaus.
 */
function SupersedeButton({ decision }: { decision: Decision }) {
  const toast = useToast();
  const mutations = useMeetingMutations();
  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState<EntityOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickerId = useId();

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Aufheben
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title={`${decision.number} aufheben`}
        description="Ein aufgehobener Entscheid bleibt lesbar und zitierbar — er gilt nur nicht mehr."
        footer={
          <>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button
              busy={busy}
              disabled={!replacement}
              onClick={async () => {
                setError(null);
                setBusy(true);
                try {
                  // The arrow points from the new decision to the old one.
                  await mutations.supersede(replacement!.value, decision.id);
                  toast.success(`${decision.number} aufgehoben`);
                  setOpen(false);
                  navigate(`/entscheide/${replacement!.value}`);
                } catch (err) {
                  setError(toFailure(err).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Aufheben
            </Button>
          </>
        }
      >
        <Form onSubmit={() => undefined} error={error}>
          <p className="text-[13px] leading-relaxed text-muted">
            Der ersetzende Entscheid muss bereits festgehalten sein — mit eigener Nummer und eigener
            Begründung. Das ist Absicht: ein Widerruf ohne begründeten Nachfolger ist die Lücke, die
            hinterher niemand mehr füllen kann.
          </p>

          <Field
            label="Ersetzt durch"
            htmlFor={pickerId}
            hint="Nur Entscheide desselben Projekts — die Nummer trägt das Projekt in sich."
          >
            <EntityPicker
              id={pickerId}
              value={replacement?.value ?? null}
              selected={replacement}
              onChange={(_next, option) => setReplacement(option)}
              search={async (q) => {
                const page = await meetingRepository.listDecisions({
                  search: q || undefined,
                  projectId: decision.projectId,
                  perPage: 20,
                  sort: { field: "decidedAt", dir: "desc" },
                });
                return page.items
                  .filter((row) => row.id !== decision.id && row.status !== "AUFGEHOBEN")
                  .map((row) => ({
                    value: row.id,
                    label: `${row.number} — ${row.title}`,
                    hint: new Date(row.decidedAt).toLocaleDateString("de-CH"),
                  }));
              }}
              placeholder="Entscheid suchen …"
            />
          </Field>
        </Form>
      </Modal>
    </>
  );
}

function DeleteButton({ decision }: { decision: Decision }) {
  const toast = useToast();
  const mutations = useMeetingMutations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Löschen
      </Button>
      <ConfirmDialog
        open={open}
        busy={busy}
        onClose={() => setOpen(false)}
        title="Entscheid löschen?"
        message={
          <>
            <p>
              {decision.number} — {decision.title}
            </p>
            {/*
              The distinction people get wrong, before the request rather than
              after the 400. Löschen is for something entered by mistake;
              Aufheben is for something that was decided and no longer applies.
              Deleting the second would remove it from the record it belongs in.
            */}
            <p className="mt-2 text-muted">
              Löschen ist für einen Fehleintrag. Ein Entscheid, der gefallen ist und nicht mehr
              gilt, wird <strong>aufgehoben</strong> — dann bleibt er zitierbar. Ein Entscheid, der
              selbst einen anderen aufhebt, lässt sich nicht löschen.
            </p>
          </>
        }
        confirmLabel="Löschen"
        destructive
        confirmText={decision.number}
        onConfirm={async () => {
          setBusy(true);
          try {
            await mutations.removeDecision(decision.id);
            toast.success("Gelöscht");
            navigate("/entscheide");
          } catch (err) {
            toast.error(toFailure(err).message);
          } finally {
            setBusy(false);
            setOpen(false);
          }
        }}
      />
    </>
  );
}

function HistoryCard({ decision }: { decision: Decision }) {
  const history = useDecisionHistory(decision.id);

  return (
    <Card title="Verlauf" description={`v${decision.version}`}>
      {history.error ? (
        <ErrorState message={history.error} onRetry={history.refetch} />
      ) : history.loading && !history.data ? (
        <Skeleton className="h-16 w-full" />
      ) : history.data?.length ? (
        <ol className="flex flex-col gap-2.5 text-[13px]">
          {history.data.map((entry) => (
            <li key={entry.version} className="flex flex-col gap-0.5">
              <span>
                <Badge tone={entry.version === decision.version ? "navy" : "neutral"}>
                  {entry.label}
                </Badge>{" "}
                <span className="text-muted">
                  {entry.changed.length
                    ? entry.changed.map((f) => FIELD_LABELS[f] ?? f).join(", ")
                    : "ohne Änderung"}
                </span>
              </span>
              <span className="text-[12px] text-muted" title={formatDateTime(entry.createdAt)}>
                {entry.changedByName ?? "System"} · {relativeTime(entry.createdAt)}
              </span>
              {entry.note ? <span className="text-ink">„{entry.note}“</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-muted">
          Unverändert seit der Erfassung — bei einem Entscheid der Normalfall.
        </p>
      )}
    </Card>
  );
}
