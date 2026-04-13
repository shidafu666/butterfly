import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SensorDto } from '@butterfly/shared-types';

@Injectable()
export class SensorsService {
  constructor(private prisma: PrismaService) {}

  async findAllForUser(userId: string, userRoles: string[]): Promise<SensorDto[]> {
    if (userRoles.includes('admin')) {
      const sensors = await this.prisma.sensor.findMany({
        orderBy: { createdAt: 'asc' },
      });
      return sensors.map(this.toDto);
    }

    // Return only sensors user has view permission for
    const permissions = await this.prisma.userSensorPermission.findMany({
      where: { userId, canView: true },
      include: { sensor: true },
    });

    return permissions.map((p) => this.toDto(p.sensor));
  }

  async findBySn(sensorSn: string): Promise<SensorDto> {
    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }
    return this.toDto(sensor);
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

    return this.toDto(sensor);
  }

  async upsert(sensorSn: string): Promise<SensorDto> {
    const sensor = await this.prisma.sensor.upsert({
      where: { sensorSn },
      update: { updatedAt: new Date() },
      create: { sensorSn, status: 'active' },
    });
    return this.toDto(sensor);
  }

  private toDto(sensor: {
    id: string;
    sensorSn: string;
    displayName: string | null;
    status: string;
    createdAt: Date;
  }): SensorDto {
    return {
      id: sensor.id,
      sensorSn: sensor.sensorSn,
      displayName: sensor.displayName,
      status: sensor.status,
      createdAt: sensor.createdAt.toISOString(),
    };
  }
}
