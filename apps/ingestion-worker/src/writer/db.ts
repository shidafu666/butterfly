import { Pool } from 'pg';

export function createDbPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}
