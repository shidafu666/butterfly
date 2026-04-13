import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from './decorators/current-user.decorator';
import { LoginDto, SetupDto, EntraLoginDto } from './dto/login.dto';
import { AuditService } from '../audit/audit.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private auditService: AuditService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('local'))
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginDto })
  async login(@Request() req: { user: Parameters<AuthService['login']>[0] }) {
    const result = await this.authService.login(req.user);
    await this.auditService.log(req.user.id, 'LOGIN', 'user', req.user.id, {
      email: req.user.email,
    });
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser() user: JwtPayload) {
    const profile = await this.authService.getUserProfile(user.sub);
    if (!profile) {
      throw new UnauthorizedException('User not found');
    }
    return profile;
  }

  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create initial admin (only if no users exist)' })
  async setup(@Body() dto: SetupDto) {
    const user = await this.authService.createInitialAdmin(
      dto.email,
      dto.password,
      dto.name,
    );
    return this.authService.login(user);
  }

  @Post('entra-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Microsoft Entra ID access token' })
  async entraLogin(@Body() dto: EntraLoginDto) {
    const profile = await this.authService.validateEntraToken(dto.accessToken);
    if (!profile) {
      throw new UnauthorizedException('Invalid or unverifiable Entra ID token');
    }

    const user = await this.authService.upsertEntraUser(profile);
    const result = await this.authService.login(user);

    await this.auditService.log(user.id, 'LOGIN', 'user', user.id, {
      email: user.email,
      method: 'entra',
    });

    return result;
  }
}
