/**
 * Teamup calendars (SLAA Virtual, ACA). Needs a free API key (TEAMUP_TOKEN) and a
 * shareable read-only calendar key. Instances inside an 8-day window are grouped
 * by (series, weekday) into weekly rules, which handles daily and BYDAY series.
 */
import { zonedParts } from '~/lib/time.ts';
import { extractConference, parseConferenceUrl, parsePhone } from '~/lib/normalize.ts';
import { sourceConfig, type AdapterContext, type AdapterResult, type NormalizedMeeting, type ReviewItem, type SourceAdapter } from './types.ts';
import type { Source } from '~db/schema.ts';

export interface TeamupEvent {
  id: string;
  series_id?: number | null;
  title?: string;
  notes?: string | null;
  location?: string | null;
  start_dt: string; // RFC 3339 with offset
  end_dt?: string;
  all_day?: boolean;
  rrule?: string | null;
  tz?: string | null;
  subcalendar_ids?: number[];
}

interface Config extends Record<string, unknown> {
  calendarKey?: string;
  subcalendarIds?: number[];
  feedUrl?: string; // fixture override
  listingUrl?: string;
}

export function normalizeTeamup(events: TeamupEvent[], defaultTz: string | null, listingUrl: string | null): { meetings: NormalizedMeeting[]; review: ReviewItem[] } {
  const meetings: NormalizedMeeting[] = [];
  const review: ReviewItem[] = [];
  const seen = new Map<string, string>();
  for (const ev of events) {
    if (ev.all_day) continue;
    const seriesKey = ev.series_id ?? ev.id.split('-rid-')[0];
    const tz = ev.tz || defaultTz;
    if (!tz) {
      review.push({ reason: 'no timezone', raw: ev });
      continue;
    }
    const rr = (ev.rrule ?? '').toUpperCase();
    if (rr && !/FREQ=(WEEKLY|DAILY)/.test(rr)) {
      review.push({ reason: `non-weekly recurrence ${rr}`, raw: ev });
      continue;
    }
    if (/INTERVAL=([2-9]|\d{2,})/.test(rr)) {
      review.push({ reason: `interval recurrence ${rr}`, raw: ev });
      continue;
    }
    let start: Date;
    try {
      start = new Date(ev.start_dt);
      if (Number.isNaN(start.getTime())) throw new Error('bad date');
    } catch {
      review.push({ reason: 'unparseable start_dt', raw: ev });
      continue;
    }
    const p = zonedParts(start, tz);
    const key = `teamup:${seriesKey}:${p.dow}`;
    const time = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
    const prior = seen.get(key);
    if (prior !== undefined) {
      // Same series, same weekday, different start: the key cannot hold both, and
      // silently keeping the first would hide a real meeting. Surface it instead.
      if (prior !== time) review.push({ reason: `two starts for one series on the same weekday (${prior} and ${time})`, raw: ev });
      continue;
    }
    seen.set(key, time);
    const title = (ev.title ?? '').trim();
    if (!title) {
      review.push({ reason: 'missing title', raw: ev });
      continue;
    }
    const found = extractConference(`${ev.notes ?? ''}\n${ev.location ?? ''}`);
    const url = parseConferenceUrl(found.url);
    const phone = parsePhone(found.phone);
    if (!url.conferenceUrl && !phone.tel) {
      review.push({ reason: 'no join link in notes', raw: ev });
      continue;
    }
    let endTime: string | null = null;
    if (ev.end_dt) {
      const e = zonedParts(new Date(ev.end_dt), tz);
      endTime = `${String(e.h).padStart(2, '0')}:${String(e.mi).padStart(2, '0')}`;
    }
    meetings.push({
      sourceKey: key,
      name: title,
      day: p.dow,
      time,
      endTime,
      timezone: tz,
      types: [],
      conferenceUrl: url.conferenceUrl,
      conferenceUrlNotes: found.passcode ? `passcode ${found.passcode}` : url.mangledPasscode ? 'passcode may be case-mangled upstream' : null,
      conferencePhone: phone.tel,
      conferencePhoneNotes: phone.notes,
      notes: null,
      url: listingUrl,
      rrule: ev.rrule ?? null,
    });
  }
  return { meetings, review };
}

export const teamup: SourceAdapter = {
  id: 'teamup',
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = sourceConfig<Config>(source);
    let url = cfg.feedUrl;
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'DoubleWinnersBot/1.0 (+https://doublewinners.org/about)' };
    if (!url) {
      if (!cfg.calendarKey) throw new Error('teamup: config.calendarKey missing');
      if (!ctx.secrets.TEAMUP_TOKEN) throw new Error('teamup: TEAMUP_TOKEN secret not set');
      const d = (offset: number) => new Date(ctx.now.getTime() + offset * 86400000).toISOString().slice(0, 10);
      const q = new URLSearchParams({ startDate: d(0), endDate: d(7), format: 'markdown' });
      for (const id of cfg.subcalendarIds ?? []) q.append('subcalendarId[]', String(id));
      url = `https://api.teamup.com/${cfg.calendarKey}/events?${q}`;
      headers['Teamup-Token'] = ctx.secrets.TEAMUP_TOKEN;
    }
    const res = await ctx.fetch(url, { headers });
    if (!res.ok) throw new Error(`teamup: ${res.status} from ${url.replace(/\/ks[\w]+\//, '/<key>/')}`);
    const body = (await res.json()) as { events?: TeamupEvent[] };
    const events = body.events ?? [];
    ctx.log(`teamup: ${events.length} event instances`);
    const { meetings, review } = normalizeTeamup(events, source.defaultTz, cfg.listingUrl ?? source.url);
    return { meetings, review, fetched: events.length };
  },
};
