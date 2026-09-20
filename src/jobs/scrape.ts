/**
 * One scrape tick: pick the stalest due source, fetch + normalize through its
 * adapter, diff against what that source told us last time, write only changes,
 * re-apply curated overrides, record the run, republish the dataset.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '~db/schema.ts';
import type { Meeting, Source } from '~db/schema.ts';
import { sha256, slugify, stableId } from '~/lib/normalize.ts';
import { BYDAY, isValidTimeZone } from '~/lib/time.ts';
import { HHMM } from '~/lib/normalize.ts';
import { publishDataset } from './publish.ts';
import { ADAPTERS } from './sources/index.ts';
import type { NormalizedMeeting, ReviewItem } from './sources/types.ts';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface ScrapeSummary {
  runId: string;
  sourceId: string;
  status: string;
  fetched: number;
  added: number;
  changed: number;
  missing: number;
  review: number;
  error?: string;
}

const nowIso = () => new Date().toISOString();
const tsmlUpdated = () => nowIso().slice(0, 19).replace('T', ' ');

/** Pick the source most overdue for a run. Returns null when nothing is due. */
export async function pickDueSource(db: Db, now = new Date()): Promise<Source | null> {
  const candidates = await db.select().from(schema.sources).where(and(eq(schema.sources.enabled, 1), sql`${schema.sources.adapter} != 'manual'`));
  const due = candidates
    .filter((s) => !s.lastRunAt || new Date(s.lastRunAt).getTime() + s.cadenceHours * 3600000 <= now.getTime())
    .sort((a, b) => (a.lastRunAt ?? '').localeCompare(b.lastRunAt ?? ''));
  return due[0] ?? null;
}

