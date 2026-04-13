import { Job } from 'bullmq';
import { Pool } from 'pg';
import { ExportJobRecord } from '../types';
import { exportCsv } from '../exporters/csv.exporter';
import { exportLog } from '../exporters/log.exporter';
import { ensureExportDir } from '../storage/storage';

interface ExportJobData {
  jobId: string;
}

export async function processExportJob(job: Job<ExportJobData>, pool: Pool): Promise<void> {
  const { jobId } = job.data;
  const outputDir = process.env.EXPORT_DIR ?? '/app/exports';

  console.log(`[export-worker] Processing export job: ${jobId}`);

  // 1. Fetch job record from export_jobs table
  const jobRecord = await fetchExportJob(pool, jobId);
  if (!jobRecord) {
    throw new Error(`Export job not found in database: ${jobId}`);
  }

  // 2. Mark as processing
  await updateJobStatus(pool, jobId, 'processing');

  try {
    // 3. Ensure the output directory exists
    ensureExportDir(outputDir);

    // 4. Dispatch to the appropriate exporter
    let result: { filePath: string; fileName: string; fileSize: number; rowCount: number };

    if (jobRecord.format === 'csv') {
      result = await exportCsv(pool, jobRecord, outputDir);
    } else if (jobRecord.format === 'log') {
      result = await exportLog(pool, jobRecord, outputDir);
    } else {
      throw new Error(`Unsupported export format: ${jobRecord.format}`);
    }

    // 5. Mark as completed
    await pool.query(
      `UPDATE export_jobs
       SET status = 'completed',
           file_path = $2,
           file_name = $3,
           file_size = $4,
           row_count = $5,
           completed_at = NOW()
       WHERE id = $1`,
      [jobId, result.filePath, result.fileName, result.fileSize, result.rowCount],
    );

    console.log(
      `[export-worker] Job ${jobId} completed: file=${result.fileName} rows=${result.rowCount} size=${result.fileSize}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[export-worker] Job ${jobId} failed: ${errorMessage}`);

    await pool.query(
      `UPDATE export_jobs
       SET status = 'failed',
           error_message = $2,
           completed_at = NOW()
       WHERE id = $1`,
      [jobId, errorMessage],
    );

    // Re-throw so BullMQ can handle retries / dead-letter
    throw err;
  }
}

async function fetchExportJob(pool: Pool, jobId: string): Promise<ExportJobRecord | null> {
  const result = await pool.query<ExportJobRecord>(
    `SELECT id, user_id, sensor_sn, device_id, start_time, end_time,
            resolution, format, status, file_path, file_name, file_size,
            row_count, error_message, created_at, completed_at
     FROM export_jobs
     WHERE id = $1`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

async function updateJobStatus(pool: Pool, jobId: string, status: string): Promise<void> {
  await pool.query(
    `UPDATE export_jobs SET status = $2 WHERE id = $1`,
    [jobId, status],
  );
}
