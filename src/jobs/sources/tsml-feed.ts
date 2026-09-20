/**
 * 12 Step Meeting List (TSML) WordPress plugin feed. Used by many fellowship
 * sites. Requires the site's sharing setting to be "open" or a sharing key.
 *   GET {site}/wp-json/tsml/meetings[?key=]        (3.18.2+)
 *   GET {site}/wp-admin/admin-ajax.php?action=meetings[&key=]
 */
import { isValidTimeZone } from '~/lib/time.ts';
import { normalizeTime, parseConferenceUrl, parsePhone } from '~/lib/normalize.ts';
import { sourceConfig, type AdapterContext, type AdapterResult, type NormalizedMeeting, type ReviewItem, type SourceAdapter } from './types.ts';
import type { Source } from '~db/schema.ts';

export interface TsmlRecord {
  id: number | string;
  name?: string;
  slug?: string;
  notes?: string;
  updated?: string;
  url?: string;
  day?: number | string | null;
  time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  types?: string[] | null;
  conference_url?: string | null;
  conference_url_notes?: string | null;
  conference_phone?: string | null;
  conference_phone_notes?: string | null;
  group?: string | null;
  group_notes?: string | null;
}

interface Config extends Record<string, unknown> {
  site?: string; // defaults to the origin of source.url
  key?: string;
  feedUrl?: string; // override everything (used by the fixture source in dev)
}

export function stripHtml(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<\/?(p|div|li|br|h\d|tr)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTsml(rec: TsmlRecord, defaultTz: string | null): NormalizedMeeting | ReviewItem {
  const name = (rec.name ?? '').trim();
  if (!name) return { reason: 'missing name', raw: rec };
  const day = rec.day === null || rec.day === undefined || rec.day === '' ? null : Number(rec.day);
  if (day === null || !Number.isInteger(day) || day < 0 || day > 6) return { reason: 'no weekday (appointment meeting?)', raw: rec };
  const time = normalizeTime(rec.time);
  if (!time) return { reason: 'unparseable time', raw: rec };
  const timezone = rec.timezone && isValidTimeZone(rec.timezone) ? rec.timezone : defaultTz;
  if (!timezone) return { reason: 'no timezone', raw: rec };
  const url = parseConferenceUrl(rec.conference_url);
  const phone = parsePhone(rec.conference_phone);
  if (!url.conferenceUrl && !phone.tel) return { reason: 'not an online meeting', raw: rec };
  const types = Array.isArray(rec.types) ? rec.types.filter((t): t is string => typeof t === 'string').map((t) => t.toUpperCase()) : [];
  const urlNotes = [rec.conference_url_notes, url.mangledPasscode ? 'passcode may be case-mangled upstream' : null].filter(Boolean).join(' — ') || null;
  return {
    sourceKey: `tsml:${rec.id}:${day}`,
    name,
    day,
    time,
    endTime: normalizeTime(rec.end_time),
    timezone,
    types,
    conferenceUrl: url.conferenceUrl,
    conferenceUrlNotes: urlNotes,
    conferencePhone: phone.tel,
    conferencePhoneNotes: rec.conference_phone_notes || phone.notes,
    notes: stripHtml(rec.notes).slice(0, 500) || null,
    url: rec.url ?? null,
    groupName: rec.group ?? null,
  };
}

export const tsmlFeed: SourceAdapter = {
  id: 'tsml-feed',
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = sourceConfig<Config>(source);
    const site = (cfg.site ?? new URL(source.url).origin).replace(/\/$/, '');
    const key = cfg.key ? `key=${encodeURIComponent(cfg.key)}` : '';
    const candidates = cfg.feedUrl ? [cfg.feedUrl] : [`${site}/wp-json/tsml/meetings${key ? `?${key}` : ''}`, `${site}/wp-admin/admin-ajax.php?action=meetings${key ? `&${key}` : ''}`];
    let records: TsmlRecord[] | null = null;
    let lastErr = '';
    for (const url of candidates) {
      try {
        const res = await ctx.fetch(url, { headers: { accept: 'application/json', 'user-agent': 'DoubleWinnersBot/1.0 (+https://doublewinners.org/about)' } });
        if (!res.ok) {
          lastErr = `${url} → ${res.status}`;
          continue;
        }
        const body = (await res.json()) as unknown;
        if (Array.isArray(body)) {
          records = body as TsmlRecord[];
          ctx.log(`tsml: ${records.length} records from ${url}`);
          break;
        }
        lastErr = `${url} → not an array`;
      } catch (e) {
        lastErr = `${url} → ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (!records) throw new Error(`no TSML feed found (${lastErr}); the site may need sharing=open or a key`);
    const meetings: NormalizedMeeting[] = [];
    const review: ReviewItem[] = [];
    for (const rec of records) {
      const n = normalizeTsml(rec, source.defaultTz);
      if ('reason' in n) {
        if (n.reason !== 'not an online meeting' && n.reason !== 'no weekday (appointment meeting?)') review.push(n);
      } else meetings.push(n);
    }
    return { meetings, review, fetched: records.length };
  },
};
