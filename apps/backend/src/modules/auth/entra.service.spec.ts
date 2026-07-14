import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EntraService } from './entra.service';

const activeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-id',
  entraOid: 'oid-1',
  email: 'user@example.com',
  name: 'Old Name',
  passwordHash: null,
  status: 'active',
  userRoles: [{ role: { code: 'exporter' } }],
  ...overrides,
});

describe('EntraService', () => {
  const config = new ConfigService({
    ENTRA_CLIENT_ID: 'client-id',
    ENTRA_CLIENT_SECRET: 'client-secret',
    ENTRA_TENANT_ID: 'tenant-id',
    ENTRA_REDIRECT_URI: 'https://app.example/api/v1/auth/entra/callback',
    ENTRA_POST_LOGIN_REDIRECT: 'https://app.example/auth/callback',
    COOKIE_SECRET: 'cookie-secret',
  });

  function setup() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      role: { upsert: jest.fn() },
    };
    const service = new EntraService(config, prisma as never);
    const acquireTokenByCode = jest.fn();
    Object.assign(service as unknown as { clientApplication: unknown }, {
      clientApplication: { acquireTokenByCode },
    });
    return { service, prisma, acquireTokenByCode };
  }

  function validResult(overrides: Record<string, unknown> = {}) {
    return {
      idTokenClaims: {
        oid: 'oid-1',
        tid: 'tenant-id',
        nonce: 'nonce-1',
        preferred_username: 'USER@example.com',
        name: 'New Name',
        ...overrides,
      },
    };
  }

  it('is disabled when configuration is incomplete', () => {
    const service = new EntraService(
      new ConfigService({ ENTRA_CLIENT_ID: 'client-id' }),
      {} as never,
    );
    expect(service.isEnabled()).toBe(false);
  });

  it('rejects an unexpected tenant or nonce before provisioning', async () => {
    const { service, acquireTokenByCode } = setup();
    acquireTokenByCode.mockResolvedValue(validResult({ tid: 'other-tenant' }));
    await expect(service.handleCallback('code', 'verifier', 'nonce-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    acquireTokenByCode.mockResolvedValue(
      validResult({ oid: undefined, preferred_username: undefined }),
    );
    await expect(service.handleCallback('code', 'verifier', 'nonce-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    acquireTokenByCode.mockResolvedValue(validResult({ nonce: 'other-nonce' }));
    await expect(service.handleCallback('code', 'verifier', 'nonce-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('updates a known oid and keeps its roles', async () => {
    const { service, prisma, acquireTokenByCode } = setup();
    const existing = activeUser();
    const updated = activeUser({ email: 'user@example.com', name: 'New Name' });
    acquireTokenByCode.mockResolvedValue(validResult());
    prisma.user.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
    prisma.user.update.mockResolvedValue(updated);

    await expect(service.handleCallback('code', 'verifier', 'nonce-1')).resolves.toMatchObject({
      id: 'user-id',
      roles: ['exporter'],
    });
  });

  it('links an existing local account without removing its password', async () => {
    const { service, prisma, acquireTokenByCode } = setup();
    const local = activeUser({ entraOid: null, passwordHash: 'hash', userRoles: [] });
    acquireTokenByCode.mockResolvedValue(validResult());
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(local);
    prisma.user.update.mockResolvedValue({ ...local, entraOid: 'oid-1', name: 'New Name' });

    await expect(service.handleCallback('code', 'verifier', 'nonce-1')).resolves.toMatchObject({
      localAuth: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { entraOid: 'oid-1', name: 'New Name' } }),
    );
  });

  it('creates a new active exporter without sensor permissions', async () => {
    const { service, prisma, acquireTokenByCode } = setup();
    acquireTokenByCode.mockResolvedValue(validResult());
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.upsert.mockResolvedValue({ id: 'exporter-role' });
    prisma.user.create.mockResolvedValue(activeUser({ name: 'New Name' }));

    await expect(service.handleCallback('code', 'verifier', 'nonce-1')).resolves.toMatchObject({
      roles: ['exporter'],
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
          userRoles: { create: { roleId: 'exporter-role' } },
        }),
      }),
    );
  });

  it('recovers when a concurrent callback creates the same oid first', async () => {
    const { service, prisma, acquireTokenByCode } = setup();
    acquireTokenByCode.mockResolvedValue(validResult());
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.upsert.mockResolvedValue({ id: 'exporter-role' });
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );
    prisma.user.findFirst.mockResolvedValue(activeUser());

    await expect(service.handleCallback('code', 'verifier', 'nonce-1')).resolves.toMatchObject({
      id: 'user-id',
      roles: ['exporter'],
    });
  });

  it('rejects disabled users and conflicting Entra links', async () => {
    const disabled = setup();
    disabled.acquireTokenByCode.mockResolvedValue(validResult());
    const disabledUser = activeUser({ status: 'disabled' });
    disabled.prisma.user.findUnique
      .mockResolvedValueOnce(disabledUser)
      .mockResolvedValueOnce(disabledUser);
    disabled.prisma.user.update.mockResolvedValue(disabledUser);
    await expect(
      disabled.service.handleCallback('code', 'verifier', 'nonce-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const conflict = setup();
    conflict.acquireTokenByCode.mockResolvedValue(validResult());
    conflict.prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeUser({ entraOid: 'different-oid' }));
    await expect(
      conflict.service.handleCallback('code', 'verifier', 'nonce-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
