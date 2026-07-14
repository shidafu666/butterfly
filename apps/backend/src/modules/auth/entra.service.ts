import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { UserWithRoles } from './auth.service';

const SCOPES = ['openid', 'profile', 'email'];

export interface EntraAuthRequest {
  url: string;
  verifier: string;
  state: string;
  nonce: string;
}

@Injectable()
export class EntraService {
  private readonly logger = new Logger(EntraService.name);
  private readonly clientApplication: ConfidentialClientApplication | null = null;
  private readonly cryptoProvider = new CryptoProvider();
  private readonly tenantId?: string;
  private readonly redirectUri?: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const clientId = config.get<string>('ENTRA_CLIENT_ID') || undefined;
    const clientSecret = config.get<string>('ENTRA_CLIENT_SECRET') || undefined;
    this.tenantId = config.get<string>('ENTRA_TENANT_ID') || undefined;
    this.redirectUri = config.get<string>('ENTRA_REDIRECT_URI') || undefined;
    const postLoginRedirect = config.get<string>('ENTRA_POST_LOGIN_REDIRECT') || undefined;
    const cookieSecret =
      config.get<string>('COOKIE_SECRET') || config.get<string>('JWT_SECRET') || undefined;

    if (
      clientId &&
      clientSecret &&
      this.tenantId &&
      this.redirectUri &&
      postLoginRedirect &&
      cookieSecret
    ) {
      this.clientApplication = new ConfidentialClientApplication({
        auth: {
          clientId,
          clientSecret,
          authority: `https://login.microsoftonline.com/${this.tenantId}`,
        },
      });
      this.logger.log('Microsoft Entra ID SSO is enabled');
    } else if (clientId || clientSecret || this.tenantId || this.redirectUri || postLoginRedirect) {
      this.logger.warn('Microsoft Entra ID SSO configuration is incomplete; SSO is disabled');
    }
  }

  isEnabled(): boolean {
    return this.clientApplication !== null;
  }

  async buildAuthCodeUrl(): Promise<EntraAuthRequest> {
    const { verifier, challenge } = await this.cryptoProvider.generatePkceCodes();
    const state = this.cryptoProvider.createNewGuid();
    const nonce = this.cryptoProvider.createNewGuid();
    const url = await this.client().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: this.redirectUri!,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    });
    return { url, verifier, state, nonce };
  }

  async handleCallback(
    code: string,
    verifier: string,
    expectedNonce: string,
  ): Promise<UserWithRoles> {
    const result = await this.client().acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: this.redirectUri!,
      codeVerifier: verifier,
    });
    const claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;

    if (!expectedNonce || claims['nonce'] !== expectedNonce) {
      throw new UnauthorizedException('Entra nonce mismatch');
    }
    if (!claims['tid'] || claims['tid'] !== this.tenantId) {
      throw new UnauthorizedException('Token from an untrusted Entra tenant');
    }

    const oid = this.claim(claims, 'oid') ?? result.account?.localAccountId;
    const email =
      this.claim(claims, 'preferred_username') ??
      this.claim(claims, 'email') ??
      this.claim(claims, 'upn') ??
      result.account?.username;
    const name = this.claim(claims, 'name') ?? email;
    if (!oid || !email) throw new UnauthorizedException('Entra token is missing required claims');

    const user = await this.provisionUser({ oid, email: email.toLowerCase(), name: name ?? null });
    if (user.status !== 'active') throw new UnauthorizedException('User account is disabled');
    return user;
  }

  private client(): ConfidentialClientApplication {
    if (!this.clientApplication) {
      throw new ServiceUnavailableException('Microsoft Entra ID SSO is not configured');
    }
    return this.clientApplication;
  }

  private claim(claims: Record<string, unknown>, key: string): string | undefined {
    const value = claims[key];
    return typeof value === 'string' && value ? value : undefined;
  }

  private async provisionUser(profile: {
    oid: string;
    email: string;
    name: string | null;
  }): Promise<UserWithRoles> {
    const byOid = await this.prisma.user.findUnique({
      where: { entraOid: profile.oid },
      include: { userRoles: { include: { role: true } } },
    });

    if (byOid) {
      if (byOid.status !== 'active') throw new UnauthorizedException('User account is disabled');
      const emailOwner = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (emailOwner && emailOwner.id !== byOid.id) {
        throw new ConflictException('Entra email is already used by another account');
      }
      const updated = await this.prisma.user.update({
        where: { id: byOid.id },
        data: { email: profile.email, name: profile.name },
        include: { userRoles: { include: { role: true } } },
      });
      return this.toUser(updated);
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { userRoles: { include: { role: true } } },
    });
    if (byEmail) {
      if (byEmail.status !== 'active') throw new UnauthorizedException('User account is disabled');
      if (byEmail.entraOid && byEmail.entraOid !== profile.oid) {
        throw new ConflictException('Email is already linked to another Entra identity');
      }
      const updated = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: { entraOid: profile.oid, name: profile.name },
        include: { userRoles: { include: { role: true } } },
      });
      return this.toUser(updated);
    }

    const exporterRole = await this.prisma.role.upsert({
      where: { code: 'exporter' },
      update: {},
      create: { code: 'exporter', name: 'Exporter' },
    });

    try {
      const created = await this.prisma.user.create({
        data: {
          entraOid: profile.oid,
          email: profile.email,
          name: profile.name,
          status: 'active',
          userRoles: { create: { roleId: exporterRole.id } },
        },
        include: { userRoles: { include: { role: true } } },
      });
      return this.toUser(created);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      const raced = await this.prisma.user.findFirst({
        where: { OR: [{ entraOid: profile.oid }, { email: profile.email }] },
        include: { userRoles: { include: { role: true } } },
      });
      if (raced?.entraOid === profile.oid) return this.toUser(raced);
      throw new ConflictException('Unable to safely link the Entra identity');
    }
  }

  private toUser(user: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    passwordHash: string | null;
    userRoles: Array<{ role: { code: string } }>;
  }): UserWithRoles {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.userRoles.map(({ role }) => role.code),
      localAuth: Boolean(user.passwordHash),
    };
  }
}
