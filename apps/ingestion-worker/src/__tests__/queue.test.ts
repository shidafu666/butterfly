import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateRetryDelay,
  loadIngestionQueueConfig,
  shouldSendRetryAlert,
} from '../queue/config';
import { buildIngestionJobId } from '../queue/producer';
import { pack } from 'msgpackr';
import { Pool } from 'pg';
import { handleMessage, NonRetryableIngestionError } from '../mqtt/handler';

describe('ingestion queue configuration', () => {
  it('loads safe defaults', () => {
    const config = loadIngestionQueueConfig({});

    assert.equal(config.concurrency, 10);
    assert.equal(config.maxAttempts, 1000);
    assert.equal(config.retryBaseDelayMs, 1000);
    assert.equal(config.retryMaxDelayMs, 300_000);
    assert.equal(config.backlogAlertThreshold, 100);
  });

  it('falls back when a numeric setting is invalid', () => {
    const config = loadIngestionQueueConfig({
      INGESTION_MAX_ATTEMPTS: 'not-a-number',
      INGESTION_QUEUE_ALERT_THRESHOLD: '0',
    });

    assert.equal(config.maxAttempts, 1000);
    assert.equal(config.backlogAlertThreshold, 100);
  });
});

describe('ingestion retry policy', () => {
  it('uses exponential delays capped at the configured maximum', () => {
    assert.equal(calculateRetryDelay(1, 1000, 300_000), 1000);
    assert.equal(calculateRetryDelay(2, 1000, 300_000), 2000);
    assert.equal(calculateRetryDelay(10, 1000, 300_000), 300_000);
    assert.equal(calculateRetryDelay(1000, 1000, 300_000), 300_000);
  });

  it('alerts on the first and configured periodic attempts', () => {
    assert.equal(shouldSendRetryAlert(1, 10), true);
    assert.equal(shouldSendRetryAlert(2, 10), false);
    assert.equal(shouldSendRetryAlert(10, 10), true);
  });
});

describe('ingestion queue job identity', () => {
  it('deduplicates the same MQTT payload and separates different topics', () => {
    const payload = Buffer.from('same-message');
    const first = buildIngestionJobId('wlpca/sensor-a/data', payload);
    const duplicate = buildIngestionJobId('wlpca/sensor-a/data', payload);
    const otherTopic = buildIngestionJobId('wlpca/sensor-b/data', payload);

    assert.equal(first, duplicate);
    assert.notEqual(first, otherTopic);
    assert.match(first, /^[a-f0-9]{64}$/);
  });
});

describe('ingestion failure classification', () => {
  it('keeps database failures retryable', async () => {
    const payload = pack({
      msgId: 1,
      sn: 'sensor-a',
      devices: [{ deviceId: 'slave1', deviceData: { timestamp: 1_800_000_000, rms: [1] } }],
    });
    const pool = {
      query: async () => {
        throw new Error('database unavailable');
      },
    } as unknown as Pool;

    await assert.rejects(
      handleMessage('wlpca/sensor-a/data', payload, pool),
      (err: unknown) =>
        err instanceof Error &&
        !(err instanceof NonRetryableIngestionError) &&
        err.message === 'database unavailable',
    );
  });

  it('marks invalid payloads as non-retryable', async () => {
    const payload = pack({ msgId: 1, sn: 'sensor-a', devices: [] });
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;

    await assert.rejects(
      handleMessage('wlpca/sensor-a/data', payload, pool),
      (err: unknown) =>
        err instanceof NonRetryableIngestionError && err.errorType === 'VALIDATION_ERROR',
    );
  });
});
