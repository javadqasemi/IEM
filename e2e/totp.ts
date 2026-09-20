import { createHmac } from "node:crypto";

/**
 * RFC 4226 / RFC 6238, implemented here rather than imported.
 *
 * ---
 *
 * **It is a second implementation on purpose.** The server computes its codes
 * with `otpauth`; if this file called the same library, a mistake in *how the
 * server uses it* — the wrong digit count, a period of 60, a secret decoded as
 * hex instead of base32 — would be mirrored perfectly and every test would
 * pass. Two independent implementations agreeing is evidence; one
 * implementation agreeing with itself is not.
 *
 * It is also why `otpauth` is not a dependency of the root package. Forty
 * lines of well-specified arithmetic beat a second copy of a library in a
 * second `node_modules`, and the arithmetic is checked against the RFC's own
 * published vectors in `mfa.spec.ts`.
 *
 * **It has to stay simple enough to be obviously right**, because nothing
 * tests the tests. Base32 decode, an HMAC, dynamic truncation, a modulo. Every
 * step is a line of the specification.
 */

/** RFC 4648 §6 — the base32 alphabet an authenticator secret is written in. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Base32 → bytes.
 *
 * Padding and whitespace are dropped: the server sends the secret unpadded,
 * and the grouped form it also sends (`JBSW Y3DP …`) is what a person would
 * paste. Accepting both means a test can use either without thinking.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Kein Base32-Zeichen: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // The remaining `bits` (< 8) are the padding the encoder added, and are
  // discarded — not rounded up into a final byte, which is the classic way a
  // hand-written decoder produces a secret one byte too long.
  return Buffer.from(out);
}

/**
 * RFC 4226 §5.3 — HOTP for one counter value.
 *
 * `writeBigUInt64BE` rather than two 32-bit writes: the counter is specified
 * as eight bytes, and the naive `writeUInt32BE(counter, 4)` form silently
 * wraps in 2106.
 */
export function hotp(secret: Buffer, counter: number, digits = 6, algorithm = "sha1"): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(algorithm, secret).update(message).digest();

  // Dynamic truncation: the low nibble of the last byte picks the offset, and
  // the high bit of the selected word is masked off so the result is positive
  // on every platform.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * RFC 6238 — HOTP with the counter derived from the clock.
 *
 * The parameters default to the ones `mfa.rules.ts` declares as invariants. A
 * test that needed different ones would be testing a different server.
 */
export function totp(
  secret: string,
  options: { at?: Date; period?: number; digits?: number; algorithm?: string; step?: number } = {},
): string {
  const period = options.period ?? 30;
  const at = options.at ?? new Date();
  const counter = Math.floor(at.getTime() / 1000 / period) + (options.step ?? 0);
  return hotp(base32Decode(secret), counter, options.digits ?? 6, options.algorithm ?? "sha1");
}

/**
 * A code that is *wrong* for this secret, whatever the clock says.
 *
 * Needed more often than it looks: a hard-coded `"000000"` is a valid code
 * once every million time steps, so a test asserting a refusal would fail
 * roughly once in a very long while and be dismissed as a flake. Deriving it
 * from the real code removes that entirely.
 */
export function wrongCode(secret: string, at = new Date()): string {
  const real = totp(secret, { at });
  const first = (Number(real[0]) + 1) % 10;
  return `${first}${real.slice(1)}`;
}

/**
 * Waits until the current time step has at least `ms` left.
 *
 * The problem it solves is a real flake and not a theoretical one: a test that
 * reads a code at second 29.8 of a step and submits it is racing the step
 * boundary — the server's window covers ±1 step so it would still pass, but a
 * test that then submits a *second* code expecting a different step gets the
 * same digits and fails on the replay guard for the wrong reason.
 */
export async function settleIntoStep(ms = 3_000, period = 30): Promise<void> {
  const remaining = period * 1000 - (Date.now() % (period * 1000));
  if (remaining < ms) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  }
}

/**
 * Waits for the next time step to begin.
 *
 * The replay guard refuses a step at or below the one already accepted, so any
 * test that authenticates twice with the same credential has to cross a
 * boundary between them. Up to thirty seconds, and it is unavoidable — the
 * alternative is a server that accepts a code twice.
 */
export async function waitForNextStep(period = 30): Promise<void> {
  const remaining = period * 1000 - (Date.now() % (period * 1000));
  await new Promise((resolve) => setTimeout(resolve, remaining + 500));
}
