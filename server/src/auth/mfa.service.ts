import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuditOutcome } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../core/audit/audit.service";
import { EventBus } from "../core/events/event-bus";
import { EncryptionService, sha256 } from "../core/crypto/encryption.service";
import { OrganisationService } from "../core/organisation/organisation.service";
import { qrMatrix, type QrMatrix } from "./mfa.qr";
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_TTL_MS,
  ENROLMENT_TTL_MS,
  RECOVERY_CODES_LOW_WATER,
  afterFailedChallenge,
  formatRecoveryCode,
  formatSecretForEntry,
  generateRecoveryCodes,
  generateSecret,
  judgeChallenge,
  judgeEnrolment,
  judgeTotp,
  normaliseRecoveryCode,
  otpauthUri,
} from "./mfa.rules";
import { ReauthService } from "./reauth.service";
import type { AuthUser } from "../common/decorators";

type Ctx = { ip?: string | null; userAgent?: string | null };

/* ------------------------------------------------------------------ */
/* What leaves the server                                              */
/* ------------------------------------------------------------------ */

/**
 * The account's own view of its second factor.
 *
 * **No secret, no ciphertext, no recovery code**, and that is a property of
 * the type rather than of somebody remembering — the same reason
 * `SessionView` exists beside `RefreshToken`. `remaining` is a count, which
 * is the most that can be said about a set of codes without weakening them.
 */
export type MfaStatus = {
  /** Whether this server can do MFA at all — see `EncryptionService`. */
  available: boolean;
  enabled: boolean;
  method: "TOTP" | null;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  /** An enrolment has been started and not finished. */
  pending: boolean;
  pendingExpiresAt: string | null;
  recoveryCodes: {
    total: number;
    remaining: number;
    /** At or below `RECOVERY_CODES_LOW_WATER`, so the screen can say so. */
    low: boolean;
  };
};

/** What the enrolment screen needs, and the one time the secret is sent. */
export type EnrolmentStart = {
  /** Base32, for an authenticator that is being set up by hand. */
  secret: string;
  /** The same secret in groups of four, for reading off a screen. */
  secretGrouped: string;
  otpauthUri: string;
  qr: QrMatrix;
  expiresAt: string;
};

/** A fresh set of recovery codes, formatted, shown exactly once. */
export type RecoveryCodeSet = { codes: string[]; generatedAt: string };

/** The outcome of a second factor being checked against an account. */
export type FactorOutcome = {
  usedRecoveryCode: boolean;
  /** Unused codes left afterwards. `-1` when no recovery code was involved. */
  remainingRecoveryCodes: number;
};

/* ------------------------------------------------------------------ */

