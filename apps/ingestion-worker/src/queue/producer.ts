import { createHash } from 'node:crypto';
import { JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { log } from '../logger';
import { IngestionQueueConfig } from './config';
import { INGESTION_QUEUE_NAME, IngestionJobData } from './types';

export interface IngestionQueueProducer {
  enqueue(topic: string, payload: Buffer, mqttQos: number, receivedAt?: Date): Promise<string>;
  close(): Promise<void>;
  readonly queue: Queue<IngestionJobData>;
}

export function buildIngestionJobId(topic: string, payload: Buffer): string {
  return createHash('sha256').update(topic).update('\0').update(payload).digest('hex');
}

export function createIngestionQueueProducer(
  connection: IORedis,
  config: IngestionQueueConfig,
): IngestionQueueProducer {
  const queue = new Queue<IngestionJobData>(INGESTION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: config.maxAttempts,
      backoff: { type: 'ingestion-exponential', delay: config.retryBaseDelayMs },
      removeOnComplete: {
        age: config.completedJobRetentionSeconds,
        count: config.completedJobRetentionCount,
      },
      removeOnFail: false,
    },
  });

  return {
    queue,
    async enqueue(
      topic: string,
      payload: Buffer,
      mqttQos: number,
      receivedAt: Date = new Date(),
    ): Promise<string> {
      const jobId = buildIngestionJobId(topic, payload);
      const data: IngestionJobData = {
        topic,
        payloadBase64: payload.toString('base64'),
        receivedAt: receivedAt.toISOString(),
        mqttQos,
      };
      const options: JobsOptions = { jobId };

      const job = await queue.add('ingest-mqtt-message', data, options);
      log('info', 'ingestion_message_queued', {
        jobId: job.id,
        topic,
        payloadBytes: payload.length,
        mqttQos,
      });
      return String(job.id);
    },
    async close(): Promise<void> {
      await queue.close();
    },
  };
}
