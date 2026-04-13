import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { CurrentDataService } from './current-data.service';
import { CurrentDataQueryDto } from './dto/current-data-query.dto';
import { AuditService } from '../audit/audit.service';

@ApiTags('current-data')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('current-data')
export class CurrentDataController {
  constructor(
    private currentDataService: CurrentDataService,
    private auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Query current data with auto resolution selection' })
  async queryData(
    @Query() query: CurrentDataQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.currentDataService.queryData(query, user.sub, user.roles);

    await this.auditService.log(user.sub, 'QUERY_CURRENT_DATA', 'sensor', query.sensorSn, {
      startTime: query.startTime,
      endTime: query.endTime,
      resolution: query.resolution,
      pointCount: result.points.length,
    });

    return result;
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get summary statistics (min/max/avg/count)' })
  async getSummary(
    @Query() query: CurrentDataQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.currentDataService.getSummary(query, user.sub, user.roles);
  }
}
