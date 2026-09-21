import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { MaintenanceService } from "./maintenance.service";

/**
 * Refuses mutations while a restore is replacing the database.
 *
 * ---
 *
 * ## Why it keys on the HTTP verb
 *
 * A guard that had to be added to every mutating route would be a guard that
 * is missing from the route somebody adds next month, and that route would be
 * the one writing into a half-restored database. The verb is the one property
 * every mutation shares and no read has, so the default is closed and a new
 * endpoint inherits the protection without anybody remembering it.
 *
 * ## The two exceptions, and why each is safe
 *
 * **Reads stay open**, which is deliberate: the person watching the restore
 * needs the status endpoint to answer, and a dashboard that goes blank
 * mid-restore is how an operator concludes the application has died.
 *
 * **`/auth/*` stays open.** Signing in is a `POST` and it writes a refresh
 * token, so the verb rule would refuse it — and locking the operator out of
 * the application during the operation they are supervising is precisely the
 * wrong moment for it. Those writes touch session tables, which the restore
 * replaces wholesale anyway; nothing is lost that was not already going.
 *
 * Global, registered in `AppModule`, in the same way `JwtAuthGuard` is.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly maintenance: MaintenanceService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.maintenance.active) return true;
    if (context.getType() !== "http") return true;

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
    if (request.path.startsWith("/api/v1/auth/")) return true;

    this.maintenance.assertWritable();
    return true;
  }
}

