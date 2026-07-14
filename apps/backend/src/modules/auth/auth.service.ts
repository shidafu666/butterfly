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

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
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

  async createInitialAdmin(email: string, password: string, name: string): Promise<UserWithRoles> {
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
