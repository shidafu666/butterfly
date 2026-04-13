import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserDto, AuditLogDto } from '@butterfly/shared-types';
import { CreateAdminUserDto, AssignSensorPermissionDto } from './dto/admin.dto';

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

  async assignRole(
    userId: string,
    roleCode: string,
    actorId: string,
  ): Promise<AdminUserDto> {
    const user = await this.usersService.assignRole(userId, roleCode);

    await this.auditService.log(actorId, 'ASSIGN_ROLE', 'user', userId, {
      roleCode,
    });

    return user;
  }

  async removeRole(
    userId: string,
    roleCode: string,
    actorId: string,
  ): Promise<AdminUserDto> {
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
    await this.usersService.grantSensorPermission(
      userId,
      dto.sensorSn,
      dto.canView,
      dto.canExport,
    );

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

  async revokeSensorPermission(
    userId: string,
    sensorSn: string,
    actorId: string,
  ): Promise<void> {
    await this.usersService.revokeSensorPermission(userId, sensorSn);

    await this.auditService.log(
      actorId,
      'REVOKE_SENSOR_PERMISSION',
      'user_sensor_permission',
      `${userId}:${sensorSn}`,
      { sensorSn },
    );
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
