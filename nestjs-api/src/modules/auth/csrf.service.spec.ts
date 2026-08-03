import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createHmac } from 'node:crypto';
import { CookieConfiguration } from '../../config/cookie.config';
import { CsrfService } from './csrf.service';

describe('CsrfService', () => {
  const configuration: CookieConfiguration = {
    accessCookieName: 'access_token',
    refreshCookieName: 'refresh_token',
    passwordResetCookieName: 'password_reset_token',
    csrfCookieName: 'csrf_token',
    secure: false,
    sameSite: 'lax',
    authPath: '/api/auth',
    csrfSecret: 'c'.repeat(64),
  };
  const cookie = jest.fn();
  const setHeader = jest.fn();
  const response = {
    cookie,
    setHeader,
  } as unknown as Response;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(configuration),
  } as unknown as ConfigService;
  const service = new CsrfService(configService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('issues a signed readable CSRF cookie and returns its raw token', () => {
    const token = service.issueToken(response);
    const signature = createHmac('sha256', configuration.csrfSecret)
      .update(token)
      .digest('base64url');

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toHaveBeenCalledWith('csrf_token', `${token}.${signature}`, {
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('validates a matching header and signed cookie', () => {
    const token = 'a'.repeat(43);
    const signature = createHmac('sha256', configuration.csrfSecret)
      .update(token)
      .digest('base64url');
    const request = {
      headers: {
        cookie: `csrf_token=${token}.${signature}`,
        'x-csrf-token': token,
      },
    } as Request;

    expect(service.validateRequest(request)).toBe(true);
  });

  it.each([
    {
      name: 'missing header',
      cookieToken: 'a'.repeat(43),
      headerToken: undefined,
      tamperSignature: false,
    },
    {
      name: 'mismatched header',
      cookieToken: 'a'.repeat(43),
      headerToken: 'b'.repeat(43),
      tamperSignature: false,
    },
    {
      name: 'tampered signature',
      cookieToken: 'a'.repeat(43),
      headerToken: 'a'.repeat(43),
      tamperSignature: true,
    },
  ])(
    'rejects a request with $name',
    ({ cookieToken, headerToken, tamperSignature }) => {
      const validSignature = createHmac('sha256', configuration.csrfSecret)
        .update(cookieToken)
        .digest('base64url');
      const signature = tamperSignature ? 'z'.repeat(43) : validSignature;
      const request = {
        headers: {
          cookie: `csrf_token=${cookieToken}.${signature}`,
          ...(headerToken ? { 'x-csrf-token': headerToken } : {}),
        },
      } as Request;

      expect(service.validateRequest(request)).toBe(false);
    },
  );
});
