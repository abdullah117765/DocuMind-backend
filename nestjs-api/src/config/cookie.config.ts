import { registerAs } from '@nestjs/config';

const MINIMUM_SECRET_LENGTH = 64;
const COOKIE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface CookieConfiguration {
  accessCookieName: string;
  refreshCookieName: string;
  csrfCookieName: string;
  secure: boolean;
  sameSite: CookieSameSite;
  authPath: string;
  csrfSecret: string;
}

function getCookieName(name: string, defaultValue: string): string {
  const value = process.env[name]?.trim() || defaultValue;

  if (!COOKIE_NAME_PATTERN.test(value)) {
    throw new Error(
      `${name} may contain only letters, numbers, underscores, and hyphens.`,
    );
  }

  return value;
}

function getBoolean(name: string, defaultValue: boolean): boolean {
  const rawValue =
    process.env[name]?.trim().toLowerCase() || String(defaultValue);

  if (rawValue !== 'true' && rawValue !== 'false') {
    throw new Error(`${name} must be either true or false.`);
  }

  return rawValue === 'true';
}

function getSameSite(): CookieSameSite {
  const value = process.env.COOKIE_SAME_SITE?.trim().toLowerCase() || 'lax';

  if (value !== 'lax' && value !== 'strict' && value !== 'none') {
    throw new Error('COOKIE_SAME_SITE must be lax, strict, or none.');
  }

  return value;
}

function requireCsrfSecret(): string {
  const value = process.env.CSRF_SECRET?.trim();

  if (!value) {
    throw new Error('CSRF_SECRET is required.');
  }

  if (value.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `CSRF_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters.`,
    );
  }

  return value;
}

function getAuthPath(): string {
  const configuredPrefix = process.env.API_PREFIX?.trim() || 'api';
  const prefix = configuredPrefix.replace(/^\/+|\/+$/g, '') || 'api';

  return `/${prefix}/auth`;
}

export default registerAs('cookies', (): CookieConfiguration => {
  const secure = getBoolean('COOKIE_SECURE', false);
  const sameSite = getSameSite();

  if (sameSite === 'none' && !secure) {
    throw new Error(
      'COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.',
    );
  }

  if (process.env.NODE_ENV?.trim() === 'production' && !secure) {
    throw new Error('COOKIE_SECURE must be true in production.');
  }

  return {
    accessCookieName: getCookieName('ACCESS_COOKIE_NAME', 'access_token'),
    refreshCookieName: getCookieName('REFRESH_COOKIE_NAME', 'refresh_token'),
    csrfCookieName: getCookieName('CSRF_COOKIE_NAME', 'csrf_token'),
    secure,
    sameSite,
    authPath: getAuthPath(),
    csrfSecret: requireCsrfSecret(),
  };
});
