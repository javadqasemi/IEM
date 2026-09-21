import { Global, Module } from "@nestjs/common";
import { EncryptionService, SecretEncryptionService } from "./encryption.service";

/**
 * Encryption at rest, reachable from anywhere.
 *
 * `@Global` for the reason `SettingsModule` is: it is infrastructure that more
 * than one feature reads, and the alternative is importing it into each module
 * that grows a secret. That was `AuthModule` alone until P2-4; the second
 * caller is `SettingsModule`, which is what turned the prediction in this
 * comment into a second provider.
 *
 * **Two providers, one implementation.** They differ only in the environment
 * variable they read — see the note at the head of `encryption.service.ts` for
 * why the keys are separate when the AES-GCM code is not.
 */
@Global()
@Module({
  providers: [EncryptionService, SecretEncryptionService],
  exports: [EncryptionService, SecretEncryptionService],
})
export class CryptoModule {}
