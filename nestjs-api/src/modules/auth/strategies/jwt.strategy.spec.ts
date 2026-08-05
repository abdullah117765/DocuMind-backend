import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfiguration } from '../../../config/auth.config';
import { CookieConfiguration } from '../../../config/cookie.config';
import { Session, User } from '../../../generated/prisma/client';
import { UsersService } from '../../users/users.service';
import { EnvSuperAdminService } from '../env-super-admin.service';
import { SessionService } from '../session.service';
import { AccessTokenPayload } from '../token.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const payload: AccessTokenPayload = {
    sub: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    sid: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
    jti: '550e8400-e29b-41d4-a716-446655440000',
  };
  const user: User = {
    id: payload.sub,
    email: 'user@example.com',
    passwordHash: 'hashed-password',
    isVerified: true,
    createdAt: now,
    updatedAt: now,
  };
  const session: Session = {
    id: payload.sid,
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
  const cookieConfiguration: CookieConfiguration = {
    accessCookieName: 'access_token',
    refreshCookieName: 'refresh_token',
    passwordResetCookieName: 'password_reset_token',
    csrfCookieName: 'csrf_token',
    secure: false,
    sameSite: 'lax',
    authPath: '/api/auth',
    csrfSecret: 'c'.repeat(64),
  };
  const getOrThrow = jest.fn((key: string) =>
    key === 'auth' ? authConfiguration : cookieConfiguration,
  );
  const findActiveSession = jest.fn();
  const findById = jest.fn();
  const getSuperAdminSessionUserMetadata = jest.fn();
  const configService = {
    getOrThrow,
  } as unknown as ConfigService;
  const sessionService = {
    findActiveSession,
  } as unknown as SessionService;
  const usersService = {
    findById,
  } as unknown as UsersService;
  const envSuperAdminService = {
    getSessionUserMetadata: getSuperAdminSessionUserMetadata,
  } as unknown as EnvSuperAdminService;
  const strategy = new JwtStrategy(
    configService,
    sessionService,
    usersService,
    envSuperAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findActiveSession.mockResolvedValue(session);
    findById.mockResolvedValue(user);
    getSuperAdminSessionUserMetadata.mockReturnValue(null);
  });

  it('returns an authenticated principal for a valid active session', async () => {
    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: user.id,
      email: user.email,
      isVerified: user.isVerified,
      sessionId: session.id,
      tokenId: payload.jti,
    });
    expect(findActiveSession).toHaveBeenCalledWith(payload.sid);
    expect(findById).toHaveBeenCalledWith(payload.sub);
  });

  it.each([
    null,
    {},
    {
      sub: 'not-a-uuid',
      sid: payload.sid,
      jti: payload.jti,
    },
    {
      sub: payload.sub,
      sid: 'not-a-uuid',
      jti: payload.jti,
    },
    {
      sub: payload.sub,
      sid: payload.sid,
      jti: 'not-a-uuid',
    },
  ])('rejects malformed access-token claims', async (invalidPayload) => {
    await expect(strategy.validate(invalidPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('rejects a revoked or expired session', async () => {
    findActiveSession.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects a session belonging to another user', async () => {
    findActiveSession.mockResolvedValue({
      ...session,
      userId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects an unavailable or unverified user', async () => {
    findById.mockResolvedValue({
      ...user,
      isVerified: false,
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
