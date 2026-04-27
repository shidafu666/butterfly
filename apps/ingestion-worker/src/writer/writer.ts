import { Pool } from 'pg';

export interface CurrentMeasurementRow {
  sensor_sn: string;
  device_id: string;
  ts: Date;
  current_value: number;
  msg_id: string;
  source_topic: string;
}

const CHUNK_SIZE = 1000;
const COLUMNS_PER_ROW = 6;

export async function bulkInsert(pool: Pool, rows: CurrentMeasurementRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    await insertChunk(pool, chunk);
  }
}

async function insertChunk(pool: Pool, chunk: CurrentMeasurementRow[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < chunk.length; i++) {
    const row = chunk[i];
    const base = i * COLUMNS_PER_ROW;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
    );
    values.push(
      row.sensor_sn,
      row.device_id,
      row.ts,
      row.current_value,
      row.msg_id,
      row.source_topic,
    );
  }

  const sql = `
    INSERT INTO raw_current_measurements (sensor_sn, device_id, ts, current_value, msg_id, source_topic)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT DO NOTHING
  `;

  await pool.query(sql, values);
}

export async function upsertSensor(pool: Pool, sensorSn: string): Promise<void> {
  await pool.query(
    `INSERT INTO sensors (sensor_sn, status, created_at, updated_at)
     VALUES ($1, 'active', NOW(), NOW())
     ON CONFLICT (sensor_sn) DO NOTHING`,
    [sensorSn],
  );
}

export async function upsertDevice(pool: Pool, sensorSn: string, deviceId: string): Promise<void> {
  // Single query: look up sensor and insert device in one round-trip
  await pool.query(
    `INSERT INTO devices (sensor_id, device_id)
     SELECT id, $2 FROM sensors WHERE sensor_sn = $1
     ON CONFLICT (sensor_id, device_id) DO NOTHING`,
    [sensorSn, deviceId],
  );
}
