import { describe, expect, it } from "vitest";
import { Secret, TOTP } from "otpauth";
import {
  CHALLENGE_MAX_ATTEMPTS,
  ENROLMENT_TTL_MS,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  TOTP_DIGITS,
  TOTP_DRIFT_STEPS,
  TOTP_PERIOD_SECONDS,
  afterFailedChallenge,
  attemptsRemaining,
  currentStep,
  formatRecoveryCode,
  formatSecretForEntry,
  generateRecoveryCode,
  generateRecoveryCodes,
  generateSecret,
  isRecentAuth,
  judgeChallenge,
  judgeEnrolment,
  judgeTotp,
  normaliseRecoveryCode,
  normaliseTotpCode,
  otpauthUri,
} from "./mfa.rules";
import { qrMatrix } from "./mfa.qr";

/**
 * The second factor's arithmetic, exhaustively.
 *
 * Every decision here is a function of a few values and a clock, which is the
 * whole reason `mfa.rules.ts` exists as a separate file — the boundaries are
 * where the bugs are, and none of them is observable from a screen. Three in
 * particular are asserted at the boundary rather than in the middle:
 *
 * - the drift window, at exactly ±1 and ±2 steps;
 * - the replay guard, at the code's *own* step (the `<` / `<=` mistake);
 * - the challenge ceiling, at the attempt that reaches it (the off-by-one
 *   `afterFailedLogin` in `auth.rules.ts` was written to make visible).
 */

/** A fixed secret and clock, so a failure is reproducible rather than timely. */
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const NOW = new Date("2026-09-20T12:00:00.000Z");

/** The code an authenticator would show `stepsFromNow` steps away from `at`. */
function codeAt(at: Date, stepsFromNow = 0, secret = SECRET): string {
  return TOTP.generate({
    secret: Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    timestamp: at.getTime() + stepsFromNow * TOTP_PERIOD_SECONDS * 1000,
  });
}

/* ================================================================== */
/* Time steps                                                          */
/* ================================================================== */

describe("currentStep", () => {
  it("is the RFC 6238 counter", () => {
    // 1789905600 / 30. Pinned to a literal rather than recomputed, so a
    // change to the period fails here instead of silently invalidating every
    // stored `lastUsedStep` in the database.
    expect(NOW.getTime() / 1000).toBe(1789905600);
    expect(currentStep(NOW)).toBe(59663520);
  });

  it("advances once per period and not before", () => {
    const step = currentStep(NOW);
    expect(currentStep(new Date(NOW.getTime() + 29_999))).toBe(step);
    expect(currentStep(new Date(NOW.getTime() + 30_000))).toBe(step + 1);
  });
});

/* ================================================================== */
/* Verifying a code                                                    */
/* ================================================================== */

describe("normaliseTotpCode", () => {
  it("accepts six digits", () => {
    expect(normaliseTotpCode("123456")).toBe("123456");
  });

  it("accepts the spacing every authenticator app displays", () => {
    // `123 456` is what the app shows, and it is what a paste carries.
    expect(normaliseTotpCode("123 456")).toBe("123456");
    expect(normaliseTotpCode(" 123456 ")).toBe("123456");
    expect(normaliseTotpCode("123-456")).toBe("123456");
  });

  it("refuses anything that is not exactly six digits", () => {
    expect(normaliseTotpCode("12345")).toBeNull();
    expect(normaliseTotpCode("1234567")).toBeNull();
    expect(normaliseTotpCode("12345a")).toBeNull();
    expect(normaliseTotpCode("")).toBeNull();
    expect(normaliseTotpCode("x".repeat(1024))).toBeNull();
  });
});

