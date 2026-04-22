import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminUserDto } from '@butterfly/shared-types';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        userRoles: { include: { role: true } },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: { include: { role: true } },
      },
    });
  }

  async findAll(): Promise<AdminUserDto[]> {
    const users = await this.prisma.user.findMany({
      include: {
        userRoles: { include: { role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      roles: u.userRoles.map((ur) => ur.role.code),
      localAuth: Boolean(u.passwordHash),
      ssoAuth: Boolean(u.entraOid),
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async create(dto: CreateUserDto): Promise<AdminUserDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException(`User with email ${dto.email} already exists`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    let roleId: string | undefined;
    if (dto.roleCode) {
      const role = await this.prisma.role.findUnique({
        where: { code: dto.roleCode },
      });
      if (!role) {
        throw new NotFoundException(`Role '${dto.roleCode}' not found`);
      }
      roleId = role.id;
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        status: 'active',
        ...(roleId && {
          userRoles: {
            create: { roleId },
          },
        }),
      },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.userRoles.map((ur) => ur.role.code),
      localAuth: Boolean(user.passwordHash),
      ssoAuth: Boolean(user.entraOid),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async updateRoles(userId: string, roleCodes: string[]): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes } },
    });

    if (roles.length !== roleCodes.length) {
      const foundCodes = roles.map((r) => r.code);
      const missing = roleCodes.filter((c) => !foundCodes.includes(c));
      throw new NotFoundException(`Roles not found: ${missing.join(', ')}`);
    }

    // Replace all roles
    await this.prisma.userRole.deleteMany({ where: { userId } });

    if (roles.length > 0) {
      await this.prisma.userRole.createMany({
        data: roles.map((r) => ({ userId, roleId: r.id })),
      });
    }

    return this.getUserWithRoles(userId);
  }

  async assignRole(userId: string, roleCode: string): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const role = await this.prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      throw new NotFoundException(`Role '${roleCode}' not found`);
    }

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });

    return this.getUserWithRoles(userId);
  }

  async removeRole(userId: string, roleCode: string): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const role = await this.prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      throw new NotFoundException(`Role '${roleCode}' not found`);
    }

    await this.prisma.userRole.deleteMany({
      where: { userId, roleId: role.id },
    });

    return this.getUserWithRoles(userId);
  }

  async getUserWithRoles(userId: string): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.userRoles.map((ur) => ur.role.code),
      localAuth: Boolean(user.passwordHash),
      ssoAuth: Boolean(user.entraOid),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async updateUser(
    userId: string,
    dto: {
      email?: string;
      name?: string;
      password?: string;
      status?: string;
    },
  ): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (existing) throw new ConflictException(`Email ${dto.email} is already in use`);
    }

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) data.name = dto.name?.trim() || null;
    if (dto.email) data.email = dto.email.toLowerCase();
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    if (dto.status) data.status = dto.status;

    await this.prisma.user.update({ where: { id: userId }, data });
    return this.getUserWithRoles(userId);
  }

  async deleteUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new ForbiddenException('Cannot delete your own account');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    await this.prisma.user.delete({ where: { id: userId } });
  }

  async grantSensorPermission(
    userId: string,
    sensorSn: string,
    canView: boolean,
    canExport: boolean,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }

    await this.prisma.userSensorPermission.upsert({
      where: { userId_sensorId: { userId, sensorId: sensor.id } },
      update: { canView, canExport },
      create: { userId, sensorId: sensor.id, canView, canExport },
    });
  }

  async revokeSensorPermission(userId: string, sensorSn: string): Promise<void> {
    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }

    await this.prisma.userSensorPermission.deleteMany({
      where: { userId, sensorId: sensor.id },
    });
  }
}
