import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { SensorDto, SensorOverviewDto, SensorOverviewPageDto } from '@butterfly/shared-types';
import { SensorOverviewQueryDto } from './dto/sensor-overview-query.dto';
import { AuditService } from '../audit/audit.service';

interface SensorRow {
  id: string;
  sensorSn: string;
  displayName: string | null;
  status: string;
  createdAt: Date;
  lastReportTime: Date | null;
  deviceCount?: number | bigint;
}

@Injectable()
export class SensorsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  private get thresholdMs(): number {
    const hours = parseInt(process.env.SENSOR_ACTIVE_THRESHOLD_HOURS ?? '24', 10);
    return hours * 60 * 60 * 1000;
  }

  async findAllForUser(userId: string, userRoles: string[]): Promise<SensorDto[]> {
    let rows: SensorRow[];

    if (userRoles.includes('admin')) {
      rows = await this.prisma.$queryRaw<SensorRow[]>`
        SELECT
          s.id,
          s.sensor_sn     AS "sensorSn",
          s.display_name  AS "displayName",
          s.status,
          s.created_at    AS "createdAt",
          s.updated_at    AS "lastReportTime",
          dc.count        AS "deviceCount"
        FROM sensors s
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count
          FROM devices d
          WHERE d.sensor_id = s.id
        ) dc ON true
        ORDER BY s.created_at ASC
      `;
    } else {
      rows = await this.prisma.$queryRaw<SensorRow[]>`
        SELECT
          s.id,
          s.sensor_sn     AS "sensorSn",
          s.display_name  AS "displayName",
          s.status,
          s.created_at    AS "createdAt",
          s.updated_at    AS "lastReportTime",
          dc.count        AS "deviceCount"
        FROM sensors s
        INNER JOIN user_sensor_permissions p ON p.sensor_id = s.id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count
          FROM devices d
          WHERE d.sensor_id = s.id
        ) dc ON true
        WHERE p.user_id = ${userId}::uuid AND p.can_view = true
        ORDER BY s.created_at ASC
      `;
    }

    const now = Date.now();
    return rows.map((row) => this.toDto(row, now));
  }

  async listOverviewForUser(
    query: SensorOverviewQueryDto,
    userId: string,
    userRoles: string[],
  ): Promise<SensorOverviewPageDto> {
    const thresholdHours = parseInt(process.env.SENSOR_ACTIVE_THRESHOLD_HOURS ?? '24', 10);
    const activeAfter = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 100, 200);
    const offset = (page - 1) * pageSize;
    const filters = [
      query.sensorSn
        ? Prisma.sql`AND s.sensor_sn ILIKE ${`%${query.sensorSn.trim()}%`}`
        : Prisma.empty,
      query.displayName
        ? Prisma.sql`AND s.display_name ILIKE ${`%${query.displayName.trim()}%`}`
        : Prisma.empty,
      query.status ? Prisma.sql`AND s.status = ${query.status}` : Prisma.empty,
    ];
    const permissionFilter = userRoles.includes('admin')
      ? Prisma.empty
      : Prisma.sql`INNER JOIN user_sensor_permissions p ON p.sensor_id = s.id AND p.user_id = ${userId}::uuid AND p.can_view = true`;
    const activeFilter =
      query.isActive === 'true'
        ? Prisma.sql`WHERE last_report_time >= ${activeAfter}`
        : query.isActive === 'false'
          ? Prisma.sql`WHERE last_report_time IS NULL OR last_report_time < ${activeAfter}`
          : Prisma.empty;
    const orderBy = this.overviewOrderBy(query.sortBy, query.sortOrder);
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        sensorSn: string;
        displayName: string | null;
        status: string;
        createdAt: Date;
        lastReportTime: Date | null;
        total: bigint;
        activeCount: bigint;
      }[]
    >(Prisma.sql`
      WITH sensor_reports AS MATERIALIZED (
        SELECT s.id, s.sensor_sn AS "sensorSn", s.display_name AS "displayName", s.status,
          s.created_at AS "createdAt", latest.ts AS last_report_time
        FROM sensors s
        ${permissionFilter}
        LEFT JOIN LATERAL (
          SELECT ts FROM raw_current_measurements WHERE sensor_sn = s.sensor_sn ORDER BY ts DESC LIMIT 1
        ) latest ON TRUE
        WHERE TRUE ${Prisma.join(filters, ' ')}
      ), filtered AS (
        SELECT * FROM sensor_reports ${activeFilter}
      ), stats AS (
        SELECT (SELECT COUNT(*) FROM filtered) AS total,
          (SELECT COUNT(*) FROM sensor_reports WHERE last_report_time >= ${activeAfter}) AS "activeCount"
      )
      SELECT f.id, f."sensorSn", f."displayName", f.status, f."createdAt",
        f.last_report_time AS "lastReportTime", stats.total, stats."activeCount"
      FROM filtered f CROSS JOIN stats
      ORDER BY ${orderBy}, f.id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    return {
      items: rows.map((row) => ({
        id: row.id,
        sensorSn: row.sensorSn,
        displayName: row.displayName,
        status: row.status,
        createdAt: new Date(row.createdAt).toISOString(),
        lastReportTime: row.lastReportTime ? new Date(row.lastReportTime).toISOString() : null,
        isActive: row.lastReportTime ? row.lastReportTime >= activeAfter : false,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      activeCount: rows[0] ? Number(rows[0].activeCount) : 0,
    };
  }

  async findBySn(sensorSn: string): Promise<SensorDto> {
    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }
    return this.toDto({ ...sensor, lastReportTime: null }, Date.now());
  }

  async updateDisplayNameForUser(
    sensorSn: string,
    displayName: string | undefined,
    userId: string,
    userRoles: string[],
  ): Promise<void> {
    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) throw new NotFoundException(`Sensor '${sensorSn}' not found`);

    if (!userRoles.includes('admin')) {
      const permission = await this.prisma.userSensorPermission.findUnique({
        where: { userId_sensorId: { userId, sensorId: sensor.id } },
      });
      if (!permission?.canView) throw new ForbiddenException(`No access to sensor '${sensorSn}'`);
    }

    const nextDisplayName =
      displayName === undefined ? sensor.displayName : displayName.trim() || null;
    await this.prisma.sensor.update({
      where: { sensorSn },
      data: { displayName: nextDisplayName, updatedAt: new Date() },
    });
    await this.auditService.log(userId, 'UPDATE_SENSOR', 'sensor', sensorSn, {
      displayName: nextDisplayName,
    });
  }

  async findBySnForUser(sensorSn: string, userId: string, userRoles: string[]): Promise<SensorDto> {
    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }

    if (!userRoles.includes('admin')) {
      const permission = await this.prisma.userSensorPermission.findUnique({
        where: { userId_sensorId: { userId, sensorId: sensor.id } },
      });

      if (!permission || !permission.canView) {
        throw new ForbiddenException(`No access to sensor '${sensorSn}'`);
      }
    }

    return this.toDto({ ...sensor, lastReportTime: null }, Date.now());
  }

  async upsert(sensorSn: string): Promise<SensorDto> {
    const sensor = await this.prisma.sensor.upsert({
      where: { sensorSn },
      update: { updatedAt: new Date() },
      create: { sensorSn, status: 'active' },
    });
    return this.toDto({ ...sensor, lastReportTime: null }, Date.now());
  }

  private toDto(sensor: SensorRow, now: number): SensorDto {
    const lastReportTime = sensor.lastReportTime ? new Date(sensor.lastReportTime) : null;
    return {
      id: sensor.id,
      sensorSn: sensor.sensorSn,
      displayName: sensor.displayName,
      status: sensor.status,
      createdAt: new Date(sensor.createdAt).toISOString(),
      lastReportTime: lastReportTime ? lastReportTime.toISOString() : null,
      isActive: lastReportTime ? now - lastReportTime.getTime() < this.thresholdMs : false,
      deviceCount: sensor.deviceCount != null ? Number(sensor.deviceCount) : 0,
    };
  }

  private overviewOrderBy(
    sortBy: SensorOverviewQueryDto['sortBy'],
    sortOrder: SensorOverviewQueryDto['sortOrder'],
  ): Prisma.Sql {
    const direction = sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    switch (sortBy) {
      case 'sensorSn':
        return Prisma.sql`f."sensorSn" ${direction}`;
      case 'displayName':
        return Prisma.sql`f."displayName" ${direction} NULLS LAST`;
      case 'lastReportTime':
        return Prisma.sql`f.last_report_time ${direction} NULLS LAST`;
      case 'status':
        return Prisma.sql`f.status ${direction}`;
      case 'createdAt':
      default:
        return Prisma.sql`f."createdAt" ${direction}`;
    }
  }
}
