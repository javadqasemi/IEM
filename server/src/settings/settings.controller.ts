import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { Allow, IsArray, IsEmail, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { SettingsService, canManageSecrets } from "../core/settings/settings.service";
import { OrganisationService } from "../core/organisation/organisation.service";
import { MailService } from "../mail/mail.service";
import { MailStatusService } from "../mail/mail.status.service";
import { mailTemplateCatalogue, previewMailTemplate } from "../mail/mail.templates";
import type { MailVerifyResult } from "../mail/mail.provider";
import { EventBus } from "../core/events/event-bus";
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

class SettingUpdate {
  @IsString() key!: string;

  /**
   * `@Allow()` is load-bearing, not decoration.
   *
   * The global pipe runs with `whitelist: true`, which **strips every property
   * that carries no class-validator decorator**. This field had none, so `value`
   * was removed from each update before the service ever saw it. The service
   * then wrote `value: undefined`, which Prisma reads as "leave this column
   * alone" — so the endpoint answered 200, the audit log recorded
   * `settings.updated` with the key, and the value did not change. **The
   * settings page had never saved anything**, and it reported success while not
   * doing so, which is worse than an error.
   *
   * `@Allow()` rather than a real validator because the value genuinely is
   * arbitrary JSON — a string, a number, a boolean or an array, depending on
   * the key. **The shape is checked against the setting's own declaration in
   * `settings.rules.ts`**, which is where a per-key rule can live and a
   * decorator cannot.
   *
   * That sentence used to be here and was not true: nothing checked the shape
   * anywhere, and one unchecked value — `applications.retentionDays` — was
   * multiplied into a deletion deadline. A `0` there deleted every applicant
   * dossier received that day; a non-numeric one produced `new Date(NaN)` and
   * took the public application form down with a 500. The rules file exists
   * because of that; see the note at the top of it.
   *
   * This is the second time the whitelist trap has been sprung in this
   * codebase; the first is written up in CLAUDE.md against the content DTOs.
   * Undecorated fields do not fail loudly. They vanish.
   */
  @Allow() value!: unknown;
}

export class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingUpdate)
  updates!: SettingUpdate[];
}

/**
 * The only thing a caller may say about a test message.
 *
 * One optional address — **no subject, no body, no attachment**. That absence
 * is the design: with them this route would be an authenticated way to send
 * arbitrary mail from the firm's domain, and `settings.update` is a permission
 * several roles hold for reasons that have nothing to do with that.
 *
 * `@IsEmail` rather than a loose string, because an unvalidated recipient is
 * handed straight to the transport, where a malformed address produces a
 * provider error that reads as a broken configuration.
 */
export class TestMailDto {
  @IsOptional()
  @IsEmail({}, { message: "Die Empfängeradresse ist keine gültige E-Mail-Adresse." })
  to?: string;
}

