import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { PasswordResetConfiguration } from '../../config/password-reset.config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  ExpiredPasswordResetAuthorizationException,
  InvalidPasswordResetAuthorizationException,
  InvalidPasswordResetOtpException,
  UsedPasswordResetAuthorizationException,
} from './auth.exceptions';
import { PasswordResetService } from './password-reset.service';
import { SESSION_REVOCATION_REASONS } from './session.service';

jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  randomInt: jest.fn(),
  randomUUID: jest.fn(),
}));

describe('PasswordResetService', () => {
  const configuration: PasswordResetConfiguration = {
    authorizationTtlSeconds: 120,
    resendCooldownSeconds: 40,
    otp: {
      secret: 'c'.repeat(64),
      ttlSeconds: 120,
      maxAttempts: 5,
    },
    rateLimit: {
      maxRequests: 3,
      windowSeconds: 900,
    },
  };
  const userId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const resetToken = '550e8400-e29b-41d4-a716-446655440000';
  const tokenHash = createHash('sha256').update(resetToken).digest('hex');
  const now = new Date('2026-08-03T12:00:00.000Z');
  const authorization = {
    id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
    userId,
    tokenHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 120_000),
    consumedAt: null,
    revokedAt: null,
  };
  const acquirePasswordResetCooldown = jest.fn();
  const releasePasswordResetCooldown = jest.fn();
  const recordPasswordResetRequest = jest.fn();
  const storePasswordResetOtp = jest.fn();
  const consumePasswordResetOtp = jest.fn();
  const deletePasswordResetOtp = jest.fn();
  const redisService = {
    acquirePasswordResetCooldown,
    releasePasswordResetCooldown,
    recordPasswordResetRequest,
    storePasswordResetOtp,
    consumePasswordResetOtp,
    deletePasswordResetOtp,
  } as unknown as RedisService;
  const authorizationFindUnique = jest.fn();
  const authorizationUpdateMany = jest.fn();
  const authorizationCreate = jest.fn();
  const userUpdate = jest.fn();
  const sessionUpdateMany = jest.fn();
  const refreshTokenUpdateMany = jest.fn();
  const transaction = {
    passwordResetAuthorization: {
      findUnique: authorizationFindUnique,
      updateMany: authorizationUpdateMany,
      create: authorizationCreate,
    },
    user: { update: userUpdate },
    session: { updateMany: sessionUpdateMany },
    refreshToken: { updateMany: refreshTokenUpdateMany },
  };
  const runTransaction = jest.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  const prismaService = {
    passwordResetAuthorization: {
      findUnique: authorizationFindUnique,
      updateMany: authorizationUpdateMany,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(configuration),
  } as unknown as ConfigService;
  const service = new PasswordResetService(
    redisService,
    prismaService,
    configService,
  );
  const generateRandomInteger = jest.mocked(randomInt);
  const generateRandomUuid = jest.mocked(randomUUID);

  beforeEach(() => {
    jest.clearAllMocks();
    acquirePasswordResetCooldown.mockResolvedValue({
      acquired: true,
      retryAfterSeconds: 40,
    });
    releasePasswordResetCooldown.mockResolvedValue(undefined);
    recordPasswordResetRequest.mockResolvedValue({
      attempts: 1,
      retryAfterSeconds: 900,
    });
    storePasswordResetOtp.mockResolvedValue(undefined);
    consumePasswordResetOtp.mockResolvedValue({
      status: 'valid',
      attemptsRemaining: 5,
    });
    deletePasswordResetOtp.mockResolvedValue(undefined);
    authorizationFindUnique.mockResolvedValue(authorization);
    authorizationUpdateMany.mockResolvedValue({ count: 1 });
    authorizationCreate.mockResolvedValue(authorization);
    userUpdate.mockResolvedValue(undefined);
    sessionUpdateMany.mockResolvedValue({ count: 1 });
    refreshTokenUpdateMany.mockResolvedValue({ count: 1 });
    generateRandomInteger.mockReturnValue(42817);
    generateRandomUuid.mockReturnValue(resetToken);
  });

  it('rate-limits both the normalized email and the requesting IP', async () => {
    await service.assertRequestAllowed(' USER@Example.COM ', ' 203.0.113.10 ');

    expect(recordPasswordResetRequest).toHaveBeenCalledWith(
      'email:user@example.com',
      900,
    );
    expect(recordPasswordResetRequest).toHaveBeenCalledWith(
      'ip:203.0.113.10',
      900,
    );
    expect(acquirePasswordResetCooldown).toHaveBeenCalledWith(
      'user@example.com',
      40,
    );
  });

  it('rejects a resend during cooldown with the server remaining time', async () => {
    acquirePasswordResetCooldown.mockResolvedValue({
      acquired: false,
      retryAfterSeconds: 27,
    });

    await expect(
      service.assertRequestAllowed('user@example.com', '203.0.113.10'),
    ).rejects.toMatchObject({
      response: { details: { retryAfterSeconds: 27 } },
      status: 429,
    });
    expect(recordPasswordResetRequest).not.toHaveBeenCalled();
  });

  it('rejects requests when either independent rate bucket is exhausted', async () => {
    recordPasswordResetRequest
      .mockResolvedValueOnce({ attempts: 1, retryAfterSeconds: 600 })
      .mockResolvedValueOnce({ attempts: 4, retryAfterSeconds: 600 });

    const result = service.assertRequestAllowed(
      'user@example.com',
      '203.0.113.10',
    );

    await expect(result).rejects.toBeInstanceOf(HttpException);
    await expect(result).rejects.toMatchObject({ status: 429 });
    expect(releasePasswordResetCooldown).toHaveBeenCalledWith(
      'user@example.com',
    );
  });

  it('revokes previous reset sessions before issuing a hashed OTP', async () => {
    await expect(service.issueOtp(userId)).resolves.toBe('042817');

    const expectedHash = createHmac('sha256', configuration.otp.secret)
      .update(`${userId}:042817`)
      .digest('hex');

    expect(authorizationUpdateMany).toHaveBeenCalledWith({
      where: { userId, consumedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(storePasswordResetOtp).toHaveBeenCalledWith(
      userId,
      expectedHash,
      120,
    );
    expect(storePasswordResetOtp).not.toHaveBeenCalledWith(
      expect.anything(),
      '042817',
      expect.anything(),
    );
  });

  it('atomically verifies and consumes a valid OTP', async () => {
    await service.verifyAndConsumeOtp(userId, '042817');

    expect(consumePasswordResetOtp).toHaveBeenCalledWith(
      userId,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      5,
    );
  });

  it('uses the same response for an invalid or locked OTP', async () => {
    consumePasswordResetOtp.mockResolvedValue({
      status: 'locked',
      attemptsRemaining: 0,
    });

    await expect(
      service.verifyAndConsumeOtp(userId, '000000'),
    ).rejects.toBeInstanceOf(InvalidPasswordResetOtpException);
  });

  it('issues one hashed, short-lived reset authorization', async () => {
    await expect(
      service.verifyOtpAndIssueAuthorization(userId, '042817'),
    ).resolves.toBe(resetToken);

    expect(authorizationUpdateMany).toHaveBeenCalledWith({
      where: { userId, consumedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(authorizationCreate).toHaveBeenCalledWith({
      data: {
        userId,
        tokenHash,
        expiresAt: expect.any(Date) as Date,
      },
    });
  });

  it('reports the active reset authorization without exposing its token', async () => {
    await expect(
      service.getAuthorizationStatus(resetToken, now),
    ).resolves.toEqual({
      userId,
      expiresAt: authorization.expiresAt,
    });
  });

  it('distinguishes missing, expired, and replaced reset sessions', async () => {
    authorizationFindUnique.mockResolvedValueOnce(null);
    await expect(
      service.getAuthorizationStatus(resetToken, now),
    ).rejects.toBeInstanceOf(InvalidPasswordResetAuthorizationException);

    authorizationFindUnique.mockResolvedValueOnce({
      ...authorization,
      expiresAt: now,
    });
    await expect(
      service.getAuthorizationStatus(resetToken, now),
    ).rejects.toBeInstanceOf(ExpiredPasswordResetAuthorizationException);

    authorizationFindUnique.mockResolvedValueOnce({
      ...authorization,
      revokedAt: now,
    });
    await expect(
      service.getAuthorizationStatus(resetToken, now),
    ).rejects.toBeInstanceOf(UsedPasswordResetAuthorizationException);
  });

  it('changes the password and revokes sessions in the claim transaction', async () => {
    await service.completePasswordReset(resetToken, 'new-password-hash', now);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: userId },
      data: { passwordHash: 'new-password-hash' },
    });
    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: now,
        revokeReason: SESSION_REVOCATION_REASONS.passwordReset,
      },
    });
    expect(refreshTokenUpdateMany).toHaveBeenCalled();
  });

  it('invalidates an OTP and exposes each configured timer', async () => {
    await expect(service.invalidateOtp(userId)).resolves.toBeUndefined();
    expect(deletePasswordResetOtp).toHaveBeenCalledWith(userId);
    expect(service.getExpiryMinutes()).toBe(2);
    expect(service.getOtpTtlSeconds()).toBe(120);
    expect(service.getResendCooldownSeconds()).toBe(40);
    expect(service.getAuthorizationTtlSeconds()).toBe(120);
  });

  it('releases a normalized resend cooldown after a failed request', async () => {
    await service.releaseRequestCooldown(' USER@Example.COM ');

    expect(releasePasswordResetCooldown).toHaveBeenCalledWith(
      'user@example.com',
    );
  });
});
