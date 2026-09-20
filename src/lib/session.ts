/**
 * Anonymous-first sessions, hand-rolled on purpose (Lucia pattern).
 * A user is a random id; an anonymous user simply has no email. The cookie
 * carries a random token; only its SHA-256 is stored. No IP, no user agent.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import * as schema from '~db/schema.ts';
import type { Db } from './db.ts';
import { nowIso, today } from './db.ts';
import { DEFAULT_PREFS, type Prefs } from './types.ts';
import { sanitizePrefs } from './prefs.ts';

export const SESSION_COOKIE = 'dw_s';
const SESSION_DAYS = 365;
const EXTEND_BELOW_DAYS = 180;

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function newToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hex(new Uint8Array(buf));
}

export interface Viewer {
  user: schema.User;
  prefs: Prefs;
  saved: string[];
  hidden: string[];
}

/** Create an anonymous user and a session for it. Returns the raw token for the cookie. */
export async function createAnonUser(db: Db): Promise<{ user: schema.User; token: string }> {
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  const token = newToken();
  const now = nowIso();
  const user: schema.User = { id, email: null, emailVerifiedAt: null, createdAt: now, lastActiveDay: today() };
  await db.batch([
    db.insert(schema.users).values(user),
    db.insert(schema.sessions).values({ id: await hashToken(token), userId: id, expiresAt: addDays(now, SESSION_DAYS), createdAt: now }),
    bumpStat(db, 'anon_users_created'),
  ]);
  return { user, token };
}

/** Resolve a cookie token to the viewer's user, prefs, saved and hidden ids. Null when absent or expired. */
export async function loadViewer(db: Db, token: string | undefined): Promise<Viewer | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const sid = await hashToken(token);
  const row = await db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, sid))
    .get();
  if (!row) return null;
  const now = nowIso();
  if (row.expiresAt <= now) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sid));
    return null;
  }
  const [prefsRow, savedRows] = await db.batch([
    db.select().from(schema.userPrefs).where(eq(schema.userPrefs.userId, row.user.id)),
    db.select({ meetingId: schema.savedMeetings.meetingId, kind: schema.savedMeetings.kind }).from(schema.savedMeetings).where(eq(schema.savedMeetings.userId, row.user.id)),
  ]);
  // Cheap write avoidance: bump activity once a day, extend the session only when it is half gone.
  const writes = [];
  if (row.user.lastActiveDay !== today()) writes.push(db.update(schema.users).set({ lastActiveDay: today() }).where(eq(schema.users.id, row.user.id)));
  if (row.expiresAt < addDays(now, EXTEND_BELOW_DAYS)) writes.push(db.update(schema.sessions).set({ expiresAt: addDays(now, SESSION_DAYS) }).where(eq(schema.sessions.id, sid)));
  if (writes.length) await db.batch(writes as [any, ...any[]]);
  let prefs = DEFAULT_PREFS;
  try {
    if (prefsRow[0]) prefs = sanitizePrefs(JSON.parse(prefsRow[0].prefsJson));
  } catch {
    /* corrupt prefs: fall back to defaults */
  }
  return {
    user: row.user,
    prefs,
    saved: savedRows.filter((r) => r.kind === 'saved').map((r) => r.meetingId),
    hidden: savedRows.filter((r) => r.kind === 'hidden').map((r) => r.meetingId),
  };
}

export async function savePrefs(db: Db, userId: string, prefs: Prefs): Promise<void> {
  await db
    .insert(schema.userPrefs)
    .values({ userId, prefsJson: JSON.stringify(prefs), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: schema.userPrefs.userId, set: { prefsJson: JSON.stringify(prefs), updatedAt: nowIso() } });
}

export async function setSavedMeeting(db: Db, userId: string, meetingId: string, kind: 'saved' | 'hidden', on: boolean): Promise<void> {
  if (on) {
    await db.batch([
      db
        .insert(schema.savedMeetings)
        .values({ userId, meetingId, kind, createdAt: nowIso() })
        .onConflictDoUpdate({ target: [schema.savedMeetings.userId, schema.savedMeetings.meetingId], set: { kind, createdAt: nowIso() } }),
      bumpStat(db, kind === 'saved' ? 'saves' : 'hides'),
    ]);
  } else {
    await db.delete(schema.savedMeetings).where(and(eq(schema.savedMeetings.userId, userId), eq(schema.savedMeetings.meetingId, meetingId), eq(schema.savedMeetings.kind, kind)));
  }
}

/** Everything about a user, gone. Cascades cover sessions, prefs and saved meetings. */
export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.batch([db.delete(schema.users).where(eq(schema.users.id, userId)), bumpStat(db, 'deletes')]);
}

/** Weekly retention: anonymous users idle for 180 days, expired sessions. */
export async function purgeInactive(db: Db, days = 180): Promise<{ users: number; sessions: number }> {
  const cutoffDay = addDays(nowIso(), -days).slice(0, 10);
  const u = await db.delete(schema.users).where(and(sql`${schema.users.email} IS NULL`, lt(schema.users.lastActiveDay, cutoffDay))).returning({ id: schema.users.id });
  const s = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, nowIso())).returning({ id: schema.sessions.id });
  return { users: u.length, sessions: s.length };
}

export function bumpStat(db: Db, metric: string) {
  return db
    .insert(schema.dailyStats)
    .values({ day: today(), metric, value: 1 })
    .onConflictDoUpdate({ target: [schema.dailyStats.day, schema.dailyStats.metric], set: { value: sql`${schema.dailyStats.value} + 1` } });
}

export function setSessionCookie(cookies: AstroCookies, token: string): void {
  cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}
export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}
