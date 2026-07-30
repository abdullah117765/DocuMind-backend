import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CookieConfiguration } from '../../config/cookie.config';
import type { AuthenticatedSessionResult } from './auth.service';
import { AuthCookieService } from './auth-cookie.service';

describe('AuthCookieService', () => {
  const expiresAt = new Date('2026-08-29T12:00:00.000Z');
  const configuration: CookieConfiguration = {
    accessCookieName: 'access_token',
    refreshCookieName: 'refresh_token',
    csrfCookieName: 'csrf_token',
    secure: false,
    sameSite: 'lax',
    authPath: '/api/auth',
    csrfSecret: 'c'.repeat(64),
  };
  const result: AuthenticatedSessionResult = {
    data: {
      user: {
        id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
        email: 'user@example.com',
        isVerified: true,
      },
      session: {
        id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
        expiresAt,
      },
      accessToken: 'signed-access-token',
      refreshToken: 'opaque-refresh-token',
    },
  };
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const setHeader = jest.fn();
  const response = {
    cookie,
    clearCookie,
    setHeader,
  } as unknown as Response;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(configuration),
  } as unknown as ConfigService;
  const service = new AuthCookieService(configService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets separate HttpOnly access and refresh cookies', () => {
    service.setAuthenticationCookies(response, result);

    expect(cookie).toHaveBeenNthCalledWith(
      1,
      'access_token',
      'signed-access-token',
      {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      },
    );
    expect(cookie).toHaveBeenNthCalledWith(
      2,
      'refresh_token',
      'opaque-refresh-token',
      {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/auth',
        expires: expiresAt,
      },
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('clears both cookies using their original paths', () => {
    service.clearAuthenticationCookies(response);

    expect(clearCookie).toHaveBeenNthCalledWith(1, 'access_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    expect(clearCookie).toHaveBeenNthCalledWith(2, 'refresh_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/auth',
    });
  });

  it('reads the refresh cookie and strips tokens from browser responses', () => {
    const request = {
      headers: {
        cookie: 'access_token=access; refresh_token=opaque%2Etoken',
      },
    } as Request;

    expect(service.getRefreshToken(request)).toBe('opaque.token');
    expect(service.toBrowserResult(result)).toEqual({
      data: {
        user: result.data.user,
        session: result.data.session,
      },
    });
  });
});
