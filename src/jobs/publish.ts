/**
 * Read every active meeting from D1, build the client dataset, write it to KV.
 * Runs after each scrape (Phase 2) and on demand from POST /api/publish.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '~db/schema.ts';
import { buildDataset, toFellowshipLite, toLite } from '~/lib/dataset.ts';
import { KV_CURRENT } from '~/lib/data.ts';
import type { Dataset } from '~/lib/types.ts';

export async function publishDataset(env: Env): Promise<Dataset> {
  const db = drizzle(env.DB, { schema });
  const [fellowships, meetings, health] = await Promise.all([
    db.select().from(schema.fellowships).where(eq(schema.fellowships.active, 1)).orderBy(schema.fellowships.sortOrder),
    db.select().from(schema.meetings).where(eq(schema.meetings.status, 'active')),
    db.select({ id: schema.linkHealth.meetingId, verdict: schema.linkHealth.verdict }).from(schema.linkHealth),
  ]);
  const healthById = new Map(health.map((h) => [h.id, h.verdict]));
  const ds = await buildDataset(
    fellowships.map(toFellowshipLite),
    meetings.map((m) => toLite(m, healthById.get(m.id) ?? null)),
  );
  const body = JSON.stringify(ds);
  await Promise.all([
    env.KV.put(KV_CURRENT, body),
    env.KV.put(`dataset:${ds.hash}`, body, { expirationTtl: 60 * 60 * 24 * 30 }),
  ]);
  return ds;
}
