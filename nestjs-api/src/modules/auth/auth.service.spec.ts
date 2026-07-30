import { ConflictException, HttpException } from '@nestjs/common';
import { hash } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('AuthService', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const user: User = {
    id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    email: 'user@example.com',
    passwordHash: 'hashed-password',
    isVerified: false,
    createdAt: now,
    updatedAt: now,
  };
  const verificationToken = '550e8400-e29b-41d4-a716-446655440000';
  const findByEmail = jest.fn();
  const createUser = jest.fn();
  const markVerified = jest.fn();
  const storeVerificationToken = jest.fn();
  const getVerificationUserId = jest.fn();
  const deleteVerificationToken = jest.fn();
  const sendVerificationEmail = jest.fn();
  const usersService = {
    findByEmail,
    create: createUser,
    markVerified,
  } as unknown as UsersService;
  const redisService = {
    storeVerificationToken,
    getVerificationUserId,
    deleteVerificationToken,
  } as unknown as RedisService;
  const mailService = {
    sendVerificationEmail,
  } as unknown as MailService;
  const service = new AuthService(usersService, redisService, mailService);
  const hashPassword = jest.mocked(hash);
  const createRandomUuid = jest.mocked(randomUUID);

  beforeEach(() => {
    jest.clearAllMocks();
    findByEmail.mockResolvedValue(null);
    hashPassword.mockResolvedValue(user.passwordHash);
    createUser.mockResolvedValue(user);
    createRandomUuid.mockReturnValue(verificationToken);
    storeVerificationToken.mockResolvedValue(undefined);
    sendVerificationEmail.mockResolvedValue(undefined);
    markVerified.mockResolvedValue({
      ...user,
      isVerified: true,
    });
    deleteVerificationToken.mockResolvedValue(undefined);
  });

  describe('register', () => {
    it('creates an unverified user and sends a verification email', async () => {
      await expect(
        service.register({
          email: user.email,
          password: 'SecureP@ss1',
        }),
      ).resolves.toEqual({
        message:
          'Registration successful. Please check your email to verify your account.',
      });

      expect(findByEmail).toHaveBeenCalledWith(user.email);
      expect(hashPassword).toHaveBeenCalledWith('SecureP@ss1', 12);
      expect(createUser).toHaveBeenCalledWith({
        email: user.email,
        passwordHash: user.passwordHash,
      });
      expect(storeVerificationToken).toHaveBeenCalledWith(
        verificationToken,
        user.id,
      );
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        user.email,
        verificationToken,
      );
    });

    it('rejects an already-registered email before hashing', async () => {
      findByEmail.mockResolvedValue(user);

      await expect(
        service.register({
          email: user.email,
          password: 'SecureP@ss1',
        }),
      ).rejects.toThrow(ConflictException);

      expect(hashPassword).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
      expect(storeVerificationToken).not.toHaveBeenCalled();
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('does not send an email when Redis token storage fails', async () => {
      storeVerificationToken.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.register({
          email: user.email,
          password: 'SecureP@ss1',
        }),
      ).rejects.toThrow('Redis unavailable');

      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('marks the user verified and consumes the token', async () => {
      getVerificationUserId.mockResolvedValue(user.id);

      await expect(service.verifyEmail(verificationToken)).resolves.toEqual({
        message: 'Email verified successfully',
      });

      expect(markVerified).toHaveBeenCalledWith(user.id);
      expect(deleteVerificationToken).toHaveBeenCalledWith(verificationToken);
    });

    it('returns status 498 for an expired or unknown token', async () => {
      getVerificationUserId.mockResolvedValue(null);

      const result = service.verifyEmail(verificationToken);

      await expect(result).rejects.toBeInstanceOf(HttpException);
      await expect(result).rejects.toMatchObject({
        status: 498,
      });
      expect(markVerified).not.toHaveBeenCalled();
      expect(deleteVerificationToken).not.toHaveBeenCalled();
    });

    it('does not consume the token when the user update fails', async () => {
      getVerificationUserId.mockResolvedValue(user.id);
      markVerified.mockRejectedValue(new Error('Database unavailable'));

      await expect(service.verifyEmail(verificationToken)).rejects.toThrow(
        'Database unavailable',
      );

      expect(deleteVerificationToken).not.toHaveBeenCalled();
    });
  });
});
