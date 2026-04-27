import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CurrentDataResponse,
  CurrentDataSummary,
  RawDataPoint,
  AggregatedDataPoint,
} from '@butterfly/shared-types';
import { CurrentDataQueryDto } from './dto/current-data-query.dto';

function resolveResolution(startTime: Date, endTime: Date, requested: string): string {
  if (requested !== 'auto') return requested;
  const diffMs = endTime.getTime() - startTime.getTime();
  const sixHours = 6 * 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (diffMs <= sixHours) return 'raw';
  if (diffMs <= sevenDays) return '1m';
  if (diffMs <= thirtyDays) return '1h';
  return '1d';
}

interface RawRow {
  ts: Date;
  current_value: number;
}

interface AggRow {
  bucket: Date;
  avg_current: number;
  min_current: number;
  max_current: number;
  sample_count: bigint;
}

interface SummaryRow {
  min_val: number | null;
  max_val: number | null;
  avg_val: number | null;
  cnt: bigint;
}

@Injectable()
export class CurrentDataService {
  constructor(private prisma: PrismaService) {}

  private async checkPermission(
    sensorSn: string,
    userId: string,
    userRoles: string[],
    requireExport = false,
  ): Promise<void> {
    if (userRoles.includes('admin')) return;

    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }

    const permission = await this.prisma.userSensorPermission.findUnique({
      where: { userId_sensorId: { userId, sensorId: sensor.id } },
    });

    if (!permission || !permission.canView) {
      throw new ForbiddenException(`No view access to sensor '${sensorSn}'`);
    }

