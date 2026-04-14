import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExportsService } from './exports.service';
import { ExportsCleanupService } from './exports.cleanup.service';
import { ExportsController } from './exports.controller';
import { AuditModule } from '../audit/audit.module';
import { EXPORT_QUEUE } from './exports.queue';

@Module({
  imports: [
    BullModule.registerQueue({ name: EXPORT_QUEUE }),
    AuditModule,
  ],
  providers: [ExportsService, ExportsCleanupService],
  controllers: [ExportsController],
  exports: [ExportsService],
})
export class ExportsModule {}
