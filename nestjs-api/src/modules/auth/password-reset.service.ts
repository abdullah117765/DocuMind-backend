import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt } from 'node:crypto';
import { PasswordResetConfiguration } from '../../config/password-reset.config';
import { RedisService } from '../redis/redis.service';
import { InvalidPasswordResetOtpException } from './auth.exceptions';

const OTP_UPPER_BOUND = 1_000_000;

@Injectable()
export class PasswordResetService {
  private readonly config: PasswordResetConfiguration;

  constructor(
    private readonly redisService: RedisService,
    configService: ConfigService,
  ) {
    this.config =
      configService.getOrThrow<PasswordResetConfiguration>('passwordReset');
  }

  async assertRequestAllowed(
    email: string,
    ipAddress?: string | null,
  ): Promise<void> {
    const identifier = `${email.trim().toLowerCase()}|${
      ipAddress?.trim() || 'unknown'
    }`;
    const state = await this.redisService.recordPasswordResetRequest(
      identifier,
      this.config.rateLimit.windowSeconds,
    );

    if (state.attempts > this.config.rateLimit.maxRequests) {
      throw new HttpException(
        'Too many password reset requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async issueOtp(userId: string): Promise<string> {
    const otp = randomInt(0, OTP_UPPER_BOUND).toString().padStart(6, '0');

    await this.redisService.storePasswordResetOtp(
      userId,
      this.hashOtp(userId, otp),
      this.config.otp.ttlSeconds,
    );

    return otp;
  }

  async verifyAndConsumeOtp(userId: string, otp: string): Promise<void> {
    const result = await this.redisService.consumePasswordResetOtp(
      userId,
      this.hashOtp(userId, otp),
      this.config.otp.maxAttempts,
    );

    if (result.status !== 'valid') {
      throw new InvalidPasswordResetOtpException();
    }
  }

  invalidateOtp(userId: string): Promise<void> {
    return this.redisService.deletePasswordResetOtp(userId);
  }

  getExpiryMinutes(): number {
    return Math.ceil(this.config.otp.ttlSeconds / 60);
  }

  private hashOtp(userId: string, otp: string): string {
    return createHmac('sha256', this.config.otp.secret)
      .update(`${userId}:${otp}`)
      .digest('hex');
  }
}
