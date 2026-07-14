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
  BadRequestException,
  ServiceUnavailableException,
  Query,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from './decorators/current-user.decorator';
import { LoginDto, SetupDto, EntraExchangeDto, ChangePasswordDto } from './dto/login.dto';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { Request as ExpressRequest, Response } from 'express';
import { EntraService } from './entra.service';
import { EntraCodeStore } from './entra-code.store';

const ENTRA_TX_COOKIE = 'cyberbee_entra_tx';

interface EntraTransaction {
  verifier: string;
  state: string;
  nonce: string;
  returnTo?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private auditService: AuditService,
    private entraService: EntraService,
    private entraCodeStore: EntraCodeStore,
    private config: ConfigService,
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

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Change password for current local user' })
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    await this.auditService.log(user.sub, 'CHANGE_PASSWORD', 'user', user.sub, {
      email: user.email,
    });
  }

  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create initial admin (only if no users exist)' })
  async setup(@Body() dto: SetupDto) {
    const user = await this.authService.createInitialAdmin(dto.email, dto.password, dto.name);
    return this.authService.login(user);
  }

  @Get('entra/enabled')
  @ApiOperation({ summary: 'Check whether Microsoft Entra ID SSO is enabled' })
  entraEnabled() {
    return { enabled: this.entraService.isEnabled() };
  }

  @Get('entra/login')
  @ApiOperation({ summary: 'Start Microsoft Entra ID SSO' })
  async entraLogin(@Query('returnTo') returnTo: string | undefined, @Res() res: Response) {
    if (!this.entraService.isEnabled()) {
      throw new ServiceUnavailableException('Microsoft Entra ID SSO is not configured');
    }
    const { url, verifier, state, nonce } = await this.entraService.buildAuthCodeUrl();
    const transaction: EntraTransaction = {
      verifier,
      state,
      nonce,
      returnTo: this.safeReturnTo(returnTo),
    };
    res.cookie(ENTRA_TX_COOKIE, JSON.stringify(transaction), this.transactionCookieOptions());
    return res.redirect(url);
  }

  @Get('entra/callback')
  @ApiOperation({ summary: 'Handle Microsoft Entra ID SSO callback' })
  async entraCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: ExpressRequest,
    @Res() res: Response,
  ) {
    const raw = req.signedCookies?.[ENTRA_TX_COOKIE] as string | undefined;
    res.clearCookie(ENTRA_TX_COOKIE, { path: '/' });
    const transaction = this.parseTransaction(raw);

    if (providerError) return res.redirect(this.loginErrorUrl('provider'));
    if (!transaction || !code || !state || state !== transaction.state) {
      return res.redirect(this.loginErrorUrl('state'));
    }

    try {
      const user = await this.entraService.handleCallback(
        code,
        transaction.verifier,
        transaction.nonce,
      );
      const session = await this.authService.login(user);
      const exchangeCode = await this.entraCodeStore.issue(session);
      await this.auditService.log(user.id, 'LOGIN', 'user', user.id, {
        email: user.email,
        method: 'entra',
      });
      return res.redirect(this.successUrl(exchangeCode, transaction.returnTo));
    } catch (error) {
      this.logger.warn(
        `Entra callback failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      const errorCode =
        error instanceof UnauthorizedException && error.message.includes('disabled')
          ? 'disabled'
          : error instanceof UnauthorizedException && error.message.includes('tenant')
            ? 'tenant'
            : 'exchange';
      return res.redirect(this.loginErrorUrl(errorCode));
    }
  }

  @Post('entra/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a one-time SSO code for a CyberBee session' })
  async entraExchange(@Body() dto: EntraExchangeDto) {
    const session = await this.entraCodeStore.consume(dto.code);
    if (!session) throw new BadRequestException('Invalid or expired SSO exchange code');
    return session;
  }

  private parseTransaction(raw?: string): EntraTransaction | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<EntraTransaction>;
      if (!parsed.verifier || !parsed.state || !parsed.nonce) return null;
      return parsed as EntraTransaction;
    } catch {
      return null;
    }
  }

  private transactionCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('ENTRA_REDIRECT_URI', '').startsWith('https://'),
      sameSite: 'lax' as const,
      signed: true,
      maxAge: 10 * 60 * 1000,
      path: '/',
    };
  }

  private safeReturnTo(value?: string): string | undefined {
    return value?.startsWith('/') && !value.startsWith('//') ? value : undefined;
  }

  private frontendCallbackUrl(): URL {
    const configured = this.config.get<string>('ENTRA_POST_LOGIN_REDIRECT');
    if (!configured)
      throw new ServiceUnavailableException('ENTRA_POST_LOGIN_REDIRECT is not configured');
    return new URL(configured);
  }

  private loginErrorUrl(code: string): string {
    const callback = this.frontendCallbackUrl();
    return `${callback.origin}/login?sso_error=${encodeURIComponent(code)}`;
  }

  private successUrl(code: string, returnTo?: string): string {
    const callback = this.frontendCallbackUrl();
    callback.searchParams.set('code', code);
    if (returnTo) callback.searchParams.set('returnTo', returnTo);
    return callback.toString();
  }
}
