import { useEffect, useId, useState } from "react";
import { ApiError } from "@/core/api";
import { useAuth } from "@/core/auth";
import { navigate } from "@/core/router";
import {
  DecisionStatusBadge,
  ITEM_KIND_OPTIONS,
  ItemKindBadge,
  type ItemDraft,
  type MeetingDetail,
  type MeetingItem,
  type MeetingItemKind,
} from "@/entities/meeting";
import { DisciplineDot } from "@/entities/project";
import { TaskStatusBadge } from "@/entities/task";
import { Button, EmptyState } from "@/shared/ui/primitives";
import {
  DateInput,
  EntityPicker,
  Field,
  Select,
  Textarea,
  type EntityOption,
} from "@/shared/ui/forms";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, parseDateInput, toDateInput } from "@/shared/utils/format";
import { meetingRepository } from "../repository";
import { useMeetingMutations } from "../hooks/useMeetings";
import { groupProtocol } from "../service";

/**
 * The protocol — the module's centre of gravity.
 *
 * Lines under the agenda item they were discussed against, with the ones that
 * belong to none at the foot under their own heading. `groupProtocol` does the
 * splitting and explains why both halves matter.
 *
 * ---
 *
 * **The whole panel is read-only when the protocol is approved**, and it says
 * so in a sentence rather than by greying things out silently. `protocolLocked`
 * arrives with the record, so the editor is closed before the user types rather
 * than after they press save — and the server refuses either way, which is what
 * makes this a courtesy rather than the control.
 */
export function ProtocolPanel({ meeting }: { meeting: MeetingDetail }) {
  const { can } = useAuth();
  const toast = useToast();
  const mutations = useMeetingMutations();

  const [adding, setAdding] = useState<string | null | false>(false);
  const [editing, setEditing] = useState<MeetingItem | null>(null);
  const [busy, setBusy] = useState(false);

  const mayWrite = can("meeting.update") && !meeting.protocolLocked;
  const groups = groupProtocol(meeting);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setAdding(false);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Nicht möglich.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {meeting.protocolLocked ? (
        <div className="rounded-lg bg-surface-sunken p-3 text-[13px] leading-relaxed ring-1 ring-line">
          {/*
            The rule in a sentence, with the way forward.

            A refusal with no way forward is one people route around — here, by
            keeping the real minutes in a Word file.
          */}
          <strong className="font-medium text-ink">Dieses Protokoll ist genehmigt.</strong>{" "}
          Es ist damit der Stand. Eine Korrektur wird als Änderung an der nächsten Sitzung
          genehmigt und bleibt neben dem ursprünglichen Text stehen.
        </div>
      ) : null}

      {groups.map(({ agenda, items }) => (
        <section key={agenda?.id ?? "__loose"} className="flex flex-col gap-2">
          <header className="flex flex-wrap items-baseline gap-2 border-b border-line pb-1.5">
            <h3 className="text-[13px] font-semibold text-ink">
              {agenda ? (
                <>
                  <span className="font-mono text-muted">{agenda.order}.</span> {agenda.title}
                </>
              ) : (
                "Ohne Traktandum"
              )}
            </h3>
            {agenda?.presenter ? (
              <span className="text-[12px] text-muted">{agenda.presenter.name}</span>
            ) : null}
            {agenda?.durationMinutes ? (
              <span className="text-[12px] text-muted">{agenda.durationMinutes} min</span>
            ) : null}
          </header>

          {agenda?.note ? (
            <p className="whitespace-pre-line px-1 text-[13px] leading-relaxed text-muted">
              {agenda.note}
            </p>
          ) : null}

          {items.map((item) => (
            <ProtocolRow
              key={item.id}
              item={item}
              mayWrite={mayWrite}
              busy={busy}
              onEdit={() => setEditing(item)}
              onRemove={() =>
                void run(() => mutations.removeItem(meeting.id, item.id), "Zeile entfernt")
              }
            />
          ))}

          {!items.length ? (
            <p className="px-1 py-2 text-[12px] text-muted">
              {agenda ? "Nicht behandelt." : "Keine Zeilen."}
            </p>
          ) : null}

          {mayWrite && agenda ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setAdding(agenda.id)}
            >
              + Zeile
            </Button>
          ) : null}
        </section>
      ))}

      {!meeting.items.length && !meeting.agenda.length ? (
        <EmptyState
          title="Noch kein Protokoll"
          description="Traktanden werden vor der Sitzung gesetzt, die Zeilen danach geschrieben. Beides geht auch ohne das andere."
        />
      ) : null}

      {mayWrite ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setAdding(null)}>
          + Zeile ohne Traktandum
        </Button>
      ) : null}

      {adding !== false ? (
        <ItemDialog
          meeting={meeting}
          agendaItemId={adding}
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={(draft) =>
            run(() => mutations.addItem(meeting.id, draft), "Zeile hinzugefügt")
          }
        />
      ) : null}

      {editing ? (
        <ItemDialog
          meeting={meeting}
          item={editing}
          agendaItemId={editing.agendaItemId}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={(draft) =>
            run(() => mutations.updateItem(meeting.id, editing.id, draft), "Zeile geändert")
          }
        />
      ) : null}
    </div>
  );
}

