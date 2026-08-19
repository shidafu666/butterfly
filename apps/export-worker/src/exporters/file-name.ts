import { ExportJobRecord } from '../types';

export function buildExportFileName(job: ExportJobRecord, extension: 'csv' | 'log'): string {
  const identifier = sanitizeSegment(job.device_id ?? job.sensor_sn);
  const date = job.created_at.toISOString().slice(0, 10).replace(/-/g, '');

  return `${identifier}_${date}.${extension}`;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}
