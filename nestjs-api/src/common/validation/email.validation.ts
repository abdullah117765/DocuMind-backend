export const APP_EMAIL_PATTERN =
  /^[a-z0-9]+(?:[._+-][a-z0-9]+)*@[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/i;

export const INVALID_EMAIL_MESSAGE = 'Email must be a valid email address';

export function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
