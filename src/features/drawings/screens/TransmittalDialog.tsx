import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import {
  RECIPIENT_ROLE_OPTIONS,
  RevisionBadge,
  TRANSMITTAL_MEDIUM_OPTIONS,
  TRANSMITTAL_PURPOSE_OPTIONS,
  type Drawing,
  type RecipientRole,
  type TransmittalMedium,
  type TransmittalPurpose,
  type TransmittalResult,
} from "@/entities/drawing";
import { Badge, Button } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import {
  EntityPicker,
  Field,
  Form,
  Input,
  Select,
  Textarea,
  type EntityOption,
} from "@/shared/ui/forms";
import { drawingRepository } from "../repository";
import { useDrawingMutations, useDrawingList } from "../hooks/useDrawings";
import { refuseSelection, warningsByRecipient } from "../service";

/**
 * Assembling a Planversand.
 *
 * **The one act in the module with a liability behind it**: after this,
 * somebody is building from these plans. The dialog is shaped around three
 * things the server would otherwise refuse the whole request for:
 *
 * - **A plan that cannot be sent is disabled with its reason attached.**
 *   `refuseSelection` greys the row and says why — not released, superseded,
 *   withdrawn — so nobody assembles twelve plans and has the lot refused. It is
 *   deliberately a *subset* of the server's rule; the server re-reads the
 *   release stamp and checks the project, and it is the one that decides.
 * - **Recipients are two kinds and one list.** An employee is a foreign key;
 *   the Unternehmer and the Architekt are a name and a firm typed in, because
 *   they are not users of this system and never will be.
 * - **The warnings come back after the send, not before it.** Reissuing a
 *   revised plan is the normal case and refusing it would make the correct
 *   action impossible — but whoever is holding the old revision must be named.
 */
export function TransmittalDialog({
  projectId,
  onClose,
  onSent,
}: {
  projectId: string;
  onClose: () => void;
  onSent: (result: TransmittalResult) => void;
}) {
  const ids = { purpose: useId(), medium: useId(), note: useId() };

  const mutations = useDrawingMutations();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recipients, setRecipients] = useState<Recipient[]>([{ key: "r0", role: "TO" }]);
  const [purpose, setPurpose] = useState<TransmittalPurpose>("ZUR_AUSFUEHRUNG");
  const [medium, setMedium] = useState<TransmittalMedium>("EMAIL");
  const [note, setNote] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set after a successful send. The dialog becomes a report. */
  const [result, setResult] = useState<TransmittalResult | null>(null);

  /*
    Only what could plausibly be sent, and only from this project.

    `live` rather than `released`: a plan in `WIP` is shown and disabled, so
    somebody looking for it finds it with a reason rather than concluding the
    register is incomplete.
  */
  const plans = useDrawingList({ projectId, live: true, perPage: 100 });

  const ready =
    selected.size > 0 && recipients.some((r) => r.employee || (r.name ?? "").trim().length > 1);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const sent = await mutations.createTransmittal({
        projectId,
        items: [...selected].map((drawingRevisionId) => ({ drawingRevisionId })),
        recipients: recipients
          .filter((r) => r.employee || (r.name ?? "").trim())
          .map((r) => ({
            employeeId: r.employee?.value,
            externalName: r.employee ? undefined : r.name?.trim(),
            externalOrg: r.employee ? undefined : r.org?.trim(),
            externalMail: r.employee ? undefined : r.mail?.trim(),
            role: r.role,
          })),
        purpose,
        medium,
        note: note.trim() || undefined,
      });
      setResult(sent);
    } catch (err) {
      setError(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) return <SentReport result={result} onClose={() => onSent(result)} />;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Pläne versenden"
      description="Nur freigegebene Revisionen. Nach dem Versand gelten die Pläne als ausgegeben."
      size="lg"
      footer={
        <>
          <span className="text-[12px] text-muted">
            {selected.size} {selected.size === 1 ? "Plan" : "Pläne"}
          </span>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} busy={busy} disabled={!ready}>
            Versenden
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[13px] font-medium text-ink">Pläne</legend>

          {plans.loading && !plans.data ? (
            <p className="text-[13px] text-muted">Wird geladen …</p>
          ) : plans.data?.items.length ? (
            <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line">
              {plans.data.items.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  checked={selected}
                  onToggle={(revisionId, on) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (on) next.add(revisionId);
                      else next.delete(revisionId);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">
              Auf diesem Projekt gibt es keine Pläne, die versandt werden könnten.
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-medium text-ink">Empfänger</legend>

          {recipients.map((recipient, index) => (
            <RecipientFields
              key={recipient.key}
              recipient={recipient}
              onChange={(next) =>
                setRecipients((current) =>
                  current.map((r, i) => (i === index ? { ...r, ...next } : r)),
                )
              }
              onRemove={
                recipients.length > 1
                  ? () => setRecipients((current) => current.filter((_, i) => i !== index))
                  : undefined
              }
            />
          ))}

          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() =>
              setRecipients((current) => [
                ...current,
                { key: `r${Date.now()}`, role: "TO" as RecipientRole },
              ])
            }
          >
            + Empfänger
          </Button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Zweck"
            htmlFor={ids.purpose}
            hint="„Zur Ausführung“ heisst, danach wird gebaut. Das ist später der Unterschied zwischen einem Nachtrag und einem Gespräch."
          >
            <Select
              id={ids.purpose}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as TransmittalPurpose)}
              options={TRANSMITTAL_PURPOSE_OPTIONS}
            />
          </Field>
          <Field label="Weg" htmlFor={ids.medium}>
            <Select
              id={ids.medium}
              value={medium}
              onChange={(event) => setMedium(event.target.value as TransmittalMedium)}
              options={TRANSMITTAL_MEDIUM_OPTIONS}
            />
          </Field>
        </div>

        <Field label="Bemerkung" htmlFor={ids.note} optional>
          <Textarea
            id={ids.note}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ausführungsstand EG Heizung. Rev. B ist damit überholt."
          />
        </Field>
      </Form>
    </Modal>
  );
}

