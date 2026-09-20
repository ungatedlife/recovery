import { defineMiddleware } from 'astro:middleware';
import { isValidTimeZone } from './lib/time.ts';

/** Viewer timezone: explicit cookie first, then Cloudflare's geo guess, then UTC. */
export const onRequest = defineMiddleware((ctx, next) => {
  const fromCookie = ctx.cookies.get('dw_tz')?.value;
  const fromCf = (ctx.request as Request & { cf?: { timezone?: string } }).cf?.timezone;
  const tz = [fromCookie, fromCf].find((t) => t && isValidTimeZone(t)) ?? 'UTC';
  ctx.locals.tz = tz;
  return next();
});
