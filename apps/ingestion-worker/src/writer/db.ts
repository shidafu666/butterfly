import { Pool } from 'pg';
import { log } from '../logger';

export function createDbPool(): Pool {
  const max = parseInt(process.env.DB_POOL_MAX ?? '20', 10);
  log('info', 'db_pool_create', { max });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    log('error', 'db_pool_idle_client_error', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
  });

  return pool;
}
