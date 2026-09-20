import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";

/**
 * Symmetric encryption at rest, for the whole application.
 *
 * **One service, not one per caller.** MFA is the first thing here that has to
 * store a value it must later read back in the clear — a TOTP secret cannot be
 * hashed, because the server has to recompute the code from it. API keys,
 * stored SMTP credentials and integration tokens are the same shape and are
 * coming; a `mfa.crypto.ts` would be the first of four incompatible answers to
 * one question.
 *
 * ---
 *
 * ## What it is
 *
 * AES-256-GCM. Authenticated, so a ciphertext that has been edited in the
 * database fails to decrypt rather than decrypting to something else — which
 * matters more here than confidentiality alone: an attacker who can *write*
 * the column but not read the key must not be able to swap in a secret they
 * know. A 96-bit random IV per value, which is the size GCM is specified for.
 *
 * The stored form is `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The
 * version prefix is not decoration — it is what makes a key rotation or an
 * algorithm change a migration rather than a data loss, and `decrypt` refuses
 * a prefix it does not know instead of guessing.
 *
 * ## Where the key comes from
 *
 * `MFA_ENCRYPTION_KEY`, 32 bytes, as base64 or hex. **Environment, not
 * settings** — `security.policy.ts` sorts security numbers into four kinds and
 * this is squarely the second: it belongs to the deployment, it is a secret,
 * and a settings screen that can print it is a settings screen that has
 * already lost.
 *
 * **It is deliberately not derived from `JWT_ACCESS_SECRET`.** That would make
 * the two rotate together, and rotating the JWT secret is documented in
 * `.env.example` as the way to sign everybody out — an operator doing the
 * ordinary thing would silently destroy every enrolled second factor.
 *
 * ## When it is missing
 *
 * The application still boots. Every other feature works, and anything that
 * needs encryption refuses with a message naming the variable — see
 * `assertAvailable`. Failing the bootstrap instead would take an installation
 * that has never used MFA offline over a feature it does not use.
 *
 * Failing *closed* is the right direction for the callers, and it has a cost
 * worth stating plainly: if the key is lost, enrolled users cannot complete a
 * sign-in with their authenticator. Their **recovery codes still work** —
 * those are hashed, not encrypted — and an administrator holding
 * `user.resetMfa` can clear the credential. That is the operational recovery
 * procedure, and it is in `docs/ENTERPRISE_ROADMAP.md` as well as here.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer | null;

  constructor(private readonly config: ConfigService) {
    this.key = readKey(this.config.get<string>("MFA_ENCRYPTION_KEY"), (message) =>
      this.logger.error(message),
    );
    if (!this.key) {
      // Logged once at construction rather than on every refusal: an operator
      // reading the boot log should see why a feature is unavailable before a
      // user finds out by pressing the button.
      this.logger.warn(
        "MFA_ENCRYPTION_KEY ist nicht gesetzt — Zwei-Faktor-Authentisierung ist deaktiviert. " +
          'Schlüssel erzeugen mit: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
  }

  /** Whether anything encrypted can be written or read at all. */
  get available(): boolean {
    return this.key !== null;
  }

  /**
   * Refuses with an operator-readable message when no key is configured.
   *
   * 503 rather than 500: the request was fine and the server is not broken —
   * this deployment has not been finished. The distinction is what an operator
   * needs from the status code before they read anything else.
   */
  assertAvailable(): void {
    if (!this.key) {
      throw new ServiceUnavailableException(
        "Die Zwei-Faktor-Authentisierung ist auf diesem Server nicht eingerichtet. " +
          "Es fehlt der Schlüssel MFA_ENCRYPTION_KEY.",
      );
    }
  }

  encrypt(plaintext: string): string {
    this.assertAvailable();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key!, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join(".");
  }

  /**
   * @throws if the key is absent, the envelope is malformed, the version is
   * unknown, or the authentication tag does not match. All four are the same
   * answer to the caller — the value cannot be read — and the caller's job is
   * to translate that into something the user can act on rather than to tell
   * them which.
   */
  decrypt(stored: string): string {
    this.assertAvailable();
    const parts = stored.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error(`Unreadable ciphertext envelope (${parts[0] ?? "empty"}).`);
    }
    const [, iv, tag, ciphertext] = parts;
    const decipher = createDecipheriv(ALGORITHM, this.key!, unb64(iv));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(ciphertext)), decipher.final()]).toString("utf8");
  }
}

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

const b64 = (buf: Buffer): string => buf.toString("base64url");
const unb64 = (value: string): Buffer => Buffer.from(value, "base64url");

/**
 * The configured key, or `null` with a reason logged.
 *
 * Exported for the test, which is the only way to cover the four rejection
 * branches without constructing a Nest module per case. A key of the wrong
 * length is rejected rather than stretched: `createCipheriv` would throw
 * anyway, and it would throw at the first *use* — which is a deployment
 * discovering its configuration is wrong when somebody tries to enrol.
 */
export function readKey(raw: string | undefined, onError: (message: string) => void): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;

  // Hex first: a 64-character hex string is also valid base64 input, and
  // decoding it as base64 would yield 48 bytes of nonsense rather than the
  // 32 the operator generated with `openssl rand -hex 32`.
  const buffer = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");

  if (buffer.length !== KEY_BYTES) {
    onError(
      `MFA_ENCRYPTION_KEY ist ${buffer.length} Byte lang, erwartet sind ${KEY_BYTES} ` +
        "(32 Byte als Base64 oder 64 Zeichen Hex). Der Schlüssel wird ignoriert.",
    );
    return null;
  }
  return buffer;
}

/**
 * A constant-time comparison of two hex digests.
 *
 * Here rather than in each caller because `timingSafeEqual` throws on a length
 * mismatch — so the obvious call site is the one that leaks the length and
 * crashes on the input an attacker controls. Both are handled once.
 *
 * It is used for recovery codes and for challenge tokens, both of which are
 * looked up by hash; the lookup itself is the comparison Postgres performs, so
 * this covers the places where two digests are compared *in process*.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** sha256, hex. The one spelling of it for everything token-shaped. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
