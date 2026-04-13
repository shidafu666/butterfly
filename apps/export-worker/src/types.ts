export interface ExportJobRecord {
  id: string;
  user_id: string | null;
  sensor_sn: string;
  device_id: string | null;
  start_time: Date;
  end_time: Date;
  resolution: 'raw' | '1m' | '1h';
  format: 'csv' | 'log';
  status: string;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  row_count: number | null;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface ExportResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  rowCount: number;
}
