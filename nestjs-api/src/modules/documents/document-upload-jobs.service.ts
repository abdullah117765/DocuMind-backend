import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS_CLIENT } from '../redis/redis.constants';

export type DocumentUploadJobStatus =
  'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export type DocumentUploadJobStage =
  | 'queued'
  | 'validating'
  | 'copying'
  | 'saving'
  | 'cleanup'
  | 'completed'
  | 'failed';

export interface DocumentUploadJobWarning {
  stagedFileId: string;
  message: string;
  duplicateDocumentIds: string[];
}

export interface DocumentUploadJobDocument {
  id: string;
  name: string;
  originalFilename: string;
}

export interface DocumentUploadJobView {
  id: string;
  organizationId: string;
  sessionId: string;
  createdByUserId: string;
  status: DocumentUploadJobStatus;
  stage: DocumentUploadJobStage;
  progress: number;
  message: string;
  totalFiles: number;
  processedFiles: number;
  currentFileName: string | null;
  documents: DocumentUploadJobDocument[];
  warnings: DocumentUploadJobWarning[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
}

export type DocumentUploadJobPatch = Partial<
  Pick<
    DocumentUploadJobView,
    | 'status'
    | 'stage'
    | 'progress'
    | 'message'
    | 'totalFiles'
    | 'processedFiles'
    | 'currentFileName'
    | 'documents'
    | 'warnings'
    | 'error'
    | 'startedAt'
    | 'finishedAt'
  >
>;

const CACHE_PREFIX = 'document-upload-jobs:v1';
const QUEUE_KEY = `${CACHE_PREFIX}:queue`;
const MIN_JOB_TTL_SECONDS = 45 * 60;
const DEFAULT_JOB_TTL_SECONDS = 4 * 60 * 60;
const MIN_STALE_REQUEUE_SECONDS = 35 * 60;
const DEFAULT_STALE_REQUEUE_SECONDS = 40 * 60;

function toPositiveInteger(value: unknown, fallback: number): number {
  const parsedValue = Number(value);

  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

function jobKey(jobId: string): string {
  return `${CACHE_PREFIX}:job:${jobId}`;
}

function sessionJobKey(organizationId: string, sessionId: string): string {
  return `${CACHE_PREFIX}:session:${organizationId}:${sessionId}`;
}

function parseJob(rawValue: string | null): DocumentUploadJobView | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      !('id' in parsedValue) ||
      typeof parsedValue.id !== 'string'
    ) {
      return null;
    }

    return parsedValue as DocumentUploadJobView;
  } catch {
    return null;
  }
}