    if (requireExport && !permission.canExport) {
      throw new ForbiddenException(`No export access to sensor '${sensorSn}'`);
    }
  }

  async queryData(
    params: CurrentDataQueryDto,
    userId: string,
    userRoles: string[],
  ): Promise<CurrentDataResponse> {
    await this.checkPermission(params.sensorSn, userId, userRoles);

    const startTime = new Date(params.startTime);
    const endTime = new Date(params.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException('Invalid startTime or endTime');
    }

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const resolution = resolveResolution(startTime, endTime, params.resolution ?? 'auto');

    if (resolution === 'raw') {
      return this.queryRaw(params.sensorSn, params.deviceId, startTime, endTime);
    } else if (resolution === '1m') {
      return this.query1m(params.sensorSn, params.deviceId, startTime, endTime);
    } else if (resolution === '1h') {
      return this.query1h(params.sensorSn, params.deviceId, startTime, endTime);
    } else {
      return this.query1d(params.sensorSn, params.deviceId, startTime, endTime);
    }
  }

  private async queryRaw(
    sensorSn: string,
    deviceId: string | undefined,
    startTime: Date,
    endTime: Date,
  ): Promise<CurrentDataResponse> {
    let rows: RawRow[];

    if (deviceId) {
      rows = await this.prisma.$queryRaw<RawRow[]>`
        SELECT ts, current_value
        FROM raw_current_measurements
        WHERE sensor_sn = ${sensorSn}
          AND device_id = ${deviceId}
          AND ts >= ${startTime}
          AND ts < ${endTime}
        ORDER BY ts ASC
      `;
    } else {
      rows = await this.prisma.$queryRaw<RawRow[]>`
        SELECT ts, current_value
        FROM raw_current_measurements
        WHERE sensor_sn = ${sensorSn}
          AND ts >= ${startTime}
          AND ts < ${endTime}
        ORDER BY ts ASC
      `;
    }

    const points: RawDataPoint[] = rows.map((r) => ({
      timestamp: r.ts instanceof Date ? r.ts.toISOString() : new Date(r.ts).toISOString(),
      currentValue: Number(r.current_value),
    }));

    return {
      sensorSn,
      deviceId: deviceId ?? null,
      resolution: 'raw',
      points,
    };
  }

  private async query1m(
    sensorSn: string,
    deviceId: string | undefined,
    startTime: Date,
    endTime: Date,
  ): Promise<CurrentDataResponse> {
    let rows: AggRow[];

    if (deviceId) {
      rows = await this.prisma.$queryRaw<AggRow[]>`
        SELECT bucket AS bucket, avg_current, min_current, max_current, sample_count
        FROM current_1m
        WHERE sensor_sn = ${sensorSn}
          AND device_id = ${deviceId}
          AND bucket >= ${startTime}
          AND bucket < ${endTime}
        ORDER BY bucket ASC
      `;
    } else {
      rows = await this.prisma.$queryRaw<AggRow[]>`
        SELECT bucket AS bucket, avg_current, min_current, max_current, sample_count
        FROM current_1m
        WHERE sensor_sn = ${sensorSn}
          AND bucket >= ${startTime}
          AND bucket < ${endTime}
        ORDER BY bucket ASC
      `;
    }

    const points: AggregatedDataPoint[] = rows.map((r) => ({
      timestamp:
        r.bucket instanceof Date ? r.bucket.toISOString() : new Date(r.bucket).toISOString(),
      avgCurrent: Number(r.avg_current),
      minCurrent: Number(r.min_current),
      maxCurrent: Number(r.max_current),
      sampleCount: Number(r.sample_count),
    }));

    return {
      sensorSn,
      deviceId: deviceId ?? null,
      resolution: '1m',
      points,
    };
  }

  private async query1h(
    sensorSn: string,
    deviceId: string | undefined,
    startTime: Date,
    endTime: Date,
  ): Promise<CurrentDataResponse> {
    let rows: AggRow[];

    if (deviceId) {
      rows = await this.prisma.$queryRaw<AggRow[]>`
        SELECT bucket AS bucket, avg_current, min_current, max_current, sample_count
        FROM current_1h
        WHERE sensor_sn = ${sensorSn}
          AND device_id = ${deviceId}
          AND bucket >= ${startTime}
          AND bucket < ${endTime}
        ORDER BY bucket ASC
      `;
    } else {
      rows = await this.prisma.$queryRaw<AggRow[]>`
        SELECT bucket AS bucket, avg_current, min_current, max_current, sample_count
        FROM current_1h
        WHERE sensor_sn = ${sensorSn}
          AND bucket >= ${startTime}
          AND bucket < ${endTime}
        ORDER BY bucket ASC
      `;
    }

    const points: AggregatedDataPoint[] = rows.map((r) => ({
      timestamp:
        r.bucket instanceof Date ? r.bucket.toISOString() : new Date(r.bucket).toISOString(),
      avgCurrent: Number(r.avg_current),
      minCurrent: Number(r.min_current),
      maxCurrent: Number(r.max_current),
      sampleCount: Number(r.sample_count),
    }));

    return {
      sensorSn,
      deviceId: deviceId ?? null,
      resolution: '1h',
      points,
    };
  }

  private async query1d(
    sensorSn: string,
    deviceId: string | undefined,
    startTime: Date,
    endTime: Date,
  ): Promise<CurrentDataResponse> {
    let rows: AggRow[];

    if (deviceId) {
      rows = await this.prisma.$queryRaw<AggRow[]>`
        SELECT bucket AS bucket, avg_current, min_current, max_current, sample_count
        FROM current_1d
        WHERE sensor_sn = ${sensorSn}
          AND device_id = ${deviceId}
          AND bucket >= ${startTime}
          AND bucket < ${endTime}
        ORDER BY bucket ASC
      `;
    } else {
      rows = await this.prisma.$queryRaw<AggRow[]>`
        SELECT bucket AS bucket, avg_current, min_current, max_current, sample_count
        FROM current_1d
        WHERE sensor_sn = ${sensorSn}
          AND bucket >= ${startTime}
          AND bucket < ${endTime}
        ORDER BY bucket ASC
      `;
    }

    const points: AggregatedDataPoint[] = rows.map((r) => ({
      timestamp:
        r.bucket instanceof Date ? r.bucket.toISOString() : new Date(r.bucket).toISOString(),
      avgCurrent: Number(r.avg_current),
      minCurrent: Number(r.min_current),
      maxCurrent: Number(r.max_current),
      sampleCount: Number(r.sample_count),
    }));

    return {
      sensorSn,
      deviceId: deviceId ?? null,
      resolution: '1d',
      points,
    };
  }

  async getSummary(
    params: CurrentDataQueryDto,
    userId: string,
    userRoles: string[],
  ): Promise<CurrentDataSummary> {
    await this.checkPermission(params.sensorSn, userId, userRoles);

    const startTime = new Date(params.startTime);
    const endTime = new Date(params.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException('Invalid startTime or endTime');
    }

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const resolution = resolveResolution(startTime, endTime, params.resolution ?? 'auto');

    let rows: SummaryRow[];

    if (resolution === 'raw') {
      if (params.deviceId) {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(current_value)::float AS min_val,
            MAX(current_value)::float AS max_val,
            AVG(current_value)::float AS avg_val,
            COUNT(*) AS cnt
          FROM raw_current_measurements
          WHERE sensor_sn = ${params.sensorSn}
            AND device_id = ${params.deviceId}
            AND ts >= ${startTime}
            AND ts < ${endTime}
        `;
      } else {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(current_value)::float AS min_val,
            MAX(current_value)::float AS max_val,
            AVG(current_value)::float AS avg_val,
            COUNT(*) AS cnt
          FROM raw_current_measurements
          WHERE sensor_sn = ${params.sensorSn}
            AND ts >= ${startTime}
            AND ts < ${endTime}
        `;
      }
    } else if (resolution === '1m') {
      if (params.deviceId) {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(min_current)::float AS min_val,
            MAX(max_current)::float AS max_val,
            AVG(avg_current)::float AS avg_val,
            SUM(sample_count) AS cnt
          FROM current_1m
          WHERE sensor_sn = ${params.sensorSn}
            AND device_id = ${params.deviceId}
            AND bucket >= ${startTime}
            AND bucket < ${endTime}
        `;
      } else {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(min_current)::float AS min_val,
            MAX(max_current)::float AS max_val,
            AVG(avg_current)::float AS avg_val,
            SUM(sample_count) AS cnt
          FROM current_1m
          WHERE sensor_sn = ${params.sensorSn}
            AND bucket >= ${startTime}
            AND bucket < ${endTime}
        `;
      }
    } else if (resolution === '1h') {
      if (params.deviceId) {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(min_current)::float AS min_val,
            MAX(max_current)::float AS max_val,
            AVG(avg_current)::float AS avg_val,
            SUM(sample_count) AS cnt
          FROM current_1h
          WHERE sensor_sn = ${params.sensorSn}
            AND device_id = ${params.deviceId}
            AND bucket >= ${startTime}
            AND bucket < ${endTime}
        `;
      } else {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(min_current)::float AS min_val,
            MAX(max_current)::float AS max_val,
            AVG(avg_current)::float AS avg_val,
            SUM(sample_count) AS cnt
          FROM current_1h
          WHERE sensor_sn = ${params.sensorSn}
            AND bucket >= ${startTime}
            AND bucket < ${endTime}
        `;
      }
    } else {
      if (params.deviceId) {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(min_current)::float AS min_val,
            MAX(max_current)::float AS max_val,
            AVG(avg_current)::float AS avg_val,
            SUM(sample_count) AS cnt
          FROM current_1d
          WHERE sensor_sn = ${params.sensorSn}
            AND device_id = ${params.deviceId}
            AND bucket >= ${startTime}
            AND bucket < ${endTime}
        `;
      } else {
        rows = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MIN(min_current)::float AS min_val,
            MAX(max_current)::float AS max_val,
            AVG(avg_current)::float AS avg_val,
            SUM(sample_count) AS cnt
          FROM current_1d
          WHERE sensor_sn = ${params.sensorSn}
            AND bucket >= ${startTime}
            AND bucket < ${endTime}
        `;
      }
    }

    const row = rows[0];
    return {
      min: row?.min_val != null ? Number(row.min_val) : null,
      max: row?.max_val != null ? Number(row.max_val) : null,
      avg: row?.avg_val != null ? Number(row.avg_val) : null,
      count: row?.cnt != null ? Number(row.cnt) : 0,
    };
  }
}
