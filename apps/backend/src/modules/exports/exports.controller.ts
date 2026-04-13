import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { ExportsService } from './exports.service';
import { CreateExportDto } from './dto/create-export.dto';
import { AuditService } from '../audit/audit.service';

@ApiTags('exports')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('exports')
export class ExportsController {
  constructor(
    private exportsService: ExportsService,
    private auditService: AuditService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new export job' })
  async createJob(@Body() dto: CreateExportDto, @CurrentUser() user: JwtPayload) {
    const job = await this.exportsService.createJob(dto, user.sub);

    await this.auditService.log(user.sub, 'CREATE_EXPORT', 'export_job', job.id, {
      sensorSn: dto.sensorSn,
      resolution: dto.resolution,
      format: dto.format,
    });

    return job;
  }

  @Get()
  @ApiOperation({ summary: 'List export jobs' })
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.exportsService.findAll(user.sub, user.roles);
  }

  @Get(':jobId')
  @ApiOperation({ summary: 'Get export job status' })
  @ApiParam({ name: 'jobId', description: 'Export job UUID' })
  async findOne(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.exportsService.findOne(jobId, user.sub, user.roles);
  }

  @Get(':jobId/download')
  @ApiOperation({ summary: 'Download completed export file' })
  @ApiParam({ name: 'jobId', description: 'Export job UUID' })
  async download(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const filePath = await this.exportsService.getDownloadPath(jobId, user.sub, user.roles);

    await this.auditService.log(user.sub, 'DOWNLOAD_EXPORT', 'export_job', jobId, {});

    res.download(filePath);
  }
}