@Controller("settings")
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly mailStatusService: MailStatusService,
    private readonly organisation: OrganisationService,
    private readonly config: ConfigService,
    private readonly events: EventBus,
  ) {}

  /** Where a preview's links point. The same value `MailService` renders with. */
  private get adminUrl(): string {
    return this.config.get<string>("ADMIN_URL") ?? "http://localhost:5173/admin.html";
  }

  @Get()
  @RequirePermissions("settings.read")
  list(@CurrentUser() user: AuthUser) {
    /*
      The flag says whether this caller may **manage** credentials, not whether
      they may see them (P2-4).

      Nobody sees them. `settings.secrets` used to hand the plaintext SMTP
      password back to anyone holding it, which is a credential travelling over
      the wire and into a browser's memory for no operational reason — knowing
      the password is not needed to replace it. What the flag now decides is
      whether the form draws the "replace" and "remove" controls, so somebody
      without the permission is not offered a button that would 403.
    */
    return this.settings.list(canManageSecrets(user));
  }

  /**
   * Clears a stored credential, deliberately.
   *
   * Its own route because no spelling of a blank field may destroy one — see
   * `classifySecretWrite`. `settings.secrets` rather than `settings.update`:
   * removing the SMTP password stops every notification e-mail in the firm,
   * which is a different authority from editing the port.
   */
  @Delete("secrets/:key")
  @RequirePermissions("settings.secrets")
  removeSecret(
    @Param("key") key: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.settings.removeSecret(key, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  @Patch()
  @RequirePermissions("settings.update")
  update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.settings.update(dto.updates, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  /* ================================================================ */
  /* E-Mail-Betrieb                                                    */
  /* ================================================================ */

  /**
   * The operational picture of the mail channel.
   *
   * `settings.read` rather than `system.health`: everything in it is the mail
   * *configuration* and what happened to it, which is what this screen is
   * about. `/dashboard/system` carries the one-word summary for the operator
   * who is looking at the whole installation, and it reads the same service —
   * two endpoints, one source, so they cannot disagree.
   */
  @Get("mail/status")
  @RequirePermissions("settings.read")
  mailStatus() {
    return this.mailStatusService.status();
  }

  /**
   * DNS, TCP, TLS and AUTH — **and no message**.
   *
   * The separation from `mail/test` is the point. An operator editing the SMTP
   * form presses this repeatedly, and a probe that put a message in somebody's
   * inbox every time would either be used once or train people to ignore the
   * inbox. It is also the only check that can be run against a configuration
   * whose sender address is not yet valid.
   *
   * Throttled like the send: it opens a real connection to a third party, and
   * a settings page does not need more than three a minute.
   */
  @Post("mail/verify")
  @RequirePermissions("settings.update")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  /*
    No `@CurrentUser()`, and that is the rule rather than an omission.

    A handler that only publishes an event needs no actor: `AuditListener`
    reads the actor, the IP and the user agent from `AsyncLocalStorage`, which
    is why `MailStatusService` can report who ran the last probe without this
    method ever naming them. A parameter here that nothing reads is the sign
    the event migration was done halfway — see the note in CLAUDE.md.
  */
  async verifyMail() {
    const result = await this.mail.verifyConnection();

    /*
      `mode` is what lets `MailStatusService` tell the two probes apart, and
      `category` is the **sanitized** classification — never the provider's own
      message. A raw SMTP error can name the host, the user and the AUTH
      mechanism, and the audit log is read by people who are not operators.
    */
    const record = {
      mode: "verify" as const,
      ok: result.status === "connected",
      category: result.status === "failed" ? result.failure.category : undefined,
      durationMs: result.status === "unconfigured" ? 0 : result.durationMs,
    };

    this.events.publish("MailTested", {
      entity: "setting",
      entityId: "mail",
      payload: record,
      /*
        The same object as `after`, and that is not redundancy.

        `payload` is what a *listener* receives; `after` is what `AuditListener`
        writes into the row. They are different fields on the envelope, and
        setting only the first is why the first version of this recorded two
        `mail.tested` rows with an empty `after` — the audit log is the storage
        `MailStatusService` reads back, so a payload that never lands there is
        a diagnostic nobody can see.
      */
      after: record,
      message: describeVerify(result),
    });

    return result;
  }

  /**
   * Sends the fixed diagnostic message.
   *
   * **The recipient may be named; the message may not.** That split is the
   * whole security argument, and it changed in P2-4 from "no recipient
   * parameter at all": an operator commissioning a server legitimately needs
   * to prove that mail reaches a colleague or a shared mailbox, not only
   * themselves. What keeps it from being an authenticated relay is that there
   * is no subject parameter, no body parameter and no attachment — the most
   * this endpoint can produce is one predetermined note from
   * `renderTestEmail`, three times a minute, from an account holding
   * `settings.update`.
   *
   * Defaults to the caller's own address, which is the safe and usual case.
   *
   * The outcome is announced whichever way it goes. Somebody debugging "mail
   * stopped working last Tuesday" wants the failures in the audit log, not
   * only the successes.
   */
  @Post("mail/test")
  @RequirePermissions("settings.update")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async testMail(@CurrentUser() user: AuthUser, @Body() dto: TestMailDto) {
    const to = dto.to?.trim() || user.email;
    const result = await this.mail.sendTest(to);

    const record = {
      mode: "send" as const,
      to,
      ok: result.ok,
      category: result.category,
      durationMs: result.durationMs,
    };

    this.events.publish("MailTested", {
      entity: "setting",
      entityId: "mail",
      payload: record,
      // See the note on the verify publish above: `after` is the field the
      // audit row keeps, and the audit row is what the status panel reads.
      after: record,
      message: result.stub
        ? "Kein SMTP-Server konfiguriert — die Nachricht wurde nur protokolliert."
        : result.ok
          ? `Testnachricht über ${result.host} an ${to} versendet (${result.durationMs} ms).`
          : `Test-Versand an ${to} fehlgeschlagen: ${result.error}`,
    });

    return { ...result, to };
  }

  /**
   * Every message the application can send, with the variables each carries.
   *
   * A catalogue rather than an editor. `mail.templates.ts` opens with the
   * argument; the short version is that a template is where a variable meets a
   * string, and both ways that goes wrong — a reference to something that does
   * not exist, and a convincing sentence beside a real link — are worse in a
   * system whose messages include "your second factor was removed".
   */
  @Get("mail/templates")
  @RequirePermissions("settings.read")
  mailTemplates() {
    return { items: mailTemplateCatalogue() };
  }

  /**
   * One template, rendered with sample values.
   *
   * **Sends nothing.** Previewing "Ihr zweiter Faktor wurde zurückgesetzt" by
   * mailing it would produce a security alert that is a lie, in the one
   * category of message where a false alarm costs the most.
   */
  @Get("mail/templates/:key/preview")
  @RequirePermissions("settings.read")
  async mailTemplatePreview(@Param("key") key: string) {
    const identity = await this.organisation.identity();
    const rendered = previewMailTemplate(key, identity.name, this.adminUrl);
    if (!rendered) throw new NotFoundException(`Unbekannte Vorlage „${key}“.`);
    return { key, ...rendered };
  }
}

/** The audit sentence for a connection test, in the one place it is written. */
function describeVerify(result: MailVerifyResult): string {
  if (result.status === "connected") {
    return `Verbindung zu ${result.describedAs} erfolgreich (${result.durationMs} ms).`;
  }
  if (result.status === "unconfigured") return result.reason;
  return `Verbindungstest fehlgeschlagen: ${result.failure.message}`;
}
