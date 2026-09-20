import { and, isNotNull, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '~db/schema.ts';
import { purgeInactive } from '~/lib/session.ts';

/** Weekly: idle anonymous users, expired sessions, old run logs, resolved review items. */
export async function runRetention(env: Env): Promise<Record<string, number>> {
  const db = drizzle(env.DB, { schema });
  const users = await purgeInactive(db as any, 180);
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const runs = await db.delete(schema.scrapeRuns).where(lt(schema.scrapeRuns.startedAt, cutoff)).returning({ id: schema.scrapeRuns.id });
  const reviews = await db.delete(schema.reviewQueue).where(and(isNotNull(schema.reviewQueue.resolvedAt), lt(schema.reviewQueue.resolvedAt, cutoff))).returning({ id: schema.reviewQueue.id });
  return { users: users.users, sessions: users.sessions, runs: runs.length, reviews: reviews.length };
}
