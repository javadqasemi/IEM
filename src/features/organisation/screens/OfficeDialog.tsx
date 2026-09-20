import { useId } from "react";
import { Button } from "@/shared/ui/primitives";
import { Field, Form, Input, Select, Textarea, Toggle, useForm } from "@/shared/ui/forms";
import { Modal } from "@/shared/ui/overlays";
import type { Office, OfficeDraft } from "@/entities/organisation";
import { validateOffice } from "../service";

/**
 * Creating and editing a Standort, in one dialog.
 *
 * **A dialog, not a route** — the opposite of what Sitzungen chose and for the
 * same test. A protocol is read, quoted and pasted into an e-mail, so it needs
 * a URL. An office is opened, a telephone number is corrected, and it is
 * closed; there are two of them, and they are edited from a register that
 * fits on one screen. The cost is stated rather than discovered: **an office
 * has no shareable URL.**
 */
export function OfficeDialog({
  open,
  office,
  kinds,
  existing,
  onClose,
  onSave,
}: {
  open: boolean;
  /** `null` creates. */
  office: Office | null;
  kinds: string[];
  /** Everything already in the register — for the headquarters warning. */
  existing: Office[];
  onClose: () => void;
  onSave: (draft: OfficeDraft, office: Office | null) => Promise<unknown>;
}) {
  const id = useId();

  const initial: OfficeDraft = office
    ? {
        name: office.name,
        kind: office.kind,
        street: office.street,
        zip: office.zip,
        city: office.city,
        canton: office.canton,
        country: office.country,
        phone: office.phone,
        email: office.email,
        latitude: office.latitude,
        longitude: office.longitude,
        mapsUrl: office.mapsUrl,
        openingHours: office.openingHours,
        isHeadquarters: office.isHeadquarters,
        isPublic: office.isPublic,
        position: office.position,
      }
    : {
        name: "",
        kind: kinds[1] ?? "Zweigbüro",
        street: null,
        zip: null,
        city: null,
        canton: null,
        country: "CH",
        phone: null,
        email: null,
        latitude: null,
        longitude: null,
        mapsUrl: null,
        openingHours: null,
        isHeadquarters: false,
        isPublic: true,
        position: existing.length,
      };

  const form = useForm<OfficeDraft>({
    initial,
    validate: (values) => validateOffice({ ...values, id: "", version: 1, archivedAt: null }),
    onSubmit: async (values) => {
      await onSave(values, office);
      onClose();
    },
  });

  const text = (name: keyof OfficeDraft) => String(form.values[name] ?? "");
  const setText = (name: keyof OfficeDraft, raw: string) =>
    form.patch({ [name]: raw === "" ? null : raw } as Partial<OfficeDraft>);
  const setNumber = (name: keyof OfficeDraft, raw: string) =>
    form.patch({
      [name]: raw.trim() === "" ? null : Number(raw),
    } as Partial<OfficeDraft>);

  const currentHq = existing.find((o) => o.isHeadquarters && o.id !== office?.id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      size="lg"
      title={office ? `Standort „${office.name}“ bearbeiten` : "Standort anlegen"}
      description="Öffentliche Standorte erscheinen mit der nächsten Veröffentlichung auf der Website."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Abbrechen
          </Button>
          <Button variant="primary" busy={form.submitting} onClick={form.submit}>
            {office ? "Speichern" : "Anlegen"}
          </Button>
        </>
      }
    >
      <Form onSubmit={form.submit} error={form.error}>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${id}-name`} error={form.fieldError("name")}>
            <Input
              id={`${id}-name`}
              value={text("name")}
              invalid={Boolean(form.fieldError("name"))}
              onChange={(e) => form.patch({ name: e.target.value })}
            />
          </Field>

          <Field
            label="Bezeichnung"
            htmlFor={`${id}-kind`}
            hint="Steht auf der Website neben dem Ort."
          >
            <Select
              id={`${id}-kind`}
              value={text("kind")}
              options={kinds.map((kind) => ({ value: kind, label: kind }))}
              onChange={(e) => form.patch({ kind: e.target.value })}
            />
          </Field>

          <Field label="Strasse" htmlFor={`${id}-street`} className="sm:col-span-2">
            <Input
              id={`${id}-street`}
              value={text("street")}
              autoComplete="street-address"
              onChange={(e) => setText("street", e.target.value)}
            />
          </Field>

          <Field label="PLZ" htmlFor={`${id}-zip`}>
            <Input
              id={`${id}-zip`}
              value={text("zip")}
              autoComplete="postal-code"
              onChange={(e) => setText("zip", e.target.value)}
            />
          </Field>

          <Field
            label="Ort"
            htmlFor={`${id}-city`}
            hint="Auch der Wert, dem Teammitglieder im Team-Raster zugeordnet werden."
          >
            <Input
              id={`${id}-city`}
              value={text("city")}
              onChange={(e) => setText("city", e.target.value)}
            />
          </Field>

          <Field label="Kanton" htmlFor={`${id}-canton`}>
            <Input
              id={`${id}-canton`}
              value={text("canton")}
              onChange={(e) => setText("canton", e.target.value)}
            />
          </Field>

          <Field label="Land" htmlFor={`${id}-country`} error={form.fieldError("country")} hint="Zwei Buchstaben.">
            <Input
              id={`${id}-country`}
              value={text("country")}
              invalid={Boolean(form.fieldError("country"))}
              onChange={(e) => form.patch({ country: e.target.value.toUpperCase() })}
            />
          </Field>

          <Field
            label="Telefon"
            htmlFor={`${id}-phone`}
            hint="Der tel:-Link wird daraus abgeleitet — er muss nicht mehr getippt werden."
          >
            <Input
              id={`${id}-phone`}
              type="tel"
              value={text("phone")}
              autoComplete="tel"
              onChange={(e) => setText("phone", e.target.value)}
            />
          </Field>

          <Field label="E-Mail" htmlFor={`${id}-email`} error={form.fieldError("email")}>
            <Input
              id={`${id}-email`}
              type="email"
              value={text("email")}
              invalid={Boolean(form.fieldError("email"))}
              onChange={(e) => setText("email", e.target.value)}
            />
          </Field>

          <Field
            label="Breitengrad"
            htmlFor={`${id}-lat`}
            error={form.fieldError("latitude")}
            optional
          >
            <Input
              id={`${id}-lat`}
              type="number"
              step="any"
              value={text("latitude")}
              invalid={Boolean(form.fieldError("latitude"))}
              onChange={(e) => setNumber("latitude", e.target.value)}
            />
          </Field>

          <Field
            label="Längengrad"
            htmlFor={`${id}-lng`}
            error={form.fieldError("longitude")}
            optional
          >
            <Input
              id={`${id}-lng`}
              type="number"
              step="any"
              value={text("longitude")}
              invalid={Boolean(form.fieldError("longitude"))}
              onChange={(e) => setNumber("longitude", e.target.value)}
            />
          </Field>

          <Field label="Kartenlink" htmlFor={`${id}-maps`} className="sm:col-span-2" optional>
            <Input
              id={`${id}-maps`}
              value={text("mapsUrl")}
              onChange={(e) => setText("mapsUrl", e.target.value)}
            />
          </Field>

          <Field
            label="Öffnungszeiten"
            htmlFor={`${id}-hours`}
            className="sm:col-span-2"
            hint="Freitext, eine Zeile pro Tag."
            optional
          >
            <Textarea
              id={`${id}-hours`}
              rows={3}
              value={text("openingHours")}
              onChange={(e) => setText("openingHours", e.target.value)}
            />
          </Field>

          <Field
            label="Reihenfolge"
            htmlFor={`${id}-position`}
            hint="Kleinere Zahlen zuerst — auch auf der Website."
          >
            <Input
              id={`${id}-position`}
              type="number"
              min={0}
              value={String(form.values.position)}
              onChange={(e) => form.patch({ position: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-4 border-t border-line pt-5">
          <Toggle
            label="Auf der Website zeigen"
            hint="Ausgeschaltet bleibt der Standort intern — er steht weiter für Mitarbeitende und Projekte zur Verfügung."
            checked={form.values.isPublic}
            onChange={(next) => form.patch({ isPublic: next })}
          />
          <Toggle
            label="Hauptsitz"
            hint={
              currentHq
                ? `Setzt „${currentHq.name}“ zurück — es gibt genau einen Hauptsitz.`
                : "Der eingetragene Sitz der Firma."
            }
            checked={form.values.isHeadquarters}
            onChange={(next) => form.patch({ isHeadquarters: next })}
          />
        </div>
      </Form>
    </Modal>
  );
}
