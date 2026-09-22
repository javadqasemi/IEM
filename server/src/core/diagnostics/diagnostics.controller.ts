import { Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, RequirePermissions, type AuthUser } from "../../common/decorators";
import { AuditService } from "../audit/audit.service";
import { DiagnosticsService } from "./diagnostics.service";

/**
 * *Diagnose ausführen* — one button, eight checks.
 *
 * ---
 *
 * ## `POST`, not `GET`
 *
 * Three of the checks open a connection to something outside the process and
 * one writes a file. That is not a read, whatever the response looks like, and
 * a `GET` is the thing a browser prefetches, a proxy caches and a monitoring
 * tool polls — every one of which would turn this into an SMTP handshake per
 * page view.
 *
 * ## `system.health`, and deliberately no key of its own
 *
 * Minting `system.diagnostics` was the alternative and it would have been a
 * checkbox nobody could meaningfully withhold: every effect here is
 * self-contained and reversible, the route is throttled, and the run is
 * audited. The repository already records the shape of that mistake twice —
 * `user.readMfa`, and the four backup keys the brief proposed — a permission
 * whose removal changes nothing a reader could notice.
 *
 * What *is* separated is the operating: retrying a job is `job.retry`, taking
 * a backup is `system.backup`, replacing the database is `system.restore`.
 *
 * ## Throttled, because it reaches a third party
 *
 * Three a minute, the same budget `POST /settings/mail/verify` carries and for
 * the same reason: the mail check opens a real connection to somebody else's
 * server, and a page with a button on it must not be a way to knock on that
 * door as fast as a browser can repeat a request. `ThrottlerGuard` keys by
 * class and handler, so this is its own bucket and does not spend the settings
 * screen's.
 */
@Controller("diagnostics")
export class DiagnosticsController {
  constructor(
    private readonly diagnostics: DiagnosticsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermissions("system.health")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async run(@CurrentUser() user: AuthUser) {
    const run = await this.diagnostics.run();

    /*
      Audited, and this is the line the brief draws: *"audit manual diagnostic
      runs only if they have operational/security significance"*.

      A health *read* is not recorded — flooding the log with page views is how
      the log stops being readable. A diagnostics run is: it opened a
      connection to the firm's mail server, wrote to the backup volume, and did
      so because a named person pressed a button. That is an outbound action
      with an actor, which is exactly what the log is for.

      Recorded directly rather than through an event, for the reason CLAUDE.md
      gives: nothing reacts to it, and there is no before and no after.
    */
    await this.audit.record({
      actor: user,
      action: "system.diagnostics_run",
      resource: "system",
      outcome: run.result === "FAIL" ? "FAILURE" : "SUCCESS",
      after: {
        result: run.result,
        durationMs: run.durationMs,
        // The results only — the detail sentences are already sanitized, and
        // copying eight of them into every audit row would bury the log.
        checks: run.checks.map((c) => ({ key: c.key, result: c.result })),
      },
      message: `Diagnose ausgeführt: ${run.result}.`,
    });

    return run;
  }
}
