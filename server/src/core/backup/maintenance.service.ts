import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

/**
 * The write gate that closes while a restore is replacing the database.
 *
 * ---
 *
 * ## Why it is a process flag and not a settings row
 *
 * The obvious implementation is `site.maintenanceMode` — a setting that
 * already exists, declared `pending` and read by nothing. It is the wrong
 * mechanism for **this** use, and the reason is the thing being guarded: a
 * flag stored in the database cannot govern an operation that is *replacing
 * that database*. `pg_restore --clean` drops and recreates the `Setting` table
 * partway through, so a guard reading it would find the row missing, the table
 * missing, or — worst — the **restored** value, which is whatever the backup
 * happened to contain.
 *
 * So the gate lives in the process that is performing the restore, where it
 * cannot be overwritten by the restore.
 *
 * ## What that costs, stated rather than discovered
 *
 * **It governs one process.** A second API instance behind a load balancer
 * would not see the flag and would keep accepting writes into a database being
 * replaced underneath it. That is a real limitation of this implementation and
 * it is in `docs/BACKUP_RECOVERY_RUNBOOK.md` in as many words: an in-place
 * restore on a multi-instance deployment means stopping the other instances
 * first. Single-instance is this application's documented deployment shape
 * today — `RedisService` exists precisely because that is expected to change,
 * and when it does, this flag becomes a Redis key and `MaintenanceGuard` stays
 * exactly as it is.
 *
 * ## Reads stay open
 *
 * Deliberately. Somebody watching the restore needs the status endpoint to
 * answer, and a dashboard that goes blank mid-restore is how an operator
 * concludes the application has died and does something rash. What is refused
 * is mutation — see `MaintenanceGuard`.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private reason: string | null = null;
  private since: Date | null = null;

  begin(reason: string): void {
    this.reason = reason;
    this.since = new Date();
    this.logger.warn(`Schreibsperre aktiv: ${reason}`);
  }

  end(): void {
    if (this.reason) this.logger.log(`Schreibsperre aufgehoben (${this.reason}).`);
    this.reason = null;
    this.since = null;
  }

  get active(): boolean {
    return this.reason !== null;
  }

  status(): { active: boolean; reason: string | null; since: string | null } {
    return {
      active: this.active,
      reason: this.reason,
      since: this.since?.toISOString() ?? null,
    };
  }

  /**
   * Refuses a mutation while the gate is closed.
   *
   * 503 rather than 423 or 409: the request was fine and the server is
   * temporarily unable to handle it, which is exactly what 503 means and what a
   * client's retry logic already understands. `Retry-After` is deliberately not
   * set — a restore takes as long as it takes, and a number invented here would
   * be a promise nothing keeps.
   */
  assertWritable(): void {
    if (this.reason) {
      throw new ServiceUnavailableException(
        `Das System wird gerade wiederhergestellt (${this.reason}). ` +
          "Schreibende Zugriffe sind bis zum Abschluss gesperrt.",
      );
    }
  }
}

