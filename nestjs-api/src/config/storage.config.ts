import { registerAs } from '@nestjs/config';

export interface StorageConfiguration {
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  documents: {
    maxFileSizeBytes: number;
    maxFilesPerBatch: number;
    stagingTtlSeconds: number;
    maxZipExpandedBytes: number;
  };
}

function getEnvironmentValue(name: string, fallback: string): string {
  const value = process.env[name]?.trim();

  return value || fallback;
}

function getIntegerEnvironmentValue(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function getBooleanEnvironmentValue(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();

  if (!rawValue) {
    return fallback;
  }

  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;

  throw new Error(`${name} must be true or false.`);
}

export default registerAs('storage', (): StorageConfiguration => {
  const maxFileSizeBytes = getIntegerEnvironmentValue(
    'DOCUMENT_MAX_FILE_SIZE_BYTES',
    10 * 1024 * 1024,
  );

  return {
    minio: {
      endPoint: getEnvironmentValue('MINIO_ENDPOINT', 'localhost'),
      port: getIntegerEnvironmentValue('MINIO_PORT', 9000),
      useSSL: getBooleanEnvironmentValue('MINIO_USE_SSL', false),
      accessKey: getEnvironmentValue('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: getEnvironmentValue('MINIO_SECRET_KEY', 'minioadmin123'),
      bucket: getEnvironmentValue('MINIO_DOCUMENT_BUCKET', 'documents'),
    },
    documents: {
      maxFileSizeBytes,
      maxFilesPerBatch: getIntegerEnvironmentValue(
        'DOCUMENT_MAX_FILES_PER_BATCH',
        8,
      ),
      stagingTtlSeconds: getIntegerEnvironmentValue(
        'DOCUMENT_STAGING_TTL_SECONDS',
        24 * 60 * 60,
      ),
      maxZipExpandedBytes: getIntegerEnvironmentValue(
        'DOCUMENT_ZIP_MAX_EXPANDED_BYTES',
        40 * 1024 * 1024,
      ),
    },
  };
});
