import { registerAs } from '@nestjs/config';

export interface RateLimitRuleConfiguration {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitConfiguration {
  enabled: boolean;
  general: RateLimitRuleConfiguration;
  stateChanging: RateLimitRuleConfiguration;
  documentUpload: RateLimitRuleConfiguration;
  ragSearch: RateLimitRuleConfiguration;
  ragAsk: RateLimitRuleConfiguration;
  ragReindex: RateLimitRuleConfiguration;
}

function getBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();

  if (!value) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;

  throw new Error(`${name} must be a boolean value.`);
}

function getPositiveInteger(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim() || String(defaultValue);
  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function getRule(
  prefix: string,
  defaultMaxRequests: number,
  defaultWindowSeconds: number,
): RateLimitRuleConfiguration {
  return {
    maxRequests: getPositiveInteger(
      `${prefix}_MAX_REQUESTS`,
      defaultMaxRequests,
    ),
    windowSeconds: getPositiveInteger(
      `${prefix}_WINDOW_SECONDS`,
      defaultWindowSeconds,
    ),
  };
}

export default registerAs(
  'rateLimit',
  (): RateLimitConfiguration => ({
    enabled: getBoolean('API_RATE_LIMIT_ENABLED', true),
    general: getRule('API_RATE_LIMIT_GENERAL', 240, 60),
    stateChanging: getRule('API_RATE_LIMIT_STATE_CHANGING', 120, 60),
    documentUpload: getRule('API_RATE_LIMIT_DOCUMENT_UPLOAD', 20, 60),
    ragSearch: getRule('API_RATE_LIMIT_RAG_SEARCH', 30, 60),
    ragAsk: getRule('API_RATE_LIMIT_RAG_ASK', 10, 60),
    ragReindex: getRule('API_RATE_LIMIT_RAG_REINDEX', 5, 60),
  }),
);
