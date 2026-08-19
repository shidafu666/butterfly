import { ExportJobRecord } from '../types';

export function buildExportFileName(job: ExportJobRecord, extension: 'csv' | 'log'): string {
  const sensorSn = sanitizeSegment(job.sensor_sn);
  const date = job.created_at.toISOString().slice(2, 10).replace(/-/g, '');

  return `${sensorSn}${date}.${extension}`;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}
