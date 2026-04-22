import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserProfile } from '@butterfly/shared-types';

export interface UserWithRoles {
  id: string;
  email: string;
  name: string | null;
  status: string;
  roles: string[];
  localAuth: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  private toUserProfile(user: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    userRoles: Array<{ role: { code: string } }>;
    passwordHash?: string | null;
  }): UserProfile {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.userRoles.map((ur) => ur.role.code),
      status: user.status,
      localAuth: Boolean(user.passwordHash),
    };
  }

  async validateUser(email: string, password: string): Promise<UserWithRoles | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return null;
    }

    if (user.status !== 'active') {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.userRoles.map((ur) => ur.role.code),
      localAuth: Boolean(user.passwordHash),
    };
  }

  async login(user: UserWithRoles): Promise<{ accessToken: string; user: UserProfile }> {
    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        status: user.status,
        localAuth: user.localAuth,
      },
    };
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      return null;
    }

    return this.toUserProfile(user);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.passwordHash) {
      throw new ForbiddenException('Password change is only available for local users');
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async ensureInitialAdmin(): Promise<void> {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      return;
    }

    const email = this.configService.get<string>('INITIAL_ADMIN_EMAIL', 'admin@example.com');
    const password = this.configService.get<string>('INITIAL_ADMIN_PASSWORD', 'Admin@123456');
    const name = this.configService.get<string>('INITIAL_ADMIN_NAME', 'Administrator');

    this.logger.log(`Creating initial admin user: ${email}`);

    const passwordHash = await bcrypt.hash(password, 10);

    // Ensure admin role exists
    const adminRole = await this.prisma.role.upsert({
      where: { code: 'admin' },
      update: {},
      create: {
        code: 'admin',
        name: 'Administrator',
      },
    });

    // Also ensure operator role exists
    await this.prisma.role.upsert({
      where: { code: 'operator' },
      update: {},
      create: {
        code: 'operator',
        name: 'Operator',
      },
    });

    // Also ensure viewer role exists
    await this.prisma.role.upsert({
      where: { code: 'viewer' },
      update: {},
      create: {
        code: 'viewer',
        name: 'Viewer',
      },
    });

    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        status: 'active',
      },
    });

    await this.prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: adminRole.id,
      },
    });

    this.logger.log(`Initial admin user created: ${email}`);
  }

  async validateEntraToken(token: string): Promise<{
    oid: string;
    email: string;
    name: string | null;
  } | null> {
    const issuer = this.configService.get<string>('JWT_ISSUER');
    const audience = this.configService.get<string>('JWT_AUDIENCE');

    if (!issuer || !audience) {
      this.logger.warn('Entra ID not configured (JWT_ISSUER/JWT_AUDIENCE not set)');
      return null;
    }

    try {
      const jwksUri = new URL(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
      // Fetch OIDC config to get jwks_uri
      const oidcResponse = await fetch(jwksUri.toString());
      const oidcConfig = await oidcResponse.json() as { jwks_uri: string };

      const jwks = createRemoteJWKSet(new URL(oidcConfig.jwks_uri));

      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
      });

      const oid = payload['oid'] as string | undefined;
      const email =
        (payload['preferred_username'] as string | undefined) ||
        (payload['email'] as string | undefined) ||
        (payload['upn'] as string | undefined);
      const name =
        (payload['name'] as string | undefined) ||
        (payload['given_name'] as string | undefined) ||
        null;

      if (!oid || !email) {
        this.logger.warn('Entra token missing oid or email claim');
        return null;
      }

      return { oid, email, name };
    } catch (err) {
      this.logger.error('Entra token validation failed', err);
      return null;
    }
  }

  async upsertEntraUser(profile: {
    oid: string;
    email: string;
    name: string | null;
  }): Promise<UserWithRoles> {
    const existingByOid = await this.prisma.user.findUnique({
      where: { entraOid: profile.oid },
      include: { userRoles: { include: { role: true } } },
    });

    if (existingByOid) {
      // Update name/email if changed
      const updated = await this.prisma.user.update({
        where: { id: existingByOid.id },
        data: {
          email: profile.email.toLowerCase(),
          name: profile.name,
        },
        include: { userRoles: { include: { role: true } } },
      });

      return {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        status: updated.status,
        roles: updated.userRoles.map((ur) => ur.role.code),
        localAuth: Boolean(updated.passwordHash),
      };
    }

    // Check if user exists by email (link account)
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: profile.email.toLowerCase() },
    });

    if (existingByEmail) {
      const updated = await this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: { entraOid: profile.oid, name: profile.name },
        include: { userRoles: { include: { role: true } } },
      });

      return {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        status: updated.status,
        roles: updated.userRoles.map((ur) => ur.role.code),
        localAuth: Boolean(updated.passwordHash),
      };
    }

    // Ensure viewer role exists
    const viewerRole = await this.prisma.role.upsert({
      where: { code: 'viewer' },
      update: {},
      create: { code: 'viewer', name: 'Viewer' },
    });

    // Create new user
    const newUser = await this.prisma.user.create({
      data: {
        entraOid: profile.oid,
        email: profile.email.toLowerCase(),
        name: profile.name,
        status: 'active',
        userRoles: {
          create: { roleId: viewerRole.id },
        },
      },
      include: { userRoles: { include: { role: true } } },
    });

    return {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      status: newUser.status,
      roles: newUser.userRoles.map((ur) => ur.role.code),
      localAuth: Boolean(newUser.passwordHash),
    };
  }

  async createInitialAdmin(
    email: string,
    password: string,
    name: string,
  ): Promise<UserWithRoles> {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      throw new ConflictException('Setup already completed: users already exist');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const adminRole = await this.prisma.role.upsert({
      where: { code: 'admin' },
      update: {},
      create: { code: 'admin', name: 'Administrator' },
    });

    await this.prisma.role.upsert({
      where: { code: 'operator' },
      update: {},
      create: { code: 'operator', name: 'Operator' },
    });

    await this.prisma.role.upsert({
      where: { code: 'viewer' },
      update: {},
      create: { code: 'viewer', name: 'Viewer' },
    });

    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        status: 'active',
        userRoles: {
          create: { roleId: adminRole.id },
        },
      },
      include: { userRoles: { include: { role: true } } },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.userRoles.map((ur) => ur.role.code),
      localAuth: Boolean(user.passwordHash),
    };
  }
}
