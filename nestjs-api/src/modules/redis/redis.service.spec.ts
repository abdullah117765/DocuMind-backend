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
