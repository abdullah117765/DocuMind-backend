import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import {
  REDIS_CLIENT,
  VERIFICATION_TOKEN_TTL_SECONDS,
} from './redis.constants';

const verificationTokenKey = (token: string): string => `verify:${token}`;
const LOGIN_FAILURE_SCRIPT = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {attempts, ttl}
`;

const loginFailureKey = (identifier: string): string =>
  `login-failure:${createHash('sha256').update(identifier).digest('hex')}`;

export interface LoginFailureState {
  attempts: number;
  retryAfterSeconds: number;
}

function toNonNegativeInteger(value: unknown): number {
  const parsedValue = Number(value);

  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : 0;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }

    if (this.client.status === 'wait') {
      this.client.disconnect();
      return;
    }

    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async storeVerificationToken(
    token: string,
    userId: string,
    ttlSeconds = VERIFICATION_TOKEN_TTL_SECONDS,
  ): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError(
        'Verification token TTL must be a positive integer.',
      );
    }

    await this.client.set(
      verificationTokenKey(token),
      userId,
      'EX',
      ttlSeconds,
    );
  }

  getVerificationUserId(token: string): Promise<string | null> {
    return this.client.get(verificationTokenKey(token));
  }

  async deleteVerificationToken(token: string): Promise<void> {
    await this.client.del(verificationTokenKey(token));
  }

  async getLoginFailureState(
    identifier: string,
  ): Promise<LoginFailureState> {
    const key = loginFailureKey(identifier);
    const [rawAttempts, rawTtl] = await Promise.all([
      this.client.get(key),
      this.client.ttl(key),
    ]);

    return {
      attempts: toNonNegativeInteger(rawAttempts),
      retryAfterSeconds: toNonNegativeInteger(rawTtl),
    };
  }

  async recordLoginFailure(
    identifier: string,
    windowSeconds: number,
  ): Promise<LoginFailureState> {
    if (!Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) {
      throw new RangeError(
        'Login rate-limit window must be a positive integer.',
      );
    }

    const result: unknown = await this.client.eval(
      LOGIN_FAILURE_SCRIPT,
      1,
      loginFailureKey(identifier),
      windowSeconds,
    );

    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error('Redis returned an invalid login rate-limit result.');
    }

    return {
      attempts: toNonNegativeInteger(result[0]),
      retryAfterSeconds: toNonNegativeInteger(result[1]),
    };
  }

  async clearLoginFailures(identifier: string): Promise<void> {
    await this.client.del(loginFailureKey(identifier));
  }
}
