import { Global, Module } from "@nestjs/common";
import { EncryptionService } from "./encryption.service";

/**
 * Encryption at rest, reachable from anywhere.
 *
 * `@Global` for the reason `SettingsModule` is: it is infrastructure that more
 * than one feature will read, and the alternative is importing it into each
 * module that grows a secret. Today that is `AuthModule` alone; API keys and
 * stored integration credentials are the next two, and both are things a
 * future author should find rather than reinvent.
 */
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
