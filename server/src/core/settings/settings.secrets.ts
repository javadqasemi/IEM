import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { SecretEncryptionService, isEncrypted } from "../crypto/encryption.service";

/**
 * The layer between a setting and the cipher.
 *
 * ```
 * Settings  →  Secret Settings Layer  →  SecretEncryptionService  →  at rest
 * ```
 *
 * It exists so that "which settings are credentials" is answered in exactly
 * one place and so the two operations a credential needs — sealing it on the
 * way in, and reading it back for the one consumer that has to have it — are
 * the only two ways to touch one. `MailService` asks `SettingsService` for
 * `mail.smtpPassword` and gets a string; it does not know there is a cipher,
 * which is what keeps the next integration from growing its own.
 *
 * ---
 *
 * ## Reading fails soft, writing fails hard
 *
 * An unreadable secret returns `null` rather than throwing. That is not
 * leniency — it is what keeps a mail misconfiguration from taking down the
 * routes that merely *mention* mail. `MailService` then behaves exactly as it
 * does with no password configured: it degrades to the stub and says so. A
 * throw here would turn "the SMTP password cannot be decrypted" into a 500 on
 * the settings page that an operator would have to read the log to understand.
 *
 * Writing is the opposite. `seal` calls `assertAvailable`, so an attempt to
 * store a credential with no key configured is a 503 naming the variable,
 * rather than a plaintext password written to a column because the cipher was
 * absent. Failing open on a write is how the bug this module exists to fix
 * gets reintroduced.
 */
@Injectable()
export class SecretSettingsService {
  private readonly logger = new Logger(SecretSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretEncryptionService,
  ) {}

  /** Whether secrets can be written or read at all on this deployment. */
  get available(): boolean {
    return this.cipher.available;
  }

  /**
   * Plaintext in, envelope out. Throws 503 when no key is configured.
   *
   * The error deliberately carries no part of the value — see
   * `unavailableMessage` on the service, which names the variable and nothing
   * else.
   */
  seal(plaintext: string): string {
    this.cipher.assertAvailable();
    return this.cipher.encrypt(plaintext);
  }

  /**
   * The value a consumer needs, or `null` when it cannot be produced.
   *
   * Four reasons it can be `null`, and all four are the same answer to the
   * caller: nothing is stored, no key is configured, the envelope is damaged,
   * or it was encrypted under a different key. The log line distinguishes
   * them for an operator; the caller gets "there is no usable password", which
   * is the only thing it can act on.
   *
   * **A plaintext left over from before this module is returned as-is.** That
   * is what makes the migration safe to run after the read path has shipped
   * rather than before it — see `migrateLegacyPlaintext`.
   */
  reveal(stored: unknown, key: string): string | null {
    if (typeof stored !== "string" || stored === "") return null;

    if (!isEncrypted(stored)) {
      // Not yet migrated. Readable, and reported once so it does not pass
      // unnoticed — `migrateLegacyPlaintext` is what clears it.
      this.logger.warn(
        `„${key}“ liegt noch im Klartext vor und wird beim nächsten Start verschlüsselt.`,
      );
      return stored;
    }

    if (!this.cipher.available) {
      this.logger.error(
        `„${key}“ ist verschlüsselt, aber APP_SECRETS_ENCRYPTION_KEY fehlt — der Wert kann nicht gelesen werden.`,
      );
      return null;
    }

    try {
      return this.cipher.decrypt(stored);
    } catch {
      /*
        The message is deliberately not included.

        `decrypt` throws on a damaged envelope, an unknown version and a failed
        authentication tag, and none of those messages helps an operator more
        than this line does — while every one of them is a string built from
        the stored value, which is the one thing that must not reach a log.
      */
      this.logger.error(
        `„${key}“ kann nicht entschlüsselt werden. Wurde APP_SECRETS_ENCRYPTION_KEY gewechselt? Der Wert muss neu gesetzt werden.`,
      );
      return null;
    }
  }

  /* ================================================================== */
  /* Boot                                                                */
  /* ================================================================== */