/**
 * One line, cited by its key.
 *
 * `14.3` is set in a monospace column of its own, because that is how it is
 * read out and how somebody finds it when it is quoted in an e-mail.
 */
function ProtocolRow({
  item,
  mayWrite,
  busy,
  onEdit,
  onRemove,
}: {
  item: MeetingItem;
  mayWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="group flex gap-3 rounded-lg px-1 py-2 hover:bg-surface-sunken">
      <span className="w-12 shrink-0 pt-0.5 font-mono text-[12px] tnum text-muted">{item.key}</span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">{item.text}</p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
          <ItemKindBadge kind={item.kind} />

          {item.discipline ? (
            <span className="inline-flex items-center gap-1.5">
              <DisciplineDot colour={item.discipline.colour} />
              {item.discipline.code}
            </span>
          ) : null}

          {item.responsible ? <span>{item.responsible.name}</span> : null}
          {item.dueDate ? <span>bis {formatDate(item.dueDate)}</span> : null}

          {/*
            The two links that stop minutes being a document nobody reads: the
            Pendenz on somebody's board and the Entscheid that can be cited.
          */}
          {item.task ? (
            <button
              type="button"
              onClick={() => navigate("/aufgaben")}
              className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 ring-1 ring-line hover:ring-line-strong"
            >
              <TaskStatusBadge status={item.task.status} />
              <span className="max-w-[16rem] truncate">{item.task.title}</span>
            </button>
          ) : null}

          {item.decision ? (
            <button
              type="button"
              onClick={() => navigate(`/entscheide/${item.decision!.id}`)}
              className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 ring-1 ring-line hover:ring-line-strong"
            >
              <span className="font-mono">{item.decision.number}</span>
              <DecisionStatusBadge status={item.decision.status} />
            </button>
          ) : null}
        </div>
      </div>

      {mayWrite ? (
        <div className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
            Ändern
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
            Entfernen
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Adding or changing a line.
 *
 * **The kind drives the form**, because the three are not interchangeable: a
 * Pendenz needs a person and a date — the server refuses without them — and an
 * Entscheid needs a decision, which is created on its own screen first. The
 * form says so rather than letting somebody find out on submit.
 */
function ItemDialog({
  meeting,
  item,
  agendaItemId,
  busy,
  onClose,
  onSubmit,
}: {
  meeting: MeetingDetail;
  item?: MeetingItem;
  agendaItemId: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: ItemDraft) => void;
}) {
  const ids = {
    text: useId(),
    kind: useId(),
    responsible: useId(),
    due: useId(),
    discipline: useId(),
  };

  const [text, setText] = useState(item?.text ?? "");
  const [kind, setKind] = useState<MeetingItemKind>(item?.kind ?? "INFORMATION");
  const [responsible, setResponsible] = useState<EntityOption | null>(
    item?.responsible ? { value: item.responsible.id, label: item.responsible.name } : null,
  );
  const [dueDate, setDueDate] = useState(toDateInput(item?.dueDate));
  const [discipline, setDiscipline] = useState(item?.discipline?.id ?? "");

  const isPendenz = kind === "PENDENZ";
  const isEntscheid = kind === "ENTSCHEID";
  const incomplete = !text.trim() || (isPendenz && (!responsible || !dueDate));

  /*
    Which agenda item this line will sit under, said out loud.

    The form opens from a "+ Zeile" button under one heading among five, and by
    the time somebody has typed three sentences the heading has scrolled away.
    Getting it wrong is not an error the server can catch — the line is simply
    filed under the wrong Traktandum in a document that gets printed.
  */
  const agenda = agendaItemId ? meeting.agenda.find((a) => a.id === agendaItemId) : null;

  return (
    <div className="rounded-lg bg-surface-sunken p-4 ring-1 ring-line">
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-muted">
          {agenda ? (
            <>
              Zu Traktandum <span className="font-mono">{agenda.order}</span> — {agenda.title}
            </>
          ) : (
            "Ohne Traktandum"
          )}
        </p>

        <Field label="Text" htmlFor={ids.text}>
          <Textarea
            id={ids.text}
            value={text}
            rows={3}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            placeholder="Was wurde gesagt, beschlossen oder aufgetragen?"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Art" htmlFor={ids.kind}>
            <Select
              id={ids.kind}
              value={kind}
              onChange={(event) => setKind(event.target.value as MeetingItemKind)}
              options={ITEM_KIND_OPTIONS}
            />
          </Field>

          <Field label="Gewerk" htmlFor={ids.discipline} optional>
            <DisciplineSelect id={ids.discipline} value={discipline} onChange={setDiscipline} />
          </Field>
        </div>

        {isPendenz ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Zuständig"
              htmlFor={ids.responsible}
              hint="Pflicht — eine Pendenz ohne Namen ist die, die an Bausitzung 20 noch offen ist."
            >
              <EntityPicker
                id={ids.responsible}
                value={responsible?.value ?? null}
                selected={responsible}
                onChange={(_next, option) => setResponsible(option)}
                search={async (q) => {
                  const page = await meetingRepository.employeeOptions(q || undefined);
                  return page.items.map((row) => ({
                    value: row.id,
                    label: row.name,
                    hint: row.position ?? row.email,
                  }));
                }}
                placeholder="Person suchen …"
              />
            </Field>
            <Field label="Termin" htmlFor={ids.due} hint="Pflicht.">
              <DateInput id={ids.due} value={dueDate} onChange={setDueDate} />
            </Field>
          </div>
        ) : null}

        {isEntscheid && !item?.decision ? (
          /*
            Said here rather than refused on submit.

            A decision has a number, a rationale and a life of its own; creating
            one as a side effect of typing a protocol line is how rationales end
            up empty. The two-step is the rule, and the form explains it.
          */
          <p className="rounded bg-surface p-3 text-[12px] leading-relaxed text-muted ring-1 ring-line">
            Ein Entscheid wird als eigener Eintrag erfasst — mit Nummer, Begründung und
            Auswirkung — und danach hier verknüpft. Die Zeile kann vorerst als Information
            gespeichert werden.
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            busy={busy}
            disabled={incomplete || (isEntscheid && !item?.decision)}
            onClick={() =>
              onSubmit({
                text: text.trim(),
                kind,
                agendaItemId,
                responsibleId: responsible?.value ?? null,
                dueDate: parseDateInput(dueDate),
                disciplineId: discipline || null,
              })
            }
          >
            {item ? "Speichern" : "Hinzufügen"}
          </Button>
        </div>

        {isPendenz && !item ? (
          <p className="text-[12px] text-muted">
            Aus dieser Zeile entsteht automatisch eine Aufgabe für{" "}
            {responsible?.label ?? "die zuständige Person"}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Gewerke as a plain select — an `EntityPicker` over six is slower to use
 * than a dropdown, because the whole list fits on screen and nothing is typed.
 *
 * Fetched rather than taken from a constant: `disc-*` are token *names* and the
 * rows are seeded, so a firm that adds a seventh gets it here without a release.
 * A failure leaves the list at "Kein Gewerk", which is the field's own default —
 * the form stays usable rather than blocking on a lookup nothing depends on.
 */
function DisciplineSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [options, setOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  useEffect(() => {
    let live = true;
    void meetingRepository
      .disciplineOptions()
      .then((rows) => {
        if (live) setOptions(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: "", label: "Kein Gewerk" },
        ...options.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` })),
      ]}
    />
  );
}
