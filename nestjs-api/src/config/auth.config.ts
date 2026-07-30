import { registerAs } from '@nestjs/config';

const MINIMUM_SECRET_LENGTH = 64;

export interface AuthConfiguration {
  accessToken: {
    secret: string;
    expiresIn: string;
    issuer: string;
    audience: string;
  };
  refreshToken: {
    pepper: string;
    ttlSeconds: number;
  };
  loginRateLimit: {
    maxAttempts: number;
    windowSeconds: number;
  };
}

function requireSecret(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (value.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `${name} must contain at least ${MINIMUM_SECRET_LENGTH} characters.`,
    );
  }

  return value;
}

function getPositiveInteger(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim() || String(defaultValue);
  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function getAccessTokenDuration(): string {
  const value = process.env.JWT_EXPIRES_IN?.trim() || '15m';

  if (!/^[1-9]\d*(?:ms|s|m|h|d)$/.test(value)) {
    throw new Error(
      'JWT_EXPIRES_IN must use a positive duration such as 15m, 1h, or 1d.',
    );
  }

  return value;
}

function getString(name: string, defaultValue: string): string {
  return process.env[name]?.trim() || defaultValue;
}

export default registerAs('auth', (): AuthConfiguration => ({
  accessToken: {
    secret: requireSecret('JWT_SECRET'),
    expiresIn: getAccessTokenDuration(),
    issuer: getString('JWT_ISSUER', 'ai-doc-intel-api'),
    audience: getString('JWT_AUDIENCE', 'ai-doc-intel-web'),
  },
  refreshToken: {
    pepper: requireSecret('REFRESH_TOKEN_PEPPER'),
    ttlSeconds: getPositiveInteger(
      'REFRESH_TOKEN_TTL_SECONDS',
      30 * 24 * 60 * 60,
    ),
  },
  loginRateLimit: {
    maxAttempts: getPositiveInteger('LOGIN_RATE_LIMIT_MAX', 5),
    windowSeconds: getPositiveInteger(
      'LOGIN_RATE_LIMIT_WINDOW_SECONDS',
      15 * 60,
    ),
  },
}));
