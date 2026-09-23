import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { FAILURE_MESSAGES, attempt, toFailure } from "./failure";

/**
 * The one place a write's failure is classified (UX-02).
 *
 * Every screen reads `kind` and `message` from here, so the two things these
 * tests pin are the two a screen relies on: that a conflict is never
 * mistaken for anything else, and that no framework English reaches a reader.
 */

const api = (statusCode: number, message: string, extra: Partial<{ code: string; fields: Record<string, string[]> }> = {}) =>
  new ApiError({ statusCode, message, code: extra.code ?? "", fields: extra.fields });

describe("toFailure — the six answers", () => {
  it("a 409 is a conflict, with the server's sentence", () => {
    const f = toFailure(api(409, "Das Projekt wurde inzwischen geändert (Version 8)."));
    expect(f.kind).toBe("conflict");
    expect(f.message).toBe("Das Projekt wurde inzwischen geändert (Version 8).");
  });

  it("a 403 is a permission refusal and keeps its code", () => {
    const f = toFailure(api(403, "Nur wer alles davon hat, darf es vergeben.", { code: "privilege_ceiling" }));
    expect(f.kind).toBe("permission");
    expect(f.code).toBe("privilege_ceiling");
  });

  it("a 404 is notFound", () => {
    expect(toFailure(api(404, "Projekt nicht gefunden.")).kind).toBe("notFound");
  });

  it("a 400 with field messages is validation, fields intact", () => {
    const f = toFailure(api(400, "Bitte prüfen.", { code: "validation_failed", fields: { name: ["Pflichtfeld"] } }));
    expect(f.kind).toBe("validation");
    expect(f.fields).toEqual({ name: ["Pflichtfeld"] });
  });

  it("any other 4xx is a domain rejection with the rule's sentence", () => {
    const f = toFailure(api(400, "Ein genehmigtes Protokoll ist abgeschlossen."));
    expect(f.kind).toBe("rejected");
    expect(f.message).toBe("Ein genehmigtes Protokoll ist abgeschlossen.");
  });

  it("a 5xx is unavailable, and the framework's text is dropped", () => {
    const f = toFailure(api(500, "Internal server error"));
    expect(f.kind).toBe("unavailable");
    expect(f.message).toBe(FAILURE_MESSAGES.server);
    expect(f.fields).toEqual({});
  });

  it("a 5xx never passes its body through, even one that looks like a sentence", () => {
    // A 5xx body is whatever the framework or a proxy produced; the rule is
    // the status, not whether the text happens to read well.
    const f = toFailure(api(502, "Verbindung zum Upstream verloren: ECONNRESET 10.0.0.4:3100"));
    expect(f.message).toBe(FAILURE_MESSAGES.server);
  });

  it("a 429 is unavailable with its own sentence", () => {
    expect(toFailure(api(429, "ThrottlerException: Too Many Requests")).message).toBe(
      FAILURE_MESSAGES.throttled,
    );
  });

  it("a request that never arrived says the input is still there", () => {
    const f = toFailure(new TypeError("Failed to fetch"));
    expect(f.kind).toBe("unavailable");
    expect(f.status).toBe(0);
    expect(f.message).toBe(FAILURE_MESSAGES.offline);
    expect(f.message).toMatch(/Eingaben sind noch da/);
  });
});

describe("toFailure — nothing English reaches a reader", () => {
  it.each(["Forbidden", "Not Found", "Conflict", "Bad Request", "Die Anfrage ist fehlgeschlagen (418)."])(
    "replaces %s with a German sentence",
    (text) => {
      const status = text === "Forbidden" ? 403 : text === "Not Found" ? 404 : text === "Conflict" ? 409 : 400;
      const f = toFailure(api(status, text));
      expect(f.message).not.toBe(text);
      expect(f.message).toMatch(/[äöüÄÖÜ]|nicht|Bitte|Eintrag|Berechtigung/);
    },
  );

  it("keeps a sentence our own code wrote", () => {
    expect(toFailure(new Error("Die Plannummer ist schon vergeben.")).message).toBe(
      "Die Plannummer ist schon vergeben.",
    );
  });

  it("survives something that is not an Error at all", () => {
    expect(toFailure("kaputt")).toMatchObject({ kind: "rejected", message: FAILURE_MESSAGES.unknown });
  });
});

describe("attempt — a result, never a throw", () => {
  it("wraps success", async () => {
    await expect(attempt(async () => 42)).resolves.toEqual({ ok: true, data: 42 });
  });

  it("wraps failure, classified", async () => {
    const result = await attempt(async () => {
      throw api(409, "Veraltet.");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("conflict");
  });
});
