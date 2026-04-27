import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import {
  CreateAdminUserDto,
  AssignRoleDto,
  AssignSensorPermissionDto,
  BatchAssignSensorPermissionDto,
  UpdateSensorDto,
  UpdateUserDto,
  AuditLogQueryDto,
} from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users with roles' })
  async listUsers() {
    return this.adminService.listUsers();
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  async createUser(@Body() dto: CreateAdminUserDto, @CurrentUser() actor: JwtPayload) {
    return this.adminService.createUser(dto, actor.sub);
  }

  @Patch('users/:userId')
  @ApiOperation({ summary: 'Update user info (name, email, password, status)' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async updateUser(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.adminService.updateUser(userId, dto, actor.sub);
  }

  @Delete('users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async deleteUser(@Param('userId') userId: string, @CurrentUser() actor: JwtPayload) {
    await this.adminService.deleteUser(userId, actor.sub);
  }

  @Post('users/:userId/roles')
  @ApiOperation({ summary: 'Assign role to user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async assignRole(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.adminService.assignRole(userId, dto.roleCode, actor.sub);
  }

  @Delete('users/:userId/roles/:roleCode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove role from user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiParam({ name: 'roleCode', description: 'Role code (admin/operator/viewer)' })
  async removeRole(
    @Param('userId') userId: string,
    @Param('roleCode') roleCode: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.adminService.removeRole(userId, roleCode, actor.sub);
  }

  @Post('users/:userId/sensors')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Grant sensor permission to user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async assignSensorPermission(
    @Param('userId') userId: string,
    @Body() dto: AssignSensorPermissionDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.adminService.assignSensorPermission(userId, dto, actor.sub);
    return { message: 'Sensor permission granted successfully' };
  }

  @Post('users/:userId/sensors/batch')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Batch grant sensor permissions to user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async batchAssignSensorPermissions(
    @Param('userId') userId: string,
    @Body() dto: BatchAssignSensorPermissionDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.adminService.batchAssignSensorPermissions(userId, dto, actor.sub);
  }

  @Delete('users/:userId/sensors/:sensorSn')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke sensor permission from user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiParam({ name: 'sensorSn', description: 'Sensor serial number' })
  async revokeSensorPermission(
    @Param('userId') userId: string,
    @Param('sensorSn') sensorSn: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.adminService.revokeSensorPermission(userId, sensorSn, actor.sub);
    return { message: 'Sensor permission revoked successfully' };
  }

  @Get('users/:userId/sensors')
  @ApiOperation({ summary: 'Get sensor permissions for a user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async getUserSensorPermissions(@Param('userId') userId: string) {
    return this.adminService.getUserSensorPermissions(userId);
  }

  @Get('sensors')
  @ApiOperation({ summary: 'List all sensors with last report time and active status' })
  async listSensorOverview() {
    return this.adminService.listSensorOverview();
  }

  @Patch('sensors/:sensorSn')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update sensor display name' })
  @ApiParam({ name: 'sensorSn', description: 'Sensor serial number' })
  async updateSensor(
    @Param('sensorSn') sensorSn: string,
    @Body() dto: UpdateSensorDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.adminService.updateSensorDisplayName(sensorSn, dto, actor.sub);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'List audit logs with pagination' })
  async listAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.adminService.listAuditLogs(query.page ?? 1, query.limit ?? 50, {
      action: query.action,
      startTime: query.startTime,
      endTime: query.endTime,
    });
  }
}
