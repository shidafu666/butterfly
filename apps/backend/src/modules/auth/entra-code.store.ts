import { createHash, randomBytes } from 'crypto';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { UserProfile } from '@butterfly/shared-types';

export interface EntraIssuedSession {
  accessToken: string;
  user: UserProfile;
}

const CODE_TTL_MS = 60_000;

@Injectable()
export class EntraCodeStore implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'redis'),
      port: config.get<number>('REDIS_PORT', 6379),
      ...(config.get<string>('REDIS_PASSWORD')
        ? { password: config.get<string>('REDIS_PASSWORD') }
        : {}),
      ...(config.get<string>('REDIS_TLS') === 'true' ? { tls: {} } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }

  async issue(session: EntraIssuedSession): Promise<string> {
    const code = randomBytes(32).toString('hex');
    await this.redis.set(this.key(code), JSON.stringify(session), 'PX', CODE_TTL_MS, 'NX');
    return code;
  }

  async consume(code: string): Promise<EntraIssuedSession | null> {
    if (!code) return null;
    // Use a Lua script for atomic GET+DEL (compatible with Redis < 6.2 which lacks GETDEL)
    const raw = (await this.redis.eval(
      `local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v`,
      1,
      this.key(code),
    )) as string | null;
    if (!raw) return null;
    return JSON.parse(raw) as EntraIssuedSession;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit();
  }

  private key(code: string): string {
    const digest = createHash('sha256').update(code).digest('hex');
    return `butterfly:auth:entra-code:${digest}`;
  }
}
