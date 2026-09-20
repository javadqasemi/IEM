import { describe, expect, it } from "vitest";
import {
  recoveryCodesAsText,
  toEnrolment,
  toMfaStatus,
  toRecoveryCodes,
} from "../mapper";
import type { EnrolmentStartDto, MfaStatusDto } from "../dto";

/**
 * The wire boundary.
 *
 * Thin, like the sessions mapper, and for the same reason — the server has
 * already decided everything that needs a row this side cannot see. What is
 * worth asserting is therefore narrow and specific: that the dates become
 * dates, that `low` is **not** recomputed here, and that the downloaded file
 * is something somebody can still identify in two years.
 */

const STATUS: MfaStatusDto = {
  available: true,
  enabled: true,
  method: "TOTP",
  verifiedAt: "2026-09-01T08:30:00.000Z",
  lastUsedAt: "2026-09-20T06:15:00.000Z",
  pending: false,
  pendingExpiresAt: null,
  recoveryCodes: { total: 10, remaining: 8, low: false },
};

describe("toMfaStatus", () => {
  it("turns the timestamps into dates", () => {
    const status = toMfaStatus(STATUS);
    expect(status.verifiedAt).toBeInstanceOf(Date);
    expect(status.verifiedAt?.toISOString()).toBe(STATUS.verifiedAt);
    expect(status.lastUsedAt?.toISOString()).toBe(STATUS.lastUsedAt);
  });

  it("keeps a null timestamp null rather than making it the epoch", () => {
    // `new Date(null)` is 1970-01-01, which renders as a real date and reads
    // as "used on the first of January 1970" rather than as "never".
    const status = toMfaStatus({ ...STATUS, verifiedAt: null, lastUsedAt: null });
    expect(status.verifiedAt).toBeNull();
    expect(status.lastUsedAt).toBeNull();
  });

  it("takes `low` from the server rather than deciding it here", () => {
    /*
      The threshold lives beside the code generator in `mfa.rules.ts`, so
      changing it changes one number. A client that recomputed `remaining <= 3`
      would be a second copy of the rule, and the one that gets missed.
    */
    const status = toMfaStatus({
      ...STATUS,
      recoveryCodes: { total: 10, remaining: 9, low: true },
    });
    expect(status.recoveryCodes.low).toBe(true);
  });

  it("carries `available` separately from `enabled`", () => {
    // Three states, not two: "off for you" and "never set up on this server"
    // look identical as one grey dot, and the first gets waited on for ever.
    const unconfigured = toMfaStatus({ ...STATUS, available: false, enabled: false });
    expect(unconfigured.available).toBe(false);
    expect(unconfigured.enabled).toBe(false);
  });

  it("copies the recovery-code counts rather than aliasing the DTO", () => {
    const dto = { ...STATUS };
    const status = toMfaStatus(dto);
    status.recoveryCodes.remaining = 0;
    expect(dto.recoveryCodes.remaining).toBe(8);
  });
});

describe("toEnrolment", () => {
  const dto: EnrolmentStartDto = {
    secret: "JBSWY3DPEHPK3PXP",
    secretGrouped: "JBSW Y3DP EHPK 3PXP",
    otpauthUri: "otpauth://totp/IEM:anna%40iem.ch?secret=JBSWY3DPEHPK3PXP&issuer=IEM",
    qr: { size: 29, path: "M0 0h1v1h-1z" },
    expiresAt: "2026-09-20T12:10:00.000Z",
  };

  it("keeps both forms of the secret", () => {
    // The grouped one is read off a screen; the unspaced one is what the
    // copy button puts on the clipboard, because an authenticator app that
    // is pasted a spaced key rejects it.
    const enrolment = toEnrolment(dto);
    expect(enrolment.secretGrouped).toBe("JBSW Y3DP EHPK 3PXP");
    expect(enrolment.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(enrolment.secretGrouped.replace(/ /g, "")).toBe(enrolment.secret);
  });

  it("keeps the QR geometry intact", () => {
    expect(toEnrolment(dto).qr).toEqual({ size: 29, path: "M0 0h1v1h-1z" });
  });

  it("turns the deadline into a date", () => {
    expect(toEnrolment(dto).expiresAt.toISOString()).toBe(dto.expiresAt);
  });
});

describe("toRecoveryCodes", () => {
  it("copies the list rather than aliasing it", () => {
    const dto = { codes: ["AB12C-D34EF"], generatedAt: "2026-09-20T12:00:00.000Z" };
    const set = toRecoveryCodes(dto);
    set.codes.push("XXXXX-XXXXX");
    expect(dto.codes).toHaveLength(1);
  });
});

describe("recoveryCodesAsText", () => {
  const codes = ["AB12C-D34EF", "GH56J-K78MN"];
  const text = recoveryCodesAsText(codes, "anna@iem.ch", new Date("2026-09-20T12:00:00.000Z"));

  it("names the account, so the file identifies itself in two years", () => {
    // The failure this prevents is finding `codes.txt` in a folder with ten
    // strings in it and no idea which system or which login they open.
    expect(text).toContain("anna@iem.ch");
    expect(text).toContain("IEM Dashboard");
  });

  it("contains every code, one per line", () => {
    for (const code of codes) expect(text).toContain(code);
  });

  it("uses CRLF, so it opens readably in Notepad", () => {
    // A single `\n` renders as one unbroken line on the Windows machines
    // this firm uses, which makes the file useless at the moment it matters.
    expect(text).toContain("\r\n");
    expect(text.split("\r\n").filter((l) => l === "AB12C-D34EF")).toHaveLength(1);
  });

  it("says the codes are single-use and where not to keep them", () => {
    expect(text).toMatch(/genau einmal/);
    expect(text).toMatch(/Passwort-\r\nmanager/);
  });
});
