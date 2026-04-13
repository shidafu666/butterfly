import { Module } from '@nestjs/common';
import { CurrentDataService } from './current-data.service';
import { CurrentDataController } from './current-data.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [CurrentDataService],
  controllers: [CurrentDataController],
  exports: [CurrentDataService],
})
export class CurrentDataModule {}
