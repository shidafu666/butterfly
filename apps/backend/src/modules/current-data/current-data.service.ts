import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    }
    return this.queryAggregated(
      resolution as '1m' | '1h' | '1d',
      params.sensorSn,
      params.deviceId,
      startTime,
      endTime,
    );
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

  private static readonly AGG_VIEWS: Record<'1m' | '1h' | '1d', string> = {
    '1m': 'current_1m',
    '1h': 'current_1h',
    '1d': 'current_1d',
  };

  private static readonly AGG_INTERVALS: Record<'1m' | '1h' | '1d', string> = {
    '1m': '1 minute',
    '1h': '1 hour',
    '1d': '1 day',
  };

  private async queryAggregated(
    resolution: '1m' | '1h' | '1d',
    sensorSn: string,
    deviceId: string | undefined,
    startTime: Date,
    endTime: Date,
  ): Promise<CurrentDataResponse> {
    const view = CurrentDataService.AGG_VIEWS[resolution];
    const deviceFilter = deviceId ? Prisma.sql`AND device_id = ${deviceId}` : Prisma.empty;

    // Fast path: read the pre-aggregated view.
    let rows = await this.prisma.$queryRaw<AggRow[]>`
      SELECT bucket AS bucket, avg_current, min_current, max_current, sample_count
      FROM ${Prisma.raw(view)}
      WHERE sensor_sn = ${sensorSn}
        ${deviceFilter}
        AND bucket >= ${startTime}
        AND bucket < ${endTime}
      ORDER BY bucket ASC
    `;

    // Fallback: on Apache-license deployments current_* are plain materialized
    // views with NOW()-relative windows (1m→7d, 1h→90d, 1d→3y), so a range
    // outside the window returns nothing even though raw_current_measurements
    // still has the data. Aggregate raw on the fly so any in-raw range works at
    // any resolution (mirrors the real-time behaviour of the TSL build).
    if (rows.length === 0) {
      const interval = CurrentDataService.AGG_INTERVALS[resolution];
      const groupExtra = deviceId ? Prisma.empty : Prisma.sql`, device_id`;
      rows = await this.prisma.$queryRaw<AggRow[]>`
        SELECT
          time_bucket(${interval}::interval, ts) AS bucket,
          AVG(current_value) AS avg_current,
          MIN(current_value) AS min_current,
          MAX(current_value) AS max_current,
          COUNT(*)           AS sample_count
        FROM raw_current_measurements
        WHERE sensor_sn = ${sensorSn}
          ${deviceFilter}
          AND ts >= ${startTime}
          AND ts < ${endTime}
        GROUP BY bucket ${groupExtra}
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
      resolution,
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

    const deviceFilter = params.deviceId
      ? Prisma.sql`AND device_id = ${params.deviceId}`
      : Prisma.empty;

    // Summary computed directly from raw measurements (also used as the
    // fallback when a windowed materialized view has nothing for the range).
    const summaryFromRaw = () =>
      this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          MIN(current_value)::float AS min_val,
          MAX(current_value)::float AS max_val,
          AVG(current_value)::float AS avg_val,
          COUNT(*) AS cnt
        FROM raw_current_measurements
        WHERE sensor_sn = ${params.sensorSn}
          ${deviceFilter}
          AND ts >= ${startTime}
          AND ts < ${endTime}
      `;

    let rows: SummaryRow[];

    if (resolution === 'raw') {
      rows = await summaryFromRaw();
    } else {
      const view = CurrentDataService.AGG_VIEWS[resolution as '1m' | '1h' | '1d'];
      rows = await this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          MIN(min_current)::float AS min_val,
          MAX(max_current)::float AS max_val,
          AVG(avg_current)::float AS avg_val,
          SUM(sample_count) AS cnt
        FROM ${Prisma.raw(view)}
        WHERE sensor_sn = ${params.sensorSn}
          ${deviceFilter}
          AND bucket >= ${startTime}
          AND bucket < ${endTime}
      `;
      // Same windowed-view gap as queryAggregated: when the pre-aggregated view
      // has no rows for this range, compute the summary straight from raw.
      if (rows[0]?.cnt == null || Number(rows[0].cnt) === 0) {
        rows = await summaryFromRaw();
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
