import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { processExportJob } from '../jobs/processor';

const QUEUE_NAME = 'export-queue';

export function createExportWorker(connection: IORedis, pool: Pool): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processExportJob(job, pool);
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[export-worker] BullMQ job completed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[export-worker] BullMQ job failed: ${job?.id ?? 'unknown'} - ${err.message}`,
    );
  });

  worker.on('error', (err) => {
    console.error('[export-worker] Worker error:', err);
  });

  return worker;
}
