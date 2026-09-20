import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScheduler, nextStart } from '~/lib/time.ts';
import type { Dataset } from '~/lib/types.ts';

const ds = JSON.parse(readFileSync(new URL('../src/data/dataset.json', import.meta.url), 'utf8')) as Dataset;

const INSTANTS = [
  '2026-09-22T16:47:00Z', // ordinary week
  '2026-01-15T03:00:00Z', // winter
  '2026-10-24T12:00:00Z', // week before the US fall-back: every US zone must take the slow path
  '2026-11-01T06:30:00Z', // inside the New York fall-back hour
  '2026-03-08T07:05:00Z', // five minutes after the New York spring-forward
  '2026-04-04T15:00:00Z', // Sydney DST ends 2026-04-05
  '2026-10-03T15:00:00Z', // Sydney DST starts 2026-10-04
];

describe('createScheduler', () => {
  for (const iso of INSTANTS) {
    it(`matches nextStart for every meeting at ${iso}`, () => {
      const now = new Date(iso);
      const s = createScheduler(now, 10);
      let mismatches = 0;
      for (const m of ds.meetings) {
        const a = s.next(m.day, m.time, m.tz);
        const b = nextStart(m.day, m.time, m.tz, now, 10);
        if (a.delta !== b.delta || a.start.getTime() !== b.start.getTime()) mismatches++;
      }
      expect(mismatches).toBe(0);
    });
  }
  it('is a lot cheaper than the per-meeting routine', () => {
    const now = new Date(INSTANTS[0]);
    const t0 = performance.now();
    for (const m of ds.meetings) nextStart(m.day, m.time, m.tz, now, 10);
    const slow = performance.now() - t0;
    const t1 = performance.now();
    const s = createScheduler(now, 10);
    for (const m of ds.meetings) s.next(m.day, m.time, m.tz);
    const fast = performance.now() - t1;
    expect(fast * 4).toBeLessThan(slow);
  });
});
