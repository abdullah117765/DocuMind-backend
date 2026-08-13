import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  DocumentStagedFileStatus,
  DocumentUploadSessionStatus,
} from '../../generated/prisma/client';
import {
  DocumentStorageService,
  type StoredObjectReference,
} from '../../modules/documents/document-storage.service';
import { DocumentsService } from '../../modules/documents/documents.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  formatSafeLogEvent,
  safeErrorFields,
} from '../logging/safe-log.util';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;
const DEFAULT_BATCH_SIZE = 25;

export interface MaintenanceCleanupStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  initialDelayMs: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  lastSummary: {
    sessions: number;
    refreshTokens: number;
    emailVerificationTokens: number;
    passwordResets: number;
    uploadSessions: number;
    stagedFilesDeleted: number;
    ragQueued: number;
    ragPendingQueued: number;
    ragFailedRetryQueued: number;
    ragStaleReset: number;
    elapsedMs: number;
  } | null;
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

@Injectable()
export class MaintenanceCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MaintenanceCleanupService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly batchSize: number;
  private readonly ragRecoveryBatchSize: number;
  private readonly ragFailedRetryAfterMs: number;
  private readonly ragStaleIndexingAfterMs: number;
  private interval: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastStartedAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastFailedAt: string | null = null;
  private lastError: string | null = null;
  private lastSummary: MaintenanceCleanupStatus['lastSummary'] = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: DocumentStorageService,
    private readonly documentsService: DocumentsService,
  ) {
    this.enabled = getBoolean('MAINTENANCE_CLEANUP_ENABLED', true);
    this.intervalMs = getPositiveInteger(
      'MAINTENANCE_CLEANUP_INTERVAL_MS',
      DEFAULT_INTERVAL_MS,
    );
    this.initialDelayMs = getPositiveInteger(
      'MAINTENANCE_CLEANUP_INITIAL_DELAY_MS',
      DEFAULT_INITIAL_DELAY_MS,
    );
    this.batchSize = getPositiveInteger(
      'MAINTENANCE_CLEANUP_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
    );
    this.ragRecoveryBatchSize = getPositiveInteger(
      'RAG_RECOVERY_BATCH_SIZE',
      3,
    );
    this.ragFailedRetryAfterMs = getPositiveInteger(
      'RAG_FAILED_RETRY_AFTER_MS',
      2 * 60 * 1000,
    );
    this.ragStaleIndexingAfterMs = getPositiveInteger(
      'RAG_STALE_INDEXING_AFTER_MS',
      35 * 60 * 1000,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(formatSafeLogEvent('maintenance_cleanup_disabled'));
      return;
    }

    this.logger.log(
      formatSafeLogEvent('maintenance_cleanup_scheduler_enabled', {
        intervalMs: this.intervalMs,
        initialDelayMs: this.initialDelayMs,
        batchSize: this.batchSize,
        ragFailedRetryAfterMs: this.ragFailedRetryAfterMs,
        ragStaleIndexingAfterMs: this.ragStaleIndexingAfterMs,
      }),
    );
    this.initialTimer = setTimeout(() => void this.runCleanup(), this.initialDelayMs);
    this.initialTimer.unref?.();
    this.interval = setInterval(() => void this.runCleanup(), this.intervalMs);
    this.interval.unref?.();
  }

  onModuleDestroy(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
    }

    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  async runCleanup(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        formatSafeLogEvent('maintenance_cleanup_skipped_active_run'),
      );
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();
    this.lastStartedAt = new Date(startedAt).toISOString();

    try {
      const [
        expiredSessions,
        expiredRefreshTokens,
        expiredVerificationTokens,
        expiredPasswordResets,
        expiredUploadSessions,
        ragRecovery,
        uploadQueueSummary,
        ragQueueSummary,
      ] = await Promise.all([
        this.cleanupExpiredSessions(),
        this.cleanupExpiredRefreshTokens(),
        this.cleanupExpiredEmailVerificationTokens(),
        this.cleanupExpiredPasswordResetAuthorizations(),
        this.cleanupExpiredUploadSessions(),
        this.documentsService.recoverRagIndexes({
          batchSize: this.ragRecoveryBatchSize,
          failedRetryAfterMs: this.ragFailedRetryAfterMs,
          staleIndexingAfterMs: this.ragStaleIndexingAfterMs,
        }),
        this.resolveUploadQueueSummary(),
        this.resolveRagQueueSummary(),
      ]);

      this.lastSummary = {
        sessions: expiredSessions,
        refreshTokens: expiredRefreshTokens,
        emailVerificationTokens: expiredVerificationTokens,
        passwordResets: expiredPasswordResets,
        uploadSessions: expiredUploadSessions.sessions,
        stagedFilesDeleted: expiredUploadSessions.stagedFilesDeleted,
        ragQueued: ragRecovery.queued,
        ragPendingQueued: ragRecovery.pendingQueued,
        ragFailedRetryQueued: ragRecovery.failedRetryQueued,
        ragStaleReset: ragRecovery.staleReset,
        elapsedMs: Date.now() - startedAt,
      };
      this.lastCompletedAt = new Date().toISOString();
      this.lastError = null;

      this.logger.log(
        formatSafeLogEvent('maintenance_cleanup_completed', {
          sessions: expiredSessions,
          refreshTokens: expiredRefreshTokens,
          emailVerificationTokens: expiredVerificationTokens,
          passwordResets: expiredPasswordResets,
          uploadSessions: expiredUploadSessions.sessions,
          stagedFilesDeleted: expiredUploadSessions.stagedFilesDeleted,
          ragQueued: ragRecovery.queued,
          ragPendingQueued: ragRecovery.pendingQueued,
          ragFailedRetryQueued: ragRecovery.failedRetryQueued,
          ragStaleReset: ragRecovery.staleReset,
          elapsedMs: this.lastSummary.elapsedMs,
        }),
      );
      this.logger.log(
        formatSafeLogEvent('queue_summary', {
          uploadWaiting: uploadQueueSummary.waiting,
          uploadQueued: uploadQueueSummary.queued,
          uploadProcessing: uploadQueueSummary.processing,
          uploadSucceeded: uploadQueueSummary.succeeded,
          uploadFailed: uploadQueueSummary.failed,
          uploadScanned: uploadQueueSummary.scanned,
          uploadTruncated: uploadQueueSummary.truncated,
          ragPending: ragQueueSummary.pending,
          ragIndexing: ragQueueSummary.indexing,
          ragIndexed: ragQueueSummary.indexed,
          ragFailed: ragQueueSummary.failed,
          ragNoContent: ragQueueSummary.noContent,
        }),
      );
    } catch (error) {
      this.lastFailedAt = new Date().toISOString();
      this.lastError =
        error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
      this.logger.error(
        formatSafeLogEvent('maintenance_cleanup_failed', {
          ...safeErrorFields(error),
        }),
      );
    } finally {
      this.isRunning = false;
    }
  }

  getStatus(): MaintenanceCleanupStatus {
    return {
      enabled: this.enabled,
      running: this.isRunning,
      intervalMs: this.intervalMs,
      initialDelayMs: this.initialDelayMs,
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastFailedAt: this.lastFailedAt,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
    };
  }

  private async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  }

  private async cleanupExpiredRefreshTokens(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  }

  private async cleanupExpiredEmailVerificationTokens(): Promise<number> {
    const result = await this.prisma.emailVerificationToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  }

  private async cleanupExpiredPasswordResetAuthorizations(): Promise<number> {
    const result = await this.prisma.passwordResetAuthorization.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  }

  private async cleanupExpiredUploadSessions(): Promise<{
    sessions: number;
    stagedFilesDeleted: number;
  }> {
    const sessions = await this.prisma.documentUploadSession.findMany({
      where: {
        status: DocumentUploadSessionStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      select: {
        id: true,
        files: {
          where: {
            status: {
              in: [
                DocumentStagedFileStatus.READY,
                DocumentStagedFileStatus.REJECTED,
                DocumentStagedFileStatus.REMOVED,
              ],
            },
          },
          select: {
            storageBucket: true,
            storageKey: true,
          },
        },
      },
      take: this.batchSize,
    });

    let cleanedSessions = 0;
    let stagedFilesDeleted = 0;

    for (const session of sessions) {
      const objectReferences: StoredObjectReference[] = session.files
        .filter((file) => file.storageBucket && file.storageKey)
        .map((file) => ({
          bucket: file.storageBucket,
          key: file.storageKey,
        }));

      if (objectReferences.length > 0) {
        await this.storageService.removeObjects(objectReferences);
        stagedFilesDeleted += objectReferences.length;
      }

      await this.prisma.$transaction([
        this.prisma.documentUploadStagedFile.updateMany({
          where: {
            uploadSessionId: session.id,
            status: {
              in: [
                DocumentStagedFileStatus.READY,
                DocumentStagedFileStatus.REJECTED,
              ],
            },
          },
          data: { status: DocumentStagedFileStatus.REMOVED },
        }),
        this.prisma.documentUploadSession.update({
          where: { id: session.id },
          data: { status: DocumentUploadSessionStatus.EXPIRED },
        }),
      ]);

      cleanedSessions += 1;
    }

    return {
      sessions: cleanedSessions,
      stagedFilesDeleted,
    };
  }

  private async resolveUploadQueueSummary(): Promise<{
    waiting: number;
    queued: number;
    processing: number;
    succeeded: number;
    failed: number;
    scanned: number;
    truncated: boolean;
  }> {
    try {
      return await this.documentsService.getUploadQueueSummary();
    } catch (error) {
      this.logger.warn(
        formatSafeLogEvent('upload_queue_summary_failed', {
          ...safeErrorFields(error),
        }),
      );

      return {
        waiting: 0,
        queued: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        scanned: 0,
        truncated: false,
      };
    }
  }

  private async resolveRagQueueSummary(): Promise<{
    pending: number;
    indexing: number;
    indexed: number;
    failed: number;
    noContent: number;
  }> {
    try {
      return await this.documentsService.getRagQueueSummary();
    } catch (error) {
      this.logger.warn(
        formatSafeLogEvent('rag_queue_summary_failed', {
          ...safeErrorFields(error),
        }),
      );

      return {
        pending: 0,
        indexing: 0,
        indexed: 0,
        failed: 0,
        noContent: 0,
      };
    }
  }
}
