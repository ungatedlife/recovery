/**
 * Request guards for mutating JSON routes. Astro's built-in origin check only
 * covers form content types, so this is the real CSRF line for /api/*.
 */

export function requireSameOrigin(request: Request, opts: { json?: boolean } = { json: true }): Response | null {
  const url = new URL(request.url);
  const site = url.origin;
  const fetchSite = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  const ok = fetchSite === 'same-origin' || fetchSite === 'none' || origin === site || (fetchSite === null && origin === null && isLoopback(url.hostname));
  if (!ok) return json({ error: 'cross-site request refused' }, 403);
  const ct = request.headers.get('content-type') ?? '';
  if (opts.json !== false && !ct.toLowerCase().startsWith('application/json')) return json({ error: 'expected application/json' }, 415);
  return null;
}

const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

export async function readJson<T = unknown>(request: Request, maxBytes = 32 * 1024): Promise<T> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'body too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'body too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid json');
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

/** Wrap a handler so thrown HttpErrors become JSON responses and anything else a 500 without details. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('api error', e instanceof Error ? e.message : e);
    return json({ error: 'internal error' }, 500);
  }
}
