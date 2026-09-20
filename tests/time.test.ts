import { describe, expect, it } from 'vitest';
import { fmtHHMM, nextStart, shiftHHMM, tzOffsetMinutes, zonedParts, zonedTimeToUtc } from '~/lib/time.ts';

const iso = (d: Date) => d.toISOString();

describe('tzOffsetMinutes', () => {
  it('knows Phoenix never shifts and New York does', () => {
    const jan = new Date('2026-01-15T12:00:00Z');
    const jul = new Date('2026-07-15T12:00:00Z');
    expect(tzOffsetMinutes(jan, 'America/Phoenix')).toBe(-420);
    expect(tzOffsetMinutes(jul, 'America/Phoenix')).toBe(-420);
    expect(tzOffsetMinutes(jan, 'America/New_York')).toBe(-300);
    expect(tzOffsetMinutes(jul, 'America/New_York')).toBe(-240);
    expect(tzOffsetMinutes(jul, 'Australia/Sydney')).toBe(600);
    expect(tzOffsetMinutes(jan, 'Australia/Sydney')).toBe(660);
  });
});

describe('zonedTimeToUtc', () => {
  it('converts civil times on both sides of the US fall-back', () => {
    // 2026-11-01 is the US fall-back date. 09:00 New York before = 13:00Z, after = 14:00Z.
    expect(iso(zonedTimeToUtc(2026, 10, 31, 9, 0, 'America/New_York'))).toBe('2026-10-31T13:00:00.000Z');
    expect(iso(zonedTimeToUtc(2026, 11, 1, 9, 0, 'America/New_York'))).toBe('2026-11-01T14:00:00.000Z');
  });
  it('resolves a spring-forward gap to the later offset', () => {
    // 2026-03-08 02:30 does not exist in New York. Accept 03:30 EDT (07:30Z).
    expect(iso(zonedTimeToUtc(2026, 3, 8, 2, 30, 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z');
  });
  it('handles London BST and midnight', () => {
    expect(iso(zonedTimeToUtc(2026, 7, 1, 0, 0, 'Europe/London'))).toBe('2026-06-30T23:00:00.000Z');
    expect(iso(zonedTimeToUtc(2026, 1, 1, 0, 0, 'Europe/London'))).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('nextStart', () => {
  // Thursday 2026-09-17 16:00 Phoenix = 23:00Z
  const now = new Date('2026-09-17T23:00:00Z');

  it('finds a meeting later today in its own zone', () => {
    const r = nextStart(4, '17:00', 'America/Phoenix', now);
    expect(r.delta).toBe(60);
    expect(iso(r.start)).toBe('2026-09-18T00:00:00.000Z');
  });
  it('keeps a meeting inside the join grace as "now"', () => {
    const r = nextStart(4, '15:55', 'America/Phoenix', now);
    expect(r.delta).toBe(-5);
  });
  it('rolls a meeting past the grace to next week', () => {
    const r = nextStart(4, '15:00', 'America/Phoenix', now);
    expect(r.delta).toBe(7 * 1440 - 60);
  });
  it('rounds a start 30 s away up to 1 minute, and 30 s ago to 0', () => {
    expect(nextStart(4, '16:01', 'America/Phoenix', new Date('2026-09-17T23:00:30Z')).delta).toBe(1);
    expect(nextStart(4, '16:00', 'America/Phoenix', new Date('2026-09-17T23:00:30Z')).delta).toBe(0);
  });
  it('computes a New York meeting for a viewer in Phoenix across the DST change', () => {
    // Sat 2026-10-31 12:00 Phoenix (19:00Z). Sunday 09:00 New York, still EDT on Nov 1? No: Nov 1 is fall-back day,
    // so 09:00 EST = 14:00Z. Delta from 19:00Z Sat = 19 h = 1140 min.
    const sat = new Date('2026-10-31T19:00:00Z');
    const r = nextStart(0, '09:00', 'America/New_York', sat);
    expect(iso(r.start)).toBe('2026-11-01T14:00:00.000Z');
    expect(r.delta).toBe(1140);
  });
  it('rolls forward across a DST change and recomputes the offset', () => {
    // Sun 2026-10-25 15:00Z. Meeting Sunday 09:00 New York already happened (13:00Z EDT).
    // Next week Sunday Nov 1 is EST, so 14:00Z, not 13:00Z.
    const r = nextStart(0, '09:00', 'America/New_York', new Date('2026-10-25T15:00:00Z'));
    expect(iso(r.start)).toBe('2026-11-01T14:00:00.000Z');
  });
  it('handles Sydney meetings for a US viewer, day boundary included', () => {
    // 2026-09-17T23:00Z is Friday 09:00 in Sydney. A Friday 10:00 Sydney meeting is in 60 min.
    const r = nextStart(5, '10:00', 'Australia/Sydney', now);
    expect(r.delta).toBe(60);
  });
  it('handles a 00:00 meeting', () => {
    const r = nextStart(5, '00:00', 'America/Phoenix', now); // Fri 00:00 Phoenix = 07:00Z Fri
    expect(iso(r.start)).toBe('2026-09-18T07:00:00.000Z');
    expect(r.delta).toBe(480);
  });
});

describe('helpers', () => {
  it('formats and shifts', () => {
    expect(fmtHHMM('00:00')).toBe('12:00am');
    expect(fmtHHMM('13:05')).toBe('1:05pm');
    expect(shiftHHMM('22:30', 180)).toEqual({ time: '01:30', dayCarry: 1 });
    expect(shiftHHMM('01:00', -180)).toEqual({ time: '22:00', dayCarry: -1 });
    expect(zonedParts(new Date('2026-09-17T23:00:00Z'), 'America/Phoenix')).toMatchObject({ dow: 4, h: 16, mi: 0 });
  });
});
