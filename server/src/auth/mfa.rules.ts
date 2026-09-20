/**
 * Every second-factor decision that is arithmetic rather than I/O.
 *
 * The same split `auth.rules.ts` makes, and for the same reason: what a code,
 * a challenge or a recovery code *means* is a function of a few columns and a
 * clock, so it can be covered exhaustively — and the cases that matter here
 * are the ones that are invisible unless the decision is written down on its
 * own. A drift window that is one step too wide, a replay that is accepted
 * because the step was compared with `<` instead of `<=`, a challenge that
 * runs out of attempts and stays usable: none of those fails loudly, and all
 * three are branches below.
 *
 * No Prisma, no request, no `Date.now()` — every function takes its clock.
 *
 * ---
 *
 * ## Why TOTP, and why these parameters
 *
 * RFC 6238 with the defaults every authenticator implements: **SHA-1, six
 * digits, a thirty-second period.** They are not the strongest available
 * numbers and that is deliberate — the threat a second factor answers is a
 * stolen password, not a cryptanalysis of HMAC-SHA1 over a 160-bit secret,
 * and a `SHA256`/8-digit configuration is silently unsupported by several of
 * the apps the firm actually uses. An authenticator that shows the wrong code
 * is indistinguishable from a broken enrolment, and the user blames the
 * system.
 *
 * `otpauth` does the HMAC. It was already a dependency of this package,
 * declared and unused, which is what a planned feature looks like from the
 * outside; this is the release that spends it.
 */

import { Secret, TOTP, URI } from "otpauth";

/* ================================================================== */
/* 1. Invariants — compile time, never configurable                    */
/* ================================================================== */
/*
  `security.policy.ts` sorts security numbers into four kinds and this block
  is the first: properties the correctness of the factor rests on. Every one
  of them is an interoperability constraint, a detection tolerance, or a
  brute-force bound, and none of the three is a preference a form should be
  able to express.
*/

/** RFC 6238 defaults. Changing any of the three breaks existing enrolments. */
export const TOTP_ALGORITHM = "SHA1";
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/**
 * How far the phone's clock may be out: **one step either way**, so a code is
 * accepted for at most ninety seconds around its own.
 *
 * The number is chosen against the two things it has to survive rather than
 * picked round. A phone that has not synchronised for a week drifts by a few
 * seconds, not a minute; the real slack is the human one — reading six digits
 * and typing them takes ten to twenty seconds, and a code read at second 28 of
 * its window arrives in the next one. One step covers both.
 *
 * It is not widened past that, and the reason is that the window is the
 * attacker's too: every extra step multiplies the codes a guess can match and
 * extends how long a code observed over somebody's shoulder stays worth
 * having. Three steps — which several implementations default to — means a
 * code is live for two and a half minutes.
 */
export const TOTP_DRIFT_STEPS = 1;

/**
 * How long a started enrolment stays finishable.
 *
 * Ten minutes is long enough to install an authenticator app from scratch and
 * short enough that a secret shown on a screen somebody walked away from is
 * not still valid after lunch. A `PENDING` credential protects nothing, so the
 * cost of expiry is one more button press.
 */
export const ENROLMENT_TTL_MS = 10 * 60_000;

/**
 * How long a half-finished sign-in stays open.
 *
 * Five minutes: the password has already been accepted, so this is the window
 * in which a leaked challenge token is worth stealing. It has to be long
 * enough to fetch a phone from a coat pocket.
 */
export const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Wrong codes before the half-finished sign-in is thrown away.
 *
 * Five, matching the account lockout threshold's default, and it is the
 * *per-challenge* bound rather than the per-account one — the throttle on the
 * route bounds the attacker across challenges, this bounds them within one.
 * Without it a single challenge is a five-minute window in which a script can
 * try as many codes as the rate limit allows against a *known* account.
 *
 * The person is not locked out by it: they go back to the password form and
 * get a new challenge. That is the correct asymmetry — a wrong TOTP code is
 * overwhelmingly a mistyped one, and answering it with a fifteen-minute
 * account lockout would make the second factor the thing that costs people
 * their morning.
 */
export const CHALLENGE_MAX_ATTEMPTS = 5;

