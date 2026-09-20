import type { EnrolmentStartDto, MfaStatusDto, RecoveryCodeSetDto } from "./dto";
import type { Enrolment, MfaStatus, RecoveryCodes } from "./types";

/**
 * Wire shapes in, entities out — the only file besides `repository.ts`
 * allowed to name a DTO.
 *
 * Thin, and correctly so: the server already decided what "enabled" means,
 * how many codes are left and whether that count is low, because every one of
 * those needs rows this side must never see. What is left is turning ISO
 * strings into `Date`s, which is exactly the boundary this layer exists for.
 *
 * `low` is **not** recomputed here from `remaining`. The threshold is the
 * server's — it is declared beside the code generator in `mfa.rules.ts`, so
 * that changing it changes one number rather than one number and a component
 * that will be missed.
 */

export function toMfaStatus(dto: MfaStatusDto): MfaStatus {
  return {
    available: dto.available,
    enabled: dto.enabled,
    method: dto.method,
    verifiedAt: dto.verifiedAt ? new Date(dto.verifiedAt) : null,
    lastUsedAt: dto.lastUsedAt ? new Date(dto.lastUsedAt) : null,
    pending: dto.pending,
    pendingExpiresAt: dto.pendingExpiresAt ? new Date(dto.pendingExpiresAt) : null,
    recoveryCodes: { ...dto.recoveryCodes },
  };
}

export function toEnrolment(dto: EnrolmentStartDto): Enrolment {
  return {
    secret: dto.secret,
    secretGrouped: dto.secretGrouped,
    otpauthUri: dto.otpauthUri,
    qr: { size: dto.qr.size, path: dto.qr.path },
    expiresAt: new Date(dto.expiresAt),
  };
}

export function toRecoveryCodes(dto: RecoveryCodeSetDto): RecoveryCodes {
  return { codes: [...dto.codes], generatedAt: new Date(dto.generatedAt) };
}

/**
 * The codes as a file somebody can keep.
 *
 * Plain text with a header naming the account and the date, because the
 * failure this prevents is finding a file called `codes.txt` in two years
 * with ten strings in it and no idea which system or which login they belong
 * to. `\r\n`, so it opens correctly in Notepad on the Windows machines this
 * firm uses — a single `\n` renders as one unreadable line there.
 */
export function recoveryCodesAsText(
  codes: string[],
  account: string,
  generatedAt: Date,
): string {
  return [
    "IEM Dashboard — Wiederherstellungscodes",
    `Konto: ${account}`,
    `Erstellt: ${generatedAt.toLocaleString("de-CH")}`,
    "",
    "Jeder Code funktioniert genau einmal. Bewahren Sie diese Liste so auf,",
    "wie Sie einen Schlüssel aufbewahren würden — nicht im selben Passwort-",
    "manager wie Ihr Passwort, sonst schützt der zweite Faktor nichts.",
    "",
    ...codes,
    "",
  ].join("\r\n");
}
