import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateAdminUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'SecurePass@123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'viewer' })
  @IsString()
  @IsOptional()
  roleCode?: string;
}

export class AssignRoleDto {
  @ApiProperty({ example: 'operator' })
  @IsString()
  @IsNotEmpty()
  roleCode: string;
}

export class AssignSensorPermissionDto {
  @ApiProperty({ example: 'SENSOR-001' })
  @IsString()
  @IsNotEmpty()
  sensorSn: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  canView: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  canExport: boolean;
}

export class UpdateSensorDto {
  @ApiPropertyOptional({ example: 'Main Building Sensor', nullable: true })
  @IsString()
  @IsOptional()
  displayName?: string;
}

export class AuditLogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'Filter by action type (e.g. LOGIN)' })
  @IsString()
  @IsOptional()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter from this time (ISO 8601)' })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ description: 'Filter until this time (ISO 8601)' })
  @IsString()
  @IsOptional()
  endTime?: string;
}
