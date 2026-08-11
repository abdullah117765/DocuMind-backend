const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passcode|secret|token|otp|apikey|api_key|api-key|credential|hash|invite)/i;
const RAW_TEXT_KEY_PATTERN =
  /(content|body|prompt|answer|text|chunk|embedding|document_text|file_buffer)/i;
const MAX_STRING_LENGTH = 180;
const MAX_ARRAY_LENGTH = 12;
const MAX_OBJECT_KEYS = 40;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeString(value: string): string {
  const compactValue = value.replace(/\s+/g, ' ').trim();

  if (compactValue.length <= MAX_STRING_LENGTH) {
    return compactValue;
  }

  return `${compactValue.slice(0, MAX_STRING_LENGTH)}...`;
}

export function sanitizeLogValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (RAW_TEXT_KEY_PATTERN.test(key) && typeof value === 'string') {
    return `[REDACTED_TEXT length=${value.length}]`;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeLogValue(entry, key));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeLogValue(entryValue, entryKey),
        ]),
    );
  }

  return sanitizeString(String(value));
}

function formatLogValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return value.includes(' ') ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

export function formatSafeLogEvent(
  event: string,
  fields: Record<string, unknown> = {},
): string {
  const safeFields = sanitizeLogValue(fields);

  if (!isPlainObject(safeFields)) {
    return event;
  }

  const pairs = Object.entries(safeFields).map(
    ([key, value]) => `${key}=${formatLogValue(value)}`,
  );

  return [event, ...pairs].join(' ');
}

export function safeErrorFields(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      errorName: sanitizeString(error.name || 'Error'),
      errorMessage: sanitizeString(error.message || 'Unknown error'),
    };
  }

  return {
    errorName: 'UnknownError',
    errorMessage: sanitizeString(String(error || 'Unknown error')),
  };
}
