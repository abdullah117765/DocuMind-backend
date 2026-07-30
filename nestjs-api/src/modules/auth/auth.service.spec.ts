import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { AuthConfiguration } from '../../config/auth.config';
import { Session, User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  InvalidPasswordResetOtpException,
  InvalidRefreshTokenException,
} from './auth.exceptions';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { SESSION_REVOCATION_REASONS, SessionService } from './session.service';
import { TokenService } from './token.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('AuthService', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const authConfiguration: AuthConfiguration = {
    accessToken: {
      secret: 'a'.repeat(64),
      expiresIn: '15m',
      issuer: 'ai-doc-intel-api',
      audience: 'ai-doc-intel-web',
    },
    refreshToken: {
      pepper: 'b'.repeat(64),
      ttlSeconds: 30 * 24 * 60 * 60,
    },
    loginRateLimit: {
      maxAttempts: 5,
      windowSeconds: 900,
    },
  };
  const user: User = {
    id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    email: 'user@example.com',
    passwordHash: 'hashed-password',
    isVerified: false,
    createdAt: now,
    updatedAt: now,
  };
  const verifiedUser: User = {
    ...user,
    isVerified: true,
  };
  const session: Session = {
    id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
    userId: user.id,
    deviceName: 'Chrome on Windows',
    userAgent: 'Mozilla/5.0',
    ipAddress: '127.0.0.1',
    createdAt: now,
    lastActiveAt: now,
    expiresAt: new Date('2026-01-31T00:00:00.000Z'),
    revokedAt: null,
    revokeReason: null,
  };
  const sessionWithRefreshToken = {
    session,
    refreshToken: 'opaque-refresh-token',
  };
  const verificationToken = '550e8400-e29b-41d4-a716-446655440000';
  const findByEmail = jest.fn();
  const findById = jest.fn();
  const createUser = jest.fn();
  const markVerified = jest.fn();
  const storeVerificationToken = jest.fn();
  const getVerificationUserId = jest.fn();
  const deleteVerificationToken = jest.fn();
  const getLoginFailureState = jest.fn();
  const recordLoginFailure = jest.fn();
  const clearLoginFailures = jest.fn();
  const sendVerificationEmail = jest.fn();
  const createSession = jest.fn();
  const rotateRefreshToken = jest.fn();
  const revokeSession = jest.fn();
  const listActiveUserSessions = jest.fn();
  const revokeUserSession = jest.fn();
  const revokeAllUserSessions = jest.fn();
  const resetPasswordAndRevokeSessions = jest.fn();
  const createAccessToken = jest.fn();
  const assertPasswordResetRequestAllowed = jest.fn();
  const issuePasswordResetOtp = jest.fn();
  const verifyAndConsumePasswordResetOtp = jest.fn();
  const invalidatePasswordResetOtp = jest.fn();
  const getPasswordResetExpiryMinutes = jest.fn();
  const sendPasswordResetOtp = jest.fn();
  const getOrThrow = jest.fn().mockReturnValue(authConfiguration);
  const usersService = {
    findByEmail,
    findById,
    create: createUser,
    markVerified,
  } as unknown as UsersService;
  const redisService = {
    storeVerificationToken,
    getVerificationUserId,
    deleteVerificationToken,
    getLoginFailureState,
    recordLoginFailure,
    clearLoginFailures,
  } as unknown as RedisService;
  const mailService = {
    sendVerificationEmail,
    sendPasswordResetOtp,
  } as unknown as MailService;
  const sessionService = {
    createSession,
    rotateRefreshToken,
    revokeSession,
    listActiveUserSessions,
    revokeUserSession,
    revokeAllUserSessions,
    resetPasswordAndRevokeSessions,
  } as unknown as SessionService;
  const tokenService = {
    createAccessToken,
  } as unknown as TokenService;
  const configService = {
    getOrThrow,
  } as unknown as ConfigService;
  const passwordResetService = {
    assertRequestAllowed: assertPasswordResetRequestAllowed,
    issueOtp: issuePasswordResetOtp,
    verifyAndConsumeOtp: verifyAndConsumePasswordResetOtp,
    invalidateOtp: invalidatePasswordResetOtp,
    getExpiryMinutes: getPasswordResetExpiryMinutes,
  } as unknown as PasswordResetService;
  const service = new AuthService(
    usersService,
    redisService,
    mailService,
    sessionService,
    tokenService,
    passwordResetService,
    configService,
  );
  const hashPassword = jest.mocked(hash);
  const comparePassword = jest.mocked(compare);
  const createRandomUuid = jest.mocked(randomUUID);

  beforeEach(() => {
    jest.clearAllMocks();
    findByEmail.mockResolvedValue(null);
    findById.mockResolvedValue(verifiedUser);
    hashPassword.mockResolvedValue(user.passwordHash);
    comparePassword.mockResolvedValue(true);
    createUser.mockResolvedValue(user);
    createRandomUuid.mockReturnValue(verificationToken);
    storeVerificationToken.mockResolvedValue(undefined);
    sendVerificationEmail.mockResolvedValue(undefined);
    markVerified.mockResolvedValue({
      ...user,
      isVerified: true,
    });
    deleteVerificationToken.mockResolvedValue(undefined);
    getLoginFailureState.mockResolvedValue({
      attempts: 0,
      retryAfterSeconds: 0,
    });
    recordLoginFailure.mockResolvedValue({
      attempts: 1,
      retryAfterSeconds: 900,
    });
    clearLoginFailures.mockResolvedValue(undefined);
    createSession.mockResolvedValue(sessionWithRefreshToken);
    rotateRefreshToken.mockResolvedValue(sessionWithRefreshToken);
    revokeSession.mockResolvedValue(undefined);
    listActiveUserSessions.mockResolvedValue([session]);
    revokeUserSession.mockResolvedValue(true);
    revokeAllUserSessions.mockResolvedValue(undefined);
    resetPasswordAndRevokeSessions.mockResolvedValue(undefined);
    createAccessToken.mockResolvedValue('signed-access-token');
    assertPasswordResetRequestAllowed.mockResolvedValue(undefined);
    issuePasswordResetOtp.mockResolvedValue('042817');
    verifyAndConsumePasswordResetOtp.mockResolvedValue(undefined);
    invalidatePasswordResetOtp.mockResolvedValue(undefined);
    getPasswordResetExpiryMinutes.mockReturnValue(10);
    sendPasswordResetOtp.mockResolvedValue(undefined);
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

  describe('login', () => {
    const loginDto = {
      email: user.email,
      password: 'SecureP@ss1',
    };
    const metadata = {
      deviceName: 'Chrome on Windows',
      userAgent: 'Mozilla/5.0',
      ipAddress: '127.0.0.1',
    };

    it('creates a device session and issues both tokens', async () => {
      findByEmail.mockResolvedValue(verifiedUser);

      await expect(service.login(loginDto, metadata)).resolves.toEqual({
        data: {
          user: {
            id: verifiedUser.id,
            email: verifiedUser.email,
            isVerified: true,
          },
          session: {
            id: session.id,
            expiresAt: session.expiresAt,
          },
          accessToken: 'signed-access-token',
          refreshToken: sessionWithRefreshToken.refreshToken,
        },
      });

      expect(getLoginFailureState).toHaveBeenCalledWith(
        'user@example.com|127.0.0.1',
      );
      expect(comparePassword).toHaveBeenCalledWith(
        loginDto.password,
        verifiedUser.passwordHash,
      );
      expect(clearLoginFailures).toHaveBeenCalledWith(
        'user@example.com|127.0.0.1',
      );
      expect(createSession).toHaveBeenCalledWith(verifiedUser.id, metadata);
      expect(createAccessToken).toHaveBeenCalledWith(
        verifiedUser.id,
        session.id,
      );
    });

    it('uses the same unauthorized response for an unknown account', async () => {
      comparePassword.mockResolvedValue(false);

      await expect(service.login(loginDto, metadata)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(comparePassword).toHaveBeenCalledWith(
        loginDto.password,
        expect.stringMatching(/^\$2[aby]\$12\$/),
      );
      expect(recordLoginFailure).toHaveBeenCalledWith(
        'user@example.com|127.0.0.1',
        900,
      );
      expect(createSession).not.toHaveBeenCalled();
    });

    it('uses the same unauthorized response for an incorrect password', async () => {
      findByEmail.mockResolvedValue(verifiedUser);
      comparePassword.mockResolvedValue(false);

      await expect(service.login(loginDto, metadata)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(recordLoginFailure).toHaveBeenCalledWith(
        'user@example.com|127.0.0.1',
        900,
      );
      expect(createSession).not.toHaveBeenCalled();
    });

    it('blocks authentication when the failure limit is reached', async () => {
      getLoginFailureState.mockResolvedValue({
        attempts: 5,
        retryAfterSeconds: 600,
      });

      await expect(service.login(loginDto, metadata)).rejects.toMatchObject({
        status: 429,
      });
      expect(findByEmail).not.toHaveBeenCalled();
      expect(comparePassword).not.toHaveBeenCalled();
    });

    it('rejects an unverified account after valid credentials', async () => {
      findByEmail.mockResolvedValue(user);

      await expect(service.login(loginDto, metadata)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(clearLoginFailures).toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      await expect(service.refresh('old-refresh-token')).resolves.toEqual({
        data: {
          user: {
            id: verifiedUser.id,
            email: verifiedUser.email,
            isVerified: true,
          },
          session: {
            id: session.id,
            expiresAt: session.expiresAt,
          },
          accessToken: 'signed-access-token',
          refreshToken: sessionWithRefreshToken.refreshToken,
        },
      });

      expect(rotateRefreshToken).toHaveBeenCalledWith('old-refresh-token');
      expect(findById).toHaveBeenCalledWith(session.userId);
      expect(createAccessToken).toHaveBeenCalledWith(
        verifiedUser.id,
        session.id,
      );
    });

    it('revokes a rotated session when its user is unavailable', async () => {
      findById.mockResolvedValue(null);

      await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(
        InvalidRefreshTokenException,
      );
      expect(revokeSession).toHaveBeenCalledWith(
        session.id,
        SESSION_REVOCATION_REASONS.accountUnavailable,
      );
      expect(createAccessToken).not.toHaveBeenCalled();
    });

    it('revokes the session when access-token signing fails', async () => {
      createAccessToken.mockRejectedValue(new Error('JWT signing failed'));

      await expect(service.refresh('old-refresh-token')).rejects.toThrow(
        'JWT signing failed',
      );
      expect(revokeSession).toHaveBeenCalledWith(
        session.id,
        SESSION_REVOCATION_REASONS.tokenIssueFailure,
      );
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

  describe('forgotPassword', () => {
    const request = {
      email: user.email,
    };
    const genericResult = {
      message:
        'If an account exists for that email, a password reset code has been sent.',
    };

    it('sends a one-time code to an existing account', async () => {
      findByEmail.mockResolvedValue(verifiedUser);

      await expect(
        service.forgotPassword(request, '203.0.113.10'),
      ).resolves.toEqual(genericResult);

      expect(assertPasswordResetRequestAllowed).toHaveBeenCalledWith(
        user.email,
        '203.0.113.10',
      );
      expect(issuePasswordResetOtp).toHaveBeenCalledWith(user.id);
      expect(sendPasswordResetOtp).toHaveBeenCalledWith(
        user.email,
        '042817',
        10,
      );
    });

    it('returns the same response for an unknown account without sending mail', async () => {
      await expect(
        service.forgotPassword(request, '203.0.113.10'),
      ).resolves.toEqual(genericResult);

      expect(assertPasswordResetRequestAllowed).toHaveBeenCalled();
      expect(issuePasswordResetOtp).not.toHaveBeenCalled();
      expect(sendPasswordResetOtp).not.toHaveBeenCalled();
    });

    it('invalidates the OTP when email delivery fails', async () => {
      findByEmail.mockResolvedValue(verifiedUser);
      sendPasswordResetOtp.mockRejectedValue(new Error('SMTP unavailable'));

      await expect(
        service.forgotPassword(request, '203.0.113.10'),
      ).rejects.toThrow('SMTP unavailable');

      expect(invalidatePasswordResetOtp).toHaveBeenCalledWith(user.id);
    });
  });

  describe('resetPassword', () => {
    const request = {
      email: user.email,
      otp: '042817',
      newPassword: 'NewSecureP@ss2',
    };

    it('consumes the OTP, hashes the new password, and revokes all sessions', async () => {
      findByEmail.mockResolvedValue(verifiedUser);
      hashPassword.mockResolvedValue('new-password-hash');

      await expect(service.resetPassword(request)).resolves.toEqual({
        message: 'Password reset successfully. Please log in again.',
      });

      expect(verifyAndConsumePasswordResetOtp).toHaveBeenCalledWith(
        user.id,
        request.otp,
      );
      expect(hashPassword).toHaveBeenCalledWith(request.newPassword, 12);
      expect(resetPasswordAndRevokeSessions).toHaveBeenCalledWith(
        user.id,
        'new-password-hash',
      );
    });

    it('uses the same invalid-code response for an unknown account', async () => {
      await expect(service.resetPassword(request)).rejects.toBeInstanceOf(
        InvalidPasswordResetOtpException,
      );

      expect(verifyAndConsumePasswordResetOtp).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000000',
        request.otp,
      );
      expect(hashPassword).not.toHaveBeenCalled();
      expect(resetPasswordAndRevokeSessions).not.toHaveBeenCalled();
    });

    it('does not change the password when OTP verification fails', async () => {
      findByEmail.mockResolvedValue(verifiedUser);
      verifyAndConsumePasswordResetOtp.mockRejectedValue(
        new InvalidPasswordResetOtpException(),
      );

      await expect(service.resetPassword(request)).rejects.toBeInstanceOf(
        InvalidPasswordResetOtpException,
      );

      expect(hashPassword).not.toHaveBeenCalled();
      expect(resetPasswordAndRevokeSessions).not.toHaveBeenCalled();
    });
  });

  describe('device sessions', () => {
    const otherSession: Session = {
      ...session,
      id: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
      deviceName: 'Safari on iPhone',
      userAgent: 'Mobile Safari',
      ipAddress: '203.0.113.10',
    };

    it('lists only safe session details with the current device first', async () => {
      listActiveUserSessions.mockResolvedValue([otherSession, session]);

      await expect(
        service.getActiveSessions(user.id, session.id),
      ).resolves.toEqual({
        data: {
          sessions: [
            {
              id: session.id,
              deviceName: session.deviceName,
              userAgent: session.userAgent,
              ipAddress: session.ipAddress,
              createdAt: session.createdAt,
              lastActiveAt: session.lastActiveAt,
              expiresAt: session.expiresAt,
              isCurrent: true,
            },
            {
              id: otherSession.id,
              deviceName: otherSession.deviceName,
              userAgent: otherSession.userAgent,
              ipAddress: otherSession.ipAddress,
              createdAt: otherSession.createdAt,
              lastActiveAt: otherSession.lastActiveAt,
              expiresAt: otherSession.expiresAt,
              isCurrent: false,
            },
          ],
        },
      });
      expect(listActiveUserSessions).toHaveBeenCalledWith(user.id);
    });

    it('logs out the current session', async () => {
      await expect(
        service.logoutCurrentSession(user.id, session.id),
      ).resolves.toEqual({
        message: 'Logged out successfully',
      });
      expect(revokeUserSession).toHaveBeenCalledWith(
        user.id,
        session.id,
        SESSION_REVOCATION_REASONS.logout,
      );
    });

    it('logs out one selected owned session', async () => {
      await expect(
        service.logoutSession(user.id, otherSession.id),
      ).resolves.toEqual({
        message: 'Session logged out successfully',
      });
      expect(revokeUserSession).toHaveBeenCalledWith(
        user.id,
        otherSession.id,
        SESSION_REVOCATION_REASONS.logout,
      );
    });

    it('does not reveal an inactive or foreign session', async () => {
      revokeUserSession.mockResolvedValue(false);

      await expect(
        service.logoutSession(user.id, otherSession.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('logs out every user session', async () => {
      await expect(service.logoutAllSessions(user.id)).resolves.toEqual({
        message: 'Logged out from all devices successfully',
      });
      expect(revokeAllUserSessions).toHaveBeenCalledWith(
        user.id,
        SESSION_REVOCATION_REASONS.logoutAll,
      );
    });
  });
});
