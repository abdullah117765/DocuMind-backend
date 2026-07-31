import { registerAs } from '@nestjs/config';

export interface AccessControlConfiguration {
  cacheTtlSeconds: number;
}

function getPositiveInteger(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim() || String(defaultValue);
  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

export default registerAs('accessControl', (): AccessControlConfiguration => ({
  cacheTtlSeconds: getPositiveInteger('PERMISSION_CACHE_TTL_SECONDS', 5 * 60),
}));