function clampProgress(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

@Injectable()
export class DocumentUploadJobsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentUploadJobsService.name);
  private readonly workerClient: Redis;
  private readonly ttlSeconds: number;
  private readonly staleRequeueSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: Redis,
    configService: ConfigService,
  ) {
    this.workerClient = this.client.duplicate({
      connectionName: 'ai-doc-intel-upload-jobs-worker',
    });
    this.ttlSeconds = Math.max(
      MIN_JOB_TTL_SECONDS,
      toPositiveInteger(
        configService.get('DOCUMENT_UPLOAD_JOB_TTL_SECONDS'),
        DEFAULT_JOB_TTL_SECONDS,
      ),
    );
    this.staleRequeueSeconds = Math.max(
      MIN_STALE_REQUEUE_SECONDS,
      toPositiveInteger(
        configService.get('DOCUMENT_UPLOAD_JOB_STALE_REQUEUE_SECONDS'),
        DEFAULT_STALE_REQUEUE_SECONDS,
      ),
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.workerClient.status === 'wait') {
      await this.workerClient.connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.workerClient.status === 'end') {
      return;
    }

    if (this.workerClient.status === 'wait') {
      this.workerClient.disconnect();
      return;
    }

    try {
      await this.workerClient.quit();
    } catch {
      this.workerClient.disconnect();
    }
  }

  getTtlSeconds(): number {
    return this.ttlSeconds;
  }

  isTerminalStatus(status: DocumentUploadJobStatus): boolean {
    return status === 'SUCCEEDED' || status === 'FAILED';
  }

  async createOrGetJob(input: {
    organizationId: string;
    sessionId: string;
    createdByUserId: string;
    totalFiles: number;
  }): Promise<DocumentUploadJobView> {
    const sessionKey = sessionJobKey(input.organizationId, input.sessionId);
    const existingJobId = await this.client.get(sessionKey);

    if (existingJobId) {
      const existingJob = await this.getJob(existingJobId);

      if (existingJob) {
        if (this.isStaleProcessingJob(existingJob)) {
          return this.requeueJob(existingJob);
        }

        return existingJob;
      }

      await this.client.del(sessionKey);
    }

    const now = new Date();
    const job: DocumentUploadJobView = {
      id: randomUUID(),
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      status: 'QUEUED',
      stage: 'queued',
      progress: 0,
      message: 'Upload job is queued and will start shortly.',
      totalFiles: input.totalFiles,
      processedFiles: 0,
      currentFileName: null,
      documents: [],
      warnings: [],
      error: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: null,
      finishedAt: null,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000).toISOString(),
    };

    const acquired = await this.client.set(
      sessionKey,
      job.id,
      'EX',
      this.ttlSeconds,
      'NX',
    );

    if (acquired !== 'OK') {
      const jobId = await this.client.get(sessionKey);
      const existingJob = jobId ? await this.getJob(jobId) : null;

      if (existingJob) {
        return existingJob;
      }

      await this.client.del(sessionKey);
      return this.createOrGetJob(input);
    }

    await this.client.set(
      jobKey(job.id),
      JSON.stringify(job),
      'EX',
      this.ttlSeconds,
    );
    await this.client.rpush(QUEUE_KEY, job.id);

    return job;
  }

  async reserveNextJob(
    timeoutSeconds = 5,
  ): Promise<DocumentUploadJobView | null> {
    const result = await this.workerClient.blpop(QUEUE_KEY, timeoutSeconds);
    const queuedJobId = Array.isArray(result) ? result[1] : null;

    if (!queuedJobId) {
      return null;
    }

    const job = await this.getJob(queuedJobId);

    if (!job || job.status !== 'QUEUED') {
      return null;
    }

    return job;
  }

  async getJob(jobId: string): Promise<DocumentUploadJobView | null> {
    const job = parseJob(await this.client.get(jobKey(jobId)));

    if (!job) {
      await this.client.del(jobKey(jobId)).catch(() => undefined);
    }

    return job;
  }

  async getAuthorizedJob(input: {
    organizationId: string;
    jobId: string;
    userId: string;
  }): Promise<DocumentUploadJobView | null> {
    const job = await this.getJob(input.jobId);

    if (
      !job ||
      job.organizationId !== input.organizationId ||
      job.createdByUserId !== input.userId
    ) {
      return null;
    }

    return job;
  }

  async getJobForSession(
    organizationId: string,
    sessionId: string,
  ): Promise<DocumentUploadJobView | null> {
    const jobId = await this.client.get(
      sessionJobKey(organizationId, sessionId),
    );

    return jobId ? this.getJob(jobId) : null;
  }

  async updateJob(
    jobId: string,
    patch: DocumentUploadJobPatch,
  ): Promise<DocumentUploadJobView | null> {
    const currentJob = await this.getJob(jobId);

    if (!currentJob) {
      return null;
    }

    const nextJob: DocumentUploadJobView = {
      ...currentJob,
      ...patch,
      progress: clampProgress(patch.progress ?? currentJob.progress),
      updatedAt: new Date().toISOString(),
    };

    await this.client.set(
      jobKey(jobId),
      JSON.stringify(nextJob),
      'EX',
      this.ttlSeconds,
    );
    await this.client.expire(
      sessionJobKey(nextJob.organizationId, nextJob.sessionId),
      this.ttlSeconds,
    );

    return nextJob;
  }

  isStaleProcessingJob(job: DocumentUploadJobView): boolean {
    if (job.status !== 'PROCESSING') {
      return false;
    }

    const updatedAt = Date.parse(job.updatedAt);

    if (!Number.isFinite(updatedAt)) {
      return true;
    }

    return Date.now() - updatedAt > this.staleRequeueSeconds * 1000;
  }

  async requeueJob(job: DocumentUploadJobView): Promise<DocumentUploadJobView> {
    const nextJob = await this.updateJob(job.id, {
      status: 'QUEUED',
      stage: 'queued',
      progress: Math.max(1, job.progress),
      message:
        'Upload job was stale and has been requeued for safe processing.',
      currentFileName: null,
      error: null,
    });

    if (!nextJob) {
      throw new Error('Unable to requeue upload job.');
    }

    await this.client.rpush(QUEUE_KEY, nextJob.id);

    return nextJob;
  }

  async completeJob(
    jobId: string,
    result: {
      documents: DocumentUploadJobDocument[];
      warnings: DocumentUploadJobWarning[];
    },
  ): Promise<DocumentUploadJobView | null> {
    return this.updateJob(jobId, {
      status: 'SUCCEEDED',
      stage: 'completed',
      progress: 100,
      message: `${result.documents.length} document(s) saved successfully.`,
      processedFiles: result.documents.length,
      currentFileName: null,
      documents: result.documents,
      warnings: result.warnings,
      error: null,
      finishedAt: new Date().toISOString(),
    });
  }

  async failJob(
    jobId: string,
    error: unknown,
  ): Promise<DocumentUploadJobView | null> {
    const job = await this.getJob(jobId);
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Upload job failed. Please try again.';

    if (!job) {
      this.logger.warn(`Upload job ${jobId} failed but job state was missing.`);
      return null;
    }

    await this.client
      .del(sessionJobKey(job.organizationId, job.sessionId))
      .catch(() => undefined);

    return this.updateJob(jobId, {
      status: 'FAILED',
      stage: 'failed',
      progress: Math.max(job.progress, 1),
      message: 'Upload job failed before all files could be saved.',
      currentFileName: null,
      error: message,
      finishedAt: new Date().toISOString(),
    });
  }
}
