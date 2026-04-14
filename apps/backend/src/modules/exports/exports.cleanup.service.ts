import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ExportsCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportsCleanupService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    const retentionHours = parseInt(
      this.configService.get<string>('EXPORT_JOB_RETENTION_HOURS', '24'),
      10,
    );

    // Run once at startup, then every hour
    this.run(retentionHours);
    this.intervalHandle = setInterval(
      () => this.run(retentionHours),
      60 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  private run(retentionHours: number) {
    this.cleanup(retentionHours).catch((err) =>
      this.logger.error('Export job cleanup failed', err),
    );
  }

  private async cleanup(retentionHours: number): Promise<void> {
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
    const exportDir = this.configService.get<string>(
      'EXPORT_DIR',
      '/app/exports',
    );

    const oldJobs = await this.prisma.exportJob.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, filePath: true },
    });

    if (oldJobs.length === 0) return;

    // Delete files from disk first
    for (const job of oldJobs) {
      if (job.filePath) {
        const filePath = path.isAbsolute(job.filePath)
          ? job.filePath
          : path.join(exportDir, job.filePath);
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
          this.logger.warn(`Could not delete file ${filePath}: ${err}`);
        }
      }
    }

    const { count } = await this.prisma.exportJob.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.log(
      `Cleaned up ${count} export job(s) older than ${retentionHours}h`,
    );
  }
}
