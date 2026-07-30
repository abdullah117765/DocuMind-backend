import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthConfiguration } from '../../config/auth.config';
import { AccessTokenPayload, TokenService } from './token.service';

describe('TokenService', () => {
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
  const signAsync = jest.fn<(payload: AccessTokenPayload) => Promise<string>>();
  const getOrThrow = jest.fn();
  let capturedPayload: AccessTokenPayload | undefined;
  const jwtService = {
    signAsync,
  } as unknown as JwtService;
  const configService = {
    getOrThrow,
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedPayload = undefined;
    getOrThrow.mockReturnValue(authConfiguration);
  });

  it('creates an access token containing user, session, and token IDs', async () => {
    signAsync.mockImplementation(
      (payload: AccessTokenPayload): Promise<string> => {
        capturedPayload = payload;

        return Promise.resolve('signed-access-token');
      },
    );
    const service = new TokenService(jwtService, configService);

    await expect(
      service.createAccessToken('user-id', 'session-id'),
    ).resolves.toBe('signed-access-token');

    expect(capturedPayload).toBeDefined();
    expect(capturedPayload?.sub).toBe('user-id');
    expect(capturedPayload?.sid).toBe('session-id');
    expect(capturedPayload?.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('creates an opaque refresh token and its HMAC hash', () => {
    const service = new TokenService(jwtService, configService);
    const now = new Date('2026-01-01T00:00:00.000Z');

    const token = service.createRefreshToken(now);

    expect(token.value).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i);
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.expiresAt).toEqual(new Date('2026-01-31T00:00:00.000Z'));
    expect(service.parseRefreshToken(token.value)).toEqual({
      id: token.id,
      tokenHash: token.tokenHash,
    });
    expect(
      service.refreshTokenMatches(token.value, token.id, token.tokenHash),
    ).toBe(true);
  });

  it('rejects malformed and tampered refresh tokens', () => {
    const service = new TokenService(jwtService, configService);
    const token = service.createRefreshToken();
    const tamperedToken = `${token.id}.${'A'.repeat(43)}`;

    expect(service.parseRefreshToken('not-a-token')).toBeNull();
    expect(
      service.refreshTokenMatches(tamperedToken, token.id, token.tokenHash),
    ).toBe(false);
    expect(
      service.refreshTokenMatches(
        token.value,
        '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
        token.tokenHash,
      ),
    ).toBe(false);
  });
});
