/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

// `Env` is generated into worker-configuration.d.ts by `npm run types`.
// Bindings are read with `import { env } from 'cloudflare:workers'`, never from Astro.locals.

declare namespace App {
  interface Locals {
    /** IANA timezone of the viewer, from a pref cookie, then request.cf, else UTC. */
    tz: string;
    /** The signed-in (anonymous or upgraded) viewer, or null when no valid session cookie. */
    viewer: import('~/lib/session.ts').Viewer | null;
    /** Cloudflare Access identity on /admin routes; null elsewhere. */
    admin: import('~/lib/access.ts').AccessIdentity | null;
  }
}

// Secrets and dev-only vars are not in wrangler.jsonc, so the generated Env doesn't know them.
interface Env {
  TEAMUP_TOKEN?: string;
  ADMIN_DEV_BYPASS?: string;
}
