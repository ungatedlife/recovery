import type { SourceAdapter } from './types.ts';
import { teamup } from './teamup.ts';
import { tsmlFeed } from './tsml-feed.ts';

const manual: SourceAdapter = { id: 'manual', run: async () => null };

export const ADAPTERS: Record<string, SourceAdapter> = {
  'tsml-feed': tsmlFeed,
  teamup,
  manual,
};
