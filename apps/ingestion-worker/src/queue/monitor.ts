import { Queue } from 'bullmq';
import { AlertNotifier } from '../alerts/notifier';
import { log, logError } from '../logger';
import { IngestionQueueConfig } from './config';
import { IngestionJobData } from './types';

export interface QueueMonitor {
  close(): void;
}

export function startQueueMonitor(
  queue: Queue<IngestionJobData>,
  config: IngestionQueueConfig,
  notifier: AlertNotifier,
): QueueMonitor {
  let backlogAlertActive = false;
  let failedAlertActive = false;
  let stopped = false;

  const check = async (): Promise<void> => {
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      const backlog = counts.waiting + counts.active + counts.delayed;

      log('info', 'ingestion_queue_metrics', {
        ...counts,
        backlog,
        backlogAlertThreshold: config.backlogAlertThreshold,
      });

      if (backlog >= config.backlogAlertThreshold && !backlogAlertActive) {
        backlogAlertActive = true;
        await notifier.send(
          'ingestion_queue_backlog_alert',
          'critical',
          'The ingestion queue backlog exceeded its configured threshold.',
          { ...counts, backlog, threshold: config.backlogAlertThreshold },
        );
      } else if (backlog < config.backlogAlertThreshold && backlogAlertActive) {
        backlogAlertActive = false;
        log('info', 'ingestion_queue_backlog_recovered', {
          ...counts,
          backlog,
          threshold: config.backlogAlertThreshold,
        });
      }

      if (counts.failed > 0 && !failedAlertActive) {
        failedAlertActive = true;
        await notifier.send(
          'ingestion_dead_letter_backlog_alert',
          'critical',
          'The ingestion queue contains failed messages that require inspection or replay.',
          { failed: counts.failed },
        );
      } else if (counts.failed === 0 && failedAlertActive) {
        failedAlertActive = false;
        log('info', 'ingestion_dead_letter_backlog_recovered');
      }
    } catch (err) {
      logError('ingestion_queue_metrics_failed', err);
    }
  };

  const timer = setInterval(() => {
    if (!stopped) void check();
  }, config.metricsIntervalMs);
  timer.unref();
  void check();

  return {
    close(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}
