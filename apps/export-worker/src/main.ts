import 'dotenv/config';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { createExportWorker } from './queue/worker';

async function main() {
  console.log('[export-worker] Starting...');

  const redisHost = process.env.REDIS_HOST ?? 'redis';
  const redisPort = parseInt(process.env.REDIS_PORT ?? '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD;
  const redisTls = process.env.REDIS_TLS === 'true';

  const connection = new IORedis({
    host: redisHost,
    port: redisPort,
    ...(redisPassword ? { password: redisPassword } : {}),
    ...(redisTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  });

  connection.on('connect', () => {
    console.log(
      `[export-worker] Connected to Redis at ${redisHost}:${redisPort}${redisTls ? ' (TLS)' : ''}`,
    );
  });

  connection.on('error', (err) => {
    console.error('[export-worker] Redis error:', err);
  });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Verify DB connectivity before proceeding
  try {
    await pool.query('SELECT 1');
    console.log('[export-worker] Connected to PostgreSQL');
  } catch (err) {
    console.error('[export-worker] Failed to connect to PostgreSQL:', err);
    process.exit(1);
  }

  const worker = createExportWorker(connection, pool);

  console.log('[export-worker] Worker started, listening for jobs...');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[export-worker] Received ${signal}, shutting down gracefully...`);
    await worker.close();
    await connection.quit();
    await pool.end();
    console.log('[export-worker] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[export-worker] Fatal error:', err);
  process.exit(1);
});
