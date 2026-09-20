/**
 * Timezone math with no dependencies. Every meeting is a weekly rule
 * (day, 'HH:MM', IANA tz); this file turns that into a concrete next start
 * instant for a given `now`, correctly across DST in both the meeting's zone and
 * the viewer's zone. Intl only, so it runs identically in Workers and browsers.
 */

export interface CivilParts {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  dow: number; // 0 = Sunday
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Civil wall-clock parts of an instant in a zone. */
export function zonedParts(date: Date, tz: string): CivilParts {
  const o: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) o[p.type] = p.value;
  return {
    y: +o.year,
    mo: +o.month,
    d: +o.day,
    h: +o.hour % 24,
    mi: +o.minute,
    dow: DOW[o.weekday] ?? 0,
  };
}

/** Offset of `tz` from UTC at `date`, in minutes (New York summer = -240). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, date.getUTCSeconds());
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Convert a civil time in `tz` to an instant. Handles DST edges explicitly:
 * a time that exists twice (fall-back overlap) resolves to its first occurrence,
 * a time that never exists (spring-forward gap) shifts forward to the later offset,
 * which is what calendar apps do.
 */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  const a = new Date(guess - off1 * 60000);
  const off2 = tzOffsetMinutes(a, tz);
  if (off1 === off2) return a;
  const b = new Date(guess - off2 * 60000);
  const roundTrips = (x: Date) => {
    const p = zonedParts(x, tz);
    return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi;
  };
  const ra = roundTrips(a);
  const rb = roundTrips(b);
  if (ra && rb) return a < b ? a : b; // overlap: earlier instant
  if (ra) return a;
  if (rb) return b;
  return a > b ? a : b; // gap: later instant
}

export function parseHHMM(time: string): { h: number; mi: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`bad time ${time}`);
  return { h: +m[1], mi: +m[2] };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface NextStart {
  start: Date;
  /** Whole minutes until start. Zero or negative while the meeting is underway. */
  delta: number;
}

/**
 * Next start of a weekly meeting relative to `now`. A meeting that began no more
 * than `graceMin` minutes ago is still "now" (negative delta); anything older
 * rolls forward one week, with the offset recomputed for that week.
 */
export function nextStart(day: number, time: string, tz: string, now: Date, graceMin = 10): NextStart {
  const { h, mi } = parseHHMM(time);
  const today = zonedParts(now, tz);
  const dd = (day - today.dow + 7) % 7;
  const build = (plusDays: number): Date => {
    const c = new Date(Date.UTC(today.y, today.mo - 1, today.d + plusDays));
    return zonedTimeToUtc(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(), h, mi, tz);
  };
  let start = build(dd);
  let delta = minutesBetween(now, start);
  if (delta < -graceMin) {
    start = build(dd + 7);
    delta = minutesBetween(now, start);
  }
  return { start, delta };
}

/** Whole minutes from `from` to `to`, rounded up so a start 30 s away reads as 1 minute. */
export function minutesBetween(from: Date, to: Date): number {
  const v = Math.ceil((to.getTime() - from.getTime()) / 60000);
  return v === 0 ? 0 : v; // normalise -0
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** '13:05' -> '1:05pm' */
export function fmtHHMM(time: string): string {
  const { h, mi } = parseHHMM(time);
  return fmtHM(h, mi);
}

export function fmtHM(h: number, mi: number): string {
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(mi).padStart(2, '0')}${ap}`;
}

/** 'America/Los_Angeles' -> 'Los Angeles'. Good enough for the clock line. */
export function tzLabel(tz: string): string {
  const seg = tz.split('/').pop() ?? tz;
  return seg.replace(/_/g, ' ');
}

/** Add whole minutes to an 'HH:MM', wrapping and reporting day carry (-1, 0, +1). */
export function shiftHHMM(time: string, minutes: number): { time: string; dayCarry: number } {
  const { h, mi } = parseHHMM(time);
  const total = h * 60 + mi + minutes;
  const dayCarry = Math.floor(total / 1440);
  const t = ((total % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, dayCarry };
}
