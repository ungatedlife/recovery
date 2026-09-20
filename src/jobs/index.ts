/**
 * Cron dispatcher. Phase 0 ships the publish job only (run by hand from /api/publish).
 * Phase 2 adds scrape, link-health and retention keyed on the cron expression.
 */
import { publishDataset } from './publish.ts';

export async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
  switch (controller.cron) {
    case '17 9 * * *':
      // Phase 2: scrape the stalest source, then republish.
      await publishDataset(env);
      break;
    case '43 */6 * * *':
      // Phase 2: link health batch.
      break;
    case '5 4 * * 1':
      // Phase 1/2: retention.
      break;
    default:
      await publishDataset(env);
  }
}
