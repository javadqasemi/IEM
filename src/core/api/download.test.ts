import { describe, expect, it } from "vitest";
import { filenameFrom } from "./download";

/**
 * Parsing the filename out of `Content-Disposition`.
 *
 * Part of the fix for the two download links that returned 401. Worth its own
 * test because the filename comes from an **applicant's own file**, which is the
 * one string in this client shaped by someone outside the organisation: Swiss
 * names bring umlauts, CVs bring spaces, and the server percent-encodes the
 * whole thing. Getting it wrong is not a crash — it is a dossier saved under a
 * name nobody can match to a person.
 */
describe("filenameFrom", () => {
  it("reads a quoted filename", () => {
    expect(filenameFrom('attachment; filename="lebenslauf.pdf"')).toBe("lebenslauf.pdf");
  });

  it("reads an unquoted filename", () => {
    expect(filenameFrom("attachment; filename=lebenslauf.pdf")).toBe("lebenslauf.pdf");
  });

  it("decodes percent-encoded spaces", () => {
    // What `ApplicationsController` actually sends: it runs the original name
    // through `encodeURIComponent`.
    expect(filenameFrom('attachment; filename="Lebenslauf%20M%20Meier.pdf"')).toBe(
      "Lebenslauf M Meier.pdf",
    );
  });

  it("decodes umlauts", () => {
    expect(filenameFrom('attachment; filename="Zeugnis%20M%C3%BCller.pdf"')).toBe(
      "Zeugnis Müller.pdf",
    );
  });

  it("prefers the RFC 5987 form when both are present", () => {
    // Some servers send an ASCII fallback plus `filename*`. The starred one is
    // the accurate one and has to win.
    expect(
      filenameFrom("attachment; filename=\"Zeugnis.pdf\"; filename*=UTF-8''Zeugnis%20M%C3%BCller.pdf"),
    ).toBe("Zeugnis Müller.pdf");
  });

  it("returns null when there is no header", () => {
    // The caller falls back to its own name, which is why null rather than "".
    expect(filenameFrom(null)).toBeNull();
  });

  it("returns null when the header carries no filename", () => {
    expect(filenameFrom("attachment")).toBeNull();
  });

  it("survives a malformed percent escape rather than throwing", () => {
    // `decodeURIComponent("%zz")` throws. A download must not fail because a
    // filename was odd — the raw value is still better than nothing.
    expect(filenameFrom('attachment; filename="broken%zz.pdf"')).toBe("broken%zz.pdf");
  });

  it("trims surrounding whitespace", () => {
    expect(filenameFrom('attachment; filename=" spaced.pdf "')).toBe("spaced.pdf");
  });
});
