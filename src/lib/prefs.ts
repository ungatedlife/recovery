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

/** Validate untrusted prefs (API body, localStorage) into a well-formed Prefs. Unknown keys dropped. */
export function sanitizePrefs(input: unknown): Prefs {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 64) => (typeof v === 'string' && v.length <= max ? v : null);
  const bool = (v: unknown) => v === true;
  const fellowships = Array.isArray(p.fellowships) ? p.fellowships.filter((c): c is string => typeof c === 'string' && /^[A-Z0-9-]{1,12}$/.test(c)).slice(0, 32) : [];
  const types: Record<string, -1 | 0 | 1> = {};
  if (p.types && typeof p.types === 'object') {
    for (const [k, v] of Object.entries(p.types as Record<string, unknown>).slice(0, 64)) {
      if (/^[A-Z0-9-]{1,16}$/.test(k) && (v === 1 || v === -1)) types[k] = v;
    }
  }
  const timezone = str(p.timezone) ?? null;
  const grace = typeof p.joinGraceMin === 'number' && Number.isFinite(p.joinGraceMin) ? Math.min(60, Math.max(0, Math.round(p.joinGraceMin))) : DEFAULT_PREFS.joinGraceMin;
  const pageSize = typeof p.pageSize === 'number' && Number.isFinite(p.pageSize) ? Math.min(48, Math.max(6, Math.round(p.pageSize))) : DEFAULT_PREFS.pageSize;
  return {
    fellowships,
    types,
    menOnly: bool(p.menOnly),
    womenOnly: bool(p.womenOnly) && !bool(p.menOnly),
    videoOnly: bool(p.videoOnly),
    timezone: timezone && /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(timezone) ? timezone : null,
    joinGraceMin: grace,
    pageSize,
  };
}
