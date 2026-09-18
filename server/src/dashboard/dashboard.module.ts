import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";

/**
 * The overview and the health endpoint.
 *
 * A controller with no service: every figure it reports is a count or an
 * aggregate read straight from Prisma, and a service that only forwarded them
 * would be a layer with nothing in it.
 *
 * It reads across several domains, which is the one place that is legitimate —
 * a dashboard is a *view*, and a view over other modules is what `widgets/` is
 * on the client. It reads their tables and calls none of their services.
 */
@Module({
  controllers: [DashboardController],
})
export class DashboardModule {}