import { RefreshToken, Session } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidRefreshTokenException,
  RefreshTokenReuseException,
} from './auth.exceptions';
import { SESSION_REVOCATION_REASONS, SessionService } from './session.service';
import { GeneratedRefreshToken, TokenService } from './token.service';

describe('SessionService', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const expiresAt = new Date('2026-01-31T00:00:00.000Z');
  const userId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const sessionId = '21e7748f-bd05-46bd-b6a2-c6eb20e1204f';
  const refreshTokenId = '550e8400-e29b-41d4-a716-446655440000';
  const rawRefreshToken = `${refreshTokenId}.${'a'.repeat(43)}`;
  const session: Session = {
    id: sessionId,
    userId,
    deviceName: 'Chrome on Windows',
    userAgent: 'Mozilla/5.0',
    ipAddress: '127.0.0.1',
    createdAt: now,
    lastActiveAt: now,
    expiresAt,
    revokedAt: null,
    revokeReason: null,
  };
  const storedToken: RefreshToken & { session: Session } = {
    id: refreshTokenId,
    sessionId,
    tokenHash: '1'.repeat(64),
    createdAt: now,
    expiresAt,
    usedAt: null,
    revokedAt: null,
    session,
  };
  const nextToken: GeneratedRefreshToken = {
    id: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    value: `6ba7b810-9dad-41d1-80b4-00c04fd430c8.${'b'.repeat(43)}`,
    tokenHash: '2'.repeat(64),
    expiresAt,
  };
  const sessionCreate = jest.fn();
  const sessionFindFirst = jest.fn();
  const sessionUpdateMany = jest.fn();
  const refreshTokenFindUnique = jest.fn();
  const refreshTokenCreate = jest.fn();
  const refreshTokenUpdateMany = jest.fn();
  const userUpdate = jest.fn();
  const transactionClient = {
    user: {
      update: userUpdate,
    },
    session: {
      updateMany: sessionUpdateMany,
    },
    refreshToken: {
      create: refreshTokenCreate,
      updateMany: refreshTokenUpdateMany,
    },
  };
  type TransactionCallback = (
    transaction: typeof transactionClient,
  ) => Promise<unknown>;
  const runTransaction = jest.fn(
    async (callback: TransactionCallback): Promise<unknown> =>
      callback(transactionClient),
  );
  const prismaService = {
    session: {
      create: sessionCreate,
      findFirst: sessionFindFirst,
    },
    refreshToken: {
      findUnique: refreshTokenFindUnique,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const createRefreshToken = jest.fn();
  const parseRefreshToken = jest.fn();
  const refreshTokenMatches = jest.fn();
  const tokenService = {
    createRefreshToken,
    parseRefreshToken,
    refreshTokenMatches,
  } as unknown as TokenService;
  const service = new SessionService(prismaService, tokenService);

  beforeEach(() => {
    jest.clearAllMocks();
    createRefreshToken.mockReturnValue(nextToken);
    parseRefreshToken.mockReturnValue({
      id: refreshTokenId,
      tokenHash: storedToken.tokenHash,
    });
    refreshTokenMatches.mockReturnValue(true);
    refreshTokenFindUnique.mockResolvedValue(storedToken);
    sessionCreate.mockResolvedValue(session);
    sessionFindFirst.mockResolvedValue(session);
    sessionUpdateMany.mockResolvedValue({ count: 1 });
    refreshTokenUpdateMany.mockResolvedValue({ count: 1 });
    refreshTokenCreate.mockResolvedValue({
      ...storedToken,
      id: nextToken.id,
      tokenHash: nextToken.tokenHash,
    });
    userUpdate.mockResolvedValue(undefined);
  });

  it('creates a device session and initial refresh-token record', async () => {
    await expect(
      service.createSession(userId, {
        deviceName: ' Chrome on Windows ',
        userAgent: ' Mozilla/5.0 ',
        ipAddress: ' 127.0.0.1 ',
      }),
    ).resolves.toEqual({
      session,
      refreshToken: nextToken.value,
    });

    expect(sessionCreate).toHaveBeenCalledWith({
      data: {
        userId,
        deviceName: 'Chrome on Windows',
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
        expiresAt: nextToken.expiresAt,
        refreshTokens: {
          create: {
            id: nextToken.id,
            tokenHash: nextToken.tokenHash,
            expiresAt: nextToken.expiresAt,
          },
        },
      },
    });
  });

  it('finds only an active, unexpired session', async () => {
    await expect(service.findActiveSession(sessionId, now)).resolves.toEqual(
      session,
    );
    expect(sessionFindFirst).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
    });
  });

  it('atomically rotates a valid refresh token', async () => {
    await expect(
      service.rotateRefreshToken(rawRefreshToken, now),
    ).resolves.toEqual({
      session: {
        ...session,
        lastActiveAt: now,
        expiresAt: nextToken.expiresAt,
      },
      refreshToken: nextToken.value,
    });

    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: {
        id: storedToken.id,
        usedAt: null,
        revokedAt: null,
      },
      data: {
        usedAt: now,
      },
    });
    expect(refreshTokenCreate).toHaveBeenCalledWith({
      data: {
        sessionId,
        id: nextToken.id,
        tokenHash: nextToken.tokenHash,
        expiresAt: nextToken.expiresAt,
      },
    });
  });

  it('rejects a token whose secret does not match the stored hash', async () => {
    refreshTokenMatches.mockReturnValue(false);

    await expect(
      service.rotateRefreshToken(rawRefreshToken, now),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('revokes the session when an already-used token is replayed', async () => {
    refreshTokenFindUnique.mockResolvedValue({
      ...storedToken,
      usedAt: now,
    });

    await expect(
      service.rotateRefreshToken(rawRefreshToken, now),
    ).rejects.toBeInstanceOf(RefreshTokenReuseException);
    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: SESSION_REVOCATION_REASONS.tokenReuse,
      },
    });
  });

  it('treats a normally revoked token as invalid rather than replayed', async () => {
    refreshTokenFindUnique.mockResolvedValue({
      ...storedToken,
      revokedAt: now,
    });

    await expect(
      service.rotateRefreshToken(rawRefreshToken, now),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('revokes all active sessions and tokens for a user', async () => {
    await service.revokeAllUserSessions(
      userId,
      SESSION_REVOCATION_REASONS.passwordReset,
      now,
    );

    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: SESSION_REVOCATION_REASONS.passwordReset,
      },
    });
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: {
        session: {
          userId,
        },
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });
  });

  it('atomically updates a password and revokes every active session', async () => {
    await service.resetPasswordAndRevokeSessions(
      userId,
      'new-password-hash',
      now,
    );

    expect(userUpdate).toHaveBeenCalledWith({
      where: {
        id: userId,
      },
      data: {
        passwordHash: 'new-password-hash',
      },
    });
    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: SESSION_REVOCATION_REASONS.passwordReset,
      },
    });
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: {
        session: {
          userId,
        },
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });
  });
});
