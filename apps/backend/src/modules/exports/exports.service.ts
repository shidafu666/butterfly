import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ExportJobDto } from '@butterfly/shared-types';
import { CreateExportDto } from './dto/create-export.dto';
import { EXPORT_QUEUE } from './exports.queue';

@Injectable()
export class ExportsService {
  private static readonly MAX_EXPORT_RANGE_MS = 14 * 24 * 60 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @InjectQueue(EXPORT_QUEUE) private exportQueue: Queue,
  ) {}

  private async checkPermission(
    sensorSn: string,
    userId: string,
    userRoles: string[],
  ): Promise<void> {
    if (userRoles.includes('admin')) return;

    const sensor = await this.prisma.sensor.findUnique({ where: { sensorSn } });
    if (!sensor) {
      throw new NotFoundException(`Sensor '${sensorSn}' not found`);
    }

    const permission = await this.prisma.userSensorPermission.findUnique({
      where: { userId_sensorId: { userId, sensorId: sensor.id } },
    });

    if (!permission || !permission.canExport) {
      throw new ForbiddenException(`No export access to sensor '${sensorSn}'`);
    }
  }

  private validateExportLimits(startTime: Date, endTime: Date, resolution: string): void {
    const diffMs = endTime.getTime() - startTime.getTime();

    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    const oneYear = 365 * 24 * 60 * 60 * 1000;

    if (diffMs > ExportsService.MAX_EXPORT_RANGE_MS) {
      throw new BadRequestException(
        'Export time range must not exceed 14 days',
      );
    }

    if (resolution === '1m' && diffMs > ninetyDays) {
      throw new BadRequestException(
        '1-minute resolution exports are limited to 90 days maximum',
      );
    }

    if (resolution === '1h' && diffMs > oneYear) {
      throw new BadRequestException(
        '1-hour resolution exports are limited to 1 year maximum',
      );
    }
  }

  async createJob(dto: CreateExportDto, userId: string): Promise<ExportJobDto> {
    const userRoles = await this.getUserRoles(userId);
    await this.checkPermission(dto.sensorSn, userId, userRoles);

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException('Invalid startTime or endTime');
    }

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    this.validateExportLimits(startTime, endTime, dto.resolution);

    const job = await this.prisma.exportJob.create({
      data: {
        userId,
        sensorSn: dto.sensorSn,
        deviceId: dto.deviceId ?? null,
        startTime,
        endTime,
        resolution: dto.resolution,
        format: dto.format,
        status: 'pending',
      },
    });

    // Add to BullMQ queue (BullMQ v5 API: add(name, data, opts))
    await this.exportQueue.add(
      'process-export',
      { jobId: job.id },
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return this.toDto(job);
  }

  async findAll(userId: string, userRoles: string[]): Promise<ExportJobDto[]> {
    const where = userRoles.includes('admin') ? {} : { userId };

    const jobs = await this.prisma.exportJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return jobs.map((j) => this.toDto(j));
  }

  async findOne(jobId: string, userId: string, userRoles: string[]): Promise<ExportJobDto> {
    const job = await this.prisma.exportJob.findUnique({ where: { id: jobId } });

    if (!job) {
      throw new NotFoundException(`Export job '${jobId}' not found`);
    }

    if (!userRoles.includes('admin') && job.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.toDto(job);
  }

  async getDownloadPath(
    jobId: string,
    userId: string,
    userRoles: string[],
  ): Promise<string> {
    const job = await this.prisma.exportJob.findUnique({ where: { id: jobId } });

    if (!job) {
      throw new NotFoundException(`Export job '${jobId}' not found`);
    }

    if (!userRoles.includes('admin') && job.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (job.status !== 'completed' || !job.filePath) {
      throw new BadRequestException('Export job is not completed or file not available');
    }

    const exportDir = this.configService.get<string>('EXPORT_DIR', '/app/exports');
    const filePath = path.isAbsolute(job.filePath)
      ? job.filePath
      : path.join(exportDir, job.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found on disk');
    }

    return filePath;
  }

  private async getUserRoles(userId: string): Promise<string[]> {
    const userWithRoles = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });

    return userWithRoles?.userRoles.map((ur) => ur.role.code) ?? [];
  }

  private toDto(job: {
    id: string;
    sensorSn: string;
    deviceId: string | null;
    startTime: Date;
    endTime: Date;
    resolution: string;
    format: string;
    status: string;
    fileName: string | null;
    fileSize: bigint | null;
    rowCount: bigint | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): ExportJobDto {
    return {
      id: job.id,
      sensorSn: job.sensorSn,
      deviceId: job.deviceId,
      startTime: job.startTime.toISOString(),
      endTime: job.endTime.toISOString(),
      resolution: job.resolution,
      format: job.format,
      status: job.status as ExportJobDto['status'],
      fileName: job.fileName,
      fileSize: job.fileSize != null ? Number(job.fileSize) : null,
      rowCount: job.rowCount != null ? Number(job.rowCount) : null,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    };
  }
}
