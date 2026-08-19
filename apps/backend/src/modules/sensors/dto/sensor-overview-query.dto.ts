import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SensorOverviewQueryDto {
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 100;

  @IsString()
  @IsOptional()
  sensorSn?: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: 'active' | 'inactive';

  @IsIn(['true', 'false'])
  @IsOptional()
  isActive?: 'true' | 'false';

  @IsIn(['sensorSn', 'displayName', 'lastReportTime', 'status', 'createdAt'])
  @IsOptional()
  sortBy?: 'sensorSn' | 'displayName' | 'lastReportTime' | 'status' | 'createdAt';

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}
