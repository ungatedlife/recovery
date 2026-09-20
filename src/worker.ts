/**
 * Single Worker entry: Astro handles HTTP, `scheduled` runs the data jobs.
 * Keeping both in one Worker means one deploy, one schema, one Drizzle client.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { runScheduled } from './jobs/index.ts';

const SECURITY_HEADERS: Record<string, string> = {
  // Join links are plain anchors and must never carry our URL to Zoom.
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Astro inlines stylesheets and island bootstrap scripts, so inline is allowed for now.
  // Phase 1 moves scripts to nonces once sessions land.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const res = await handle(request, env, ctx);
    return withSecurityHeaders(res);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;
