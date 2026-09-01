import { UnrecoverableError, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { AlertNotifier } from '../alerts/notifier';
import { NonRetryableIngestionError, handleMessage } from '../mqtt/handler';
import { log, logError } from '../logger';
import { calculateRetryDelay, IngestionQueueConfig, shouldSendRetryAlert } from './config';
import { INGESTION_QUEUE_NAME, IngestionJobData } from './types';

export function createIngestionQueueWorker(
  connection: IORedis,
  pool: Pool,
  config: IngestionQueueConfig,
  notifier: AlertNotifier,
): Worker<IngestionJobData> {
  const worker = new Worker<IngestionJobData>(
    INGESTION_QUEUE_NAME,
    async (job) => {
      try {
        await handleMessage(
          job.data.topic,
          Buffer.from(job.data.payloadBase64, 'base64'),
          pool,
          new Date(job.data.receivedAt),
        );
      } catch (err) {
        if (err instanceof NonRetryableIngestionError) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    {
      connection,
      concurrency: config.concurrency,
      settings: {
        backoffStrategy: (attemptsMade, type) => {
          if (type !== 'ingestion-exponential') return -1;
          return calculateRetryDelay(attemptsMade, config.retryBaseDelayMs, config.retryMaxDelayMs);
        },
      },
    },
  );

  worker.on('completed', (job) => {
    if (job.attemptsMade > 0) {
      log('info', 'ingestion_retry_recovered', {
        jobId: job.id,
        topic: job.data.topic,
        attemptsMade: job.attemptsMade,
      });
    }
  });

  worker.on('failed', (job, err) => {
    if (!job) {
      logError('ingestion_queue_worker_failed', err);
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    const attemptsRemaining = Math.max(0, maxAttempts - job.attemptsMade);
    const isDeadLettered =
      err instanceof UnrecoverableError ||
      err.name === 'UnrecoverableError' ||
      attemptsRemaining === 0;

    if (isDeadLettered) {
      void notifier.send(
        'ingestion_message_dead_lettered',
        'critical',
        'An ingestion message exhausted retries and requires manual replay.',
        {
          jobId: job.id,
          topic: job.data.topic,
          attemptsMade: job.attemptsMade,
          errorMessage: err.message,
        },
      );
      return;
    }

    if (shouldSendRetryAlert(job.attemptsMade, config.alertEveryAttempts)) {
      void notifier.send(
        'ingestion_database_retry_alert',
        'warning',
        'Ingestion is retrying a message after a database write failure.',
        {
          jobId: job.id,
          topic: job.data.topic,
          attemptsMade: job.attemptsMade,
          attemptsRemaining,
          errorMessage: err.message,
        },
      );
    }
  });

  worker.on('error', (err) => {
    logError('ingestion_queue_worker_error', err);
  });

  return worker;
}
