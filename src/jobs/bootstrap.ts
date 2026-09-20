/**
 * Zero-touch first run: if the catalog is empty, load the bundled legacy seed.
 * Reference rows (fellowships with scrapers, sources) are re-applied every time
 * because they are INSERT OR IGNORE. Safe to call on every cron tick.
 */
import legacySql from '~db/seed/legacy.sql?raw';
import sourcesSql from '~db/seed/sources.sql?raw';

export async function bootstrap(env: Env): Promise<{ seeded: boolean; statements: number }> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM meetings').first<{ n: number }>();
  let seeded = false;
  let statements = 0;
  if (!row || row.n === 0) {
    statements += await runSql(env.DB, legacySql);
    seeded = true;
  }
  statements += await runSql(env.DB, sourcesSql);
  return { seeded, statements };
}

/**
 * The seed files are generated one statement per `;\n`, values never contain
 * that sequence. D1's exec() needs single-line statements, so split and batch.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--[^\n]*\n/gm, '').trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
}

async function runSql(db: D1Database, sql: string): Promise<number> {
  const stmts = splitStatements(sql);
  for (let i = 0; i < stmts.length; i += 20) {
    const chunk = stmts.slice(i, i + 20).map((s) => db.prepare(s));
    await db.batch(chunk);
  }
  return stmts.length;
}
