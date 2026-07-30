import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { AuthConfiguration } from '../../config/auth.config';

const REFRESH_SECRET_BYTES = 32;
const REFRESH_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  jti: string;
}

export interface GeneratedRefreshToken {
  id: string;
  value: string;
  tokenHash: string;
  expiresAt: Date;
}

interface ParsedRefreshToken {
  id: string;
  tokenHash: string;
}

@Injectable()
export class TokenService {
  private readonly authConfig: AuthConfiguration;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.authConfig = configService.getOrThrow<AuthConfiguration>('auth');
  }

  createAccessToken(userId: string, sessionId: string): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: userId,
      sid: sessionId,
      jti: randomUUID(),
    };

    return this.jwtService.signAsync(payload);
  }

  createRefreshToken(now = new Date()): GeneratedRefreshToken {
    const id = randomUUID();
    const secret = randomBytes(REFRESH_SECRET_BYTES).toString('base64url');

    return {
      id,
      value: `${id}.${secret}`,
      tokenHash: this.hashRefreshSecret(secret),
      expiresAt: new Date(
        now.getTime() + this.authConfig.refreshToken.ttlSeconds * 1000,
      ),
    };
  }

  parseRefreshToken(value: string): ParsedRefreshToken | null {
    const separatorIndex = value.indexOf('.');

    if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf('.')) {
      return null;
    }

    const id = value.slice(0, separatorIndex);
    const secret = value.slice(separatorIndex + 1);

    if (!UUID_V4_PATTERN.test(id) || !REFRESH_SECRET_PATTERN.test(secret)) {
      return null;
    }

    return {
      id,
      tokenHash: this.hashRefreshSecret(secret),
    };
  }

  refreshTokenMatches(
    value: string,
    expectedId: string,
    expectedHash: string,
  ): boolean {
    const parsedToken = this.parseRefreshToken(value);

    if (!parsedToken || parsedToken.id !== expectedId) {
      return false;
    }

    const actualHashBuffer = Buffer.from(parsedToken.tokenHash, 'hex');
    const expectedHashBuffer = Buffer.from(expectedHash, 'hex');

    if (
      actualHashBuffer.length === 0 ||
      actualHashBuffer.length !== expectedHashBuffer.length
    ) {
      return false;
    }

    return timingSafeEqual(actualHashBuffer, expectedHashBuffer);
  }

  private hashRefreshSecret(secret: string): string {
    return createHmac('sha256', this.authConfig.refreshToken.pepper)
      .update(secret)
      .digest('hex');
  }
}
