/**
 * Best-effort link checks. Catches dead hosts and gone pages, not dead Zoom
 * meetings (Zoom answers 200 for those). Sticky verdicts like needs-passcode
 * are kept. Runs on a batch of the stalest links each tick.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '~db/schema.ts';

const STICKY = new Set(['needs-passcode']);

export async function runLinkHealth(env: Env, opts: { limit?: number; fetchImpl?: typeof fetch } = {}): Promise<{ checked: number; failing: number }> {
  const db = drizzle(env.DB, { schema });
  const limit = opts.limit ?? 100;
  const rows = await db
    .select({ id: schema.meetings.id, url: schema.meetings.conferenceUrl, verdict: schema.linkHealth.verdict, failures: schema.linkHealth.consecutiveFailures, checkedAt: schema.linkHealth.checkedAt })
    .from(schema.meetings)
    .leftJoin(schema.linkHealth, eq(schema.linkHealth.meetingId, schema.meetings.id))
    .where(and(eq(schema.meetings.status, 'active'), isNotNull(schema.meetings.conferenceUrl)))
    .orderBy(sql`${schema.linkHealth.checkedAt} IS NOT NULL`, schema.linkHealth.checkedAt)
    .limit(limit);
  const f: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  let failing = 0;
  const results = await mapLimit(rows, 10, async (r) => {
    const v = await check(r.url!, f);
    const failed = v.verdict === 'dead-host' || v.verdict === 'dead';
    if (failed) failing++;
    const verdict = r.verdict && STICKY.has(r.verdict) && !failed ? r.verdict : v.verdict;
    return { id: r.id, url: r.url!, httpStatus: v.status, verdict, failures: failed ? (r.failures ?? 0) + 1 : 0 };
  });
  const now = new Date().toISOString();
  const stmts = results.map((x) =>
    db
      .insert(schema.linkHealth)
      .values({ meetingId: x.id, url: x.url, checkedAt: now, httpStatus: x.httpStatus, verdict: x.verdict, consecutiveFailures: x.failures })
      .onConflictDoUpdate({ target: schema.linkHealth.meetingId, set: { url: x.url, checkedAt: now, httpStatus: x.httpStatus, verdict: x.verdict, consecutiveFailures: x.failures } }),
  );
  while (stmts.length) await db.batch(stmts.splice(0, 40) as [any, ...any[]]);
  return { checked: results.length, failing };
}

type Verdict = { verdict: 'ok' | 'redirect' | 'dead' | 'dead-host' | 'unknown'; status: number | null };

async function check(url: string, f: typeof fetch): Promise<Verdict> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const res = await f(url, { method, redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'DoubleWinnersBot/1.0 (+https://doublewinners.org/about)' } });
    return res.status;
  };
  let v: Verdict;
  try {
    let status = await attempt('HEAD');
    if (status === 405 || status === 403 || status === 501) status = await attempt('GET');
    if (status >= 200 && status < 300) v = { verdict: 'ok', status };
    else if (status >= 300 && status < 400) v = { verdict: 'redirect', status };
    else if (status === 404 || status === 410) v = { verdict: 'dead', status };
    else v = { verdict: 'unknown', status };
  } catch {
    v = { verdict: 'dead-host', status: null };
  }
  return v;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}
