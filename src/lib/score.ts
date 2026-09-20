/**
 * Runtime relevance score. Replaces the `s` integer that used to be baked into
 * every row. Ordering is chronological first; this only breaks ties among
 * meetings that start in the same minute, and decides what gets hidden.
 */
import type { MeetingLite, Prefs } from './types.ts';

const LINK_QUALITY: Record<string, number> = { V: 8, F: 6, P: 3, '?': -10 };

export function passesFilters(m: MeetingLite, prefs: Prefs, hidden: ReadonlySet<string> = new Set()): boolean {
  if (hidden.has(m.id)) return false;
  if (prefs.fellowships.length && !prefs.fellowships.includes(m.f)) return false;
  if (prefs.menOnly && !m.types.includes('M')) return false;
  if (prefs.womenOnly && !m.types.includes('W')) return false;
  if (prefs.videoOnly && !(m.link === 'V' && m.url)) return false;
  for (const code of m.types) if (prefs.types[code] === -1) return false;
  return true;
}

export function score(m: MeetingLite, prefs: Prefs, saved: ReadonlySet<string> = new Set()): number {
  let s = 0;
  if (prefs.fellowships.includes(m.f)) s += 20;
  for (const code of m.types) s += (prefs.types[code] ?? 0) * 12;
  if (prefs.menOnly && m.types.includes('M')) s += 20;
  if (prefs.womenOnly && m.types.includes('W')) s += 20;
  s += LINK_QUALITY[m.link] ?? 0;
  if (m.health && m.health !== 'ok' && m.health !== 'unknown') s -= 15;
  if (saved.has(m.id)) s += 100;
  return s;
}
