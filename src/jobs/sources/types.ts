import type { Source } from '~db/schema.ts';

/** TSML-shaped record every adapter produces. One per (meeting, weekday). */
export interface NormalizedMeeting {
  sourceKey: string; // stable per source: 'tsml:123', 'teamup:456:2', ...
  name: string;
  day: number; // 0 = Sunday
  time: string; // 'HH:MM'
  endTime?: string | null;
  timezone: string; // IANA
  types: string[]; // TSML codes
  conferenceUrl?: string | null;
  conferenceUrlNotes?: string | null;
  conferencePhone?: string | null;
  conferencePhoneNotes?: string | null;
  notes?: string | null;
  url?: string | null; // official listing page
  groupName?: string | null;
  rrule?: string | null;
}

export interface ReviewItem {
  reason: string;
  raw: unknown;
}

export interface AdapterContext {
  fetch: typeof fetch;
  secrets: { TEAMUP_TOKEN?: string };
  now: Date;
  log: (msg: string) => void;
}

export interface AdapterResult {
  meetings: NormalizedMeeting[];
  review: ReviewItem[];
  fetched: number;
}

export interface SourceAdapter {
  id: string;
  /** Fetch and normalize. Return null to say "this source is not scraped" (manual). */
  run(source: Source, ctx: AdapterContext): Promise<AdapterResult | null>;
}

export function sourceConfig<T extends Record<string, unknown>>(source: Source): T {
  try {
    return JSON.parse(source.configJson || '{}') as T;
  } catch {
    return {} as T;
  }
}