export async function runScrape(env: Env, opts: { sourceId?: string; fetchImpl?: typeof fetch; force?: boolean } = {}): Promise<ScrapeSummary | null> {
  const db = drizzle(env.DB, { schema });
  const now = new Date();
  let source: Source | null;
  if (opts.sourceId) source = (await db.select().from(schema.sources).where(eq(schema.sources.id, opts.sourceId)).get()) ?? null;
  else source = await pickDueSource(db, now);
  if (!source) return null;
  const adapter = ADAPTERS[source.adapter];
  if (!adapter) return null;

  const runId = await stableId(`run|${source.id}|${now.toISOString()}`);
  const logs: string[] = [];
  await db.insert(schema.scrapeRuns).values({ id: runId, sourceId: source.id, startedAt: nowIso(), status: 'running' });
  const finish = async (patch: Partial<typeof schema.scrapeRuns.$inferInsert>) => {
    await db.batch([
      db.update(schema.scrapeRuns).set({ finishedAt: nowIso(), ...patch }).where(eq(schema.scrapeRuns.id, runId)),
      db.update(schema.sources).set({ lastRunAt: nowIso(), ...(patch.status === 'ok' || patch.status === 'partial' ? { lastSuccessAt: nowIso() } : {}) }).where(eq(schema.sources.id, source!.id)),
    ]);
  };

  let result;
  try {
    result = await adapter.run(source, {
      fetch: opts.fetchImpl ?? ((input, init) => fetch(input, init)),
      secrets: { TEAMUP_TOKEN: env.TEAMUP_TOKEN },
      now,
      log: (m) => logs.push(m),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish({ status: 'failed', error: error.slice(0, 1000), diffJson: JSON.stringify({ logs }) });
    return { runId, sourceId: source.id, status: 'failed', fetched: 0, added: 0, changed: 0, missing: 0, review: 0, error };
  }
  if (!result) {
    await finish({ status: 'ok', fetched: 0, added: 0, changed: 0, missing: 0 });
    return { runId, sourceId: source.id, status: 'ok', fetched: 0, added: 0, changed: 0, missing: 0, review: 0 };
  }

  const valid = result.meetings.filter((m) => validate(m));
  const invalid = result.meetings.length - valid.length;
  if (invalid) logs.push(`${invalid} records failed validation`);

  // A source that suddenly returns nothing is far more likely broken than emptied.
  if (valid.length === 0 && result.fetched > 0) {
    await finish({ status: 'failed', fetched: result.fetched, error: 'source returned records but none were usable', diffJson: JSON.stringify({ logs }) });
    return { runId, sourceId: source.id, status: 'failed', fetched: result.fetched, added: 0, changed: 0, missing: 0, review: result.review.length, error: 'no usable records' };
  }

  const diff = await applyNormalized(db, source, valid, now);
  await queueReview(db, source, result.review);

  const status = result.review.length || invalid ? 'partial' : 'ok';
  await finish({
    status,
    fetched: result.fetched,
    added: diff.added.length,
    changed: diff.changed.length,
    missing: diff.missing.length,
    diffJson: JSON.stringify({ added: diff.added.slice(0, 200), changed: diff.changed.slice(0, 200), missing: diff.missing.slice(0, 200), review: result.review.length, logs }),
  });
  if (diff.added.length || diff.changed.length || diff.missing.length) await publishDataset(env);
  if (env.HEALTHCHECK_URL) fetch(env.HEALTHCHECK_URL, { method: 'POST', body: `${source.id}: +${diff.added.length} ~${diff.changed.length} -${diff.missing.length}` }).catch(() => {});
  return { runId, sourceId: source.id, status, fetched: result.fetched, added: diff.added.length, changed: diff.changed.length, missing: diff.missing.length, review: result.review.length };
}

function validate(m: NormalizedMeeting): boolean {
  if (!m.name || m.name.length > 200) return false;
  if (!Number.isInteger(m.day) || m.day < 0 || m.day > 6) return false;
  if (!HHMM.test(m.time)) return false;
  if (!isValidTimeZone(m.timezone)) return false;
  if (m.conferenceUrl && !/^https?:\/\//.test(m.conferenceUrl)) return false;
  return Boolean(m.conferenceUrl || m.conferencePhone);
}

interface DiffEntry {
  id: string;
  name: string;
  day: number;
  time: string;
  fields?: string[];
}

interface ApplyResult {
  added: DiffEntry[];
  changed: DiffEntry[];
  missing: DiffEntry[];
}

/** The meetings columns an adapter is allowed to write. Everything else is ours. */
function columnsFor(m: NormalizedMeeting): Partial<Meeting> {
  const provider = m.conferenceUrl ? (/zoom\.us/.test(m.conferenceUrl) ? 'zoom' : /meet\.google/.test(m.conferenceUrl) ? 'meet' : 'other') : m.conferencePhone ? 'phone' : null;
  return {
    name: m.name,
    day: m.day,
    time: m.time,
    endTime: m.endTime ?? null,
    timezone: m.timezone,
    tzConfidence: 'source',
    rrule: m.rrule ?? null,
    typesJson: JSON.stringify([...new Set(m.types)].sort()),
    conferenceUrl: m.conferenceUrl ?? null,
    conferenceUrlNotes: m.conferenceUrlNotes ?? null,
    conferencePhone: m.conferencePhone ?? null,
    conferencePhoneNotes: m.conferencePhoneNotes ?? null,
    conferenceProvider: provider,
    linkKind: m.conferenceUrl ? 'V' : 'P',
    notes: m.notes ?? null,
    groupName: m.groupName ?? null,
    url: m.url ?? null,
  };
}

const COMPARE_KEYS: Array<keyof Meeting> = ['name', 'day', 'time', 'endTime', 'timezone', 'typesJson', 'conferenceUrl', 'conferenceUrlNotes', 'conferencePhone', 'conferencePhoneNotes', 'notes', 'groupName', 'url', 'rrule'];

async function applyNormalized(db: Db, source: Source, records: NormalizedMeeting[], now: Date): Promise<ApplyResult> {
  const out: ApplyResult = { added: [], changed: [], missing: [] };
  const seenAt = now.toISOString();
  const existing = new Map((await db.select().from(schema.meetingSources).where(eq(schema.meetingSources.sourceId, source.id))).map((r) => [r.sourceKey, r]));
  const fellowshipMeetings = await db.select().from(schema.meetings).where(eq(schema.meetings.fellowship, source.fellowship));
  const byId = new Map(fellowshipMeetings.map((m) => [m.id, m]));
  const slugs = new Set(fellowshipMeetings.map((m) => m.slug));
  const seenKeys = new Set<string>();
  const touched = new Set<string>();
  const stmts: any[] = [];
  const flush = async () => {
    while (stmts.length) {
      const chunk = stmts.splice(0, 40);
      await db.batch(chunk as [any, ...any[]]);
    }
  };

  for (const rec of records) {
    seenKeys.add(rec.sourceKey);
    const hash = await sha256(JSON.stringify(rec));
    const prov = existing.get(rec.sourceKey);
    const cols = columnsFor(rec);

    if (prov && byId.has(prov.meetingId)) {
      const m = byId.get(prov.meetingId)!;
      if (prov.rawHash !== hash) {
        const fields = COMPARE_KEYS.filter((k) => (cols as any)[k] !== undefined && (cols as any)[k] !== (m as any)[k]);
        stmts.push(db.update(schema.meetings).set({ ...cols, status: 'active', lastSeenAt: seenAt, updated: tsmlUpdated() }).where(eq(schema.meetings.id, m.id)));
        stmts.push(db.update(schema.meetingSources).set({ rawHash: hash, rawJson: JSON.stringify(rec), seenAt }).where(and(eq(schema.meetingSources.sourceId, source.id), eq(schema.meetingSources.sourceKey, rec.sourceKey))));
        out.changed.push({ id: m.id, name: rec.name, day: rec.day, time: rec.time, fields });
        touched.add(m.id);
      } else if (m.status !== 'active') {
        stmts.push(db.update(schema.meetings).set({ status: 'active', lastSeenAt: seenAt }).where(eq(schema.meetings.id, m.id)));
        stmts.push(db.update(schema.meetingSources).set({ seenAt }).where(and(eq(schema.meetingSources.sourceId, source.id), eq(schema.meetingSources.sourceKey, rec.sourceKey))));
      } else {
        stmts.push(db.update(schema.meetingSources).set({ seenAt }).where(and(eq(schema.meetingSources.sourceId, source.id), eq(schema.meetingSources.sourceKey, rec.sourceKey))));
      }
      continue;
    }

    // New key for this source: adopt an existing meeting when it is clearly the same one.
    const match = fuzzyMatch(fellowshipMeetings, rec);
    if (match) {
      stmts.push(db.update(schema.meetings).set({ ...cols, status: 'active', lastSeenAt: seenAt, updated: tsmlUpdated() }).where(eq(schema.meetings.id, match.id)));
      stmts.push(db.insert(schema.meetingSources).values({ meetingId: match.id, sourceId: source.id, sourceKey: rec.sourceKey, rawHash: hash, rawJson: JSON.stringify(rec), seenAt }).onConflictDoNothing());
      out.changed.push({ id: match.id, name: rec.name, day: rec.day, time: rec.time, fields: ['adopted'] });
      touched.add(match.id);
      continue;
    }

    const id = await stableId(`${source.id}|${rec.sourceKey}`);
    let slug = `${source.fellowship.toLowerCase()}-${slugify(rec.name)}-${BYDAY[rec.day].toLowerCase()}-${rec.time.replace(':', '')}`;
    let n = 2;
    while (slugs.has(slug)) slug = `${slug}-${n++}`;
    slugs.add(slug);
    const row: Meeting = {
      ...(cols as Required<typeof cols>),
      id,
      slug,
      fellowship: source.fellowship,
      language: 'en',
      groupNotes: null,
      formattedAddress: null,
      latitude: null,
      longitude: null,
      region: null,
      approximate: null,
      status: 'active',
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      updated: tsmlUpdated(),
    } as Meeting;
    stmts.push(db.insert(schema.meetings).values(row).onConflictDoNothing());
    stmts.push(db.insert(schema.meetingSources).values({ meetingId: id, sourceId: source.id, sourceKey: rec.sourceKey, rawHash: hash, rawJson: JSON.stringify(rec), seenAt }).onConflictDoNothing());
    byId.set(id, row);
    fellowshipMeetings.push(row);
    out.added.push({ id, name: rec.name, day: rec.day, time: rec.time });
    touched.add(id);
    if (stmts.length >= 80) await flush();
  }
  await flush();

  // Keys this source used to report but did not this time: missing after ~2 cadences, retired after ~4.
  const cadenceMs = Math.max(1, source.cadenceHours) * 3600000;
  for (const [key, prov] of existing) {
    if (seenKeys.has(key)) continue;
    const m = byId.get(prov.meetingId);
    if (!m || m.status === 'retired') continue;
    const age = now.getTime() - new Date(prov.seenAt).getTime();
    const next = age >= 4 * cadenceMs ? 'retired' : age >= 2 * cadenceMs ? 'missing' : null;
    if (next && next !== m.status) {
      stmts.push(db.update(schema.meetings).set({ status: next }).where(eq(schema.meetings.id, m.id)));
      out.missing.push({ id: m.id, name: m.name, day: m.day ?? 0, time: m.time ?? '', fields: [next] });
    }
  }
  await flush();

  await applyOverrides(db, [...touched]);
  return out;
}

function fuzzyMatch(pool: Meeting[], rec: NormalizedMeeting): Meeting | null {
  const zoomId = rec.conferenceUrl ? /\/j\/(\d+)/.exec(rec.conferenceUrl)?.[1] : null;
  if (zoomId) {
    const hit = pool.find((m) => m.day === rec.day && m.conferenceUrl && m.conferenceUrl.includes(`/j/${zoomId}`));
    if (hit) return hit;
  }
  const name = rec.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return pool.find((m) => m.day === rec.day && m.time === rec.time && m.timezone === rec.timezone && m.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === name) ?? null;
}

const OVERRIDABLE: Record<string, keyof Meeting> = {
  types_json: 'typesJson',
  notes: 'notes',
  name: 'name',
  timezone: 'timezone',
  conference_url: 'conferenceUrl',
  conference_url_notes: 'conferenceUrlNotes',
  status: 'status',
  group_name: 'groupName',
};

/** Curated values always win. Called for every meeting a scrape touched. */
export async function applyOverrides(db: Db, meetingIds: string[]): Promise<number> {
  let applied = 0;
  for (let i = 0; i < meetingIds.length; i += 90) {
    const ids = meetingIds.slice(i, i + 90);
    const rows = await db.select().from(schema.overrides).where(inArray(schema.overrides.meetingId, ids));
    const byMeeting = new Map<string, Partial<Meeting>>();
    for (const o of rows) {
      const col = OVERRIDABLE[o.field];
      if (!col) continue;
      let value: unknown = null;
      try {
        value = o.value === null ? null : JSON.parse(o.value);
      } catch {
        continue;
      }
      if (col === 'typesJson' && Array.isArray(value)) {
        // Merge: curated tags are added to whatever the source says, never replacing it.
        const cur = byMeeting.get(o.meetingId) ?? {};
        (cur as any).__mergeTypes = value;
        byMeeting.set(o.meetingId, cur);
        continue;
      }
      byMeeting.set(o.meetingId, { ...(byMeeting.get(o.meetingId) ?? {}), [col]: value });
    }
    if (!byMeeting.size) continue;
    const current = await db.select({ id: schema.meetings.id, typesJson: schema.meetings.typesJson }).from(schema.meetings).where(inArray(schema.meetings.id, [...byMeeting.keys()]));
    const stmts: any[] = [];
    for (const { id, typesJson } of current) {
      const patch = { ...byMeeting.get(id)! } as any;
      if (patch.__mergeTypes) {
        let base: string[] = [];
        try {
          base = JSON.parse(typesJson);
        } catch {
          /* ignore */
        }
        patch.typesJson = JSON.stringify([...new Set([...base, ...patch.__mergeTypes])].sort());
        delete patch.__mergeTypes;
      }
      stmts.push(db.update(schema.meetings).set(patch).where(eq(schema.meetings.id, id)));
      applied++;
    }
    while (stmts.length) await db.batch(stmts.splice(0, 40) as [any, ...any[]]);
  }
  return applied;
}

async function queueReview(db: Db, source: Source, items: ReviewItem[]): Promise<void> {
  const stmts: any[] = [];
  for (const item of items.slice(0, 50)) {
    const id = await stableId(`review|${source.id}|${item.reason}|${JSON.stringify(item.raw)}`);
    stmts.push(
      db
        .insert(schema.reviewQueue)
        .values({ id, sourceId: source.id, kind: 'scrape', proposedJson: JSON.stringify({ reason: item.reason, raw: item.raw }).slice(0, 8000), createdAt: nowIso() })
        .onConflictDoNothing(),
    );
  }
  while (stmts.length) await db.batch(stmts.splice(0, 40) as [any, ...any[]]);
}
