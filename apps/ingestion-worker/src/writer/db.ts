import { Pool } from 'pg';

export function createDbPool(): Pool {
  const max = parseInt(process.env.DB_POOL_MAX ?? '20', 10);
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
