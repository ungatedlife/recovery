/**
 * Cron dispatcher. Expressions must match wrangler.jsonc character for character.
 *   CRON_SCRAPE     daily: bootstrap if empty, then scrape the stalest due source
 *   CRON_LINKS      six-hourly link health batch
 *   CRON_RETENTION  weekly retention
 */
import { bootstrap } from './bootstrap.ts';
import { runLinkHealth } from './link-health.ts';
import { publishDataset } from './publish.ts';
import { runRetention } from './retention.ts';
import { runScrape } from './scrape.ts';

export const CRON_SCRAPE = '17 9 * * *';
export const CRON_LINKS = '43 */6 * * *';
export const CRON_RETENTION = '5 4 * * 1';

export async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const started = Date.now();
  let summary: unknown;
  try {
    switch (controller.cron) {
      case CRON_LINKS:
        summary = await runLinkHealth(env);
        break;
      case CRON_RETENTION:
        summary = await runRetention(env);
        break;
      case CRON_SCRAPE:
      default: {
        const b = await bootstrap(env);
        if (b.seeded) await publishDataset(env);
        summary = { ...b, scrape: await runScrape(env) };
      }
    }
    console.log(JSON.stringify({ cron: controller.cron, ms: Date.now() - started, summary }));
  } catch (e) {
    console.error(JSON.stringify({ cron: controller.cron, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) }));
    throw e;
  }
}
