import { registerAs } from '@nestjs/config';

const MINIMUM_SECRET_LENGTH = 64;

export interface PasswordResetConfiguration {
  otp: {
    secret: string;
    ttlSeconds: number;
    maxAttempts: number;
  };
  rateLimit: {
    maxRequests: number;
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

export default registerAs('passwordReset', (): PasswordResetConfiguration => ({
  otp: {
    secret: requireSecret('PASSWORD_RESET_OTP_SECRET'),
    ttlSeconds: getPositiveInteger('PASSWORD_RESET_OTP_TTL_SECONDS', 10 * 60),
    maxAttempts: getPositiveInteger('PASSWORD_RESET_OTP_MAX_ATTEMPTS', 5),
  },
  rateLimit: {
    maxRequests: getPositiveInteger('PASSWORD_RESET_RATE_LIMIT_MAX', 3),
    windowSeconds: getPositiveInteger(
      'PASSWORD_RESET_RATE_LIMIT_WINDOW_SECONDS',
      15 * 60,
    ),
  },
}));