  /**
   * Encrypts every secret setting still stored in the clear.
   *
   * Run once at boot, before anything reads a credential. Five properties, and
   * each is a way this could have gone wrong:
   *
   * - **Idempotent.** `isEncrypted` is a prefix test on the stored envelope, so
   *   a second run finds nothing to do. Deciding by attempting to decrypt would
   *   need the key to be present merely to *skip* the work.
   * - **Narrow.** Only rows whose *declaration* says `secret: true`. The
   *   database's own `secret` column is not consulted, because a row that
   *   drifted from the catalogue would otherwise be encrypted into something no
   *   declared reader ever asks for — unreadable, and invisible until somebody
   *   needed it.
   * - **Quiet.** No value is logged, at any level, in any branch. The counts are
   *   the report.
   * - **Fails safe.** With no key configured it changes nothing and says so.
   *   Encrypting is not possible, and clearing the rows to "protect" them would
   *   destroy a working configuration.
   * - **Per row.** One failure does not abandon the rest, and a row that cannot
   *   be sealed is left exactly as it was.
   */
  async migrateLegacyPlaintext(
    declaredSecretKeys: string[],
  ): Promise<{ migrated: number; alreadySealed: number; skipped: number; failed: number }> {
    if (declaredSecretKeys.length === 0) {
      return { migrated: 0, alreadySealed: 0, skipped: 0, failed: 0 };
    }

    const rows = await this.prisma.setting.findMany({
      where: { key: { in: declaredSecretKeys } },
      select: { key: true, value: true },
    });

    let migrated = 0;
    let alreadySealed = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const value = row.value;

      // Nothing stored is nothing to protect. An empty secret is the normal
      // state of a fresh install and must not become an encrypted empty string,
      // which would read as "configured" ever after.
      if (typeof value !== "string" || value.trim() === "") {
        skipped += 1;
        continue;
      }

      if (isEncrypted(value)) {
        alreadySealed += 1;
        continue;
      }

      if (!this.cipher.available) {
        skipped += 1;
        continue;
      }

      try {
        await this.prisma.setting.update({
          where: { key: row.key },
          data: { value: this.cipher.encrypt(value) },
        });
        migrated += 1;
      } catch (err) {
        // The key is named; the value is not, and neither is the exception's
        // message, which for a Prisma write can echo the column contents.
        failed += 1;
        this.logger.error(`„${row.key}“ konnte nicht verschlüsselt werden.`, (err as Error).name);
      }
    }

    if (migrated > 0) {
      this.logger.log(`${migrated} geheime Einstellung(en) nachträglich verschlüsselt.`);
    }
    if (failed > 0) {
      this.logger.error(`${failed} geheime Einstellung(en) konnten nicht verschlüsselt werden.`);
    }

    return { migrated, alreadySealed, skipped, failed };
  }

  /**
   * The loud half: encrypted secrets exist and the key to read them does not.
   *
   * **This must never be silent.** Without it the application boots perfectly,
   * the settings page reports the SMTP password as configured — because a row
   * holding an envelope *is* configured — and mail simply stops arriving, with
   * the cause several layers away from the symptom. That is precisely the
   * failure mode the brief names, and it is worth a line in the boot log that
   * an operator will find when they go looking.
   *
   * It reports rather than throws, which is the same choice
   * `EncryptionService` makes for MFA and for the same reason: an installation
   * that cannot send mail must still be able to serve the website and let
   * somebody sign in to fix it. A process that refuses to start is one nobody
   * can log into to repair.
   */
  async warnIfUnreadable(declaredSecretKeys: string[]): Promise<number> {
    if (this.cipher.available || declaredSecretKeys.length === 0) return 0;

    const rows = await this.prisma.setting.findMany({
      where: { key: { in: declaredSecretKeys } },
      select: { key: true, value: true },
    });
    const unreadable = rows.filter((r) => isEncrypted(r.value));
    if (unreadable.length === 0) return 0;

    this.logger.error(
      `${unreadable.length} geheime Einstellung(en) sind verschlüsselt, aber APP_SECRETS_ENCRYPTION_KEY ist nicht gesetzt: ` +
        `${unreadable.map((r) => r.key).join(", ")}. ` +
        "Diese Werte werden als „nicht konfiguriert“ behandelt, bis der Schlüssel wieder vorhanden ist — " +
        "E-Mail-Versand und Integrationen, die davon abhängen, funktionieren bis dahin nicht.",
    );
    return unreadable.length;
  }
}
