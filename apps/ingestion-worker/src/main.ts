import 'dotenv/config';
import { createDbPool } from './writer/db';
import { startMqttClient } from './mqtt/client';
import { logError, log } from './logger';
import { createRedisConnection } from './queue/connection';
import { loadIngestionQueueConfig } from './queue/config';
import { createIngestionQueueProducer } from './queue/producer';
import { createIngestionQueueWorker } from './queue/worker';
import { startQueueMonitor } from './queue/monitor';
import { AlertNotifier } from './alerts/notifier';

async function main() {
  log('info', 'worker_starting');
  const pool = createDbPool();
  const config = loadIngestionQueueConfig();
  const producerConnection = createRedisConnection('ingestion-producer');
  const workerConnection = createRedisConnection('ingestion-consumer');

  // Do not subscribe to MQTT until Redis is writable. Otherwise MQTT QoS 1 messages
  // could be acknowledged without crossing a durable storage boundary.
  await producerConnection.ping();

  const producer = createIngestionQueueProducer(producerConnection, config);
  const notifier = new AlertNotifier();
  const worker = createIngestionQueueWorker(workerConnection, pool, config, notifier);
  await worker.waitUntilReady();
  const monitor = startQueueMonitor(producer.queue, config, notifier);
  const mqttClient = await startMqttClient(producer);

  log('info', 'worker_ready', {
    queue: producer.queue.name,
    concurrency: config.concurrency,
    maxAttempts: config.maxAttempts,
    retryMaxDelayMs: config.retryMaxDelayMs,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'worker_shutting_down', { signal });
    monitor.close();
    await mqttClient.endAsync();
    await worker.close();
    await producer.close();
    await workerConnection.quit();
    await producerConnection.quit();
    await pool.end();
    log('info', 'worker_shutdown_complete');
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logError('worker_fatal_error', err);
  process.exit(1);
});