describe("judgeTotp", () => {
  it("accepts the current code and reports the step it was for", () => {
    const verdict = judgeTotp({ secret: SECRET, code: codeAt(NOW), now: NOW, lastUsedStep: null });
    expect(verdict).toEqual({ kind: "accepted", step: currentStep(NOW) });
  });

  it("accepts the spacing the app shows", () => {
    const spaced = `${codeAt(NOW).slice(0, 3)} ${codeAt(NOW).slice(3)}`;
    expect(judgeTotp({ secret: SECRET, code: spaced, now: NOW, lastUsedStep: null }).kind).toBe(
      "accepted",
    );
  });

  it("refuses a wrong code", () => {
    // Derived from the real one so the test cannot accidentally use a code
    // that happens to be valid in a neighbouring step.
    const wrong = codeAt(NOW) === "000000" ? "111111" : "000000";
    expect(judgeTotp({ secret: SECRET, code: wrong, now: NOW, lastUsedStep: null })).toEqual({
      kind: "invalid",
    });
  });

  it("refuses a code from a different secret", () => {
    const other = new Secret({ size: 20 }).base32;
    expect(
      judgeTotp({ secret: SECRET, code: codeAt(NOW, 0, other), now: NOW, lastUsedStep: null }).kind,
    ).toBe("invalid");
  });

  /*
    The drift window, at its edges.

    `TOTP_DRIFT_STEPS` is one, so the previous and the next step are accepted
    and the one beyond each is not. Asserted as a loop over the boundary
    rather than as two happy cases, because a library default of three — which
    several implementations ship — would pass a test that only checked ±1.
  */
  it.each([-TOTP_DRIFT_STEPS, 0, TOTP_DRIFT_STEPS])("accepts a code %i step(s) away", (offset) => {
    const verdict = judgeTotp({
      secret: SECRET,
      code: codeAt(NOW, offset),
      now: NOW,
      lastUsedStep: null,
    });
    expect(verdict).toEqual({ kind: "accepted", step: currentStep(NOW) + offset });
  });

  it.each([-(TOTP_DRIFT_STEPS + 1), TOTP_DRIFT_STEPS + 1, -10, 10])(
    "refuses a code %i step(s) away",
    (offset) => {
      expect(
        judgeTotp({ secret: SECRET, code: codeAt(NOW, offset), now: NOW, lastUsedStep: null }).kind,
      ).toBe("invalid");
    },
  );

  describe("the replay guard", () => {
    it("refuses the code that was just accepted", () => {
      /*
        The `<` / `<=` boundary, and the reason the guard exists at all.

        A code is valid for its whole step, so without this the same six
        digits work repeatedly for up to ninety seconds. Comparing with `<`
        would leave the code's *own* step re-usable, which is the entire
        window being closed.
      */
      const step = currentStep(NOW);
      expect(
        judgeTotp({ secret: SECRET, code: codeAt(NOW), now: NOW, lastUsedStep: step }),
      ).toEqual({ kind: "replayed" });
    });

    it("refuses an older code even though it is inside the window", () => {
      const step = currentStep(NOW);
      expect(
        judgeTotp({ secret: SECRET, code: codeAt(NOW, -1), now: NOW, lastUsedStep: step }),
      ).toEqual({ kind: "replayed" });
    });

    it("accepts the next step's code once it arrives", () => {
      const step = currentStep(NOW);
      expect(
        judgeTotp({ secret: SECRET, code: codeAt(NOW, 1), now: NOW, lastUsedStep: step }),
      ).toEqual({ kind: "accepted", step: step + 1 });
    });

    it("tells a replay apart from a wrong code", () => {
      // Both are refused and the user sees the same message; only the audit
      // log distinguishes them, which is the point of the separate verdict.
      const step = currentStep(NOW);
      expect(judgeTotp({ secret: SECRET, code: codeAt(NOW), now: NOW, lastUsedStep: step }).kind)
        .toBe("replayed");
      expect(judgeTotp({ secret: SECRET, code: "000000", now: NOW, lastUsedStep: step }).kind)
        .not.toBe("replayed");
    });

    it("does not apply to a credential that has never been used", () => {
      expect(
        judgeTotp({ secret: SECRET, code: codeAt(NOW), now: NOW, lastUsedStep: null }).kind,
      ).toBe("accepted");
    });
  });

  it("refuses rather than throwing when the stored secret is unreadable", () => {
    // A truncated column, or a ciphertext decrypted under the wrong key. It is
    // a server-side fault, and the answer to the caller is still "not right" —
    // anything else says which accounts have a broken credential.
    for (const secret of ["", "not base32!", "12345"]) {
      expect(judgeTotp({ secret, code: "123456", now: NOW, lastUsedStep: null })).toEqual({
        kind: "invalid",
      });
    }
  });
});

/* ================================================================== */
/* Recovery codes                                                      */
/* ================================================================== */

/** A byte source that is deterministic and covers the whole alphabet. */
function counterBytes(start = 0): (n: number) => Uint8Array {
  let next = start;
  return (n) => Uint8Array.from({ length: n }, () => next++ & 0xff);
}

