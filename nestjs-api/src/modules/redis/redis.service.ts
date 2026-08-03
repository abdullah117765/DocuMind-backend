import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { REDIS_CLIENT } from './redis.constants';

const WINDOW_ATTEMPT_SCRIPT = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {attempts, ttl}
`;
const CONSUME_PASSWORD_RESET_OTP_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return {'invalid', 0}
end

local separator = string.find(value, ':')
if not separator then
  redis.call('DEL', KEYS[1])
  return {'invalid', 0}
end

local storedHash = string.sub(value, 1, separator - 1)
local attempts = tonumber(string.sub(value, separator + 1))
local maxAttempts = tonumber(ARGV[2])

if not attempts or not maxAttempts or maxAttempts < 1 then
  redis.call('DEL', KEYS[1])
  return {'invalid', 0}
end

if storedHash == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {'valid', attempts}
end

attempts = attempts + 1
if attempts >= maxAttempts then
  redis.call('DEL', KEYS[1])
  return {'locked', attempts}
end

local ttl = redis.call('TTL', KEYS[1])
if ttl <= 0 then
  redis.call('DEL', KEYS[1])
  return {'invalid', attempts}
end

redis.call('SET', KEYS[1], storedHash .. ':' .. attempts, 'EX', ttl)
return {'invalid', attempts}
`;
const loginFailureKey = (identifier: string): string =>
  `login-failure:${createHash('sha256').update(identifier).digest('hex')}`;
const passwordResetRateLimitKey = (identifier: string): string =>
  `password-reset-rate:${createHash('sha256').update(identifier).digest('hex')}`;
const passwordResetCooldownKey = (email: string): string =>
  `password-reset-cooldown:${createHash('sha256').update(email).digest('hex')}`;
const passwordResetOtpKey = (userId: string): string =>
  `password-reset-otp:${createHash('sha256').update(userId).digest('hex')}`;
const emailVerificationRateLimitKey = (identifier: string): string =>
  `email-verification-rate:${createHash('sha256').update(identifier).digest('hex')}`;
const emailVerificationCooldownKey = (email: string): string =>
  `email-verification-cooldown:${createHash('sha256').update(email).digest('hex')}`;

export interface LoginFailureState {
  attempts: number;
  retryAfterSeconds: number;
}

export interface PasswordResetOtpResult {
  status: 'valid' | 'invalid' | 'locked';
  attemptsRemaining: number;
}

export interface PasswordResetCooldownResult {
  acquired: boolean;
  retryAfterSeconds: number;
}

function toNonNegativeInteger(value: unknown): number {
  const parsedValue = Number(value);

  return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : 0;
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

  async getLoginFailureState(identifier: string): Promise<LoginFailureState> {
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
    return this.recordWindowAttempt(
      loginFailureKey(identifier),
      windowSeconds,
      'Login rate-limit window',
    );
  }

  async clearLoginFailures(identifier: string): Promise<void> {
    await this.client.del(loginFailureKey(identifier));
  }

  async recordPasswordResetRequest(
    identifier: string,
    windowSeconds: number,
  ): Promise<LoginFailureState> {
    return this.recordWindowAttempt(
      passwordResetRateLimitKey(identifier),
      windowSeconds,
      'Password-reset rate-limit window',
    );
  }

  async acquirePasswordResetCooldown(
    email: string,
    cooldownSeconds: number,
  ): Promise<PasswordResetCooldownResult> {
    if (!Number.isSafeInteger(cooldownSeconds) || cooldownSeconds <= 0) {
      throw new RangeError(
        'Password-reset resend cooldown must be a positive integer.',
      );
    }

    const key = passwordResetCooldownKey(email);
    const result = await this.client.set(key, '1', 'EX', cooldownSeconds, 'NX');

    if (result === 'OK') {
      return {
        acquired: true,
        retryAfterSeconds: cooldownSeconds,
      };
    }

    const remainingSeconds = toNonNegativeInteger(await this.client.ttl(key));

    return {
      acquired: false,
      retryAfterSeconds: remainingSeconds || cooldownSeconds,
    };
  }

  async releasePasswordResetCooldown(email: string): Promise<void> {
    await this.client.del(passwordResetCooldownKey(email));
  }

  async recordEmailVerificationRequest(
    identifier: string,
    windowSeconds: number,
  ): Promise<LoginFailureState> {
    return this.recordWindowAttempt(
      emailVerificationRateLimitKey(identifier),
      windowSeconds,
      'Email-verification rate-limit window',
    );
  }

  async acquireEmailVerificationCooldown(
    email: string,
    cooldownSeconds: number,
  ): Promise<PasswordResetCooldownResult> {
    if (!Number.isSafeInteger(cooldownSeconds) || cooldownSeconds <= 0) {
      throw new RangeError(
        'Email-verification resend cooldown must be a positive integer.',
      );
    }

    const key = emailVerificationCooldownKey(email);
    const result = await this.client.set(key, '1', 'EX', cooldownSeconds, 'NX');

    if (result === 'OK') {
      return {
        acquired: true,
        retryAfterSeconds: cooldownSeconds,
      };
    }

    const remainingSeconds = toNonNegativeInteger(await this.client.ttl(key));

    return {
      acquired: false,
      retryAfterSeconds: remainingSeconds || cooldownSeconds,
    };
  }

  async releaseEmailVerificationCooldown(email: string): Promise<void> {
    await this.client.del(emailVerificationCooldownKey(email));
  }

  async storePasswordResetOtp(
    userId: string,
    otpHash: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(otpHash)) {
      throw new TypeError('Password-reset OTP hash must be a SHA-256 digest.');
    }

    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError(
        'Password-reset OTP TTL must be a positive integer.',
      );
    }

    await this.client.set(
      passwordResetOtpKey(userId),
      `${otpHash}:0`,
      'EX',
      ttlSeconds,
    );
  }

  async consumePasswordResetOtp(
    userId: string,
    otpHash: string,
    maxAttempts: number,
  ): Promise<PasswordResetOtpResult> {
    if (!/^[0-9a-f]{64}$/i.test(otpHash)) {
      throw new TypeError('Password-reset OTP hash must be a SHA-256 digest.');
    }

    if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
      throw new RangeError(
        'Password-reset OTP maximum attempts must be a positive integer.',
      );
    }

    const result: unknown = await this.client.eval(
      CONSUME_PASSWORD_RESET_OTP_SCRIPT,
      1,
      passwordResetOtpKey(userId),
      otpHash,
      maxAttempts,
    );

    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error('Redis returned an invalid password-reset OTP result.');
    }

    const status: unknown = result[0] as unknown;

    if (status !== 'valid' && status !== 'invalid' && status !== 'locked') {
      throw new Error('Redis returned an unknown password-reset OTP status.');
    }

    const attempts = toNonNegativeInteger(result[1] as unknown);

    return {
      status,
      attemptsRemaining: Math.max(maxAttempts - attempts, 0),
    };
  }

  async deletePasswordResetOtp(userId: string): Promise<void> {
    await this.client.del(passwordResetOtpKey(userId));
  }

  private async recordWindowAttempt(
    key: string,
    windowSeconds: number,
    settingName: string,
  ): Promise<LoginFailureState> {
    if (!Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) {
      throw new RangeError(`${settingName} must be a positive integer.`);
    }

    const result: unknown = await this.client.eval(
      WINDOW_ATTEMPT_SCRIPT,
      1,
      key,
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
}
