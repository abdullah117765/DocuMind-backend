import { Injectable } from '@nestjs/common';
import { RefreshToken, Session } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidRefreshTokenException,
  RefreshTokenReuseException,
} from './auth.exceptions';
import { GeneratedRefreshToken, TokenService } from './token.service';

export const SESSION_REVOCATION_REASONS = {
  accountUnavailable: 'ACCOUNT_UNAVAILABLE',
  expired: 'EXPIRED',
  logout: 'LOGOUT',
  logoutAll: 'LOGOUT_ALL',
  passwordReset: 'PASSWORD_RESET',
  tokenIssueFailure: 'TOKEN_ISSUE_FAILURE',
  tokenReuse: 'TOKEN_REUSE',
} as const;

export type SessionRevocationReason =
  (typeof SESSION_REVOCATION_REASONS)[keyof typeof SESSION_REVOCATION_REASONS];

export interface DeviceMetadata {
  deviceName?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface SessionWithRefreshToken {
  session: Session;
  refreshToken: string;
}

type RefreshTokenWithSession = RefreshToken & {
  session: Session;
};

type RotationResult = {
  status: 'rotated' | 'invalid' | 'reuse';
};

function normalizeOptionalValue(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.trim();

  return normalized ? normalized.slice(0, maxLength) : null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async createSession(
    userId: string,
    metadata: DeviceMetadata,
  ): Promise<SessionWithRefreshToken> {
    const refreshToken = this.tokenService.createRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceName: normalizeOptionalValue(metadata.deviceName, 255),
        userAgent: normalizeOptionalValue(metadata.userAgent, 1024),
        ipAddress: normalizeOptionalValue(metadata.ipAddress, 45),
        expiresAt: refreshToken.expiresAt,
        refreshTokens: {
          create: this.getRefreshTokenCreateData(refreshToken),
        },
      },
    });

    return {
      session,
      refreshToken: refreshToken.value,
    };
  }

  findActiveSession(
    sessionId: string,
    now = new Date(),
  ): Promise<Session | null> {
    return this.prisma.session.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
    });
  }

  listActiveUserSessions(
    userId: string,
    now = new Date(),
  ): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      orderBy: [{ lastActiveAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async rotateRefreshToken(
    rawRefreshToken: string,
    now = new Date(),
  ): Promise<SessionWithRefreshToken> {
    const parsedToken = this.tokenService.parseRefreshToken(rawRefreshToken);

    if (!parsedToken) {
      throw new InvalidRefreshTokenException();
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: {
        id: parsedToken.id,
      },
      include: {
        session: true,
      },
    });

    if (
      !storedToken ||
      !this.tokenService.refreshTokenMatches(
        rawRefreshToken,
        storedToken.id,
        storedToken.tokenHash,
      )
    ) {
      throw new InvalidRefreshTokenException();
    }

    await this.assertRefreshTokenIsUsable(storedToken, now);

    const nextRefreshToken = this.tokenService.createRefreshToken(now);
    const rotationResult = await this.rotateStoredToken(
      storedToken,
      nextRefreshToken,
      now,
    );

    if (rotationResult.status === 'reuse') {
      throw new RefreshTokenReuseException();
    }

    if (rotationResult.status === 'invalid') {
      throw new InvalidRefreshTokenException();
    }

    return {
      session: {
        ...storedToken.session,
        lastActiveAt: now,
        expiresAt: nextRefreshToken.expiresAt,
      },
      refreshToken: nextRefreshToken.value,
    };
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevocationReason,
    now = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.session.updateMany({
        where: {
          id: sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revokeReason: reason,
        },
      });
      await transaction.refreshToken.updateMany({
        where: {
          sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });
    });
  }

  revokeUserSession(
    userId: string,
    sessionId: string,
    reason: SessionRevocationReason,
    now = new Date(),
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const revokedSession = await transaction.session.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          revokedAt: now,
          revokeReason: reason,
        },
      });

      if (revokedSession.count !== 1) {
        return false;
      }

      await transaction.refreshToken.updateMany({
        where: {
          sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      return true;
    });
  }

  async revokeAllUserSessions(
    userId: string,
    reason: SessionRevocationReason,
    now = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revokeReason: reason,
        },
      });
      await transaction.refreshToken.updateMany({
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
  }

  async resetPasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    now = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash,
        },
      });
      await transaction.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revokeReason: SESSION_REVOCATION_REASONS.passwordReset,
        },
      });
      await transaction.refreshToken.updateMany({
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
  }

  private async assertRefreshTokenIsUsable(
    storedToken: RefreshTokenWithSession,
    now: Date,
  ): Promise<void> {
    if (storedToken.usedAt) {
      await this.revokeSession(
        storedToken.sessionId,
        SESSION_REVOCATION_REASONS.tokenReuse,
        now,
      );
      throw new RefreshTokenReuseException();
    }

    if (storedToken.revokedAt || storedToken.session.revokedAt) {
      throw new InvalidRefreshTokenException();
    }

    if (
      storedToken.expiresAt.getTime() <= now.getTime() ||
      storedToken.session.expiresAt.getTime() <= now.getTime()
    ) {
      await this.revokeSession(
        storedToken.sessionId,
        SESSION_REVOCATION_REASONS.expired,
        now,
      );
      throw new InvalidRefreshTokenException();
    }
  }

  private rotateStoredToken(
    storedToken: RefreshTokenWithSession,
    nextRefreshToken: GeneratedRefreshToken,
    now: Date,
  ): Promise<RotationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const claimedToken = await transaction.refreshToken.updateMany({
        where: {
          id: storedToken.id,
          usedAt: null,
          revokedAt: null,
        },
        data: {
          usedAt: now,
        },
      });

      if (claimedToken.count !== 1) {
        await transaction.session.updateMany({
          where: {
            id: storedToken.sessionId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            revokeReason: SESSION_REVOCATION_REASONS.tokenReuse,
          },
        });
        await transaction.refreshToken.updateMany({
          where: {
            sessionId: storedToken.sessionId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });

        return {
          status: 'reuse',
        };
      }

      const updatedSession = await transaction.session.updateMany({
        where: {
          id: storedToken.sessionId,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          lastActiveAt: now,
          expiresAt: nextRefreshToken.expiresAt,
        },
      });

      if (updatedSession.count !== 1) {
        return {
          status: 'invalid',
        };
      }

      await transaction.refreshToken.create({
        data: {
          sessionId: storedToken.sessionId,
          ...this.getRefreshTokenCreateData(nextRefreshToken),
        },
      });

      return {
        status: 'rotated',
      };
    });
  }

  private getRefreshTokenCreateData(token: GeneratedRefreshToken) {
    return {
      id: token.id,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
    };
  }
}
