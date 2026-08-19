import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import {
  AdminUserDto,
  AuditLogDto,
  SensorOverviewDto,
  SensorOverviewPageDto,
} from '@butterfly/shared-types';
import {
  CreateAdminUserDto,
  AssignSensorPermissionDto,
  BatchAssignSensorPermissionDto,
  UpdateSensorDto,
  UpdateUserDto,
  SensorOverviewQueryDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private auditService: AuditService,
  ) {}

  async listUsers(): Promise<AdminUserDto[]> {
    return this.usersService.findAll();
  }

  async createUser(dto: CreateAdminUserDto, actorId: string): Promise<AdminUserDto> {
    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      password: dto.password,
      roleCode: dto.roleCode,
    });

    await this.auditService.log(actorId, 'CREATE_USER', 'user', user.id, {
      email: user.email,
      roleCode: dto.roleCode,
    });

    return user;
  }

  async updateUser(userId: string, dto: UpdateUserDto, actorId: string): Promise<AdminUserDto> {
    const user = await this.usersService.updateUser(userId, dto);
    await this.auditService.log(actorId, 'UPDATE_USER', 'user', userId, {
      fields: Object.keys(dto).filter((k) => k !== 'password'),
      ...(dto.roleCodes !== undefined ? { roleCodes: dto.roleCodes } : {}),
    });
    return user;
  }

  async deleteUser(userId: string, actorId: string): Promise<void> {
    const user = await this.usersService.getUserWithRoles(userId);
    await this.usersService.deleteUser(userId, actorId);
    await this.auditService.log(actorId, 'DELETE_USER', 'user', userId, {
      email: user.email,
    });
  }

  async assignRole(userId: string, roleCode: string, actorId: string): Promise<AdminUserDto> {
    const user = await this.usersService.assignRole(userId, roleCode);

    await this.auditService.log(actorId, 'ASSIGN_ROLE', 'user', userId, {
      roleCode,
    });

    return user;
  }

  async removeRole(userId: string, roleCode: string, actorId: string): Promise<AdminUserDto> {
    const user = await this.usersService.removeRole(userId, roleCode);

    await this.auditService.log(actorId, 'REMOVE_ROLE', 'user', userId, {
      roleCode,
    });

    return user;
  }

  async assignSensorPermission(
    userId: string,
    dto: AssignSensorPermissionDto,
    actorId: string,
  ): Promise<void> {
    await this.usersService.grantSensorPermission(userId, dto.sensorSn, dto.canView, dto.canExport);

    await this.auditService.log(
      actorId,
      'ASSIGN_SENSOR_PERMISSION',
      'user_sensor_permission',
      `${userId}:${dto.sensorSn}`,
      {
        sensorSn: dto.sensorSn,
        canView: dto.canView,
        canExport: dto.canExport,
      },
    );
  }

  async batchAssignSensorPermissions(
    userId: string,
    dto: BatchAssignSensorPermissionDto,
    actorId: string,
  ): Promise<void> {
    await Promise.all(
      dto.sensorSns.map((sensorSn) =>
        this.usersService.grantSensorPermission(userId, sensorSn, dto.canView, dto.canExport),
      ),
    );

    await this.auditService.log(
      actorId,
      'ASSIGN_SENSOR_PERMISSION',
      'user_sensor_permission',
      userId,
      {
        sensorSns: dto.sensorSns,
        canView: dto.canView,
        canExport: dto.canExport,
      },
    );
  }

  async revokeSensorPermission(userId: string, sensorSn: string, actorId: string): Promise<void> {
    await this.usersService.revokeSensorPermission(userId, sensorSn);

    await this.auditService.log(
      actorId,
      'REVOKE_SENSOR_PERMISSION',
      'user_sensor_permission',
      `${userId}:${sensorSn}`,
      { sensorSn },
    );
  }

  async updateSensorDisplayName(
    sensorSn: string,
    dto: UpdateSensorDto,
    actorId: string,
  ): Promise<void> {
    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }

    const displayName = dto.displayName !== undefined ? dto.displayName.trim() || null : undefined;

    await this.prisma.sensor.update({
      where: { sensorSn },
      data: { displayName, updatedAt: new Date() },
    });

    await this.auditService.log(actorId, 'UPDATE_SENSOR', 'sensor', sensorSn, {
      displayName,
    });
  }

  async listSensorOverview(query: SensorOverviewQueryDto): Promise<SensorOverviewPageDto> {
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
    const activeFilter =
      query.isActive === 'true'
        ? Prisma.sql`WHERE last_report_time >= ${activeAfter}`
        : query.isActive === 'false'
          ? Prisma.sql`WHERE last_report_time IS NULL OR last_report_time < ${activeAfter}`
          : Prisma.empty;
    const orderBy = this.sensorOverviewOrderBy(query.sortBy, query.sortOrder);

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
    >(
      Prisma.sql`
        WITH sensor_reports AS MATERIALIZED (
          SELECT
            s.id,
            s.sensor_sn AS "sensorSn",
            s.display_name AS "displayName",
            s.status,
            s.created_at AS "createdAt",
            latest.ts AS last_report_time
          FROM sensors s
          LEFT JOIN LATERAL (
            SELECT ts
            FROM raw_current_measurements
            WHERE sensor_sn = s.sensor_sn
            ORDER BY ts DESC
            LIMIT 1
          ) latest ON TRUE
          WHERE TRUE ${Prisma.join(filters, ' ')}
        ), filtered AS (
          SELECT * FROM sensor_reports
          ${activeFilter}
        ), stats AS (
          SELECT
            (SELECT COUNT(*) FROM filtered) AS total,
            (SELECT COUNT(*) FROM sensor_reports WHERE last_report_time >= ${activeAfter}) AS "activeCount"
        )
        SELECT
          f.id,
          f."sensorSn",
          f."displayName",
          f.status,
          f."createdAt",
          f.last_report_time AS "lastReportTime",
          stats.total,
          stats."activeCount"
        FROM filtered f
        CROSS JOIN stats
        ORDER BY ${orderBy}, f.id ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
    );

    const items: SensorOverviewDto[] = rows.map((row) => {
      const lastReportTime = row.lastReportTime ? new Date(row.lastReportTime) : null;
      return {
        id: row.id,
        sensorSn: row.sensorSn,
        displayName: row.displayName,
        status: row.status,
        createdAt: new Date(row.createdAt).toISOString(),
        lastReportTime: lastReportTime ? lastReportTime.toISOString() : null,
        isActive: lastReportTime ? lastReportTime >= activeAfter : false,
      };
    });

    return {
      items,
      total: rows[0] ? Number(rows[0].total) : 0,
      activeCount: rows[0] ? Number(rows[0].activeCount) : 0,
    };
  }

  private sensorOverviewOrderBy(
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

  async listAuditLogs(
    page: number,
    limit: number,
    filters?: { action?: string; startTime?: string; endTime?: string },
  ): Promise<{ items: AuditLogDto[]; total: number; page: number; limit: number }> {
    return this.auditService.findAll(page, limit, filters);
  }

  async getUserSensorPermissions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const permissions = await this.prisma.userSensorPermission.findMany({
      where: { userId },
      include: { sensor: true },
    });

    return permissions.map((p) => ({
      sensorSn: p.sensor.sensorSn,
      sensorId: p.sensorId,
      canView: p.canView,
      canExport: p.canExport,
      createdAt: p.createdAt.toISOString(),
    }));
  }
}
