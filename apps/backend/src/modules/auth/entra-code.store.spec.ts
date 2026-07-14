import { ConfigService } from '@nestjs/config';
import { EntraCodeStore, EntraIssuedSession } from './entra-code.store';

describe('EntraCodeStore', () => {
  const session: EntraIssuedSession = {
    accessToken: 'app-token',
    user: {
      id: 'user-id',
      email: 'user@example.com',
      name: 'User',
      roles: ['exporter'],
      status: 'active',
      localAuth: false,
    },
  };

  it('stores a hashed, short-lived code and consumes it atomically', async () => {
    const store = new EntraCodeStore(
      new ConfigService({ REDIS_HOST: 'localhost', REDIS_PORT: 6379 }),
    );
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      getdel: jest.fn().mockResolvedValue(JSON.stringify(session)),
      status: 'end',
    };
    Object.assign(store as unknown as { redis: typeof redis }, { redis });

    const code = await store.issue(session);
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^butterfly:auth:entra-code:[a-f0-9]{64}$/),
      JSON.stringify(session),
      'PX',
      60_000,
      'NX',
    );
    expect(redis.set.mock.calls[0][0]).not.toContain(code);

    await expect(store.consume(code)).resolves.toEqual(session);
    expect(redis.getdel).toHaveBeenCalledWith(redis.set.mock.calls[0][0]);
  });

  it('rejects missing or already-consumed codes', async () => {
    const store = new EntraCodeStore(new ConfigService());
    const redis = { getdel: jest.fn().mockResolvedValue(null), status: 'end' };
    Object.assign(store as unknown as { redis: typeof redis }, { redis });

    await expect(store.consume('')).resolves.toBeNull();
    await expect(store.consume('expired')).resolves.toBeNull();
    expect(redis.getdel).toHaveBeenCalledTimes(1);
  });
});
