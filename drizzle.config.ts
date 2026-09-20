import { defineConfig } from 'drizzle-kit';

// Migrations are generated here and applied with `wrangler d1 migrations apply`.
// drizzle-kit never needs to talk to D1 for this project.
export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.ts',
  out: './db/migrations',
});
