/**
 * Server-side dataset access. KV holds the latest published dataset; the JSON
 * bundled at build time is the fallback so the site works before the first
 * publish and in local dev without bindings.
 */
import bundled from '../data/dataset.json';
import type { Dataset } from './types.ts';

export const KV_CURRENT = 'dataset:current';
const TTL_MS = 5 * 60 * 1000;

let cache: { at: number; ds: Dataset } | null = null;

async function kv(): Promise<KVNamespace | null> {
  try {
    const { env } = await import('cloudflare:workers');
    return (env as Env).KV ?? null;
  } catch {
    return null;
  }
}

export async function loadDataset(): Promise<Dataset> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ds;
  let ds = bundled as unknown as Dataset;
  try {
    const store = await kv();
    const fromKv = store ? await store.get<Dataset>(KV_CURRENT, 'json') : null;
    if (fromKv && fromKv.v === 1 && fromKv.meetings.length) ds = fromKv;
  } catch {
    // KV unavailable (dev without binding, or outage): serve the bundled copy.
  }
  cache = { at: Date.now(), ds };
  return ds;
}