/**
 * How long re-authentication counts as recent.
 *
 * Five minutes. Long enough to regenerate recovery codes and then turn the
 * factor off without being asked twice; short enough that a laptop left
 * unlocked at a desk is not a standing capability to disable somebody's
 * second factor.
 */
export const REAUTH_TTL_MS = 5 * 60_000;

/** How many recovery codes a set contains. */
export const RECOVERY_CODE_COUNT = 10;

/** Symbols per recovery code, before the separator. */
export const RECOVERY_CODE_LENGTH = 10;

/**
 * At or below this many unused codes, the screen says so without being asked.
 *
 * Three, because the failure it prevents is the quiet one: somebody who has
 * used seven of ten codes is one lost phone away from being locked out of the
 * system entirely, and nothing in the ordinary flow would ever mention it.
 */
export const RECOVERY_CODES_LOW_WATER = 3;

/* ================================================================== */
/* Time steps                                                          */
/* ================================================================== */

/**
 * The RFC 6238 counter — how many periods have elapsed since the epoch.
 *
 * Exposed rather than left inside the verifier because it is what
 * `lastUsedStep` stores, and a replay guard whose two halves compute the step
 * differently is a replay guard that does not work.
 */
export function currentStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/* ================================================================== */
/* Verifying a code                                                    */
/* ================================================================== */

export type TotpVerdict =
  /** Correct, inside the drift window, and not seen before. `step` is stored. */
  | { kind: "accepted"; step: number }
  /** Wrong, malformed, or outside the window. One answer, deliberately. */
  | { kind: "invalid" }
  /**
   * Correct — and already used.
   *
   * A distinct verdict rather than a second `invalid`, because the two mean
   * opposite things to an operator reading the audit log: a wrong code is
   * somebody mistyping, and a *correct* code presented twice is somebody
   * replaying one they watched being typed. The **user-facing message is the
   * same for both**; only the log tells them apart.
   */
  | { kind: "replayed" };

/**
 * A presented code against a secret, a clock and the last step accepted.
 *
 * ---
 *
 * **The replay guard is the half that is easy to leave out.** A TOTP code is
 * valid for its whole step, and this one accepts a window of three steps — so
 * the same six digits are accepted repeatedly for up to ninety seconds unless
 * something remembers. Recording the accepted step and refusing anything at or
 * below it closes that: a code read over somebody's shoulder, or captured from
 * a phishing page and relayed, is spent by the time it is used again.
 *
 * `<=` rather than `<`, and the boundary is a test. Refusing only *older*
 * steps would leave the code's own step re-usable, which is the entire window
 * the guard exists to close.
 *
 * It costs one real thing, stated rather than discovered: a user who
 * legitimately needs to authenticate twice inside thirty seconds — signing in
 * and immediately re-authenticating to change a security setting — has to wait
 * for the next code. The screen says so.
 */
export function judgeTotp(input: {
  /** Base32, decrypted by the caller. */
  secret: string;
  code: string;
  now: Date;
  /** `null` for a credential that has never been used, and for enrolment. */
  lastUsedStep: number | null;
}): TotpVerdict {
  const token = normaliseTotpCode(input.code);
  if (token === null) return { kind: "invalid" };

  let delta: number | null;
  try {
    delta = TOTP.validate({
      token,
      secret: Secret.fromBase32(input.secret),
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      timestamp: input.now.getTime(),
      window: TOTP_DRIFT_STEPS,
    });
  } catch {
    /*
      A secret that is not valid base32 — a truncated column, a ciphertext
      decrypted under the wrong key, a hand-edited row. It is a server-side
      fault and not something the caller did, but the answer to *them* is
      still "that code is not right": the alternative leaks which accounts
      have a broken credential.
    */
    return { kind: "invalid" };
  }

  if (delta === null) return { kind: "invalid" };

  const step = currentStep(input.now) + delta;
  if (input.lastUsedStep !== null && step <= input.lastUsedStep) return { kind: "replayed" };
  return { kind: "accepted", step };
}

/**
 * Six digits, or nothing.
 *
 * Spaces are stripped because every authenticator app displays the code as
 * `123 456` and a paste carries the space. Anything else — a letter, five
 * digits, seven — is refused here rather than handed to the HMAC, so the
 * expensive path is not reachable by a caller sending a kilobyte.
 */
