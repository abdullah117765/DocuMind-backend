import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { EmailVerificationConfiguration } from '../../config/email-verification.config';
import { User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  ExpiredEmailVerificationTokenException,
  InvalidEmailVerificationTokenException,
  UsedEmailVerificationTokenException,
} from './auth.exceptions';
import { EmailVerificationService } from './email-verification.service';

jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  randomUUID: jest.fn(),
}));

describe('EmailVerificationService', () => {
  const configuration: EmailVerificationConfiguration = {
    tokenTtlSeconds: 86_400,
    resendCooldownSeconds: 60,
    rateLimit: { maxRequests: 3, windowSeconds: 900 },
  };
  const now = new Date('2026-08-03T12:00:00.000Z');
  const token = '550e8400-e29b-41d4-a716-446655440000';
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const user: User = {
    id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    email: 'user@example.com',
    passwordHash: 'hashed-password',
    isVerified: false,
    createdAt: now,
    updatedAt: now,
  };
  const verification = {
    id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
    userId: user.id,
    tokenHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + configuration.tokenTtlSeconds * 1000),
    consumedAt: null,
    revokedAt: null,
    user,
  };
  const verificationFindUnique = jest.fn();
  const verificationUpdateMany = jest.fn();
  const verificationCreate = jest.fn();
  const userFindUnique = jest.fn();
  const userUpdate = jest.fn();
  const transaction = {
    emailVerificationToken: {
      findUnique: verificationFindUnique,
      updateMany: verificationUpdateMany,
      create: verificationCreate,
    },
    user: {
      findUnique: userFindUnique,
      update: userUpdate,
    },
  };
  const runTransaction = jest.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  const prismaService = {
    emailVerificationToken: {
      updateMany: verificationUpdateMany,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const findByEmail = jest.fn();
  const usersService = { findByEmail } as unknown as UsersService;
  const acquireEmailVerificationCooldown = jest.fn();
  const releaseEmailVerificationCooldown = jest.fn();
  const recordEmailVerificationRequest = jest.fn();
  const redisService = {
    acquireEmailVerificationCooldown,
    releaseEmailVerificationCooldown,
    recordEmailVerificationRequest,
  } as unknown as RedisService;
  const sendVerificationEmail = jest.fn();
  const mailService = { sendVerificationEmail } as unknown as MailService;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(configuration),
  } as unknown as ConfigService;
  const service = new EmailVerificationService(
    prismaService,
    usersService,
    redisService,
    mailService,
    configService,
  );
  const generateRandomUuid = jest.mocked(randomUUID);

  beforeEach(() => {
    jest.clearAllMocks();
    generateRandomUuid.mockReturnValue(token);
    verificationFindUnique.mockResolvedValue(verification);
    verificationUpdateMany.mockResolvedValue({ count: 1 });
    verificationCreate.mockResolvedValue(verification);
    userFindUnique.mockResolvedValue(user);
    userUpdate.mockResolvedValue({ ...user, isVerified: true });
    findByEmail.mockResolvedValue(user);
    acquireEmailVerificationCooldown.mockResolvedValue({
      acquired: true,
      retryAfterSeconds: 60,
    });
    releaseEmailVerificationCooldown.mockResolvedValue(undefined);
    recordEmailVerificationRequest.mockResolvedValue({
      attempts: 1,
      retryAfterSeconds: 900,
    });
    sendVerificationEmail.mockResolvedValue(undefined);
  });

  it('stores only a token hash and invalidates older active links', async () => {
    await service.sendForUser(user, now);

    expect(verificationUpdateMany).toHaveBeenCalledWith({
      where: { userId: user.id, consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    expect(verificationCreate).toHaveBeenCalledWith({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(now.getTime() + 86_400_000),
      },
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith(user.email, token);
  });

  it('revokes an unusable link when email delivery fails', async () => {
    sendVerificationEmail.mockRejectedValue(new Error('SMTP unavailable'));

    await expect(service.sendForUser(user, now)).rejects.toMatchObject({
      status: 503,
      response: {
        details: { reason: 'VERIFICATION_DELIVERY_FAILED' },
      },
    });
    expect(verificationUpdateMany).toHaveBeenLastCalledWith({
      where: { tokenHash, consumedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });

  it('rate-limits resend by both normalized email and IP', async () => {
    await service.resend(' USER@Example.COM ', ' 203.0.113.10 ');

    expect(recordEmailVerificationRequest).toHaveBeenCalledWith(
      'email:user@example.com',
      900,
    );
    expect(recordEmailVerificationRequest).toHaveBeenCalledWith(
      'ip:203.0.113.10',
      900,
    );
    expect(sendVerificationEmail).toHaveBeenCalled();
  });

  it('returns the same resend response for an unknown account', async () => {
    findByEmail.mockResolvedValue(null);

    await expect(
      service.resend('missing@example.com', '203.0.113.10'),
    ).resolves.toEqual({
      message:
        'If an unverified account exists for this email, a new verification link has been sent.',
      data: { cooldownSeconds: 60 },
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('atomically verifies a valid link', async () => {
    await expect(service.verify(token, now)).resolves.toEqual({
      message: 'Email verified successfully. You can now sign in.',
      data: { state: 'VERIFIED' },
    });
    expect(verificationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: verification.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { isVerified: true },
    });
  });

  it('treats a second click as an idempotent success', async () => {
    verificationFindUnique.mockResolvedValue({
      ...verification,
      consumedAt: now,
      user: { ...user, isVerified: true },
    });

    await expect(service.verify(token, now)).resolves.toMatchObject({
      data: { state: 'ALREADY_VERIFIED' },
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('distinguishes invalid, expired, and replaced links', async () => {
    verificationFindUnique.mockResolvedValueOnce(null);
    await expect(service.verify(token, now)).rejects.toBeInstanceOf(
      InvalidEmailVerificationTokenException,
    );

    verificationFindUnique.mockResolvedValueOnce({
      ...verification,
      expiresAt: now,
    });
    await expect(service.verify(token, now)).rejects.toBeInstanceOf(
      ExpiredEmailVerificationTokenException,
    );

    verificationFindUnique.mockResolvedValueOnce({
      ...verification,
      revokedAt: now,
    });
    await expect(service.verify(token, now)).rejects.toBeInstanceOf(
      UsedEmailVerificationTokenException,
    );
  });

  it('handles concurrent verification as already verified', async () => {
    verificationUpdateMany.mockResolvedValue({ count: 0 });
    userFindUnique.mockResolvedValue({ ...user, isVerified: true });

    await expect(service.verify(token, now)).resolves.toMatchObject({
      data: { state: 'ALREADY_VERIFIED' },
    });
  });
});
