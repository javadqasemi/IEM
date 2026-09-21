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
 * **One implementation, several keys.** MFA was the first thing here that had
 * to store a value it must later read back in the clear — a TOTP secret cannot
 * be hashed, because the server has to recompute the code from it. Stored SMTP
 * credentials, provider API keys, webhook signing secrets and integration
 * tokens are the same shape, and P2-4 is where the second one arrived.
 *
 * What that second caller settled is the shape of this file: the AES-GCM code
 * is written **once**, in `KeyedCipher`, and the services below differ only in
 * which environment variable they read and what they say when it is missing.
 * The alternative — a `settings.crypto.ts` beside `mfa.crypto.ts` — is two
 * implementations of one primitive, and the day they disagree about the
 * envelope format is the day a value stops being readable.
 *
 * ---
 *
 * ## Why the keys are separate, when the code is not
 *
 * `MFA_ENCRYPTION_KEY` and `APP_SECRETS_ENCRYPTION_KEY` are different
 * variables on purpose, because the two hold values with different recovery
 * stories:
 *
 * - **Losing the MFA key** is survivable per user: recovery codes are hashed
 *   rather than encrypted so they still work, and `user.resetMfa` clears a
 *   credential. The blast radius is "enrolled users must re-enrol".
 * - **Losing the app-secrets key** means the SMTP password has to be typed in
 *   again — annoying, and nothing worse. It must **not** also mean every
 *   second factor in the firm is gone.
 *
 * Sharing one key would tie those two consequences together, so that rotating
 * the key after an integration credential leaked would sign out and de-enrol
 * every employee. That is the same argument that keeps either of them from
 * being derived from `JWT_ACCESS_SECRET`, which `.env.example` documents as
 * the way to sign everybody out.
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
 * a prefix it does not know instead of guessing. It is also what
 * `isEncrypted` reads, which is what makes the plaintext migration in
 * `settings.secrets.ts` idempotent.
 *
 * ## When a key is missing
 *
 * The application still boots. Every other feature works, and anything that
 * needs that particular key refuses with a message naming the variable — see
 * `assertAvailable`. Failing the bootstrap instead would take an installation
 * that has never used MFA offline over a feature it does not use.
 */
export abstract class KeyedCipher {
  protected readonly key: Buffer | null;

  protected constructor(
    raw: string | undefined,
    protected readonly envVar: string,
    logger: Logger,
  ) {
    this.key = readKey(raw, (message) => logger.error(message), envVar);
  }

  /** Whether anything encrypted with this key can be written or read at all. */
  get available(): boolean {
    return this.key !== null;
  }

  /** What a caller is told when this key is not configured. */
  protected abstract get unavailableMessage(): string;

  /**
   * Refuses with an operator-readable message when no key is configured.
   *
   * 503 rather than 500: the request was fine and the server is not broken —
   * this deployment has not been finished. The distinction is what an operator
   * needs from the status code before they read anything else.
   */
  assertAvailable(): void {
    if (!this.key) {
      throw new ServiceUnavailableException(this.unavailableMessage);
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

/**
 * The second factor's secrets — TOTP seeds and challenge material.
 *
 * Losing this key does not lock anybody out permanently: recovery codes are
 * hashed rather than encrypted, so they still work, and an administrator
 * holding `user.resetMfa` can clear a credential. That is the operational
 * recovery procedure, and it is in `docs/ENTERPRISE_ROADMAP.md` as well as
 * here.
 */
@Injectable()
export class EncryptionService extends KeyedCipher {
  constructor(config: ConfigService) {
    const logger = new Logger(EncryptionService.name);
    super(config.get<string>("MFA_ENCRYPTION_KEY"), "MFA_ENCRYPTION_KEY", logger);
    if (!this.available) {
      // Logged once at construction rather than on every refusal: an operator
      // reading the boot log should see why a feature is unavailable before a
      // user finds out by pressing the button.
      logger.warn(
        "MFA_ENCRYPTION_KEY ist nicht gesetzt — Zwei-Faktor-Authentisierung ist deaktiviert. " +
          `Schlüssel erzeugen mit: ${KEYGEN_HINT}`,
      );
    }
  }

  protected get unavailableMessage(): string {
    return (
      "Die Zwei-Faktor-Authentisierung ist auf diesem Server nicht eingerichtet. " +
      "Es fehlt der Schlüssel MFA_ENCRYPTION_KEY."
    );
  }
}

/**
 * Everything else the application stores and must read back in the clear.
 *
 * The SMTP password is the first; provider API credentials, webhook signing
 * secrets and storage credentials are the ones this exists for rather than a
 * second `MailEncryptionService` being written when each arrives. A caller
 * never reaches this directly — `SettingsService` is the seam, and a setting
 * declared `secret: true` is what routes a value through it.
 */
@Injectable()
export class SecretEncryptionService extends KeyedCipher {
  constructor(config: ConfigService) {
    const logger = new Logger(SecretEncryptionService.name);
    super(
      config.get<string>("APP_SECRETS_ENCRYPTION_KEY"),
      "APP_SECRETS_ENCRYPTION_KEY",
      logger,
    );
    if (!this.available) {
      logger.warn(
        "APP_SECRETS_ENCRYPTION_KEY ist nicht gesetzt — geheime Einstellungen " +
          `(z. B. das SMTP-Passwort) können weder gespeichert noch gelesen werden. Schlüssel erzeugen mit: ${KEYGEN_HINT}`,
      );
    }
  }

  protected get unavailableMessage(): string {
    return (
      "Geheime Einstellungen sind auf diesem Server nicht eingerichtet. " +
      "Es fehlt der Schlüssel APP_SECRETS_ENCRYPTION_KEY."
    );
  }
}

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

/** The one-liner every "key is missing" message ends with. */
const KEYGEN_HINT =
  'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"';

const b64 = (buf: Buffer): string => buf.toString("base64url");
const unb64 = (value: string): Buffer => Buffer.from(value, "base64url");

/**
 * Whether a stored value is one of ours rather than a plaintext left over from
 * before the column was encrypted.
 *
 * A **prefix test, not a decryption attempt**, and the difference is what makes
 * the migration in `settings.secrets.ts` idempotent: running it twice must
 * re-encrypt nothing, and deciding that by trying to decrypt would need a key
 * the migration might not have. It is also why `encrypt` writes a version
 * prefix at all.
 *
 * A plaintext SMTP password that happened to begin with `v1.` and contain
 * three more dot-separated base64url parts would be misread — which is a
 * password nobody has, and the failure is a refusal to decrypt rather than a
 * wrong value being served.
 */
export function isEncrypted(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 4 && parts[0] === VERSION;
}

/**
 * The configured key, or `null` with a reason logged.
 *
 * Exported for the test, which is the only way to cover the four rejection
 * branches without constructing a Nest module per case. A key of the wrong
 * length is rejected rather than stretched: `createCipheriv` would throw
 * anyway, and it would throw at the first *use* — which is a deployment
 * discovering its configuration is wrong when somebody tries to enrol.
 *
 * `envVar` names the variable in the message. It is the third parameter with a
 * default rather than the first without one, because two callers now share
 * this function and the message has to name the one the operator actually set
 * wrong — "ist 16 Byte lang" against the wrong variable sends somebody to
 * re-generate a key that was fine.
 */
export function readKey(
  raw: string | undefined,
  onError: (message: string) => void,
  envVar = "Der Schlüssel",
): Buffer | null {
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
      `${envVar} ist ${buffer.length} Byte lang, erwartet sind ${KEY_BYTES} ` +
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
