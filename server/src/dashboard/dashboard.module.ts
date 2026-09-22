import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { SystemOverviewService } from "./system-overview.service";

/**
 * The overview, the health endpoint and the System Control Center's read model.
 *
 * It reads across several domains, which is the one place that is legitimate —
 * a dashboard is a *view*, and a view over other modules is what `widgets/` is
 * on the client. It reads their tables and, for the three subsystems that
 * compute a verdict, calls the **same service their own screen calls**.
 *
 * **It had no service until P2-6**, and the note that stood here said why:
 * every figure was a count, and a layer that only forwarded counts would be
 * empty. `SystemOverviewService` earns one — precedence between subsystems,
 * named thresholds, and reasons an operator can act on are logic, and logic
 * inside a controller is logic no test can reach without HTTP.
 */
@Module({
  controllers: [DashboardController],
  providers: [SystemOverviewService],
})
export class DashboardModule {}