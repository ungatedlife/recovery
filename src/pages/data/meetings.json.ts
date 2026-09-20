import type { APIRoute } from 'astro';
import { loadDataset } from '~/lib/data.ts';

/** The published dataset, ETagged by content hash so the island can refresh cheaply. */
export const GET: APIRoute = async ({ request }) => {
  const ds = await loadDataset();
  const etag = `"${ds.hash}"`;
  const headers = {
    ETag: etag,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify(ds), { headers });
};
