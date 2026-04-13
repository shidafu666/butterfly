import { Pool } from 'pg';
import { decodePayload } from '../decoder/decoder';
import { validatePayload } from '../validator/validator';
import {
  bulkInsert,
  upsertSensor,
  upsertDevice,
  CurrentMeasurementRow,
} from '../writer/writer';

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

export async function handleMessage(
  topic: string,
  buffer: Buffer,
  pool: Pool,
): Promise<void> {
  const receivedAt = new Date();
  let msgId: string | undefined;
  let sensorSn: string | undefined;
  let payloadSize: number = buffer.length;

  try {
    // 1. Parse sensor_sn from topic
    const topicSn = parseSensorSnFromTopic(topic);
    if (!topicSn) {
      throw new TopicParseError(`Cannot parse sensor SN from topic: "${topic}"`);
    }
    sensorSn = topicSn;

    // 2. Decode MessagePack
    let raw: unknown;
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
    await upsertSensor(pool, payload.sn);
    for (const device of payload.devices) {
      await upsertDevice(pool, payload.sn, device.deviceId);
    }

    // 6. Bulk insert measurements
    await bulkInsert(pool, rows);

    // 7. Log successful ingestion to ingestion_messages
    await pool.query(
      `INSERT INTO ingestion_messages
         (msg_id, sensor_sn, topic, payload_size, device_count, point_count, status, received_at, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'success', $7, NOW())`,
      [
        payload.msgId,
        payload.sn,
        topic,
        payloadSize,
        deviceCount,
        pointCount,
        receivedAt,
      ],
    );

    console.log(
      `[ingestion-worker] Processed msgId=${payload.msgId} sn=${payload.sn} ` +
        `devices=${deviceCount} points=${pointCount}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorType = err instanceof TopicParseError
      ? 'TOPIC_PARSE_ERROR'
      : err instanceof DecodeError
        ? 'DECODE_ERROR'
        : 'PROCESSING_ERROR';

    console.error(
      `[ingestion-worker] Error handling message on topic "${topic}": [${errorType}] ${errorMessage}`,
    );

    // Log to ingestion_messages if we have enough context
    try {
      await pool.query(
        `INSERT INTO ingestion_messages
           (msg_id, sensor_sn, topic, payload_size, device_count, point_count, status, error_message, received_at, processed_at)
         VALUES ($1, $2, $3, $4, 0, 0, 'failed', $5, $6, NOW())`,
        [
          msgId ?? null,
          sensorSn ?? null,
          topic,
          payloadSize,
          errorMessage,
          receivedAt,
        ],
      );
    } catch (logErr) {
      console.error('[ingestion-worker] Failed to log to ingestion_messages:', logErr);
    }

    // Log to ingestion_error_logs with the raw payload
    try {
      await pool.query(
        `INSERT INTO ingestion_error_logs
           (topic, error_type, error_message, raw_payload_base64, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [
          topic,
          errorType,
          errorMessage,
          buffer.toString('base64'),
        ],
      );
    } catch (logErr) {
      console.error('[ingestion-worker] Failed to log to ingestion_error_logs:', logErr);
    }
  }
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
