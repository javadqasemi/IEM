import { BadRequestException } from "@nestjs/common";
import type { ContentTypeDef, FieldDef } from "./content-types";

/**
 * Validates an entry's `data` against its content type.
 *
 * The database stores content as JSON, so it cannot enforce the shape — this
 * is where that enforcement lives instead, and it is the reason the tradeoff
 * in `schema.prisma` is acceptable. It runs on every write, not only on
 * publish: catching a missing field at save time puts the error in front of
 * the person who can fix it, while catching it at publish time puts it in
 * front of whoever happened to press the button.
 *
 * It returns cleaned data rather than validating in place. Unknown keys are
 * **dropped, not rejected** — a payload from an older dashboard build that
 * still carries a field since removed should save the part that is still
 * valid, not fail wholesale. Type errors are rejected, because a number where
 * a string belongs will break a component.
 */
export function validateEntry(
  type: ContentTypeDef,
  data: unknown,
): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new BadRequestException({
      code: "validation_failed",
      message: "Der Inhalt muss ein Objekt sein.",
    });
  }

  const errors: Record<string, string[]> = {};
  const clean = validateFields(type.fields, data as Record<string, unknown>, "", errors);

  if (Object.keys(errors).length) {
    throw new BadRequestException({
      code: "validation_failed",
      message: "Die Eingaben sind unvollständig oder ungültig.",
      fields: errors,
    });
  }
  return clean;
}

function validateFields(
  fields: FieldDef[],
  input: Record<string, unknown>,
  prefix: string,
  errors: Record<string, string[]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const raw = input[field.name];

    if (isBlank(raw)) {
      if (field.required) {
        push(errors, path, `${field.label} ist erforderlich.`);
      }
      // A blank optional field is *omitted*, not stored as "". The snapshot
      // builder then drops the key entirely, which is what makes an absent
      // architect render as no row rather than as an empty one.
      continue;
    }

    const value = validateField(field, raw, path, errors);
    if (value !== undefined) out[field.name] = value;
  }

  return out;
}

function validateField(
  field: FieldDef,
  raw: unknown,
  path: string,
  errors: Record<string, string[]>,
): unknown {
  switch (field.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        push(errors, path, `${field.label} muss eine Zahl sein.`);
        return undefined;
      }
      if (field.min !== undefined && n < field.min) {
        push(errors, path, `${field.label} darf nicht kleiner als ${field.min} sein.`);
      }
      if (field.max !== undefined && n > field.max) {
        push(errors, path, `${field.label} darf nicht grösser als ${field.max} sein.`);
      }
      return n;
    }

    case "boolean":
      return Boolean(raw);

    case "select": {
      const s = String(raw);
      // `optionsFrom` options are resolved from another collection at runtime,
      // so they cannot be checked here — the publish-time cross-check in
      // `snapshot.builder.ts` covers those instead.
      if (field.options && !field.options.some((o) => o.value === s)) {
        push(
          errors,
          path,
          `„${s}“ ist für ${field.label} nicht zulässig. Erlaubt: ${field.options
            .map((o) => o.value)
            .join(", ")}.`,
        );
        return undefined;
      }
      return s;
    }

    case "multiselect": {
      if (!Array.isArray(raw)) {
        push(errors, path, `${field.label} muss eine Liste sein.`);
        return undefined;
      }
      const values = raw.map(String);
      if (field.options) {
        const allowed = new Set(field.options.map((o) => o.value));
        const bad = values.filter((v) => !allowed.has(v));
        if (bad.length) {
          push(errors, path, `Unzulässige Werte in ${field.label}: ${bad.join(", ")}.`);
          return undefined;
        }
      }
      return values;
    }

    case "list": {
      if (!Array.isArray(raw)) {
        push(errors, path, `${field.label} muss eine Liste sein.`);
        return undefined;
      }
      // Blank rows are dropped rather than reported: an editor leaving an
      // empty row at the bottom of a list of duties means "I am done", not
      // "I have made a mistake".
      return raw.map(String).map((s) => s.trim()).filter(Boolean);
    }

    case "object": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        push(errors, path, `${field.label} muss ein Objekt sein.`);
        return undefined;
      }
      const nested = validateFields(
        field.fields ?? [],
        raw as Record<string, unknown>,
        path,
        errors,
      );
      return Object.keys(nested).length ? nested : undefined;
    }

    case "objectList": {
      if (!Array.isArray(raw)) {
        push(errors, path, `${field.label} muss eine Liste sein.`);
        return undefined;
      }
      return raw.map((item, i) =>
        validateFields(
          field.fields ?? [],
          (item ?? {}) as Record<string, unknown>,
          `${path}[${i}]`,
          errors,
        ),
      );
    }

    case "email": {
      const s = String(raw).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        push(errors, path, `${field.label} ist keine gültige E-Mail-Adresse.`);
        return undefined;
      }
      return s;
    }

    case "url": {
      const s = String(raw).trim();
      // Relative paths are legitimate here — `/img/...` and `#anchor` are both
      // real values in this content model — so only reject a string that looks
      // like it wanted to be absolute and failed.
      if (/^[a-z]+:/i.test(s) && !/^https?:\/\//i.test(s) && !/^(mailto|tel):/i.test(s)) {
        push(errors, path, `${field.label} muss http(s), mailto oder tel sein.`);
        return undefined;
      }
      return s;
    }

    case "color": {
      const s = String(raw).trim();
      if (!/^#[0-9a-f]{3,8}$/i.test(s)) {
        push(errors, path, `${field.label} muss eine Hex-Farbe sein, z. B. #003882.`);
        return undefined;
      }
      return s;
    }

    default: {
      // text, textarea, richtext, image, file, tel, date
      const s = String(raw);
      if (field.maxLength && s.length > field.maxLength) {
        push(
          errors,
          path,
          `${field.label} darf höchstens ${field.maxLength} Zeichen lang sein (aktuell ${s.length}).`,
        );
      }
      return s;
    }
  }
}

function isBlank(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

function push(errors: Record<string, string[]>, path: string, message: string) {
  (errors[path] ??= []).push(message);
}
