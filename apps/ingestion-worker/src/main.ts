import 'dotenv/config';
import { createDbPool } from './writer/db';
import { startMqttClient } from './mqtt/client';

async function main() {
  console.log('[ingestion-worker] Starting...');
  const pool = createDbPool();
  await startMqttClient(pool);
}

main().catch((err) => {
  console.error('[ingestion-worker] Fatal error:', err);
  process.exit(1);
});