type Recipient = {
  key: string;
  role: RecipientRole;
  employee?: EntityOption | null;
  name?: string;
  org?: string;
  mail?: string;
};

/**
 * One plan, selectable only if it could actually be sent.
 *
 * The revision offered is the plan's newest — `currentRevision` names it and
 * the list row does not carry the revision's id, so the selection is keyed on
 * the plan until the detail is fetched. That is a real limitation and the
 * reason this list asks the API for a page of 100 rather than paginating: at
 * this size a project's plan set fits, and beyond it the dialog would need the
 * revision ids on the list row.
 */
function PlanRow({
  plan,
  checked,
  onToggle,
}: {
  plan: Drawing;
  checked: Set<string>;
  onToggle: (revisionId: string, on: boolean) => void;
}) {
  const [revisionId, setRevisionId] = useState<string | null>(null);
  /**
   * What the reader just clicked, before the round-trip that confirms it.
   *
   * The first tick has to fetch the plan's detail to learn its newest
   * revision's id — a list row carries the revision *letter*, not the id. So
   * without this the checkbox sat unchanged for the length of a request and the
   * click read as having done nothing. Playwright reported it as **"clicking
   * the checkbox did not change its state"**, which is exactly what a person
   * sees.
   *
   * The optimistic flag is dropped as soon as `revisionId` is known, after
   * which the shared `Set` is the single source of truth — so a failed fetch
   * cannot leave a row ticked that is not in the selection.
   */
  const [pending, setPending] = useState<boolean | null>(null);

  // Only what a list row knows. The server re-checks everything.
  const refusal = refuseSelection(plan, {
    releasedAt: plan.status === "RELEASED" || plan.status === "ISSUED" ? new Date() : null,
    supersededAt: null,
  });

  const id = `plan-${plan.id}`;
  const on = revisionId !== null ? checked.has(revisionId) : (pending ?? false);

  async function toggle(next: boolean) {
    if (refusal) return;

    if (!revisionId) {
      // The list row has no revision id, so the first tick fetches the detail.
      // One request per plan somebody actually selects, rather than a join on
      // every row of the register.
      setPending(next);
      try {
        const detail = await drawingRepository.get(plan.id);
        const newest = detail.revisions[0];
        if (!newest) {
          setPending(null);
          return;
        }
        setRevisionId(newest.id);
        onToggle(newest.id, next);
      } catch {
        // Back to unticked: a row that stayed checked after a failed lookup
        // would be one the reader believes is in the Planversand.
        setPending(null);
      }
      return;
    }
    onToggle(revisionId, next);
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <input
        id={id}
        type="checkbox"
        checked={on}
        // Disabled only by a refusal, never by the in-flight lookup: greying a
        // control out at the instant it is clicked is the other way to make a
        // click read as having done nothing.
        disabled={Boolean(refusal)}
        onChange={(event) => void toggle(event.target.checked)}
        className="h-4 w-4 shrink-0 rounded border-line-strong text-accent disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[13px] text-ink">{plan.number}</span>
          <span className="min-w-0 truncate text-[13px]">{plan.title}</span>
        </span>
        {refusal ? (
          // The reason, attached to the row. A disabled checkbox with no
          // explanation is one somebody clicks three times.
          <span className="text-[12px] text-muted">{refusal}</span>
        ) : null}
      </label>
      <RevisionBadge revision={plan.currentRevision} />
    </li>
  );
}

