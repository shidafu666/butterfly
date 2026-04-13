import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ExportResolution {
  RAW = 'raw',
  ONE_MINUTE = '1m',
  ONE_HOUR = '1h',
}

export enum ExportFormat {
  CSV = 'csv',
  LOG = 'log',
}

export class CreateExportDto {
  @ApiProperty({ description: 'Sensor serial number' })
  @IsString()
  @IsNotEmpty()
  sensorSn: string;

  @ApiPropertyOptional({ description: 'Device ID filter' })
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiProperty({ description: 'Start time (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty({ description: 'End time (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  endTime: string;

  @ApiProperty({ enum: ExportResolution, description: 'Data resolution' })
  @IsEnum(ExportResolution)
  resolution: ExportResolution;

  @ApiProperty({ enum: ExportFormat, description: 'Export file format' })
  @IsEnum(ExportFormat)
  format: ExportFormat;
}
