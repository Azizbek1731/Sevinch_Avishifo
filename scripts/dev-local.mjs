// Local dev services WITHOUT Docker: embedded PostgreSQL 16 + Redis.
// Usage: node scripts/dev-local.mjs   (keeps running; Ctrl+C stops both)
// Matches .env defaults: postgresql://avishifo:avishifo@localhost:5432/avishifo, redis://localhost:6379
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.local-run', 'pg16');
const firstRun = !existsSync(join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'avishifo',
  password: 'avishifo',
  port: Number(process.env.LOCAL_PG_PORT ?? 5432),
  persistent: true,
});

const redis = new RedisMemoryServer({
  instance: { port: Number(process.env.LOCAL_REDIS_PORT ?? 6379) },
  autoStart: false,
});

async function main() {
  if (firstRun) {
    console.log('[dev-local] initialising PostgreSQL data dir...');
    await pg.initialise();
  }
  await pg.start();
  if (firstRun) {
    await pg.createDatabase('avishifo');
  }
  console.log('[dev-local] PostgreSQL 16 ready on port', process.env.LOCAL_PG_PORT ?? 5432);

  await redis.start();
  const pgPort = process.env.LOCAL_PG_PORT ?? 5432;
  console.log('[dev-local] Redis ready on port', await redis.getPort());
  console.log(`[dev-local] DATABASE_URL=postgresql://avishifo:avishifo@localhost:${pgPort}/avishifo`);
  console.log('[dev-local] REDIS_URL=redis://localhost:6379');
  console.log('[dev-local] Press Ctrl+C to stop.');
}

async function shutdown() {
  console.log('\n[dev-local] stopping...');
  await Promise.allSettled([pg.stop(), redis.stop()]);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (err) => {
  console.error('[dev-local] failed:', err);
  await Promise.allSettled([pg.stop(), redis.stop()]);
  process.exit(1);
});
