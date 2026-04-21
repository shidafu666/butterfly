import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SensorsModule } from './modules/sensors/sensors.module';
import { DevicesModule } from './modules/devices/devices.module';
import { CurrentDataModule } from './modules/current-data/current-data.module';
import { ExportsModule } from './modules/exports/exports.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'redis'),
          port: configService.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null,
          retryStrategy: (times: number) => Math.min(times * 500, 5000),
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    SensorsModule,
    DevicesModule,
    CurrentDataModule,
    ExportsModule,
    AdminModule,
    AuditModule,
    HealthModule,
  ],
})
export class AppModule {}
