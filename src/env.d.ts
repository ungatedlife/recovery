/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

// `Env` is generated into worker-configuration.d.ts by `npx wrangler types`.
// Bindings are read with `import { env } from 'cloudflare:workers'`, never from Astro.locals.

declare namespace App {
  interface Locals {
    /** IANA timezone of the viewer, from request.cf or a pref cookie, else UTC. */
    tz: string;
  }
}
