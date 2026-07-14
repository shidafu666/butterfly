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
    const raw = await this.redis.getdel(this.key(code));
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