function RecipientFields({
  recipient,
  onChange,
  onRemove,
}: {
  recipient: Recipient;
  onChange: (next: Partial<Recipient>) => void;
  onRemove?: () => void;
}) {
  // `useId` rather than the row's key: the key is a value this component was
  // handed, and an `id` built from it would be stable only by luck.
  const pickerId = useId();
  const external = !recipient.employee;

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={recipient.role}
          onChange={(event) => onChange({ role: event.target.value as RecipientRole })}
          aria-label="Rolle"
          className="w-28"
          options={RECIPIENT_ROLE_OPTIONS}
        />
        <div className="min-w-0 flex-1">
          {external ? (
            <Input
              value={recipient.name ?? ""}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="Name — z. B. M. Brunner"
              aria-label="Name"
            />
          ) : (
            <span className="text-[14px] text-ink">{recipient.employee?.label}</span>
          )}
        </div>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Entfernen
          </Button>
        ) : null}
      </div>

      {external ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={recipient.org ?? ""}
            onChange={(event) => onChange({ org: event.target.value })}
            placeholder="Firma"
            aria-label="Firma"
          />
          <Input
            value={recipient.mail ?? ""}
            type="email"
            onChange={(event) => onChange({ mail: event.target.value })}
            placeholder="E-Mail"
            aria-label="E-Mail"
          />
        </div>
      ) : null}

      <EntityPicker
        id={pickerId}
        value={recipient.employee?.value ?? null}
        selected={recipient.employee ?? null}
        onChange={(_next, option) => onChange({ employee: option })}
        search={async (q) => {
          const page = await drawingRepository.employeeOptions(q || undefined);
          return page.items.map((row) => ({
            value: row.id,
            label: row.name,
            hint: row.position ?? row.email,
          }));
        }}
        placeholder="… oder eine Person aus dem Personal"
      />
    </div>
  );
}

/**
 * What the send actually did, including who must be told.
 *
 * The dialog becomes a report rather than closing, because the **warnings are
 * the half that matters** and a toast would put them where nobody reads them.
 * Grouped by person, because the action is one e-mail: twelve warnings naming
 * the same contractor twelve times is a list somebody stops reading at the
 * third.
 */
function SentReport({ result, onClose }: { result: TransmittalResult; onClose: () => void }) {
  const grouped = warningsByRecipient(result.warnings);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${result.transmittal.number} versandt`}
      description={`${result.transmittal.items.length} Pläne an ${result.transmittal.recipients.length} Empfänger.`}
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Schliessen</Button>
        </>
      }
    >
      {grouped.length ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-relaxed text-ink">
            <strong className="font-medium">Diese Personen haben eine ältere Revision.</strong> Der
            Versand ist erfolgt — sie sollten wissen, dass ihr Stand überholt ist.
          </p>
          <ul className="flex flex-col gap-2">
            {grouped.map((entry) => (
              <li key={entry.recipient} className="rounded-lg bg-surface-sunken p-3 ring-1 ring-line">
                <span className="text-[14px] font-medium text-ink">{entry.recipient}</span>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {entry.plans.map((plan) => (
                    <li key={plan} className="font-mono text-[12px] text-muted">
                      {plan}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[14px] leading-relaxed">
          Niemand hielt eine ältere Revision dieser Pläne. <Badge tone="energy">Nichts offen</Badge>
        </p>
      )}
    </Modal>
  );
}
