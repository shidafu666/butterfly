export interface IngestionQueueConfig {
  concurrency: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  alertEveryAttempts: number;
  backlogAlertThreshold: number;
  metricsIntervalMs: number;
  completedJobRetentionSeconds: number;
  completedJobRetentionCount: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadIngestionQueueConfig(
  env: NodeJS.ProcessEnv = process.env,
): IngestionQueueConfig {
  return {
    concurrency: positiveInteger(env.INGESTION_CONCURRENCY, 10),
    maxAttempts: positiveInteger(env.INGESTION_MAX_ATTEMPTS, 1000),
    retryBaseDelayMs: positiveInteger(env.INGESTION_RETRY_BASE_DELAY_MS, 1000),
    retryMaxDelayMs: positiveInteger(env.INGESTION_RETRY_MAX_DELAY_MS, 300_000),
    alertEveryAttempts: positiveInteger(env.INGESTION_ALERT_EVERY_ATTEMPTS, 10),
    backlogAlertThreshold: positiveInteger(env.INGESTION_QUEUE_ALERT_THRESHOLD, 100),
    metricsIntervalMs: positiveInteger(env.INGESTION_QUEUE_METRICS_INTERVAL_MS, 60_000),
    completedJobRetentionSeconds: positiveInteger(
      env.INGESTION_COMPLETED_RETENTION_SECONDS,
      86_400,
    ),
    completedJobRetentionCount: positiveInteger(env.INGESTION_COMPLETED_RETENTION_COUNT, 10_000),
  };
}

export function calculateRetryDelay(
  attemptsMade: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponent = Math.max(0, Math.min(attemptsMade - 1, 30));
  return Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
}

export function shouldSendRetryAlert(attemptsMade: number, alertEveryAttempts: number): boolean {
  return attemptsMade === 1 || attemptsMade % alertEveryAttempts === 0;
}
