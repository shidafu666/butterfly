import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { ExportJobRecord, ExportResult } from '../types';

const PAGE_SIZE = 5000;

export async function exportCsv(
  pool: Pool,
  job: ExportJobRecord,
  outputDir: string,
): Promise<ExportResult> {
  const resolution = job.resolution;
  const fileName = buildFileName(job, 'csv');
  const filePath = path.join(outputDir, fileName);

  const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' });

  let rowCount = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      (async () => {
        try {
          if (resolution === 'raw') {
            writeStream.write('sensor_sn,device_id,timestamp,current_value\n');
            rowCount = await streamRawCsv(pool, job, writeStream);
          } else {
            writeStream.write(
              'sensor_sn,device_id,bucket,avg_current,min_current,max_current,sample_count\n',
            );
            rowCount = await streamAggregatedCsv(pool, job, resolution, writeStream);
          }
          writeStream.end();
        } catch (err) {
          writeStream.destroy(err instanceof Error ? err : new Error(String(err)));
          reject(err);
        }
      })();
    });
  } catch (err) {
    // Clean up partial file on error
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw err;
  }

  const stat = fs.statSync(filePath);
  return { filePath, fileName, fileSize: stat.size, rowCount };
}

async function streamRawCsv(
  pool: Pool,
  job: ExportJobRecord,
  stream: fs.WriteStream,
): Promise<number> {
  let offset = 0;
  let total = 0;

  while (true) {
    const params: unknown[] = [job.sensor_sn, job.start_time, job.end_time, PAGE_SIZE, offset];
    let sql: string;

    if (job.device_id) {
      sql = `
        SELECT sensor_sn, device_id, ts, current_value
        FROM raw_current_measurements
        WHERE sensor_sn = $1
          AND device_id = $6
          AND ts >= $2
          AND ts < $3
        ORDER BY ts ASC
        LIMIT $4 OFFSET $5
      `;
      params.push(job.device_id);
    } else {
      sql = `
        SELECT sensor_sn, device_id, ts, current_value
        FROM raw_current_measurements
        WHERE sensor_sn = $1
          AND ts >= $2
          AND ts < $3
        ORDER BY ts ASC
        LIMIT $4 OFFSET $5
      `;
    }

    const result = await pool.query<{
      sensor_sn: string;
      device_id: string;
      ts: Date;
      current_value: number;
    }>(sql, params);

    for (const row of result.rows) {
      stream.write(
        `${escapeCsv(row.sensor_sn)},${escapeCsv(row.device_id)},${row.ts.toISOString()},${row.current_value}\n`,
      );
    }

    total += result.rows.length;
    offset += result.rows.length;

    if (result.rows.length < PAGE_SIZE) break;
  }

  return total;
}

async function streamAggregatedCsv(
  pool: Pool,
  job: ExportJobRecord,
  resolution: '1m' | '1h',
  stream: fs.WriteStream,
): Promise<number> {
  const viewName = resolution === '1m' ? 'current_1m' : 'current_1h';
  let offset = 0;
  let total = 0;

  while (true) {
    const params: unknown[] = [job.sensor_sn, job.start_time, job.end_time, PAGE_SIZE, offset];
    let sql: string;

    if (job.device_id) {
      sql = `
        SELECT sensor_sn, device_id, bucket, avg_current, min_current, max_current, sample_count
        FROM ${viewName}
        WHERE sensor_sn = $1
          AND device_id = $6
          AND bucket >= $2
          AND bucket < $3
        ORDER BY bucket ASC
        LIMIT $4 OFFSET $5
      `;
      params.push(job.device_id);
    } else {
      sql = `
        SELECT sensor_sn, device_id, bucket, avg_current, min_current, max_current, sample_count
        FROM ${viewName}
        WHERE sensor_sn = $1
          AND bucket >= $2
          AND bucket < $3
        ORDER BY bucket ASC
        LIMIT $4 OFFSET $5
      `;
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
      stream.write(
        `${escapeCsv(row.sensor_sn)},${escapeCsv(row.device_id)},${row.bucket.toISOString()},${row.avg_current},${row.min_current},${row.max_current},${row.sample_count}\n`,
      );
    }

    total += result.rows.length;
    offset += result.rows.length;

    if (result.rows.length < PAGE_SIZE) break;
  }

  return total;
}

function buildFileName(job: ExportJobRecord, ext: string): string {
  const devicePart = job.device_id ? sanitizeSegment(job.device_id) : 'all';
  return `export_${job.id}_${sanitizeSegment(job.sensor_sn)}_${devicePart}_${job.resolution}.${ext}`;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
