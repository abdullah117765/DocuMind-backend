import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { EmailVerificationConfiguration } from '../../config/email-verification.config';
import { User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  AUTH_ERROR_REASONS,
  ExpiredEmailVerificationTokenException,
  InvalidEmailVerificationTokenException,
  UsedEmailVerificationTokenException,
} from './auth.exceptions';

const RESEND_MESSAGE =
  'If an unverified account exists for this email, a new verification link has been sent.';

export interface EmailVerificationActionResult {
  message: string;
  data?: {
    state: 'VERIFIED' | 'ALREADY_VERIFIED';
  };
}

export interface EmailVerificationResendResult {
  message: string;
  data: {
    cooldownSeconds: number;
  };
}

@Injectable()
export class EmailVerificationService {
  private readonly config: EmailVerificationConfiguration;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    configService: ConfigService,
  ) {
    this.config =
      configService.getOrThrow<EmailVerificationConfiguration>(
        'emailVerification',
      );
  }

  async sendForUser(user: User, now = new Date()): Promise<void> {
    const token = randomUUID();
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(
      now.getTime() + this.config.tokenTtlSeconds * 1000,
    );

    await this.prisma.$transaction(async (transaction) => {
      await transaction.emailVerificationToken.updateMany({
        where: {
          userId: user.id,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    try {
      await this.mailService.sendVerificationEmail(user.email, token);
    } catch (error: unknown) {
      await this.prisma.emailVerificationToken
        .updateMany({
          where: { tokenHash, consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        .catch(() => {});

      throw new ServiceUnavailableException({
        message:
          'Your account was created, but we could not send the verification email. Please try resending it.',
        details: {
          reason: AUTH_ERROR_REASONS.verificationDeliveryFailed,
        },
        cause: error,
      });
    }
  }

  async resend(
    email: string,
    ipAddress?: string | null,
  ): Promise<EmailVerificationResendResult> {
    const normalizedEmail = email.trim().toLowerCase();
    await this.assertResendAllowed(normalizedEmail, ipAddress);

    const user = await this.usersService.findByEmail(normalizedEmail);

    if (user && !user.isVerified) {
      try {
        await this.sendForUser(user);
      } catch (error: unknown) {
        await this.redisService
          .releaseEmailVerificationCooldown(normalizedEmail)
          .catch(() => {});
        throw error;
      }
    }

    return {
      message: RESEND_MESSAGE,
      data: {
        cooldownSeconds: this.config.resendCooldownSeconds,
      },
    };
  }

  async verify(
    token: string,
    now = new Date(),
  ): Promise<EmailVerificationActionResult> {
    const tokenHash = this.hashToken(token);

    return this.prisma.$transaction(async (transaction) => {
      const verification = await transaction.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!verification) {
        throw new InvalidEmailVerificationTokenException();
      }

      if (verification.user.isVerified) {
        return {
          message: 'Your email address is already verified. You can sign in.',
          data: { state: 'ALREADY_VERIFIED' as const },
        };
      }

      if (verification.consumedAt || verification.revokedAt) {
        throw new UsedEmailVerificationTokenException();
      }

      if (verification.expiresAt.getTime() <= now.getTime()) {
        throw new ExpiredEmailVerificationTokenException();
      }

      const claimed = await transaction.emailVerificationToken.updateMany({
        where: {
          id: verification.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      if (claimed.count !== 1) {
        const currentUser = await transaction.user.findUnique({
          where: { id: verification.userId },
        });

        if (currentUser?.isVerified) {
          return {
            message: 'Your email address is already verified. You can sign in.',
            data: { state: 'ALREADY_VERIFIED' as const },
          };
        }

        throw new UsedEmailVerificationTokenException();
      }

      await transaction.user.update({
        where: { id: verification.userId },
        data: { isVerified: true },
      });

      return {
        message: 'Email verified successfully. You can now sign in.',
        data: { state: 'VERIFIED' as const },
      };
    });
  }

  private async assertResendAllowed(
    email: string,
    ipAddress?: string | null,
  ): Promise<void> {
    const cooldown = await this.redisService.acquireEmailVerificationCooldown(
      email,
      this.config.resendCooldownSeconds,
    );

    if (!cooldown.acquired) {
      throw new HttpException(
        {
          message: 'Please wait before requesting another verification email.',
          details: { retryAfterSeconds: cooldown.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const [emailState, ipState] = await Promise.all([
        this.redisService.recordEmailVerificationRequest(
          `email:${email}`,
          this.config.rateLimit.windowSeconds,
        ),
        this.redisService.recordEmailVerificationRequest(
          `ip:${ipAddress?.trim() || 'unknown'}`,
          this.config.rateLimit.windowSeconds,
        ),
      ]);
      const blockedState = [emailState, ipState].find(
        (state) => state.attempts > this.config.rateLimit.maxRequests,
      );

      if (blockedState) {
        await this.redisService
          .releaseEmailVerificationCooldown(email)
          .catch(() => {});
        throw new HttpException(
          {
            message:
              'Too many verification email requests. Please try again later.',
            details: {
              retryAfterSeconds: blockedState.retryAfterSeconds,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error: unknown) {
      if (!(error instanceof HttpException)) {
        await this.redisService
          .releaseEmailVerificationCooldown(email)
          .catch(() => {});
      }
      throw error;
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
