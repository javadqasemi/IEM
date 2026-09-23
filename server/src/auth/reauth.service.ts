import { ForbiddenException, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { sha256 } from "../core/crypto/encryption.service";
import { REAUTH_TTL_MS, isRecentAuth } from "./mfa.rules";

/**
 * "This person proved who they are a moment ago."
 *
 * A separate claim from "this request carries a valid session", and the
 * difference is the whole reason the service exists: an access token says
 * somebody signed in at some point in the last fortnight and left the laptop
 * open. It is not evidence that the person at the keyboard now is the account
 * holder, and for the operations that can **remove a security control** that
 * is exactly the evidence needed.
 *
 * ---
 *
 * **Deliberately not MFA-specific.** MFA is the first caller and will not be
 * the last: `docs/ENTERPRISE_ROADMAP.md` already has a backup restore, API
 * secrets and organisation deletion waiting, and each of them would otherwise
 * grow its own password prompt with its own window and its own mistakes. The
 * three lines below are the whole concept, and `require()` is the one gate.
 *
 * **It travels in the request body, not in a header.** A custom header would
 * need `allowedHeaders` widening in `main.ts` — a CORS change made for one
 * feature, which the next reader has to work out the reason for — and it
 * would need a preflight on routes that do not otherwise have one. A field on
 * the DTO is validated by the pipe that validates everything else.
 *
 * **It is a window rather than a ticket.** Presenting it does not spend it, so
 * regenerating recovery codes and then turning the factor off is one
 * decision rather than two prompts a minute apart. The argument is written on
 * `ReauthToken` in the schema; the ceiling is `REAUTH_TTL_MS`, five minutes.
 */
/** The error `code` for "prove it again, then retry". */
export const REAUTH_REQUIRED = "reauth_required";

@Injectable()
export class ReauthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens a window. The caller has already proved whatever it takes.
   *
   * Opaque random bytes stored as a hash, the same shape as `RefreshToken`
   * and `PasswordReset` and for the same reason: it has to be revocable, and
   * nothing is gained by making it self-describing when the server looks it
   * up anyway.
   *
   * Any window this account already had is closed first. Two live windows
   * would mean the one a person opened by mistake outlives the one they meant
   * to use, and "how long am I re-authenticated for" would have no answer.
   */
  async open(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + REAUTH_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.reauthToken.deleteMany({ where: { userId } }),
      this.prisma.reauthToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } }),
    ]);

    return { token, expiresAt };
  }

  /**
   * The gate. Throws unless the presented window is this account's and open.
   *
   * Scoped by `userId` in the `where`, so a window opened against one account
   * cannot authorise an operation on another — which is the substitution a
   * bare token lookup would allow, and the one that matters most on
   * `POST /users/:id/mfa/reset`.
   *
   * 403 rather than 401: the caller *is* authenticated, and answering 401
   * would make the dashboard's API client refresh the session and retry,
   * which cannot help and looks to the reader like a random sign-out.
   */
  async require(userId: string, token: string | undefined): Promise<void> {
    const row = token
      ? await this.prisma.reauthToken.findFirst({
          where: { tokenHash: sha256(token), userId },
          select: { id: true, expiresAt: true },
        })
      : null;

    if (!isRecentAuth(row, new Date())) {
      // `code` so a client can open the password dialog and retry rather than
      // show the sentence as a failure. The message is unchanged.
      throw new ForbiddenException({
        message:
          "Für diesen Schritt ist eine erneute Bestätigung nötig. Bitte das Passwort erneut eingeben.",
        code: REAUTH_REQUIRED,
      });
    }

    // Informational only — nothing reads it to decide anything. It is what an
    // operator looks at when asking whether a window was used once or ten
    // times before it closed.
    await this.prisma.reauthToken.update({
      where: { id: row!.id },
      data: { usedAt: new Date() },
    });
  }

  /**
   * The gate, for operations that need it only sometimes.
   *
   * A privilege change needs the password again when it grants something
   * weighty — see `privilegeChangeNeedsReauth` — and not when it hands out
   * Viewer. Without a token the answer is `reauth_required` with a sentence
   * saying why, which the dashboard turns into the dialog and a retry; with
   * one, `require` checks it as always.
   */
  async requireIf(
    needed: boolean,
    userId: string,
    token: string | undefined,
    reason = "Diese Änderung vergibt weitreichende Rechte. Bitte bestätigen Sie sie mit Ihrem Passwort.",
  ): Promise<void> {
    if (!needed) return;
    if (!token) throw new ForbiddenException({ message: reason, code: REAUTH_REQUIRED });
    await this.require(userId, token);
  }

  /**
   * Closes every window this account has.
   *
   * Called wherever the sessions go — a password change, a sign-out
   * everywhere, an administrator revoking an account. Those are precisely the
   * moments where "the same person is still there" stops being something the
   * server may assume, and a surviving window would be a standing capability
   * to disable a second factor issued to whoever came before.
   */
  async closeAll(userId: string): Promise<void> {
    await this.prisma.reauthToken.deleteMany({ where: { userId } });
  }
}
