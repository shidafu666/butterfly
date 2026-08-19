import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { Pool } from 'pg';
import { ExportJobRecord, ExportResult } from '../types';
import { buildExportFileName } from './file-name';

const PAGE_SIZE = 5000;

export async function exportLog(
  pool: Pool,
  job: ExportJobRecord,
  outputDir: string,
): Promise<ExportResult> {
  const fileName = buildExportFileName(job, 'log');
  const jobOutputDir = path.join(outputDir, job.id);
  const filePath = path.join(jobOutputDir, fileName);

  fs.mkdirSync(jobOutputDir, { recursive: true });
  const fileStream = fs.createWriteStream(filePath);

  let rowCount = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);

      (async () => {
        try {
          if (job.resolution === 'raw') {
            rowCount = await streamRawLog(pool, job, fileStream);
          } else {
            rowCount = await streamAggregatedLog(pool, job, job.resolution, fileStream);
          }
          fileStream.end();
        } catch (err) {
          fileStream.destroy(err instanceof Error ? err : new Error(String(err)));
          reject(err);
        }
      })();
    });
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
      fs.rmdirSync(jobOutputDir);
    } catch {
      /* ignore */
    }
    throw err;
  }

  const stat = fs.statSync(filePath);
  return { filePath, fileName, fileSize: stat.size, rowCount };
}

async function streamRawLog(pool: Pool, job: ExportJobRecord, stream: Writable): Promise<number> {
  let lastTs: Date | null = null;
  let lastId: string | null = null;
  let total = 0;

  while (true) {
    let sql: string;
    let params: unknown[];

    if (job.device_id) {
      if (lastTs && lastId) {
        sql = `
          SELECT id, ts, current_value
          FROM raw_current_measurements
          WHERE sensor_sn = $1
            AND device_id = $2
            AND ts >= $3
            AND ts < $4
            AND (ts > $5 OR (ts = $5 AND id > $6::bigint))
          ORDER BY ts ASC, id ASC
          LIMIT $7
        `;
        params = [
          job.sensor_sn,
          job.device_id,
          job.start_time,
          job.end_time,
          lastTs,
          lastId,
          PAGE_SIZE,
        ];
      } else {
        sql = `
          SELECT id, ts, current_value
          FROM raw_current_measurements
          WHERE sensor_sn = $1
            AND device_id = $2
            AND ts >= $3
            AND ts < $4
          ORDER BY ts ASC, id ASC
          LIMIT $5
        `;
        params = [job.sensor_sn, job.device_id, job.start_time, job.end_time, PAGE_SIZE];
      }
    } else if (lastTs && lastId) {
      sql = `
        SELECT id, ts, current_value
        FROM raw_current_measurements
        WHERE sensor_sn = $1
          AND ts >= $2
          AND ts < $3
          AND (ts > $4 OR (ts = $4 AND id > $5::bigint))
        ORDER BY ts ASC, id ASC
        LIMIT $6
      `;
      params = [job.sensor_sn, job.start_time, job.end_time, lastTs, lastId, PAGE_SIZE];
    } else {
      sql = `
        SELECT id, ts, current_value
        FROM raw_current_measurements
        WHERE sensor_sn = $1
          AND ts >= $2
          AND ts < $3
        ORDER BY ts ASC, id ASC
        LIMIT $4
      `;
      params = [job.sensor_sn, job.start_time, job.end_time, PAGE_SIZE];
    }

    const result = await pool.query<{
      id: string;
      ts: Date;
      current_value: number;
    }>(sql, params);

    for (const row of result.rows) {
      const line = `[${row.ts.toISOString()}] current=${row.current_value}A\n`;
      stream.write(line);
    }

    total += result.rows.length;

    if (result.rows.length > 0) {
      const lastRow = result.rows[result.rows.length - 1];
      lastTs = lastRow.ts;
      lastId = String(lastRow.id);
    }

    if (result.rows.length < PAGE_SIZE) break;
  }

  return total;
}

async function streamAggregatedLog(
  pool: Pool,
  job: ExportJobRecord,
  resolution: '1m' | '1h',
  stream: Writable,
): Promise<number> {
  const viewName = resolution === '1m' ? 'current_1m' : 'current_1h';
  let lastBucket: Date | null = null;
  let lastDeviceId: string | null = null;
  let total = 0;

  while (true) {
    let sql: string;
    let params: unknown[];

    if (job.device_id) {
      if (lastBucket) {
        sql = `
          SELECT sensor_sn, device_id, bucket, avg_current, min_current, max_current, sample_count
          FROM ${viewName}
          WHERE sensor_sn = $1
            AND device_id = $2
            AND bucket >= $3
            AND bucket < $4
            AND bucket > $5
          ORDER BY bucket ASC
          LIMIT $6
        `;
        params = [
          job.sensor_sn,
          job.device_id,
          job.start_time,
          job.end_time,
          lastBucket,
          PAGE_SIZE,
        ];
      } else {
        sql = `
          SELECT sensor_sn, device_id, bucket, avg_current, min_current, max_current, sample_count
          FROM ${viewName}
          WHERE sensor_sn = $1
            AND device_id = $2
            AND bucket >= $3
            AND bucket < $4
          ORDER BY bucket ASC
          LIMIT $5
        `;
        params = [job.sensor_sn, job.device_id, job.start_time, job.end_time, PAGE_SIZE];
      }
    } else if (lastBucket && lastDeviceId) {
      sql = `
        SELECT sensor_sn, device_id, bucket, avg_current, min_current, max_current, sample_count
        FROM ${viewName}
        WHERE sensor_sn = $1
          AND bucket >= $2
          AND bucket < $3
          AND (bucket > $4 OR (bucket = $4 AND device_id > $5))
        ORDER BY bucket ASC, device_id ASC
        LIMIT $6
      `;
      params = [job.sensor_sn, job.start_time, job.end_time, lastBucket, lastDeviceId, PAGE_SIZE];
    } else {
      sql = `
        SELECT sensor_sn, device_id, bucket, avg_current, min_current, max_current, sample_count
        FROM ${viewName}
        WHERE sensor_sn = $1
          AND bucket >= $2
          AND bucket < $3
        ORDER BY bucket ASC, device_id ASC
        LIMIT $4
      `;
      params = [job.sensor_sn, job.start_time, job.end_time, PAGE_SIZE];
    }

    const result = await pool.query<{
      sensor_sn: string;
      device_id: string;
      bucket: Date;
      avg_current: number;
      min_current: number;
      max_current: number;
      sample_count: number;
    }>(sql, params);

    for (const row of result.rows) {
      const line = `[${row.bucket.toISOString()}] sensor=${row.sensor_sn} device=${row.device_id} avg=${row.avg_current}A min=${row.min_current}A max=${row.max_current}A samples=${row.sample_count}\n`;
      stream.write(line);
    }

    total += result.rows.length;

    if (result.rows.length > 0) {
      const lastRow = result.rows[result.rows.length - 1];
      lastBucket = lastRow.bucket;
      lastDeviceId = lastRow.device_id;
    }

    if (result.rows.length < PAGE_SIZE) break;
  }

  return total;
}