describe("generateRecoveryCode", () => {
  it("is ten symbols of the recovery alphabet", () => {
    const code = generateRecoveryCode(counterBytes());
    expect(code).toHaveLength(RECOVERY_CODE_LENGTH);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it("contains none of the four folded glyphs", () => {
    // I, L, O and U are absent by construction: the first three because they
    // are misread, the fourth because a printed sheet of random strings
    // should not produce a word somebody has to explain.
    for (let i = 0; i < 64; i += 1) {
      expect(generateRecoveryCode(counterBytes(i * 7))).not.toMatch(/[ILOU]/);
    }
  });

  it("draws every symbol uniformly from five bits of each byte", () => {
    /*
      The reason the alphabet is thirty-two and not thirty.

      256 is a whole multiple of 32, so masking is unbiased. A 30-symbol
      alphabet with `% 30` would make the first sixteen symbols 1/8 more
      likely than the rest — a shrinkage nobody would ever see in review.
    */
    const seen = new Set<string>();
    for (let i = 0; i < 256; i += 1) seen.add(generateRecoveryCode(counterBytes(i))[0]);
    expect(seen.size).toBe(32);
  });
});

describe("generateRecoveryCodes", () => {
  it("produces a full set", () => {
    expect(generateRecoveryCodes(counterBytes())).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it("never repeats a code inside one set", () => {
    /*
      A duplicate would be a *silent* short set: the second insert hits the
      unique index on the hash, and the person ends up with nine codes while
      the screen shows ten.

      Forced here with a byte source that repeats, which is what makes the
      assertion mean anything — a CSPRNG would pass it by luck.
    */
    let calls = 0;
    const repeating = (n: number) => {
      // The same ten bytes for the first two draws, then distinct.
      const base = calls++ < 2 ? 0 : calls * 31;
      return Uint8Array.from({ length: n }, (_, i) => (base + i) & 0xff);
    };
    const codes = generateRecoveryCodes(repeating);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("normaliseRecoveryCode", () => {
  const CODE = "AB12CD34EF";

  it("accepts the code exactly as generated", () => {
    expect(normaliseRecoveryCode(CODE)).toBe(CODE);
  });

  it("accepts it as displayed, typed and pasted", () => {
    expect(normaliseRecoveryCode(formatRecoveryCode(CODE))).toBe(CODE);
    expect(normaliseRecoveryCode("ab12c-d34ef")).toBe(CODE);
    expect(normaliseRecoveryCode("AB12C D34EF")).toBe(CODE);
    expect(normaliseRecoveryCode("  AB12CD34EF  ")).toBe(CODE);
  });

  it("folds the glyphs that are misread off a printed sheet", () => {
    // The whole reason for Crockford's alphabet: an `O` can only ever have
    // meant `0`, so a correctly copied code is repaired rather than refused.
    expect(normaliseRecoveryCode("OIL0123456")).toBe("0110123456");
    expect(normaliseRecoveryCode("UUUU123456")).toBe("VVVV123456");
  });

  it("refuses anything of the wrong length", () => {
    expect(normaliseRecoveryCode("AB12CD34E")).toBeNull();
    expect(normaliseRecoveryCode("AB12CD34EFG")).toBeNull();
    expect(normaliseRecoveryCode("")).toBeNull();
  });

  it("refuses a symbol that could not have been generated", () => {
    // Everything survives the strip in a locale-dependent way; an explicit
    // alphabet check is what stops a garbage string reaching the database.
    expect(normaliseRecoveryCode("ÄB12CD34EF")).toBeNull();
  });

  it("round-trips every generated code through its displayed form", () => {
    for (let i = 0; i < 128; i += 1) {
      const code = generateRecoveryCode(counterBytes(i * 3));
      expect(normaliseRecoveryCode(formatRecoveryCode(code).toLowerCase())).toBe(code);
    }
  });
});

describe("formatRecoveryCode", () => {
  it("groups in fives", () => {
    expect(formatRecoveryCode("AB12CD34EF")).toBe("AB12C-D34EF");
  });
});

/* ================================================================== */
/* The half-finished sign-in                                           */
/* ================================================================== */

const challenge = (over: Partial<Parameters<typeof judgeChallenge>[0]> = {}) => ({
  expiresAt: new Date(NOW.getTime() + 60_000),
  consumedAt: null,
  attempts: 0,
  ...over,
});

describe("judgeChallenge", () => {
  it("is usable while it is open", () => {
    expect(judgeChallenge(challenge(), NOW)).toBe("usable");
  });

  it("expires at its own instant, not after it", () => {
    expect(judgeChallenge(challenge({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBe("usable");
    expect(judgeChallenge(challenge({ expiresAt: NOW }), NOW)).toBe("expired");
  });

  it("is consumed once it has been spent", () => {
    expect(judgeChallenge(challenge({ consumedAt: NOW }), NOW)).toBe("consumed");
  });

  it("reports a spent-and-then-expired challenge as consumed", () => {
    /*
      Order is the argument, the same as in `judgeRefresh`. A challenge that
      was used and has since passed its expiry is still a replay when somebody
      presents it, and calling it merely expired hides the only interesting
      case in the log.
    */
    expect(
      judgeChallenge(
        challenge({ consumedAt: new Date(NOW.getTime() - 120_000), expiresAt: new Date(NOW.getTime() - 60_000) }),
        NOW,
      ),
    ).toBe("consumed");
  });

  it("is exhausted at the ceiling even if nothing marked it", () => {
    expect(judgeChallenge(challenge({ attempts: CHALLENGE_MAX_ATTEMPTS }), NOW)).toBe("exhausted");
    expect(judgeChallenge(challenge({ attempts: CHALLENGE_MAX_ATTEMPTS - 1 }), NOW)).toBe("usable");
  });
});

describe("afterFailedChallenge", () => {
  it("counts the attempt", () => {
    expect(afterFailedChallenge(challenge(), NOW)).toEqual({ attempts: 1, consumedAt: null });
  });

  it("consumes the challenge on the attempt that reaches the ceiling", () => {
    // The off-by-one: leaving it open for one more request turns a ceiling of
    // five into a ceiling of six.
    const last = afterFailedChallenge(challenge({ attempts: CHALLENGE_MAX_ATTEMPTS - 1 }), NOW);
    expect(last).toEqual({ attempts: CHALLENGE_MAX_ATTEMPTS, consumedAt: NOW });
  });

  it("walks a fresh challenge to exactly five attempts", () => {
    let state = challenge();
    for (let i = 1; i <= CHALLENGE_MAX_ATTEMPTS; i += 1) {
      const next = afterFailedChallenge(state, NOW);
      state = { ...state, ...next };
      expect(state.attempts).toBe(i);
      expect(judgeChallenge(state, NOW)).toBe(i < CHALLENGE_MAX_ATTEMPTS ? "usable" : "consumed");
    }
  });
});

describe("attemptsRemaining", () => {
  it("counts down and stops at zero", () => {
    expect(attemptsRemaining(challenge({ attempts: 0 }))).toBe(CHALLENGE_MAX_ATTEMPTS);
    expect(attemptsRemaining(challenge({ attempts: CHALLENGE_MAX_ATTEMPTS }))).toBe(0);
    expect(attemptsRemaining(challenge({ attempts: 99 }))).toBe(0);
  });
});

/* ================================================================== */
/* Enrolment                                                           */
/* ================================================================== */

describe("judgeEnrolment", () => {
  it("has nothing to verify when nothing was started", () => {
    expect(judgeEnrolment(null, NOW)).toBe("missing");
  });

  it("is verifiable while the pending credential is fresh", () => {
    expect(
      judgeEnrolment({ status: "PENDING", expiresAt: new Date(NOW.getTime() + ENROLMENT_TTL_MS) }, NOW),
    ).toBe("verifiable");
  });

  it("expires at its own instant", () => {
    expect(judgeEnrolment({ status: "PENDING", expiresAt: NOW }, NOW)).toBe("expired");
    expect(
      judgeEnrolment({ status: "PENDING", expiresAt: new Date(NOW.getTime() + 1) }, NOW),
    ).toBe("verifiable");
  });

  it("treats a pending credential with no expiry as expired", () => {
    // `MfaService` cannot produce one. Treating it as immortal would be the
    // wrong direction to be wrong in.
    expect(judgeEnrolment({ status: "PENDING", expiresAt: null }, NOW)).toBe("expired");
  });

  it("refuses to re-verify an active factor", () => {
    expect(judgeEnrolment({ status: "VERIFIED", expiresAt: null }, NOW)).toBe("active");
  });
});

/* ================================================================== */
/* Recent authentication                                               */
/* ================================================================== */

describe("isRecentAuth", () => {
  it("is false with no window at all", () => {
    expect(isRecentAuth(null, NOW)).toBe(false);
  });

  it("is open until its instant and not at it", () => {
    expect(isRecentAuth({ expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(true);
    expect(isRecentAuth({ expiresAt: NOW }, NOW)).toBe(false);
    expect(isRecentAuth({ expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(false);
  });
});

/* ================================================================== */
/* The authenticator's view                                            */
/* ================================================================== */

describe("generateSecret", () => {
  it("is 160 bits of base32, which is what RFC 4226 §4 asks for", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(Secret.fromBase32(secret).bytes).toHaveLength(20);
  });

  it("is different every time", () => {
    expect(new Set([generateSecret(), generateSecret(), generateSecret()]).size).toBe(3);
  });
});

describe("otpauthUri", () => {
  it("carries the parameters an authenticator needs", () => {
    const uri = otpauthUri({ secret: SECRET, account: "anna@iem.ch", issuer: "IEM" });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${SECRET}`);
    expect(uri).toContain("issuer=IEM");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("encodes an issuer with a space in it", () => {
    // Built through `otpauth`'s serialiser rather than concatenated, because
    // this is the case that produces a URI some apps silently truncate.
    const uri = otpauthUri({ secret: SECRET, account: "anna@iem.ch", issuer: "IEM AG" });
    expect(uri).not.toMatch(/issuer=IEM AG/);
    expect(uri).toContain("issuer=IEM%20AG");
  });

  it("round-trips: the URI produces the same codes as the secret", () => {
    // The end-to-end property that matters — what the phone scans has to be
    // what the server checks against.
    const uri = otpauthUri({ secret: SECRET, account: "anna@iem.ch", issuer: "IEM" });
    const parsed = new URL(uri.replace("otpauth://", "https://"));
    expect(
      judgeTotp({
        secret: parsed.searchParams.get("secret")!,
        code: codeAt(NOW),
        now: NOW,
        lastUsedStep: null,
      }).kind,
    ).toBe("accepted");
  });
});

describe("formatSecretForEntry", () => {
  it("groups in fours, for reading off a screen", () => {
    expect(formatSecretForEntry("ABCDEFGH")).toBe("ABCD EFGH");
    expect(formatSecretForEntry(SECRET).replace(/ /g, "")).toBe(SECRET);
  });
});

/* ================================================================== */
/* The QR code                                                         */
/* ================================================================== */

describe("qrMatrix", () => {
  const uri = otpauthUri({ secret: SECRET, account: "anna@iem.ch", issuer: "IEM AG" });

  it("is square and large enough to hold an otpauth URI", () => {
    const { size } = qrMatrix(uri);
    // Version 1 is 21 and cannot hold ~100 characters at error correction M;
    // anything past version 10 (57) would mean the URI has grown unexpectedly.
    expect(size).toBeGreaterThanOrEqual(25);
    expect(size).toBeLessThanOrEqual(57);
    expect((size - 21) % 4).toBe(0);
  });

  it("emits one path command per dark module", () => {
    const { size, path } = qrMatrix(uri);
    const commands = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.length).toBeLessThan(size * size);
    // Nothing outside the matrix: a coordinate at or past `size` would draw
    // off the `viewBox` the client sets from it.
    for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h/g)) {
      expect(Number(x)).toBeLessThan(size);
      expect(Number(y)).toBeLessThan(size);
    }
  });

  it("puts a finder pattern in the top-left corner", () => {
    // The three 7×7 finders are what a scanner locates first, so their
    // presence is the cheapest evidence that the matrix is a real QR symbol
    // rather than an array of the right shape.
    const { path } = qrMatrix(uri);
    for (let i = 0; i < 7; i += 1) {
      expect(path).toContain(`M${i} 0h1v1h-1z`);
      expect(path).toContain(`M0 ${i}h1v1h-1z`);
    }
    // The ring is hollow: (1,1) is light.
    expect(path).not.toContain("M1 1h1v1h-1z");
  });

  it("is deterministic for one input", () => {
    expect(qrMatrix(uri)).toEqual(qrMatrix(uri));
  });
});
