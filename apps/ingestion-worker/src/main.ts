import 'dotenv/config';
import { createDbPool } from './writer/db';
import { startMqttClient } from './mqtt/client';
import { logError, log } from './logger';

async function main() {
  log('info', 'worker_starting');
  const pool = createDbPool();
  await startMqttClient(pool);
}

main().catch((err) => {
  logError('worker_fatal_error', err);
  process.exit(1);
});
