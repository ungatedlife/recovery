import { env } from 'cloudflare:workers';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '~db/schema.ts';

export type Db = DrizzleD1Database<typeof schema>;

let cached: Db | null = null;

/** Drizzle over the D1 binding. One instance per isolate is plenty. */
export function getDb(): Db {
  if (!cached) cached = drizzle((env as Env).DB, { schema });
  return cached;
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
