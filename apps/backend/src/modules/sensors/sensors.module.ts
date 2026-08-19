import { Module } from '@nestjs/common';
import { SensorsService } from './sensors.service';
import { SensorsController } from './sensors.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [SensorsService],
  controllers: [SensorsController],
  exports: [SensorsService],
})
export class SensorsModule {}
