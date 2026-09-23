import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import {
  REVISION_REASON_OPTIONS,
  RevisionBadge,
  type DrawingDetail,
  type Revision,
  type RevisionReason,
} from "@/entities/drawing";
import { Button } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import { Field, Form, Input, Select, Textarea } from "@/shared/ui/forms";
import { useDrawingMutations } from "../hooks/useDrawings";
import { formatSize } from "../service";

/**
 * A new revision.
 *
 * **The letter is the server's.** `nextDrawingRevision` advances it and skips
 * `I` and `O` — `I` reads as a one and `O` as a nought in a title block, which
 * is why ISO 7200 omits both. A caller may type one instead, because a plan set
 * that started life in AutoCAD arrives at `C`; the server refuses `I`, `O` and
 * anything that is not letters.
 *
 * **`changeNote` is required and must say something.** Six months later the
 * question is never "was there a revision C" but "what changed in C". An empty
 * note makes the row a date stamp.
 *
 * ---
 *
 * **The file is not uploaded, and this dialog says so.**
 *
 * `DrawingRevision` carries `storageKey`, `size`, `checksum` and `mimeType`,
 * and the server records them — but there is no upload route for plans yet, and
 * inventing one that wrote into `MEDIA_ROOT` would publish the firm's drawings
 * to anyone who can guess a URL. The media allowlist in `main.ts` is a
 * *positive* match for exactly that reason.
 *
 * So the dialog reads the chosen file locally — its name, its size and a real
 * SHA-256 of its bytes — and records the revision against the copy that stays
 * on the firm's share. The checksum is not decoration: it is how somebody later
 * verifies that the file they were sent is the file that was issued, which is
 * the question a Planversand exists to answer. What is missing is the bytes,
 * and that is a deliberate stop rather than an oversight, the same shape as
 * `minutesSentAt` recording a send that no e-mail performs.
 */
export function RevisionDialog({
  drawing,
  onClose,
  onCreated,
}: {
  drawing: DrawingDetail;
  onClose: () => void;
  onCreated: (revision: Revision) => void;
}) {
  const ids = {
    file: useId(),
    note: useId(),
    reason: useId(),
    revision: useId(),
  };

  const mutations = useDrawingMutations();

  const [file, setFile] = useState<File | null>(null);
  const [checksum, setChecksum] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [reason, setReason] = useState<RevisionReason>(
    // A plan with no revision is having its first one; everything else is a
    // change, and coordination is the commonest reason for one.
    drawing.currentRevision ? "KOORDINATION" : "ERSTAUSGABE",
  );
  const [revision, setRevision] = useState("");

  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => errors[field]?.[0];
  const ready = Boolean(file && checksum) && changeNote.trim().length >= 10;

  async function pick(chosen: File | null) {
    setFile(chosen);
    setChecksum(null);
    if (!chosen) return;

    setHashing(true);
    try {
      /*
        A real SHA-256 of the real bytes, computed in the browser.

        `crypto.subtle` is available on localhost and over HTTPS, which is every
        context this dashboard runs in. If it ever is not, the catch below
        leaves the checksum null and the form stays disabled rather than
        inventing a value — a fabricated checksum is worse than none, because it
        would be trusted.
      */
      const buffer = await chosen.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      setChecksum(
        [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      );
    } catch {
      setError("Die Prüfsumme konnte nicht berechnet werden — bitte die Datei erneut wählen.");
    } finally {
      setHashing(false);
    }
  }

  async function submit() {
    if (!file || !checksum) return;
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const created = await mutations.createRevision(drawing.id, {
        changeNote: changeNote.trim(),
        reason,
        revision: revision.trim() || undefined,
        /*
          Derived, not uploaded — see the note at the top. The key is the path
          the file would have if it were stored, so the day an upload route
          exists the records already point at the right shape.
        */
        storageKey: `plaene/${new Date().getFullYear()}/${drawing.number}-${
          revision.trim().toUpperCase() || "neu"
        }.${file.name.split(".").pop() ?? "pdf"}`,
        fileName: file.name,
        size: file.size,
        checksum,
        mimeType: file.type || "application/octet-stream",
      });
      onCreated(created);
    } catch (err) {
      const failure = toFailure(err);
      setErrors(failure.fields);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Neue Revision"
      description={
        drawing.currentRevision
          ? `Aktuell ist Rev. ${drawing.currentRevision}. Die neue Revision wird die aktuelle, sobald der Plan freigegeben ist.`
          : "Die erste Revision dieses Plans."
      }
      size="lg"
      footer={
        <>
          {drawing.currentRevision ? (
            <RevisionBadge revision={drawing.currentRevision} superseded />
          ) : null}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={() => void submit()} busy={busy} disabled={!ready || hashing}>
            Revision anlegen
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <Field
          label="Datei"
          htmlFor={ids.file}
          hint="Name, Grösse und Prüfsumme werden übernommen. Die Datei selbst bleibt vorerst auf dem Laufwerk — siehe unten."
        >
          <input
            id={ids.file}
            type="file"
            onChange={(event) => void pick(event.target.files?.[0] ?? null)}
            className="block w-full text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunken
                       file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-ink
                       hover:file:bg-surface-2"
          />
        </Field>

        {file ? (
          <div className="rounded-lg bg-surface-sunken p-3 text-[12px] ring-1 ring-line">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium text-ink">{file.name}</span>
              <span className="text-muted">{formatSize(file.size)}</span>
              <span className="text-muted">{file.type || "unbekannter Typ"}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted">
              {hashing ? "Prüfsumme wird berechnet …" : `SHA-256 ${checksum?.slice(0, 32)}…`}
            </div>
          </div>
        ) : null}

        <Field
          label="Was geändert wurde"
          htmlFor={ids.note}
          error={fieldError("changeNote")}
          hint="Mindestens zehn Zeichen. In zwei Jahren ist das die einzige Antwort auf „was war in Revision C anders“."
        >
          <Textarea
            id={ids.note}
            rows={3}
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
            invalid={Boolean(fieldError("changeNote"))}
            placeholder="Steigzone Ost nach Norden verschoben, Heizkörper Zimmer 012 angepasst."
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grund" htmlFor={ids.reason}>
            <Select
              id={ids.reason}
              value={reason}
              onChange={(event) => setReason(event.target.value as RevisionReason)}
              options={REVISION_REASON_OPTIONS}
            />
          </Field>
          <Field
            label="Revision"
            htmlFor={ids.revision}
            optional
            error={fieldError("revision")}
            hint="Leer lassen zählt weiter. I und O werden übersprungen — sie lesen sich im Plankopf als 1 und 0."
          >
            <Input
              id={ids.revision}
              value={revision}
              onChange={(event) => setRevision(event.target.value.toUpperCase())}
              invalid={Boolean(fieldError("revision"))}
              placeholder="fortlaufend"
              className="font-mono"
            />
          </Field>
        </div>

        {/*
          The stop, stated plainly rather than discovered.

          A dialog that looked like an upload and silently stored nothing would
          be worse than one that says what it does.
        */}
        <p className="rounded-lg bg-surface-sunken p-3 text-[12px] leading-relaxed text-muted ring-1 ring-line">
          <strong className="font-medium text-ink">Die Datei wird noch nicht hochgeladen.</strong>{" "}
          Erfasst werden Name, Grösse und Prüfsumme; die Zeichnung selbst bleibt auf dem Laufwerk,
          bis das Dokumentenmodul die Ablage mitbringt. Die Prüfsumme ist echt — damit lässt sich
          später belegen, dass eine versandte Datei die freigegebene ist.
        </p>
      </Form>
    </Modal>
  );
}
