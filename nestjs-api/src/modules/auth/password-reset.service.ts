import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { PasswordResetConfiguration } from '../../config/password-reset.config';
import { PrismaService } from '../prisma/prisma.service';
import { type LoginFailureState, RedisService } from '../redis/redis.service';
import {
  ExpiredPasswordResetAuthorizationException,
  InvalidPasswordResetAuthorizationException,
  InvalidPasswordResetOtpException,
  UsedPasswordResetAuthorizationException,
} from './auth.exceptions';
import { SESSION_REVOCATION_REASONS } from './session.service';

const OTP_UPPER_BOUND = 1_000_000;

@Injectable()
export class PasswordResetService {
  private readonly config: PasswordResetConfiguration;

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.config =
      configService.getOrThrow<PasswordResetConfiguration>('passwordReset');
  }

  async assertRequestAllowed(
    email: string,
    ipAddress?: string | null,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const cooldown = await this.redisService.acquirePasswordResetCooldown(
      normalizedEmail,
      this.config.resendCooldownSeconds,
    );

    if (!cooldown.acquired) {
      throw new HttpException(
        {
          message: 'Please wait before requesting another password reset code.',
          details: {
            retryAfterSeconds: cooldown.retryAfterSeconds,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let states: LoginFailureState[];

    try {
      states = await Promise.all([
        this.redisService.recordPasswordResetRequest(
          `email:${normalizedEmail}`,
          this.config.rateLimit.windowSeconds,
        ),
        this.redisService.recordPasswordResetRequest(
          `ip:${ipAddress?.trim() || 'unknown'}`,
          this.config.rateLimit.windowSeconds,
        ),
      ]);
    } catch (error: unknown) {
      await this.releaseRequestCooldown(normalizedEmail).catch(() => {});
      throw error;
    }

    const blockedState = states.find(
      (state) => state.attempts > this.config.rateLimit.maxRequests,
    );

    if (blockedState) {
      await this.releaseRequestCooldown(normalizedEmail).catch(() => {});
      throw new HttpException(
        {
          message: 'Too many password reset requests. Please try again later.',
          details: {
            retryAfterSeconds: blockedState.retryAfterSeconds,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  releaseRequestCooldown(email: string): Promise<void> {
    return this.redisService.releasePasswordResetCooldown(
      email.trim().toLowerCase(),
    );
  }

  async issueOtp(userId: string): Promise<string> {
    const otp = randomInt(0, OTP_UPPER_BOUND).toString().padStart(6, '0');

    await this.revokeAuthorizationsForUser(userId);

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

  async verifyOtpAndIssueAuthorization(
    userId: string,
    otp: string,
  ): Promise<string> {
    await this.verifyAndConsumeOtp(userId, otp);

    const resetToken = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.authorizationTtlSeconds * 1000,
    );

    await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetAuthorization.updateMany({
        where: {
          userId,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.passwordResetAuthorization.create({
        data: {
          userId,
          tokenHash: this.hashAuthorization(resetToken),
          expiresAt,
        },
      });
    });

    return resetToken;
  }

  async getAuthorizationStatus(
    resetToken: string,
    now = new Date(),
  ): Promise<{ userId: string; expiresAt: Date }> {
    const authorization =
      await this.prisma.passwordResetAuthorization.findUnique({
        where: { tokenHash: this.hashAuthorization(resetToken) },
      });

    this.assertAuthorizationUsable(authorization, now);

    return {
      userId: authorization.userId,
      expiresAt: authorization.expiresAt,
    };
  }

  async completePasswordReset(
    resetToken: string,
    passwordHash: string,
    now = new Date(),
  ): Promise<void> {
    const tokenHash = this.hashAuthorization(resetToken);

    await this.prisma.$transaction(async (transaction) => {
      const authorization =
        await transaction.passwordResetAuthorization.findUnique({
          where: { tokenHash },
        });

      this.assertAuthorizationUsable(authorization, now);

      const claimed = await transaction.passwordResetAuthorization.updateMany({
        where: {
          id: authorization.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      if (claimed.count !== 1) {
        const latest = await transaction.passwordResetAuthorization.findUnique({
          where: { id: authorization.id },
        });
        this.assertAuthorizationUsable(latest, now);
        throw new UsedPasswordResetAuthorizationException();
      }

      await transaction.user.update({
        where: { id: authorization.userId },
        data: { passwordHash },
      });
      await transaction.session.updateMany({
        where: { userId: authorization.userId, revokedAt: null },
        data: {
          revokedAt: now,
          revokeReason: SESSION_REVOCATION_REASONS.passwordReset,
        },
      });
      await transaction.refreshToken.updateMany({
        where: {
          session: { userId: authorization.userId },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.passwordResetAuthorization.updateMany({
        where: {
          userId: authorization.userId,
          id: { not: authorization.id },
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    });
  }

  invalidateOtp(userId: string): Promise<void> {
    return this.redisService.deletePasswordResetOtp(userId);
  }

  getExpiryMinutes(): number {
    return Math.ceil(this.config.otp.ttlSeconds / 60);
  }

  getOtpTtlSeconds(): number {
    return this.config.otp.ttlSeconds;
  }

  getResendCooldownSeconds(): number {
    return this.config.resendCooldownSeconds;
  }

  getAuthorizationTtlSeconds(): number {
    return this.config.authorizationTtlSeconds;
  }

  private hashOtp(userId: string, otp: string): string {
    return createHmac('sha256', this.config.otp.secret)
      .update(`${userId}:${otp}`)
      .digest('hex');
  }

  private hashAuthorization(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private revokeAuthorizationsForUser(userId: string): Promise<unknown> {
    return this.prisma.passwordResetAuthorization.updateMany({
      where: { userId, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private assertAuthorizationUsable(
    authorization: {
      id: string;
      userId: string;
      expiresAt: Date;
      consumedAt: Date | null;
      revokedAt: Date | null;
    } | null,
    now: Date,
  ): asserts authorization is {
    id: string;
    userId: string;
    expiresAt: Date;
    consumedAt: Date | null;
    revokedAt: Date | null;
  } {
    if (!authorization) {
      throw new InvalidPasswordResetAuthorizationException();
    }

    if (authorization.consumedAt || authorization.revokedAt) {
      throw new UsedPasswordResetAuthorizationException();
    }

    if (authorization.expiresAt.getTime() <= now.getTime()) {
      throw new ExpiredPasswordResetAuthorizationException();
    }
  }
}
