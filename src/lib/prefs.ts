/**
 * Phase 0 persistence: the viewer's browser only. Phase 1 moves this behind an
 * anonymous session and migrates whatever is here on first contact.
 */
import { DEFAULT_PREFS, type Prefs } from './types.ts';

const PREFS_KEY = 'dw.prefs.v1';
const SAVED_KEY = 'dw.saved.v1';
const HIDDEN_KEY = 'dw.hidden.v1';

function read<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, quota, or SSR: prefs just don't persist */
  }
}

/** Returns null when the viewer has never expressed a preference (drives the first-visit strip). */
export function loadPrefs(): Prefs | null {
  const p = read<Partial<Prefs>>(PREFS_KEY);
  return p ? { ...DEFAULT_PREFS, ...p } : null;
}
export function savePrefs(p: Prefs): void {
  write(PREFS_KEY, p);
}
export function loadIdSet(kind: 'saved' | 'hidden'): Set<string> {
  return new Set(read<string[]>(kind === 'saved' ? SAVED_KEY : HIDDEN_KEY) ?? []);
}
export function saveIdSet(kind: 'saved' | 'hidden', ids: Set<string>): void {
  write(kind === 'saved' ? SAVED_KEY : HIDDEN_KEY, [...ids]);
}

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}
