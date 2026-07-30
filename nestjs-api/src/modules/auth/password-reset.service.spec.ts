import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt } from 'node:crypto';
import { PasswordResetConfiguration } from '../../config/password-reset.config';
import { RedisService } from '../redis/redis.service';
import { InvalidPasswordResetOtpException } from './auth.exceptions';
import { PasswordResetService } from './password-reset.service';

jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  randomInt: jest.fn(),
}));

describe('PasswordResetService', () => {
  const configuration: PasswordResetConfiguration = {
    otp: {
      secret: 'c'.repeat(64),
      ttlSeconds: 600,
      maxAttempts: 5,
    },
    rateLimit: {
      maxRequests: 3,
      windowSeconds: 900,
    },
  };
  const userId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const recordPasswordResetRequest = jest.fn();
  const storePasswordResetOtp = jest.fn();
  const consumePasswordResetOtp = jest.fn();
  const deletePasswordResetOtp = jest.fn();
  const redisService = {
    recordPasswordResetRequest,
    storePasswordResetOtp,
    consumePasswordResetOtp,
    deletePasswordResetOtp,
  } as unknown as RedisService;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(configuration),
  } as unknown as ConfigService;
  const service = new PasswordResetService(redisService, configService);
  const generateRandomInteger = jest.mocked(randomInt);

  beforeEach(() => {
    jest.clearAllMocks();
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
    generateRandomInteger.mockReturnValue(42817);
  });

  it('rate-limits a normalized email and IP combination', async () => {
    await service.assertRequestAllowed(' USER@Example.COM ', ' 203.0.113.10 ');

    expect(recordPasswordResetRequest).toHaveBeenCalledWith(
      'user@example.com|203.0.113.10',
      900,
    );
  });

  it('rejects requests after the configured limit', async () => {
    recordPasswordResetRequest.mockResolvedValue({
      attempts: 4,
      retryAfterSeconds: 600,
    });

    const result = service.assertRequestAllowed(
      'user@example.com',
      '203.0.113.10',
    );

    await expect(result).rejects.toBeInstanceOf(HttpException);
    await expect(result).rejects.toMatchObject({
      status: 429,
    });
  });

  it('generates a zero-padded OTP and stores only its HMAC hash', async () => {
    await expect(service.issueOtp(userId)).resolves.toBe('042817');

    const expectedHash = createHmac('sha256', configuration.otp.secret)
      .update(`${userId}:042817`)
      .digest('hex');

    expect(storePasswordResetOtp).toHaveBeenCalledWith(
      userId,
      expectedHash,
      600,
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

  it('uses the same error for an invalid or locked OTP', async () => {
    consumePasswordResetOtp.mockResolvedValue({
      status: 'locked',
      attemptsRemaining: 0,
    });

    await expect(
      service.verifyAndConsumeOtp(userId, '000000'),
    ).rejects.toBeInstanceOf(InvalidPasswordResetOtpException);
  });

  it('invalidates an issued OTP and exposes rounded expiry minutes', async () => {
    await expect(service.invalidateOtp(userId)).resolves.toBeUndefined();
    expect(deletePasswordResetOtp).toHaveBeenCalledWith(userId);
    expect(service.getExpiryMinutes()).toBe(10);
  });
});
