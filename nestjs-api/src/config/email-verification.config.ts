import { registerAs } from '@nestjs/config';

export interface EmailVerificationConfiguration {
  tokenTtlSeconds: number;
  resendCooldownSeconds: number;
  rateLimit: {
    maxRequests: number;
    windowSeconds: number;
  };
}

function getPositiveInteger(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim() || String(defaultValue);
  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

export default registerAs(
  'emailVerification',
  (): EmailVerificationConfiguration => ({
    tokenTtlSeconds: getPositiveInteger(
      'EMAIL_VERIFICATION_TTL_SECONDS',
      24 * 60 * 60,
    ),
    resendCooldownSeconds: getPositiveInteger(
      'EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS',
      60,
    ),
    rateLimit: {
      maxRequests: getPositiveInteger('EMAIL_VERIFICATION_RATE_LIMIT_MAX', 3),
      windowSeconds: getPositiveInteger(
        'EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_SECONDS',
        15 * 60,
      ),
    },
  }),
);
