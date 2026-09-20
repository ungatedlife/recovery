import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq, sql } from 'drizzle-orm';
import * as schema from '~db/schema.ts';
import { bootstrap } from '~/jobs/bootstrap.ts';
import { runLinkHealth } from '~/jobs/link-health.ts';
import { publishDataset } from '~/jobs/publish.ts';
import { runRetention } from '~/jobs/retention.ts';
import { runScrape } from '~/jobs/scrape.ts';
import { getDb } from '~/lib/db.ts';
import { requireSameOrigin } from '~/lib/guard.ts';

/** POST /api/admin/action (form) — every button on /admin. Access-gated by middleware. */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.admin) return new Response('forbidden', { status: 403 });
  const refused = requireSameOrigin(request, { json: false });
  if (refused) return refused;
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const db = getDb();
  const e = env as Env;
  let msg: string;
  try {
    switch (action) {
      case 'publish': {
        const ds = await publishDataset(e);
        msg = `published ${ds.meetings.length} meetings (${ds.hash})`;
        break;
      }
      case 'bootstrap': {
        const b = await bootstrap(e);
        if (b.seeded) await publishDataset(e);
        msg = b.seeded ? 'seeded the catalog from the bundled legacy data and published' : 'catalog already populated; reference rows refreshed';
        break;
      }
      case 'link-health': {
        const r = await runLinkHealth(e);
        msg = `checked ${r.checked} links, ${r.failing} failing`;
        break;
      }
      case 'retention': {
        msg = `retention: ${JSON.stringify(await runRetention(e))}`;
        break;
      }
      case 'run': {
        const sourceId = String(form.get('source') ?? '');
        const r = await runScrape(e, { sourceId, force: true });
        msg = r ? `${r.sourceId}: ${r.status}, fetched ${r.fetched}, +${r.added} ~${r.changed} −${r.missing}, ${r.review} to review${r.error ? ` — ${r.error}` : ''}` : 'no such source';
        break;
      }
      case 'toggle': {
        const sourceId = String(form.get('source') ?? '');
        await db.update(schema.sources).set({ enabled: sql`1 - ${schema.sources.enabled}` }).where(eq(schema.sources.id, sourceId));
        msg = `toggled ${sourceId}`;
        break;
      }
      case 'review': {
        const id = String(form.get('id') ?? '');
        const resolution = form.get('resolution') === 'accepted' ? 'accepted' : 'rejected';
        await db.update(schema.reviewQueue).set({ resolvedAt: new Date().toISOString(), resolution }).where(eq(schema.reviewQueue.id, id));
        msg = `${resolution} ${id}`;
        break;
      }
      default:
        msg = 'unknown action';
    }
  } catch (err) {
    msg = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return redirect(`/admin?msg=${encodeURIComponent(msg.slice(0, 300))}`, 303);
};
