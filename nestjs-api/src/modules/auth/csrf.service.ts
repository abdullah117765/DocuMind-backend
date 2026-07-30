import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCookieValue } from '../../common/utils/cookie.util';
import { CookieConfiguration } from '../../config/cookie.config';

const CSRF_TOKEN_BYTES = 32;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class CsrfService {
  private readonly config: CookieConfiguration;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<CookieConfiguration>('cookies');
  }

  issueToken(response: Response): string {
    const token = randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
    const cookieValue = `${token}.${this.sign(token)}`;

    response.cookie(
      this.config.csrfCookieName,
      cookieValue,
      this.getCookieOptions(),
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');

    return token;
  }

  validateRequest(request: Request): boolean {
    const headerValue = request.headers['x-csrf-token'];
    const cookieValue = getCookieValue(
      request.headers.cookie,
      this.config.csrfCookieName,
    );

    if (
      typeof headerValue !== 'string' ||
      !BASE64URL_SHA256_PATTERN.test(headerValue) ||
      !cookieValue
    ) {
      return false;
    }

    const separatorIndex = cookieValue.indexOf('.');

    if (
      separatorIndex <= 0 ||
      separatorIndex !== cookieValue.lastIndexOf('.')
    ) {
      return false;
    }

    const cookieToken = cookieValue.slice(0, separatorIndex);
    const cookieSignature = cookieValue.slice(separatorIndex + 1);

    if (
      !BASE64URL_SHA256_PATTERN.test(cookieToken) ||
      !BASE64URL_SHA256_PATTERN.test(cookieSignature)
    ) {
      return false;
    }

    return (
      this.safeEqual(headerValue, cookieToken) &&
      this.safeEqual(cookieSignature, this.sign(cookieToken))
    );
  }

  private sign(token: string): string {
    return createHmac('sha256', this.config.csrfSecret)
      .update(token)
      .digest('base64url');
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private getCookieOptions(): CookieOptions {
    return {
      httpOnly: false,
      secure: this.config.secure,
      sameSite: this.config.sameSite,
      path: '/',
    };
  }
}
