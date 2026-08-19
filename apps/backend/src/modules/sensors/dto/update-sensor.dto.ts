import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateSensorDto {
  @ApiPropertyOptional({ example: 'Main Building Sensor', nullable: true })
  @IsString()
  @IsOptional()
  displayName?: string;
}
