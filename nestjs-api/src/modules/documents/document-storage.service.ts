import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { StorageConfiguration } from '../../config/storage.config';

export interface StoredObjectReference {
  bucket: string;
  key: string;
}

@Injectable()
export class DocumentStorageService {
  private readonly client: Client;
  private readonly bucket: string;
  private bucketReady = false;
  private bucketReadyPromise: Promise<void> | null = null;

  constructor(configService: ConfigService) {
    const config = configService.get<StorageConfiguration>('storage');
    const minioConfig = config?.minio ?? {
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'minioadmin',
      secretKey: 'minioadmin123',
      bucket: 'documents',
    };

    this.bucket = minioConfig.bucket;
    this.client = new Client({
      endPoint: minioConfig.endPoint,
      port: minioConfig.port,
      useSSL: minioConfig.useSSL,
      accessKey: minioConfig.accessKey,
      secretKey: minioConfig.secretKey,
    });
  }

  getBucket(): string {
    return this.bucket;
  }

  buildStagingKey(input: {
    organizationId: string;
    sessionId: string;
    fileId: string;
    filename: string;
  }): string {
    return [
      'staging',
      input.organizationId,
      input.sessionId,
      `${input.fileId}-${this.sanitizeObjectKeySegment(input.filename)}`,
    ].join('/');
  }

  buildDocumentVersionKey(input: {
    organizationId: string;
    documentId: string;
    versionId: string;
    filename: string;
  }): string {
    return [
      'organizations',
      input.organizationId,
      'documents',
      input.documentId,
      'versions',
      `${input.versionId}-${this.sanitizeObjectKeySegment(input.filename)}`,
    ].join('/');
  }

  buildAdHocDocumentKey(input: {
    organizationId: string;
    documentId?: string;
    filename: string;
  }): string {
    return [
      'organizations',
      input.organizationId,
      'documents',
      input.documentId ?? randomUUID(),
      this.sanitizeObjectKeySegment(input.filename),
    ].join('/');
  }

  async putObject(
    key: string,
    buffer: Buffer,
    metadata?: Record<string, string>,
  ): Promise<StoredObjectReference> {
    await this.ensureBucket();

    await this.client.putObject(
      this.bucket,
      key,
      buffer,
      buffer.length,
      metadata,
    );

    return {
      bucket: this.bucket,
      key,
    };
  }

  async getObject(bucket: string, key: string): Promise<Readable> {
    await this.ensureBucket();

    return this.client.getObject(bucket, key);
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.getObject(bucket, key);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async removeObject(bucket: string, key: string): Promise<void> {
    await this.ensureBucket();

    await this.client.removeObject(bucket, key);
  }

  async removeObjects(references: StoredObjectReference[]): Promise<void> {
    const groupedKeys = references.reduce((groups, reference) => {
      const keys = groups.get(reference.bucket) ?? [];
      keys.push(reference.key);
      groups.set(reference.bucket, keys);

      return groups;
    }, new Map<string, string[]>());

    await Promise.all(
      [...groupedKeys.entries()].map(async ([bucket, keys]) => {
        if (bucket !== this.bucket) {
          await Promise.all(keys.map((key) => this.removeObject(bucket, key)));
          return;
        }

        await this.ensureBucket();
        await this.client.removeObjects(bucket, keys);
      }),
    );
  }

  private ensureBucket(): Promise<void> {
    if (this.bucketReady) {
      return Promise.resolve();
    }

    this.bucketReadyPromise ??= this.ensureBucketExists();

    return this.bucketReadyPromise;
  }

  private async ensureBucketExists(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);

      if (!exists) {
        await this.client.makeBucket(this.bucket);
      }

      this.bucketReady = true;
    } catch (error: unknown) {
      this.bucketReadyPromise = null;

      throw new ServiceUnavailableException(
        'Document storage is unavailable. Start MinIO and verify storage credentials.',
        { cause: error },
      );
    }
  }

  private sanitizeObjectKeySegment(segment: string): string {
    return (
      segment
        .normalize('NFKD')
        .replace(/[^\w. -]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .trim()
        .slice(0, 180)
        .replace(/^\.+/, '')
        .replace(/\.+$/, '') || 'file'
    );
  }
}
