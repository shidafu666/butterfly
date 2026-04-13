import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DeviceDto } from '@butterfly/shared-types';

@Injectable()
export class DevicesService {
  constructor(private prisma: PrismaService) {}

  async findBySensor(
    sensorSn: string,
    userId: string,
    userRoles: string[],
  ): Promise<DeviceDto[]> {
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

    const devices = await this.prisma.device.findMany({
      where: { sensorId: sensor.id },
      orderBy: { createdAt: 'asc' },
    });

    return devices.map((d) => this.toDto(d));
  }

  async upsert(sensorId: string, deviceId: string): Promise<DeviceDto> {
    const device = await this.prisma.device.upsert({
      where: { sensorId_deviceId: { sensorId, deviceId } },
      update: { updatedAt: new Date() },
      create: { sensorId, deviceId, status: 'active' },
    });
    return this.toDto(device);
  }

  private toDto(device: {
    id: string;
    sensorId: string;
    deviceId: string;
    displayName: string | null;
    status: string;
  }): DeviceDto {
    return {
      id: device.id,
      sensorId: device.sensorId,
      deviceId: device.deviceId,
      displayName: device.displayName,
      status: device.status,
    };
  }
}
