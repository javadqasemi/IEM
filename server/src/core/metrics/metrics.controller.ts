import { Controller, Get } from "@nestjs/common";
import { RequirePermissions } from "../../common/decorators";
import { MetricsService } from "./metrics.service";

/**
 * Operational metrics, per module.
 *
 * **`system.health`, not a permission of its own**, and not `audit.read`
 * either. This is the same question `/dashboard/health` answers — is the system
 * behaving — asked per module rather than per process, so it belongs to whoever
 * is already allowed to ask it. A `metrics.read` key would be a permission
 * every operator holds and nobody else wants, which is the definition of noise
 * in a role editor.
 *
 * It is deliberately **separate from `/dashboard/*`**. The dashboard's figures
 * are for the person who just signed in — how many entries, how many drafts —
 * and are shaped for a screen. These are for somebody on call, are shaped for a
 * scrape, and name things an editor has no use for: p95, error rate, dead jobs.
 * One route serving both audiences ends up serving neither.
 */
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("modules")
  @RequirePermissions("system.health")
  async modules() {
    return {
      /**
       * Since when the in-memory figures have been accumulating.
       *
       * Stated rather than implied: latency, error rate and event counts live
       * in the process and reset with it, while records, audit and jobs come
       * from tables and do not. An operator reading "0 errors" needs to know
       * whether that is a quiet week or a deploy ten seconds ago.
       */
      since: this.metrics.startedAt.toISOString(),
      generatedAt: new Date().toISOString(),
      modules: await this.metrics.modules(),
    };
  }
}
