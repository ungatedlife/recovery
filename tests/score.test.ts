import { describe, expect, it } from 'vitest';
import { passesFilters, score } from '~/lib/score.ts';
import { DEFAULT_PREFS, type MeetingLite } from '~/lib/types.ts';

const base: MeetingLite = {
  id: 'a', slug: 'a', f: 'DA', name: 'x', day: 1, time: '09:00', tz: 'America/New_York', tzc: 'source',
  types: [], url: 'https://zoom.us/j/1', urlNotes: null, phone: null, phoneNotes: null, provider: 'zoom',
  link: 'V', notes: null, group: null, listing: null, health: null,
};

describe('score', () => {
  it('prefers chosen fellowships, boosted types, healthy video links and saved meetings', () => {
    const prefs = { ...DEFAULT_PREFS, fellowships: ['DA'], types: { 'X-BIZ': 1 as const } };
    expect(score(base, prefs)).toBe(28);
    expect(score({ ...base, types: ['X-BIZ'] }, prefs)).toBe(40);
    expect(score({ ...base, link: '?' as const, url: null }, prefs)).toBe(10);
    expect(score({ ...base, health: 'dead-host' }, prefs)).toBe(13);
    expect(score(base, prefs, new Set(['a']))).toBe(128);
  });
  it('mutes types and applies men/women/video filters', () => {
    expect(passesFilters({ ...base, types: ['SP'] }, { ...DEFAULT_PREFS, types: { SP: -1 } })).toBe(false);
    expect(passesFilters(base, { ...DEFAULT_PREFS, menOnly: true })).toBe(false);
    expect(passesFilters({ ...base, types: ['M'] }, { ...DEFAULT_PREFS, menOnly: true })).toBe(true);
    expect(passesFilters({ ...base, link: 'P' as const }, { ...DEFAULT_PREFS, videoOnly: true })).toBe(false);
    expect(passesFilters(base, { ...DEFAULT_PREFS, fellowships: ['UA'] })).toBe(false);
    expect(passesFilters(base, DEFAULT_PREFS, new Set(['a']))).toBe(false);
  });
});