export function normaliseTotpCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(digits) ? digits : null;
}

/* ================================================================== */
/* Recovery codes                                                      */
/* ================================================================== */

/**
 * Crockford's base32, and it is chosen for the reading-aloud case.
 *
 * `I`, `L`, `O` and `U` are absent: the first three because they are the
 * glyphs people mistake for `1` and `0`, and `U` because it turns a random
 * string into a rude word often enough to matter on a printed sheet. What
 * makes it the right alphabet rather than just a shorter one is that the
 * omissions **fold** — a typed `O` can only have meant `0`, so
 * `normaliseRecoveryCode` can repair it instead of refusing a code the person
 * copied correctly off a piece of paper.
 *
 * Thirty-two symbols is also exactly five bits, so a byte masked to five bits
 * picks one uniformly. A 30-symbol alphabet would need rejection sampling to
 * avoid biasing the first sixteen symbols, and a modulo that nobody notices is
 * how a code space quietly shrinks.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * One recovery code: ten symbols, fifty bits, shown as `XXXXX-XXXXX`.
 *
 * The brief suggested `XXXX-XXXX`; ten symbols rather than eight because the
 * extra ten bits cost nothing and the group of five is what somebody reads
 * back over a telephone without losing their place.
 *
 * `random` is an argument so this stays pure and therefore testable — the
 * caller passes `node:crypto`'s `randomBytes`, and the test passes a counter.
 * A `Math.random` here would be undetectable in review and catastrophic.
 */
export function generateRecoveryCode(random: (bytes: number) => Uint8Array): string {
  const bytes = random(RECOVERY_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    // Five bits of a byte, so every symbol is equally likely: 256 is a whole
    // multiple of 32 and there is no residue to bias the front of the alphabet.
    out += ALPHABET[bytes[i] & 31];
  }
  return out;
}

export function generateRecoveryCodes(
  random: (bytes: number) => Uint8Array,
  count = RECOVERY_CODE_COUNT,
): string[] {
  const codes = new Set<string>();
  // A collision inside one set is astronomically unlikely and would be a
  // *silent* halving of that person's codes, because the second insert would
  // hit the unique index on the hash and the set would ship one short.
  while (codes.size < count) codes.add(generateRecoveryCode(random));
  return [...codes];
}

/** `AB12CD34EF` → `AB12C-D34EF`. Display only; never stored, never compared. */
export function formatRecoveryCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/**
 * What the person typed, reduced to what was generated — or `null`.
 *
 * Folds the four omitted glyphs onto what they can only have meant, strips
 * the separator, the spaces and the case. A code read off a printed sheet and
 * typed as `ab12c-d34ef`, `AB12C D34EF` or `AB12CD34EF` is one code.
 *
 * `null` for anything that is not the right length afterwards, so a garbage
 * string never reaches the database as a hash lookup.
 */
export function normaliseRecoveryCode(raw: string): string | null {
  const folded = raw
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V")
    .replace(/[^0-9A-Z]/g, "");

  if (folded.length !== RECOVERY_CODE_LENGTH) return null;
  // Everything left has to be in the alphabet. A `Ä` survives the strip above
  // only in a locale-dependent way, and a symbol that cannot have been
  // generated is a typo rather than a code.
  for (const ch of folded) if (!ALPHABET.includes(ch)) return null;
  return folded;
}

/* ================================================================== */
/* The half-finished sign-in                                           */
/* ================================================================== */

/** The columns the decision reads, and nothing more. */
export type ChallengeState = {
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
};

export type ChallengeVerdict =
  /** Open. Check the code against it. */
  | "usable"
  /** Past `expiresAt`. Nothing is wrong; go back to the password form. */
  | "expired"
  /** Already spent — by a success, or by running out of attempts. */
  | "consumed"
  /**
   * At the attempt ceiling but not yet marked.
   *
   * A separate verdict from `consumed` so the caller knows to *write* the
   * consumption rather than assuming somebody else did. Reachable when a
   * failure could not be persisted, and reaching it must not mean the
   * ceiling is ignored.
   */
  | "exhausted";

/**
 * Reads a presented challenge.
 *
 * Order matters and is the argument, the same way it is in `judgeRefresh`:
 * consumption is checked before expiry, because a challenge that was spent
 * and has *since* expired is still a replay, and reporting it as merely
 * expired would hide the only interesting case.
 */
