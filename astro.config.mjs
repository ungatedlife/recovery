// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';

export default defineConfig({
  site: 'https://doublewinners.org',
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  integrations: [preact()],
  // Keep the client bundle honest: one island, no view transitions, no prefetch.
  prefetch: false,
  build: { inlineStylesheets: 'always' },
  vite: {
    ssr: { external: ['node:crypto'] },
  },
});
