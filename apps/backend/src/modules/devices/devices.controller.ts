import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('sensors/:sensorSn/devices')
export class DevicesController {
  constructor(private devicesService: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'List devices for a sensor' })
  @ApiParam({ name: 'sensorSn', description: 'Sensor serial number' })
  async findBySensor(@Param('sensorSn') sensorSn: string, @CurrentUser() user: JwtPayload) {
    return this.devicesService.findBySensor(sensorSn, user.sub, user.roles);
  }
}