export function judgeChallenge(state: ChallengeState, now: Date): ChallengeVerdict {
  if (state.consumedAt) return "consumed";
  if (state.attempts >= CHALLENGE_MAX_ATTEMPTS) return "exhausted";
  if (state.expiresAt.getTime() <= now.getTime()) return "expired";
  return "usable";
}

/**
 * What the row becomes after a wrong code.
 *
 * The attempt that reaches the ceiling consumes the challenge in the same
 * write. Leaving it open for one more request is how a ceiling of five becomes
 * a ceiling of six, and it is exactly the off-by-one that `afterFailedLogin`
 * in `auth.rules.ts` was written to make visible.
 */
export function afterFailedChallenge(
  state: ChallengeState,
  now: Date,
): { attempts: number; consumedAt: Date | null } {
  const attempts = state.attempts + 1;
  return {
    attempts,
    consumedAt: attempts >= CHALLENGE_MAX_ATTEMPTS ? now : null,
  };
}

/** How many tries are left, for the message. Never negative. */
export function attemptsRemaining(state: ChallengeState): number {
  return Math.max(0, CHALLENGE_MAX_ATTEMPTS - state.attempts);
}

/* ================================================================== */
/* Enrolment                                                           */
/* ================================================================== */

export type CredentialState = {
  status: "PENDING" | "VERIFIED";
  expiresAt: Date | null;
};

export type EnrolmentVerdict =
  /** A pending credential is waiting for its first correct code. */
  | "verifiable"
  /** Nothing has been started. */
  | "missing"
  /** Started too long ago. Start again — the secret is discarded. */
  | "expired"
  /** Already on. Enrolling again would replace a working factor silently. */
  | "active";

export function judgeEnrolment(
  credential: CredentialState | null,
  now: Date,
): EnrolmentVerdict {
  if (!credential) return "missing";
  if (credential.status === "VERIFIED") return "active";
  // A `PENDING` row with no expiry cannot be produced by `MfaService`, and
  // treating it as immortal would be the wrong way to be wrong about it.
  if (!credential.expiresAt || credential.expiresAt.getTime() <= now.getTime()) return "expired";
  return "verifiable";
}

/* ================================================================== */
/* Recent authentication                                               */
/* ================================================================== */

/**
 * Whether a presented re-authentication window is still open.
 *
 * A window rather than a single-use ticket, and the choice is written on
 * `ReauthToken` in the schema: a person who regenerates their recovery codes
 * and then turns the factor off is one decision, and asking for the password
 * twice inside a minute teaches people to keep it in the clipboard.
 */
export function isRecentAuth(
  token: { expiresAt: Date } | null,
  now: Date,
): boolean {
  return token !== null && token.expiresAt.getTime() > now.getTime();
}

/* ================================================================== */
/* The authenticator's view                                            */
/* ================================================================== */

/**
 * The `otpauth://` URI a QR code encodes and a manual entry reproduces.
 *
 * Built through `otpauth`'s own serialiser rather than by string
 * concatenation, because the label needs percent-encoding that is easy to get
 * subtly wrong — an issuer with a space in it produces a URI several apps
 * accept and one silently truncates, and the symptom is a code that is always
 * wrong for the people using that app.
 *
 * `issuer` is the firm's short name and `account` the e-mail address, which is
 * what makes the entry identifiable on a phone that holds eleven of them.
 */
export function otpauthUri(input: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  return URI.stringify(
    new TOTP({
      issuer: input.issuer,
      label: input.account,
      secret: Secret.fromBase32(input.secret),
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
    }),
  );
}

/**
 * A fresh Base32 secret.
 *
 * Twenty bytes — 160 bits — which is what RFC 4226 §4 requires as a minimum
 * and what every authenticator expects. `otpauth` draws it from the platform
 * CSPRNG.
 */
export function generateSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/**
 * The manual-entry form: groups of four, so it can be read off a screen.
 *
 * The QR code is the normal path and this is the one that has to work when the
 * QR code is being displayed on the same phone the authenticator is running
 * on — which is the case nobody tests and everybody eventually hits.
 */
export function formatSecretForEntry(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