/**
 * The second factor: enrolment, verification, recovery and reset.
 *
 * ---
 *
 * ## Where the boundary with `AuthService` is
 *
 * This service knows what a factor is and whether one has been satisfied. It
 * issues no tokens and sets no cookies — `AuthService` does that, and calls in
 * here twice: once during sign-in to ask whether a factor is required, and
 * once to complete a challenge. The dependency points one way, which is what
 * keeps `AuthModule` free of a `forwardRef`.
 *
 * ## The two atomic writes, and why they are `updateMany`
 *
 * Both single-use guarantees in this file are **one statement**, for exactly
 * the reason `ProjectsRepository.updateIfUnchanged` is:
 *
 * - **A recovery code** is consumed with
 *   `updateMany({ where: { tokenHash, consumedAt: null } })` and the returned
 *   count is the answer. Reading the row, checking `consumedAt` and then
 *   writing looks equivalent and is not — two requests arriving together both
 *   read `null`, both proceed, and one code authenticates twice.
 * - **A TOTP step** is recorded with a `where` that names the step being
 *   beaten. A count of zero means another request has already claimed that
 *   step, which is precisely a replay, so the race resolves into the verdict
 *   the rules file already has a name for.
 *
 * Postgres's row lock is what decides both. A count is a value this code can
 * read where an exception would have to be parsed.
 *
 * ## What is never logged
 *
 * No audit row in this file carries a secret, a code, a recovery code or a
 * ciphertext. `AuditService.scrub` already redacts `mfasecret` and `secret`
 * by key at any depth, and nothing here relies on it: the payloads are
 * counts, timestamps and reasons.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly organisation: OrganisationService,
    private readonly reauth: ReauthService,
    /**
     * The four state changes are **announced**, not logged (P2-3).
     *
     * `AuditListener` writes the row from the event, so the log is unchanged
     * — `auditActionFor` derives `mfa.enabled` from `MfaEnabled`, which is
     * exactly what the direct call used to write — and Notifications hears
     * the same fact without this service knowing it exists.
     *
     * The **failures** still call `AuditService` directly, and correctly:
     * `auth.mfa_failed` is an attempt, not a change, and has no record it is
     * about. That is the rule `AuditListener` states.
     */
    private readonly events: EventBus,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Status                                                            */
  /* ---------------------------------------------------------------- */

  async status(userId: string): Promise<MfaStatus> {
    const [credential, total, remaining] = await this.prisma.$transaction([
      this.prisma.mfaCredential.findUnique({
        where: { userId_type: { userId, type: "TOTP" } },
        select: {
          status: true,
          verifiedAt: true,
          lastUsedAt: true,
          expiresAt: true,
        },
      }),
      this.prisma.mfaRecoveryCode.count({ where: { userId } }),
      this.prisma.mfaRecoveryCode.count({ where: { userId, consumedAt: null } }),
    ]);

    const enabled = credential?.status === "VERIFIED";
    return {
      available: this.encryption.available,
      enabled,
      method: enabled ? "TOTP" : null,
      verifiedAt: credential?.verifiedAt?.toISOString() ?? null,
      lastUsedAt: credential?.lastUsedAt?.toISOString() ?? null,
      // A pending row that has expired is reported as no enrolment at all:
      // the screen's offer is "start", not "carry on with something dead".
      pending:
        credential?.status === "PENDING" &&
        (credential.expiresAt?.getTime() ?? 0) > Date.now(),
      pendingExpiresAt:
        credential?.status === "PENDING" ? (credential.expiresAt?.toISOString() ?? null) : null,
      recoveryCodes: {
        total,
        remaining,
        low: enabled && remaining <= RECOVERY_CODES_LOW_WATER,
      },
    };
  }

  /**
   * Whether this account must show a second factor to sign in.
   *
   * Reads the **credential**, never `User.mfaEnabled`. The column is a mirror
   * for the user list; a decision taken from it would lock somebody out on a
   * `true` with nothing behind it and silently skip the factor on a `false`.
   * The schema says so on the column itself.
   */
  async requiresFactor(userId: string): Promise<boolean> {
    const n = await this.prisma.mfaCredential.count({
      where: { userId, status: "VERIFIED" },
    });
    return n > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Enrolment                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Step 2 of the setup: a secret exists, and nothing is protected yet.
   *
   * **The `PENDING` credential is not a second factor.** `requiresFactor`
   * counts `VERIFIED` rows only, so a person who reaches this screen and
   * closes the tab can still sign in with their password alone — which is the
   * whole reason the status enum exists. Enabling MFA because a QR code was
   * drawn would lock out everybody who got as far as looking at it.
   *
   * Restarting replaces the pending secret rather than accumulating them: the
   * unique index on `(userId, type)` makes that an upsert, and an abandoned
   * secret that is still valid is a credential nobody is watching.
   */
  async startEnrolment(user: AuthUser, ctx: Ctx): Promise<EnrolmentStart> {
    this.encryption.assertAvailable();

    const existing = await this.prisma.mfaCredential.findUnique({
      where: { userId_type: { userId: user.id, type: "TOTP" } },
      select: { status: true, expiresAt: true },
    });
    if (judgeEnrolment(existing, new Date()) === "active") {
      throw new BadRequestException(
        "Die Zwei-Faktor-Authentisierung ist bereits aktiv. Zum Wechseln des Geräts zuerst deaktivieren.",
      );
    }

    const secret = generateSecret();
    const expiresAt = new Date(Date.now() + ENROLMENT_TTL_MS);
    const issuer = await this.issuer();
    const uri = otpauthUri({ secret, account: user.email, issuer });

    await this.prisma.mfaCredential.upsert({
      where: { userId_type: { userId: user.id, type: "TOTP" } },
      create: {
        userId: user.id,
        type: "TOTP",
        status: "PENDING",
        encryptedSecret: this.encryption.encrypt(secret),
        label: `${issuer}: ${user.email}`,
        expiresAt,
      },
      update: {
        status: "PENDING",
        encryptedSecret: this.encryption.encrypt(secret),
        label: `${issuer}: ${user.email}`,
        expiresAt,
        verifiedAt: null,
        lastUsedAt: null,
        // A fresh secret has no history, and carrying the old step forward
        // would refuse the first code from the new one for up to 90 seconds.
        lastUsedStep: null,
      },
    });

    this.audit.record({
      actor: user,
      action: "auth.mfa_enrollment_started",
      resource: "user",
      resourceId: user.id,
      ...ctx,
    });

    return {
      secret,
      secretGrouped: formatSecretForEntry(secret),
      otpauthUri: uri,
      qr: qrMatrix(uri),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Step 3: the first correct code, and only now is the factor on.
   *
   * The recovery codes are generated in the **same transaction** as the
   * activation. Splitting them would leave a window in which MFA is required
   * and the person has no way back in if the phone is lost between the two
   * statements — which is the one failure in this module that cannot be
   * repaired by the person it happens to.
   */
  async verifyEnrolment(user: AuthUser, code: string, ctx: Ctx): Promise<RecoveryCodeSet> {
    this.encryption.assertAvailable();

    const credential = await this.prisma.mfaCredential.findUnique({
      where: { userId_type: { userId: user.id, type: "TOTP" } },
      select: { id: true, status: true, expiresAt: true, encryptedSecret: true },
    });

    const verdict = judgeEnrolment(credential, new Date());
    if (verdict === "active") {
      throw new BadRequestException("Die Zwei-Faktor-Authentisierung ist bereits aktiv.");
    }
    if (verdict !== "verifiable") {
      throw new BadRequestException(
        "Die Einrichtung ist abgelaufen oder wurde nicht begonnen. Bitte erneut starten.",
      );
    }

    const totp = judgeTotp({
      secret: this.decryptOrThrow(credential!.encryptedSecret),
      code,
      now: new Date(),
      // Enrolment has no history to replay against: the credential has never
      // authenticated anything, so every step is new.
      lastUsedStep: null,
    });

    if (totp.kind !== "accepted") {
      this.audit.record({
        actor: user,
        action: "auth.mfa_failed",
        resource: "user",
        resourceId: user.id,
        outcome: AuditOutcome.FAILURE,
        message: "Falscher Code bei der Einrichtung.",
        ...ctx,
      });
      throw new BadRequestException(
        "Dieser Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.",
      );
    }

    const codes = generateRecoveryCodes(randomBytes);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.mfaCredential.update({
        where: { id: credential!.id },
        data: {
          status: "VERIFIED",
          verifiedAt: now,
          lastUsedAt: now,
          lastUsedStep: BigInt(totp.step),
          expiresAt: null,
        },
      }),
      // `User.mfaEnabled` is written in the same transaction as the credential
      // it mirrors. That is the whole of what keeps the denormalisation from
      // drifting — see the comment on the column.
      this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: user.id, tokenHash: sha256(c) })),
      }),
    ]);

    this.events.publish("MfaEnabled", {
      entity: "user",
      entityId: user.id,
      payload: { email: user.email },
      message: `TOTP aktiviert, ${codes.length} Wiederherstellungscodes erzeugt.`,
    });

    return { codes: codes.map(formatRecoveryCode), generatedAt: now.toISOString() };
  }

  /* ---------------------------------------------------------------- */
  /* Management                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Turns the factor off.
   *
   * **Behind recent authentication**, which is the control that matters here:
   * a session is evidence that somebody signed in once, and an unattended
   * laptop must not be a way to remove a security control from the account.
   *
   * **The other sessions are deliberately left alone**, and the decision is
   * worth writing down because `changePassword` does the opposite two hundred
   * lines away. A password change revokes because every other session holds a
   * token issued against a credential that no longer exists. Nothing of the
   * kind is true here: disabling MFA changes what a *future* sign-in has to
   * show and changes nothing about the sessions already running, all of which
   * belong to the person who just re-entered their password. Ending them
   * would be a punishment for using a control correctly, and the person would
   * learn not to.
   *
   * The recovery codes go with the credential. Leaving them would be a set of
   * live single-use passwords for an account that no longer has a second
   * factor to recover.
   */
  /*
    No `ctx` any more, and its absence is the refactor showing.

    Every method that writes its own audit row needs the request's IP and
    user agent threaded down to it. One that publishes an event does not:
    `AuditListener` reads them from `AsyncLocalStorage`, so the parameter
    became dead the moment the `audit.record` call became a `publish`. The
    same is true of `regenerateRecoveryCodes` below and of three methods in
    `content.service.ts`. `resetFor` keeps its `ctx`, because it still has
    one direct audit call for the case where there was nothing to reset.
  */
  async disable(user: AuthUser, reauthToken: string | undefined): Promise<void> {
    await this.reauth.require(user.id, reauthToken);

    const credential = await this.prisma.mfaCredential.findUnique({
      where: { userId_type: { userId: user.id, type: "TOTP" } },
      select: { id: true, status: true },
    });
    if (credential?.status !== "VERIFIED") {
      throw new BadRequestException("Die Zwei-Faktor-Authentisierung ist nicht aktiv.");
    }

    await this.clear(user.id);

    this.events.publish("MfaDisabled", {
      entity: "user",
      entityId: user.id,
      payload: { email: user.email },
      message: "Selbst deaktiviert. Offene Sitzungen bleiben bestehen.",
    });
  }

  /**
   * A new set of recovery codes, and the old ones stop working.
   *
   * Behind recent authentication for the same reason `disable` is: somebody
   * who can silently mint ten one-time passwords for an account has a
   * persistent way back into it long after the session they used has gone.
   *
   * `deleteMany` rather than marking the old set consumed — a consumed code
   * and a superseded one are different facts, and only the first is worth a
   * row. The count in the audit message is what an operator reads.
   */
  async regenerateRecoveryCodes(
    user: AuthUser,
    reauthToken: string | undefined,
  ): Promise<RecoveryCodeSet> {
    await this.reauth.require(user.id, reauthToken);

    if (!(await this.requiresFactor(user.id))) {
      throw new BadRequestException(
        "Wiederherstellungscodes gibt es nur mit aktiver Zwei-Faktor-Authentisierung.",
      );
    }

    const codes = generateRecoveryCodes(randomBytes);
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: user.id, tokenHash: sha256(c) })),
      }),
    ]);

    this.events.publish("MfaRecoveryRegenerated", {
      entity: "user",
      entityId: user.id,
      payload: { email: user.email, codes: codes.length },
      message: `${codes.length} neue Wiederherstellungscodes; die bisherigen sind ungültig.`,
    });

    return { codes: codes.map(formatRecoveryCode), generatedAt: new Date().toISOString() };
  }

  /* ---------------------------------------------------------------- */
  /* Administration                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * An administrator clears somebody else's factor — account recovery.
   *
   * The case this exists for is the ordinary one: a person changed phone and
   * did not move the authenticator, and their recovery codes are in a drawer
   * at home. Without it the answer is a database console.
   *
   * **It grants no reading.** There is no route by which an administrator can
   * see a secret, a code or a QR image; the only thing they can do is remove
   * the credential, which is destructive and audited rather than silent.
   *
   * **The target's sessions are revoked**, which is the opposite of what
   * `disable` does, and the asymmetry is the point. `disable` is a person
   * acting on their own account having just proved who they are. This is
   * somebody else acting on an account for one of two reasons — the holder is
   * locked out, in which case there is no session to lose, or the credential
   * is suspect, in which case every session established with it is suspect
   * too. Both readings point the same way.
   */
  async resetFor(
    targetId: string,
    actor: AuthUser,
    reauthToken: string | undefined,
    ctx: Ctx,
  ): Promise<{ hadFactor: boolean; sessionsRevoked: number }> {
    await this.reauth.require(actor.id, reauthToken);

    const target = await this.prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
      select: { id: true, email: true, mfaEnabled: true },
    });
    if (!target) throw new BadRequestException("Benutzer nicht gefunden.");

    const hadFactor = await this.requiresFactor(targetId);
    await this.clear(targetId);

    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.reauth.closeAll(targetId);

    if (hadFactor) {
      /*
        An event only when there was something to reset.

        A reset of an account with no second factor changed nothing, so there
        is no fact to announce and nobody to notify — telling somebody
        "your second factor was reset" when they never had one is a security
        message that is not true. It is still worth a row in the log, because
        an administrator *attempted* it, so that case keeps the direct audit
        call below.

        `entityId` is the **target**, not the actor: that is what lets the
        notification reach the person whose account changed rather than the
        administrator who changed it.
      */
      this.events.publish("MfaReset", {
        entity: "user",
        entityId: targetId,
        payload: { email: target.email, byEmail: actor.email, sessionsRevoked: count },
        message: `Zweiter Faktor von ${target.email} zurückgesetzt; ${count} Sitzung(en) beendet.`,
      });
    } else {
      this.audit.record({
        actor,
        action: "mfa.reset",
        resource: "user",
        resourceId: targetId,
        outcome: AuditOutcome.FAILURE,
        message: `${target.email} hatte keinen zweiten Faktor; nichts zurückzusetzen.`,
        ...ctx,
      });
    }

    return { hadFactor, sessionsRevoked: count };
  }

  /* ---------------------------------------------------------------- */
  /* Sign-in                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Opens a half-finished sign-in.
   *
   * The token is opaque and the account lives only on the server side of it.
   * Sending a `userId` to the browser and trusting it back is the shape this
   * avoids: it would let a caller who knows one password finish the sign-in
   * as somebody else by editing a field.
   */
  async createChallenge(userId: string, ctx: Ctx): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    await this.prisma.mfaChallenge.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Finishes one, or refuses it.
   *
   * Returns the account so `AuthService` can issue the pair. Everything about
   * *why* a refusal happened stays in the audit log: the caller is told
   * "wrong code" whether the code was wrong, replayed, or correct for an
   * account other than the one the challenge names, because each distinction
   * is a fact worth learning for somebody who should not have it.
   *
   * @throws `UnauthorizedException` in every failing case, including an
   * expired or exhausted challenge — the browser's answer to all of them is
   * to go back to the password form.
   */
  async completeChallenge(
    token: string,
    input: { code?: string; recoveryCode?: string },
    ctx: Ctx,
  ): Promise<{ userId: string } & FactorOutcome> {
    const row = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash: sha256(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true,
        attempts: true,
        user: { select: { id: true, email: true, status: true, deletedAt: true } },
      },
    });

    if (!row) throw new UnauthorizedException(CHALLENGE_GONE);

    const verdict = judgeChallenge(row, new Date());
    if (verdict !== "usable") {
      // Marked on the way out, so an exhausted challenge cannot be reached a
      // second time even if the write that should have consumed it was lost.
      if (verdict === "exhausted") {
        await this.prisma.mfaChallenge.update({
          where: { id: row.id },
          data: { consumedAt: new Date() },
        });
      }
      this.audit.record({
        action: "auth.mfa_failed",
        resource: "user",
        resourceId: row.userId,
        outcome: AuditOutcome.DENIED,
        message: `Anmeldeversuch mit einer Bestätigung im Zustand „${verdict}“.`,
        ...ctx,
      });
      throw new UnauthorizedException(CHALLENGE_GONE);
    }

    if (row.user.deletedAt || row.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Dieses Konto ist nicht mehr aktiv.");
    }

    const outcome = await this.verifyFactor(row.userId, input);

    if (!outcome) {
      const next = afterFailedChallenge(row, new Date());
      await this.prisma.mfaChallenge.update({ where: { id: row.id }, data: next });

      this.audit.record({
        action: "auth.mfa_failed",
        resource: "user",
        resourceId: row.userId,
        outcome: AuditOutcome.FAILURE,
        message:
          `Fehlversuch ${next.attempts}/${CHALLENGE_MAX_ATTEMPTS}` +
          (next.consumedAt ? " — Bestätigung verbraucht." : ""),
        ...ctx,
      });

      throw new UnauthorizedException(
        next.consumedAt
          ? "Zu viele Fehlversuche. Bitte melden Sie sich erneut an."
          : "Dieser Code stimmt nicht.",
      );
    }

    await this.prisma.mfaChallenge.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    if (outcome.usedRecoveryCode) {
      this.audit.record({
        actor: { id: row.user.id, email: row.user.email } as AuthUser,
        action: "auth.mfa_recovery_used",
        resource: "user",
        resourceId: row.userId,
        message: `Wiederherstellungscode verwendet; ${outcome.remainingRecoveryCodes} verbleiben.`,
        ...ctx,
      });
    }

    return { userId: row.userId, ...outcome };
  }

  /* ---------------------------------------------------------------- */
  /* The shared check                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * A second factor against one account. `null` when it does not hold.
   *
   * One implementation for both callers — finishing a sign-in and
   * re-authenticating — because "is this a valid second factor for this
   * person" is one question, and two answers to it would eventually disagree
   * about the replay guard or about whether a recovery code counts.
   *
   * **A recovery code counts here**, including for re-authentication. The
   * alternative refuses somebody who has lost their phone the ability to turn
   * the factor off, which is the exact situation in which they need to.
   */
  async verifyFactor(
    userId: string,
    input: { code?: string; recoveryCode?: string },
  ): Promise<FactorOutcome | null> {
    if (input.recoveryCode?.trim()) {
      return this.consumeRecoveryCode(userId, input.recoveryCode);
    }
    if (!input.code?.trim()) return null;
    return this.consumeTotp(userId, input.code);
  }

  /**
   * A TOTP code, with the step claimed atomically.
   *
   * The `where` names the step being beaten, so two requests carrying the same
   * code cannot both succeed: Postgres's row lock decides, the loser sees a
   * count of zero, and that is exactly the replay the rules file has a name
   * for. Reading `lastUsedStep`, comparing it and then writing looks
   * equivalent and is the same race `updateIfUnchanged` was written against.
   */
  private async consumeTotp(userId: string, code: string): Promise<FactorOutcome | null> {
    // A missing key is not something a signing-in user can act on, and it must
    // not read as a wrong code — 503 with the variable named is the honest
    // answer, and it is what an operator will find in the log.
    this.encryption.assertAvailable();

    const credential = await this.prisma.mfaCredential.findFirst({
      where: { userId, status: "VERIFIED" },
      select: { id: true, encryptedSecret: true, lastUsedStep: true },
    });
    if (!credential) return null;

    const verdict = judgeTotp({
      secret: this.decryptOrThrow(credential.encryptedSecret),
      code,
      now: new Date(),
      lastUsedStep:
        credential.lastUsedStep === null ? null : Number(credential.lastUsedStep),
    });
    if (verdict.kind !== "accepted") return null;

    const { count } = await this.prisma.mfaCredential.updateMany({
      where: {
        id: credential.id,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(verdict.step) } }],
      },
      data: { lastUsedStep: BigInt(verdict.step), lastUsedAt: new Date() },
    });
    if (count === 0) return null;

    return { usedRecoveryCode: false, remainingRecoveryCodes: -1 };
  }

  /**
   * A recovery code, consumed in one statement.
   *
   * `updateMany … where consumedAt: null` and read the count. That is what
   * makes "usable exactly once" true under concurrency rather than only in
   * the happy path — the alternative reads the row, finds it unconsumed, and
   * so does the request that arrived a millisecond later.
   *
   * The lookup is by hash, so the comparison happens inside Postgres against
   * a unique index and this process never holds two codes to compare.
   */
  private async consumeRecoveryCode(
    userId: string,
    raw: string,
  ): Promise<FactorOutcome | null> {
    const normalised = normaliseRecoveryCode(raw);
    if (!normalised) return null;

    const { count } = await this.prisma.mfaRecoveryCode.updateMany({
      // `userId` in the `where` as well as the hash: the hash is unique
      // across the table, so without it a code belonging to another account
      // would be consumed — and the sign-in would still fail, leaving
      // somebody else one code poorer for no visible reason.
      where: { userId, tokenHash: sha256(normalised), consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) return null;

    const remaining = await this.prisma.mfaRecoveryCode.count({
      where: { userId, consumedAt: null },
    });
    return { usedRecoveryCode: true, remainingRecoveryCodes: remaining };
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Removes the credential, its recovery codes and any open challenge.
   *
   * One place, called by `disable` and by `resetFor`, because the three
   * deletions belong together: a recovery code that outlived its credential
   * is a password, and an open challenge would let a sign-in that started
   * before the reset finish after it.
   */
  private async clear(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mfaCredential.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaChallenge.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false } }),
    ]);
  }

  /**
   * The stored secret, or a 503 naming the key.
   *
   * A ciphertext that will not decrypt means the key has changed or the row
   * has been edited — an operator problem, not a user one. Reporting it as a
   * wrong code would send the person to reset their phone over a
   * configuration mistake, and would leave nothing in the log pointing at the
   * real cause.
   */
  private decryptOrThrow(ciphertext: string): string {
    try {
      return this.encryption.decrypt(ciphertext);
    } catch {
      throw new BadRequestException(
        "Der hinterlegte zweite Faktor kann auf diesem Server nicht gelesen werden. " +
          "Bitte einen Wiederherstellungscode verwenden oder die Administration bitten, " +
          "die Zwei-Faktor-Authentisierung zurückzusetzen.",
      );
    }
  }

  /**
   * What the authenticator app calls this installation.
   *
   * The firm's short name, from `Organisation` — so a phone holding eleven
   * entries shows "IEM" rather than "OTPAuth", and so the label follows the
   * company record instead of being a third place the firm's name is typed.
   * A failed read must not stop somebody enrolling, so it falls back.
   */
  private async issuer(): Promise<string> {
    try {
      const { shortName, name } = await this.organisation.identity();
      return (shortName || name || "IEM").trim();
    } catch {
      return "IEM";
    }
  }
}

/**
 * One sentence for every way a challenge can be unusable.
 *
 * Expired, consumed, exhausted and never-existed are four different facts and
 * the browser's response to all four is the same — start again — so telling
 * them apart would only tell an attacker whether a token they hold was ever
 * real. The audit log keeps the distinction.
 */
const CHALLENGE_GONE =
  "Die Anmeldung ist abgelaufen oder wurde bereits abgeschlossen. Bitte melden Sie sich erneut an.";
