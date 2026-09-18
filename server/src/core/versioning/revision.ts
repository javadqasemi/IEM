/**
 * How a business record counts its own revisions.
 *
 * Foundation stage F13. Not git — **fachliche Versionierung**: the number a
 * person writes on a drawing, quotes in an e-mail and signs off against.
 * `Projekt v12`, `Plan Rev. C`, `Protokoll v4`, `Dokument v8`.
 *
 * ---
 *
 * **Two schemes, because the firm already uses two**, and flattening them to
 * one would be the system telling an engineering office it has been labelling
 * its drawings wrong for forty years:
 *
 * | Scheme | Sequence | Used by |
 * | --- | --- | --- |
 * | `NUMERIC` | 1, 2, 3 … | Project, Meeting, Document, Offer |
 * | `ALPHA` | A, B, C … Z, AA, AB … | Drawing, Transmittal |
 *
 * The alphabetic one is SIA/ISO drawing practice and it has a real rule behind
 * it that a naive `String.fromCharCode` gets wrong: after `Z` comes `AA`, not
 * `[`. It is the same carry as a spreadsheet column, and it is written here
 * once rather than in the drawing module later, because "later" is where the
 * second, subtly different implementation comes from.
 *
 * ---
 *
 * **Everything in this file is pure**, and that is the point of it being a file
 * at all. The sequence is where the off-by-one lives; a database is not needed
 * to find it, and a test that needed one would not cover `Z → AA`.
 */

export const REVISION_SCHEMES = ["NUMERIC", "ALPHA"] as const;
export type RevisionScheme = (typeof REVISION_SCHEMES)[number];

/**
 * The label for revision `n`, where `n` is 1-based.
 *
 * 1-based rather than 0-based throughout, because the first version of a record
 * is "v1" and "Rev. A" to every person who will ever read it. Making the
 * storage 0-based and the display 1-based means one conversion somewhere, and
 * that conversion is the bug.
 */
export function revisionLabel(scheme: RevisionScheme, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`Revision ${n} gibt es nicht — gezählt wird ab 1.`);
  }
  return scheme === "NUMERIC" ? `v${n}` : alphaLabel(n);
}

/**
 * 1 → `A`, 26 → `Z`, 27 → `AA`, 703 → `AAA`.
 *
 * Bijective base-26 — the spreadsheet-column numbering — and the reason it is
 * not plain base-26 is that there is no zero digit: `AA` is 27, not 26, because
 * `A` means one rather than nought. The `- 1` before each `%` is that
 * correction, and leaving it out produces `Z` followed by `@A`.
 */
function alphaLabel(n: number): string {
  let rest = n;
  let out = "";
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    out = String.fromCharCode(65 + digit) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

/** The inverse: `A` → 1, `AA` → 27. Throws on anything that is not A–Z. */
export function alphaValue(label: string): number {
  if (!/^[A-Z]+$/.test(label)) {
    throw new RangeError(`„${label}“ ist keine Revisionsbezeichnung.`);
  }
  let value = 0;
  for (const character of label) {
    value = value * 26 + (character.charCodeAt(0) - 64);
  }
  return value;
}

/**
 * The label after this one.
 *
 * Takes the label rather than the number on purpose: a drawing's revision is
 * what is printed in its title block, and the caller usually has *that* rather
 * than an index. Round-tripping through `alphaValue` keeps one implementation
 * of the carry.
 */
export function nextRevisionLabel(scheme: RevisionScheme, current: string): string {
  if (scheme === "NUMERIC") {
    const n = Number(/^v?(\d+)$/.exec(current)?.[1]);
    if (!Number.isInteger(n)) throw new RangeError(`„${current}“ ist keine Versionsnummer.`);
    return revisionLabel("NUMERIC", n + 1);
  }
  return alphaLabel(alphaValue(current) + 1);
}

/**
 * Letters that are skipped in drawing revisions, and why.
 *
 * `I` and `O` are omitted by ISO 7200 and by every drawing office that has ever
 * had a fax machine: `I` is a one and `O` is a nought at the resolution a title
 * block is usually read at. `Q` follows in some practices; it is **not** skipped
 * here, because the firm's own drawings use it and inventing a stricter rule
 * than the client's would renumber their existing set.
 *
 * Nothing in this module applies the exclusion yet — Drawings are Wave 2. It is
 * written down now because the decision belongs with the numbering, and because
 * the day it is needed the question will be "what did we decide" rather than
 * "what should we decide".
 */
export const AMBIGUOUS_REVISION_LETTERS = ["I", "O"] as const;
