import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { verifyAccessJwt } from './lib/access.ts';
import { getDb } from './lib/db.ts';
import { SESSION_COOKIE, loadViewer } from './lib/session.ts';
import { isValidTimeZone } from './lib/time.ts';

const STATIC_PREFIX = /^\/(_astro|fonts|fixtures|data)\//;

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  ctx.locals.viewer = null;
  ctx.locals.admin = null;

  // Viewer timezone: explicit cookie first, then Cloudflare's geo guess, then UTC.
  const fromCookie = ctx.cookies.get('dw_tz')?.value;
  const fromCf = (ctx.request as Request<unknown, IncomingRequestCfProperties>).cf?.timezone;
  ctx.locals.tz = [fromCookie, fromCf].find((t) => t && isValidTimeZone(t)) ?? 'UTC';

  if (STATIC_PREFIX.test(path)) return next();

  // Admin: Cloudflare Access in front, verified again here so nothing bypasses it.
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/')) {
    const e = env as Env;
    // The dev bypass only works on a loopback host, so a stray env var in production
    // cannot open the console.
    const local = ctx.url.hostname === 'localhost' || ctx.url.hostname === '127.0.0.1' || ctx.url.hostname === '[::1]';
    if (e.ADMIN_DEV_BYPASS === '1' && local) {
      ctx.locals.admin = { email: 'dev@localhost', sub: 'dev' };
    } else if (!e.ACCESS_TEAM_DOMAIN || !e.ACCESS_AUD) {
      return new Response('not found', { status: 404 });
    } else {
      const id = await verifyAccessJwt(ctx.request.headers.get('cf-access-jwt-assertion'), e.ACCESS_TEAM_DOMAIN, e.ACCESS_AUD);
      if (!id) return new Response('forbidden', { status: 403 });
      ctx.locals.admin = id;
    }
  }

  // Session: only if a cookie is present; a first visit costs no database read.
  const token = ctx.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      ctx.locals.viewer = await loadViewer(getDb(), token);
      if (!ctx.locals.viewer) ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
    } catch (e) {
      console.error('session lookup failed', e instanceof Error ? e.message : e);
    }
  }
  return next();
});
