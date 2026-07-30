import type Redis from 'ioredis';
import { VERIFICATION_TOKEN_TTL_SECONDS } from './redis.constants';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  const clientMock = {
    status: 'wait',
    connect: jest.fn(),
    disconnect: jest.fn(),
    quit: jest.fn(),
    ping: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    ttl: jest.fn(),
    eval: jest.fn(),
    del: jest.fn(),
  };
  const redisService = new RedisService(clientMock as unknown as Redis);

  beforeEach(() => {
    jest.clearAllMocks();
    clientMock.status = 'wait';
  });

  it('connects a lazy client during module initialization', async () => {
    clientMock.connect.mockResolvedValue(undefined);

    await redisService.onModuleInit();

    expect(clientMock.connect).toHaveBeenCalledTimes(1);
  });

  it('stores a verification token with the default 24-hour TTL', async () => {
    clientMock.set.mockResolvedValue('OK');

    await redisService.storeVerificationToken('token-123', 'user-123');

    expect(clientMock.set).toHaveBeenCalledWith(
      'verify:token-123',
      'user-123',
      'EX',
      VERIFICATION_TOKEN_TTL_SECONDS,
    );
  });

  it('retrieves the user ID associated with a verification token', async () => {
    clientMock.get.mockResolvedValue('user-123');

    await expect(redisService.getVerificationUserId('token-123')).resolves.toBe(
      'user-123',
    );
    expect(clientMock.get).toHaveBeenCalledWith('verify:token-123');
  });

  it('deletes a verification token', async () => {
    clientMock.del.mockResolvedValue(1);

    await redisService.deleteVerificationToken('token-123');

    expect(clientMock.del).toHaveBeenCalledWith('verify:token-123');
  });

  it('reads failed-login attempts without exposing the identifier in the key', async () => {
    clientMock.get.mockResolvedValue('2');
    clientMock.ttl.mockResolvedValue(480);

    await expect(
      redisService.getLoginFailureState('user@example.com|127.0.0.1'),
    ).resolves.toEqual({
      attempts: 2,
      retryAfterSeconds: 480,
    });
    expect(clientMock.get).toHaveBeenCalledWith(
      expect.stringMatching(/^login-failure:[0-9a-f]{64}$/),
    );
    expect(clientMock.ttl).toHaveBeenCalledWith(
      expect.stringMatching(/^login-failure:[0-9a-f]{64}$/),
    );
  });

  it('atomically records a failed-login attempt and expiry', async () => {
    clientMock.eval.mockResolvedValue([3, 900]);

    await expect(
      redisService.recordLoginFailure('user@example.com|127.0.0.1', 900),
    ).resolves.toEqual({
      attempts: 3,
      retryAfterSeconds: 900,
    });
    expect(clientMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringMatching(/^login-failure:[0-9a-f]{64}$/),
      900,
    );
  });

  it('clears failed-login attempts after valid credentials', async () => {
    clientMock.del.mockResolvedValue(1);

    await redisService.clearLoginFailures('user@example.com|127.0.0.1');

    expect(clientMock.del).toHaveBeenCalledWith(
      expect.stringMatching(/^login-failure:[0-9a-f]{64}$/),
    );
  });

  it('records password-reset requests without exposing the identifier', async () => {
    clientMock.eval.mockResolvedValue([2, 720]);

    await expect(
      redisService.recordPasswordResetRequest(
        'user@example.com|127.0.0.1',
        900,
      ),
    ).resolves.toEqual({
      attempts: 2,
      retryAfterSeconds: 720,
    });
    expect(clientMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringMatching(/^password-reset-rate:[0-9a-f]{64}$/),
      900,
    );
  });

  it('stores only a password-reset OTP hash with an expiry', async () => {
    const otpHash = 'a'.repeat(64);
    clientMock.set.mockResolvedValue('OK');

    await redisService.storePasswordResetOtp('user-123', otpHash, 600);

    expect(clientMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^password-reset-otp:[0-9a-f]{64}$/),
      `${otpHash}:0`,
      'EX',
      600,
    );
  });

  it('atomically consumes a valid password-reset OTP', async () => {
    const otpHash = 'a'.repeat(64);
    clientMock.eval.mockResolvedValue(['valid', 1]);

    await expect(
      redisService.consumePasswordResetOtp('user-123', otpHash, 5),
    ).resolves.toEqual({
      status: 'valid',
      attemptsRemaining: 4,
    });
    expect(clientMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringMatching(/^password-reset-otp:[0-9a-f]{64}$/),
      otpHash,
      5,
    );
  });

  it('reports a password-reset OTP locked after too many attempts', async () => {
    clientMock.eval.mockResolvedValue(['locked', 5]);

    await expect(
      redisService.consumePasswordResetOtp('user-123', 'a'.repeat(64), 5),
    ).resolves.toEqual({
      status: 'locked',
      attemptsRemaining: 0,
    });
  });

  it('deletes a password-reset OTP', async () => {
    clientMock.del.mockResolvedValue(1);

    await redisService.deletePasswordResetOtp('user-123');

    expect(clientMock.del).toHaveBeenCalledWith(
      expect.stringMatching(/^password-reset-otp:[0-9a-f]{64}$/),
    );
  });

  it('rejects an invalid verification-token TTL', async () => {
    await expect(
      redisService.storeVerificationToken('token-123', 'user-123', 0),
    ).rejects.toThrow(RangeError);
    expect(clientMock.set).not.toHaveBeenCalled();
  });

  it('closes a connected client during module shutdown', async () => {
    clientMock.status = 'ready';
    clientMock.quit.mockResolvedValue('OK');

    await redisService.onModuleDestroy();

    expect(clientMock.quit).toHaveBeenCalledTimes(1);
    expect(clientMock.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a lazy client that was never connected', async () => {
    await redisService.onModuleDestroy();

    expect(clientMock.disconnect).toHaveBeenCalledTimes(1);
    expect(clientMock.quit).not.toHaveBeenCalled();
  });
});
