import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ResolutionEnum {
  AUTO = 'auto',
  RAW = 'raw',
  ONE_MINUTE = '1m',
  ONE_HOUR = '1h',
  ONE_DAY = '1d',
}

export class CurrentDataQueryDto {
  @ApiProperty({ description: 'Sensor serial number' })
  @IsString()
  @IsNotEmpty()
  sensorSn: string;

  @ApiPropertyOptional({ description: 'Device ID filter' })
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiProperty({ description: 'Start time (ISO 8601)', example: '2024-01-01T00:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty({ description: 'End time (ISO 8601)', example: '2024-01-01T06:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  endTime: string;

  @ApiPropertyOptional({
    enum: ResolutionEnum,
    default: ResolutionEnum.AUTO,
    description: 'Resolution: auto selects based on time range',
  })
  @IsEnum(ResolutionEnum)
  @IsOptional()
  resolution?: ResolutionEnum = ResolutionEnum.AUTO;
}
