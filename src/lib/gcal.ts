import { BYDAY, zonedParts } from './time.ts';
import type { MeetingLite } from './types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Google Calendar "add event" URL for the next occurrence, as a weekly recurrence
 * anchored in the meeting's own timezone so Google renders it right for everyone.
 * Duration is assumed 60 minutes unless the source gave an end time (Phase 2).
 */
export function gcalUrl(m: MeetingLite, start: Date, durationMin = 60): string {
  const s = zonedParts(start, m.tz);
  const e = zonedParts(new Date(start.getTime() + durationMin * 60000), m.tz);
  const stamp = (p: ReturnType<typeof zonedParts>) => `${p.y}${pad(p.mo)}${pad(p.d)}T${pad(p.h)}${pad(p.mi)}00`;
  const clean = (v: string | null | undefined) => (v ?? '').replace(/[\r\n]+/g, ' ').trim();
  const details = [
    m.url ? `Join: ${clean(m.url)}` : '',
    m.phone ? `Dial: ${clean(m.phoneNotes ?? m.phone)}` : '',
    clean(m.urlNotes),
    m.listing ? `Listing: ${clean(m.listing)}` : '',
    'via doublewinners.org',
  ]
    .filter(Boolean)
    .join('\n');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[${m.f}] ${clean(m.name)}`,
    dates: `${stamp(s)}/${stamp(e)}`,
    ctz: m.tz,
    details,
    location: clean(m.url ?? m.phoneNotes ?? m.phone ?? ''),
    recur: `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[m.day]}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}
