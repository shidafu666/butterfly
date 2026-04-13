import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { SensorsService } from './sensors.service';

@ApiTags('sensors')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('sensors')
export class SensorsController {
  constructor(private sensorsService: SensorsService) {}

  @Get()
  @ApiOperation({ summary: 'List sensors accessible to current user' })
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.sensorsService.findAllForUser(user.sub, user.roles);
  }

  @Get(':sensorSn')
  @ApiOperation({ summary: 'Get sensor details' })
  @ApiParam({ name: 'sensorSn', description: 'Sensor serial number' })
  async findOne(
    @Param('sensorSn') sensorSn: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sensorsService.findBySnForUser(sensorSn, user.sub, user.roles);
  }
}
