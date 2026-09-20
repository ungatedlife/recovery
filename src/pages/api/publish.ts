import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publishDataset } from '~/jobs/publish.ts';

/**
 * POST /api/publish  (Authorization: Bearer <PUBLISH_TOKEN>)
 * Rebuilds the KV dataset from D1. Phase 2 moves this behind Cloudflare Access.
 */
export const POST: APIRoute = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const token = (env as Env).PUBLISH_TOKEN;
  if (!token || auth !== `Bearer ${token}`) return new Response('unauthorized', { status: 401 });
  const ds = await publishDataset(env as Env);
  return Response.json({ hash: ds.hash, meetings: ds.meetings.length, generated: ds.generated });
};
