import { Pool } from 'pg';
import { decodePayload } from '../decoder/decoder';
import { validatePayload } from '../validator/validator';
import { bulkInsert, upsertSensor, upsertDevice, CurrentMeasurementRow } from '../writer/writer';
import { log, logError } from '../logger';

/**
 * Parses the sensor SN from a topic of the form `wlpca/<sensorSn>/data`.
 * Returns null if the topic does not match the expected format.
 */
function parseSensorSnFromTopic(topic: string): string | null {
  const parts = topic.split('/');
  // Expected: ["wlpca", "<sensorSn>", "data"]
  if (parts.length !== 3 || parts[0] !== 'wlpca' || parts[2] !== 'data') {
    return null;
  }
  const sn = parts[1];
  return sn && sn.trim() !== '' ? sn : null;
}

export async function handleMessage(topic: string, buffer: Buffer, pool: Pool): Promise<void> {
  const receivedAt = new Date();
  let msgId: string | undefined;
  let sensorSn: string | undefined;
  let raw: unknown;
  const payloadSize: number = buffer.length;

  try {
    // 1. Parse sensor_sn from topic
    const topicSn = parseSensorSnFromTopic(topic);
    if (!topicSn) {
      throw new TopicParseError(`Cannot parse sensor SN from topic: "${topic}"`);
    }
    sensorSn = topicSn;

    // 2. Decode MessagePack
    try {
      raw = decodePayload(buffer);
    } catch (err) {
      throw new DecodeError(
        `Failed to decode MessagePack: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. Validate payload
    const payload = validatePayload(raw, topicSn);
    msgId = payload.msgId;

    // 4. Expand RMS arrays to individual measurement rows (each rms[i] → timestamp+i seconds)
    const rows: CurrentMeasurementRow[] = [];
    for (const device of payload.devices) {
      const baseTimestamp = device.deviceData.timestamp;
      device.deviceData.rms.forEach((rmsValue, i) => {
        rows.push({
          sensor_sn: payload.sn,
          device_id: device.deviceId,
          ts: new Date((baseTimestamp + i) * 1000),
          current_value: rmsValue,
          msg_id: payload.msgId,
          source_topic: topic,
        });
      });
    }

    const deviceCount = payload.devices.length;
    const pointCount = rows.length;

    // 5. Upsert sensor and devices (auto-discovery)
    // Sensor first (devices FK → sensor), then all devices in parallel
    await upsertSensor(pool, payload.sn);
    await Promise.all(payload.devices.map((d) => upsertDevice(pool, payload.sn, d.deviceId)));

    // 6. Bulk insert measurements
    await bulkInsert(pool, rows);

    // 7. Log successful ingestion to ingestion_messages
    await pool.query(
      `INSERT INTO ingestion_messages
         (msg_id, sensor_sn, topic, payload_size, device_count, point_count, status, received_at, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'success', $7, NOW())`,
      [payload.msgId, payload.sn, topic, payloadSize, deviceCount, pointCount, receivedAt],
    );

    log('info', 'ingestion_message_processed', {
      msgId: payload.msgId,
      sensorSn: payload.sn,
      topic,
      payloadBytes: payloadSize,
      deviceCount,
      pointCount,
      receivedAt: receivedAt.toISOString(),
      processedAt: new Date().toISOString(),
      devices: payload.devices.map((device) => ({
        deviceId: device.deviceId,
        rmsCount: device.deviceData.rms.length,
        firstMeasurementTs: new Date(device.deviceData.timestamp * 1000).toISOString(),
        lastMeasurementTs: new Date(
          (device.deviceData.timestamp + device.deviceData.rms.length - 1) * 1000,
        ).toISOString(),
        minCurrent: Math.min(...device.deviceData.rms),
        maxCurrent: Math.max(...device.deviceData.rms),
      })),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorType =
      err instanceof TopicParseError
        ? 'TOPIC_PARSE_ERROR'
        : err instanceof DecodeError
          ? 'DECODE_ERROR'
          : 'PROCESSING_ERROR';

    logError('ingestion_message_failed', err, {
      topic,
      sensorSn,
      msgId,
      payloadBytes: payloadSize,
      errorType,
      receivedAt: receivedAt.toISOString(),
      payloadSummary: summarizeRawPayload(raw),
    });

    // Log to ingestion_messages if we have enough context
    try {
      await pool.query(
        `INSERT INTO ingestion_messages
           (msg_id, sensor_sn, topic, payload_size, device_count, point_count, status, error_message, received_at, processed_at)
         VALUES ($1, $2, $3, $4, 0, 0, 'failed', $5, $6, NOW())`,
        [msgId ?? null, sensorSn ?? null, topic, payloadSize, errorMessage, receivedAt],
      );
    } catch (logErr) {
      logError('ingestion_message_failure_audit_failed', logErr, { topic, sensorSn, msgId });
    }

    // Log to ingestion_error_logs with the raw payload
    try {
      await pool.query(
        `INSERT INTO ingestion_error_logs
           (topic, error_type, error_message, raw_payload_base64, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [topic, errorType, errorMessage, buffer.toString('base64')],
      );
    } catch (logErr) {
      logError('ingestion_error_payload_audit_failed', logErr, { topic, sensorSn, msgId });
    }
  }
}

function summarizeRawPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw === undefined ? null : { valueType: typeof raw };
  }

  const record = raw as Record<string, unknown>;
  const devices = Array.isArray(record['devices']) ? record['devices'] : [];
  return {
    keys: Object.keys(record),
    msgId: stringifyScalar(record['msgId']),
    sn: stringifyScalar(record['sn']),
    timestamp: stringifyScalar(record['timestamp']),
    timestampType: typeof record['timestamp'],
    rssi: stringifyScalar(record['rssi']),
    version: stringifyScalar(record['version']),
    battery: stringifyScalar(record['battery']),
    deviceCount: devices.length,
    devices: devices.slice(0, 5).map((device, index) => summarizeRawDevice(device, index)),
  };
}

function summarizeRawDevice(device: unknown, index: number): Record<string, unknown> {
  if (!device || typeof device !== 'object' || Array.isArray(device)) {
    return { index, valueType: typeof device };
  }

  const record = device as Record<string, unknown>;
  const deviceData =
    record['deviceData'] &&
    typeof record['deviceData'] === 'object' &&
    !Array.isArray(record['deviceData'])
      ? (record['deviceData'] as Record<string, unknown>)
      : null;
  const rms = Array.isArray(deviceData?.['rms']) ? (deviceData['rms'] as unknown[]) : [];
  const numericRms = rms.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  return {
    index,
    deviceId: stringifyScalar(record['deviceId']),
    deviceFirmware: stringifyScalar(record['deviceFirmware']),
    deviceState: stringifyScalar(record['deviceState']),
    deviceDataTimestamp: stringifyScalar(deviceData?.['timestamp']),
    deviceDataTimestampType: typeof deviceData?.['timestamp'],
    rmsCount: rms.length,
    rmsNonzeroCount: numericRms.filter((v) => v !== 0).length,
    rmsMin: numericRms.length ? Math.min(...numericRms) : null,
    rmsMax: numericRms.length ? Math.max(...numericRms) : null,
  };
}

function stringifyScalar(value: unknown): string | number | boolean | null {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return value == null ? null : String(value);
}

class TopicParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicParseError';
  }
}

class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}
