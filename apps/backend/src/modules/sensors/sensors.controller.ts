import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { SensorsService } from './sensors.service';
import { SensorOverviewQueryDto } from './dto/sensor-overview-query.dto';
import { UpdateSensorDto } from './dto/update-sensor.dto';

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

  @Get('overview')
  @ApiOperation({ summary: "List the current user's accessible sensors with reporting status" })
  async findOverview(@Query() query: SensorOverviewQueryDto, @CurrentUser() user: JwtPayload) {
    return this.sensorsService.listOverviewForUser(query, user.sub, user.roles);
  }

  @Patch(':sensorSn')
  @ApiOperation({ summary: 'Update the display name of a sensor accessible to the current user' })
  @ApiParam({ name: 'sensorSn', description: 'Sensor serial number' })
  async updateDisplayName(
    @Param('sensorSn') sensorSn: string,
    @Body() dto: UpdateSensorDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.sensorsService.updateDisplayNameForUser(
      sensorSn,
      dto.displayName,
      user.sub,
      user.roles,
    );
    return { message: 'Sensor display name updated successfully' };
  }

  @Get(':sensorSn')
  @ApiOperation({ summary: 'Get sensor details' })
  @ApiParam({ name: 'sensorSn', description: 'Sensor serial number' })
  async findOne(@Param('sensorSn') sensorSn: string, @CurrentUser() user: JwtPayload) {
    return this.sensorsService.findBySnForUser(sensorSn, user.sub, user.roles);
  }
}
