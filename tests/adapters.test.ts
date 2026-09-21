import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeTsml, type TsmlRecord } from '~/jobs/sources/tsml-feed.ts';
import { normalizeTeamup, type TeamupEvent } from '~/jobs/sources/teamup.ts';
import { extractConference, normalizeTime, parseConferenceUrl, parsePhone, stableId } from '~/lib/normalize.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../public/fixtures/${name}`, import.meta.url), 'utf8'));

describe('normalize helpers', () => {
  it('parses times in the shapes fellowship sites use', () => {
    expect(normalizeTime('07:00')).toBe('07:00');
    expect(normalizeTime('8:30 PM')).toBe('20:30');
    expect(normalizeTime('12:00 am')).toBe('00:00');
    expect(normalizeTime('21:30:00')).toBe('21:30');
    expect(normalizeTime('noon')).toBeNull();
  });
  it('parses phones and conference urls', () => {
    expect(parsePhone('555-123-4567 code 4321#').tel).toBe('+15551234567,,4321#');
    expect(parsePhone('+15551234567,,4321#').tel).toBe('+15551234567,,4321#');
    expect(parseConferenceUrl('https://us06web.zoom.us/j/555000111?pwd=abcdefghij')).toMatchObject({ provider: 'zoom', zoomId: '555000111', mangledPasscode: true, conferenceUrl: 'https://us06web.zoom.us/j/555000111' });
    expect(parseConferenceUrl('https://us02web.zoom.us/j/1?pwd=AbC').mangledPasscode).toBe(false);
    expect(parseConferenceUrl('javascript:alert(1)').conferenceUrl).toBeNull();
    expect(extractConference('Join: https://zoom.us/j/222?pwd=Qw9 <br>Passcode: hope')).toMatchObject({ url: 'https://zoom.us/j/222?pwd=Qw9', passcode: 'hope' });
  });
  it('makes stable ids', async () => {
    expect(await stableId('a')).toBe(await stableId('a'));
    expect(await stableId('a')).not.toBe(await stableId('b'));
    expect(await stableId('a')).toMatch(/^[0-9a-z]{20}$/);
  });
});

describe('tsml-feed normalize', () => {
  const recs = fixture('tsml-sample.json') as TsmlRecord[];
  it('keeps online meetings, drops in-person and appointment ones, fills timezone from the source default', () => {
    const out = recs.map((r) => normalizeTsml(r, 'America/Chicago'));
    expect(out[0]).toMatchObject({ sourceKey: 'tsml:101:1', day: 1, time: '07:00', endTime: '08:00', timezone: 'America/New_York', types: ['O', 'ST'], conferenceUrl: 'https://us02web.zoom.us/j/123456789?pwd=AbCdEf123', notes: 'Open to all. Bring a notebook.' });
    expect(out[1]).toMatchObject({ day: 5, time: '20:30', timezone: 'America/Chicago', conferencePhone: '+15551234567,,4321#', conferenceUrl: null });
    expect(out[2]).toMatchObject({ reason: 'not an online meeting' });
    expect(out[3]).toMatchObject({ reason: 'no weekday (appointment meeting?)' });
    expect(out[4]).toMatchObject({ conferenceUrl: 'https://us06web.zoom.us/j/555000111', conferenceUrlNotes: 'pw 123456 — passcode may be case-mangled upstream', types: ['M'] });
  });
});

describe('teamup normalize', () => {
  const events = (fixture('teamup-sample.json') as { events: TeamupEvent[] }).events;
  it('collapses instances into weekly rules per weekday and routes oddities to review', () => {
    const { meetings, review } = normalizeTeamup(events, null, 'https://example.org/cal');
    expect(meetings.map((m) => m.sourceKey).sort()).toEqual(['teamup:1001:0', 'teamup:1002:1', 'teamup:1002:2']);
    expect(meetings[0]).toMatchObject({ name: 'Sunday Serenity', day: 0, time: '09:30', endTime: '10:30', timezone: 'America/Los_Angeles', conferenceUrl: 'https://us02web.zoom.us/j/222333444?pwd=QwErTy99', conferenceUrlNotes: 'passcode serenity' });
    expect(review.map((r) => r.reason)).toEqual([
      'two starts for one series on the same weekday (12:00 and 18:00)',
      'non-weekly recurrence FREQ=MONTHLY;BYDAY=4FR',
      'no join link in notes',
    ]);
  });
  it('keeps the first start and never silently drops the second', () => {
    const { meetings } = normalizeTeamup(events, null, null);
    const monday = meetings.filter((m) => m.sourceKey === 'teamup:1002:1');
    expect(monday).toHaveLength(1);
    expect(monday[0].time).toBe('12:00');
  });
});

describe('bootstrap splitStatements', () => {
  it('splits the generated seed into complete statements', async () => {
    const { splitStatements } = await import('~/jobs/bootstrap.ts');
    const sql = readFileSync(new URL('../db/seed/legacy.sql', import.meta.url), 'utf8');
    const stmts = splitStatements(sql);
    expect(stmts.length).toBeGreaterThan(100);
    expect(stmts.every((s) => /^INSERT OR REPLACE INTO /.test(s))).toBe(true);
    expect(stmts.every((s) => s.length < 100_000)).toBe(true);
  });
});
