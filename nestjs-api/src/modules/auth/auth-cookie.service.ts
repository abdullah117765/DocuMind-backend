import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { getCookieValue } from '../../common/utils/cookie.util';
import { CookieConfiguration } from '../../config/cookie.config';
import type { AuthenticatedSessionResult } from './auth.service';

export interface BrowserAuthenticatedSessionResult {
  data: {
    user: {
      id: string;
      email: string;
      isVerified: boolean;
    };
    session: {
      id: string;
      expiresAt: Date;
    };
  };
}

@Injectable()
export class AuthCookieService {
  private readonly config: CookieConfiguration;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<CookieConfiguration>('cookies');
  }

  setAuthenticationCookies(
    response: Response,
    result: AuthenticatedSessionResult,
  ): void {
    response.cookie(
      this.config.accessCookieName,
      result.data.accessToken,
      this.getCookieOptions('/'),
    );
    response.cookie(
      this.config.refreshCookieName,
      result.data.refreshToken,
      this.getCookieOptions(
        this.config.authPath,
        result.data.session.expiresAt,
      ),
    );
    this.disableCaching(response);
  }

  clearAuthenticationCookies(response: Response): void {
    response.clearCookie(
      this.config.accessCookieName,
      this.getCookieOptions('/'),
    );
    response.clearCookie(
      this.config.refreshCookieName,
      this.getCookieOptions(this.config.authPath),
    );
    this.disableCaching(response);
  }

  getRefreshToken(request: Request): string | null {
    return getCookieValue(
      request.headers.cookie,
      this.config.refreshCookieName,
    );
  }

  toBrowserResult(
    result: AuthenticatedSessionResult,
  ): BrowserAuthenticatedSessionResult {
    return {
      data: {
        user: result.data.user,
        session: result.data.session,
      },
    };
  }

  private getCookieOptions(path: string, expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.secure,
      sameSite: this.config.sameSite,
      path,
      ...(expires ? { expires } : {}),
    };
  }

  private disableCaching(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
  }
}
