import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SensorDto } from '@butterfly/shared-types';

@Injectable()
export class SensorsService {
  constructor(private prisma: PrismaService) {}

  private get thresholdMs(): number {
    const hours = parseInt(process.env.SENSOR_ACTIVE_THRESHOLD_HOURS || '24', 10);
    return hours * 60 * 60 * 1000;
  }

  async findAllForUser(userId: string, userRoles: string[]): Promise<SensorDto[]> {
    interface SensorRow {
      id: string;
      sensorSn: string;
      displayName: string | null;
      status: string;
      createdAt: Date;
      lastReportTime: Date | null;
    }

    let rows: SensorRow[];

    if (userRoles.includes('admin')) {
      rows = await this.prisma.$queryRaw<SensorRow[]>`
        SELECT
          s.id,
          s.sensor_sn     AS "sensorSn",
          s.display_name  AS "displayName",
          s.status,
          s.created_at    AS "createdAt",
          MAX(r.ts)       AS "lastReportTime"
        FROM sensors s
        LEFT JOIN raw_current_measurements r ON s.sensor_sn = r.sensor_sn
        GROUP BY s.id
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
          MAX(r.ts)       AS "lastReportTime"
        FROM sensors s
        INNER JOIN user_sensor_permissions p ON p.sensor_id = s.id
        LEFT JOIN raw_current_measurements r ON s.sensor_sn = r.sensor_sn
        WHERE p.user_id = ${userId} AND p.can_view = true
        GROUP BY s.id
        ORDER BY s.created_at ASC
      `;
    }

    const now = Date.now();
    return rows.map((row) => this.toDto(row, now));
  }

  async findBySn(sensorSn: string): Promise<SensorDto> {
    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }
    return this.toDto({ ...sensor, lastReportTime: null }, Date.now());
  }

  async findBySnForUser(
    sensorSn: string,
    userId: string,
    userRoles: string[],
  ): Promise<SensorDto> {
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

  private toDto(
    sensor: {
      id: string;
      sensorSn: string;
      displayName: string | null;
      status: string;
      createdAt: Date;
      lastReportTime: Date | null;
    },
    now: number,
  ): SensorDto {
    const lastReportTime = sensor.lastReportTime
      ? new Date(sensor.lastReportTime)
      : null;
    return {
      id: sensor.id,
      sensorSn: sensor.sensorSn,
      displayName: sensor.displayName,
      status: sensor.status,
      createdAt: new Date(sensor.createdAt).toISOString(),
      lastReportTime: lastReportTime ? lastReportTime.toISOString() : null,
      isActive: lastReportTime ? now - lastReportTime.getTime() < this.thresholdMs : false,
    };
  }
}
