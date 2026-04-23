// API Response / Request Types

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

// ─── Auth ──────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  status: string;
  localAuth: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// ─── Sensors ───────────────────────────────────────────────

export interface SensorDto {
  id: string;
  sensorSn: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  lastReportTime: string | null;
  isActive: boolean;
}

export interface DeviceDto {
  id: string;
  sensorId: string;
  deviceId: string;
  displayName: string | null;
  status: string;
}

// ─── Current Data ──────────────────────────────────────────

export type Resolution = 'auto' | 'raw' | '1m' | '1h' | '1d';

export interface CurrentDataQuery {
  sensorSn: string;
  deviceId?: string;
  startTime: string;  // ISO 8601
  endTime: string;    // ISO 8601
  resolution?: Resolution;
}

export interface RawDataPoint {
  timestamp: string;
  currentValue: number;
}

export interface AggregatedDataPoint {
  timestamp: string;
  avgCurrent: number;
  minCurrent: number;
  maxCurrent: number;
  sampleCount: number;
}

export interface CurrentDataResponse {
  sensorSn: string;
  deviceId: string | null;
  resolution: Resolution;
  points: RawDataPoint[] | AggregatedDataPoint[];
}

export interface CurrentDataSummary {
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
}

// ─── Export ────────────────────────────────────────────────

export interface CreateExportRequest {
  sensorSn: string;
  deviceId?: string;
  startTime: string;
  endTime: string;
  resolution: 'raw' | '1m' | '1h' | '1d';  // 'auto' is not valid for exports
  format: 'csv' | 'log';
}

export interface ExportJobDto {
  id: string;
  sensorSn: string;
  deviceId: string | null;
  startTime: string;
  endTime: string;
  resolution: string;
  format: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  fileName: string | null;
  fileSize: number | null;
  rowCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ─── Sensor Overview ───────────────────────────────────────

export interface SensorOverviewDto {
  id: string;
  sensorSn: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  lastReportTime: string | null;
  isActive: boolean;
}

// ─── Admin ─────────────────────────────────────────────────

export interface AdminUserDto {
  id: string;
  email: string;
  name: string | null;
  status: string;
  roles: string[];
  localAuth: boolean;
  ssoAuth: boolean;
  createdAt: string;
}

export interface AssignRoleRequest {
  roleCode: string;
}

export interface AssignSensorRequest {
  sensorSn: string;
  canView: boolean;
  canExport: boolean;
}

// ─── Audit ─────────────────────────────────────────────────

export interface AuditLogDto {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ─── Dashboard ─────────────────────────────────────────────

export interface DashboardStats {
  totalSensors: number;
  totalDevices: number;
  todayDataPoints: number;
  recentExports: ExportJobDto[];
}
