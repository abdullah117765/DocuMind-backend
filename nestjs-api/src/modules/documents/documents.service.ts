import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  catchError,
  defer,
  from,
  interval,
  map,
  Observable,
  of,
  startWith,
  switchMap,
  takeWhile,
} from 'rxjs';
import {
  formatSafeLogEvent,
  safeErrorFields,
} from '../../common/logging/safe-log.util';
import {
  AccessScope,
  DocumentAccessLevel,
  DocumentRagIndexStatus,
  RagChatMessageRole,
  DocumentStagedFileStatus,
  DocumentStatus,
  DocumentUploadSessionStatus,
  KnowledgeBaseStatus,
  OrganizationMembershipStatus,
  Prisma,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import type { OrganizationAccess } from '../access-control/access-control.types';
import {
  ORGANIZATION_PERMISSIONS,
  ORGANIZATION_ROLE_KEYS,
} from '../access-control/rbac.constants';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ZipManifestView } from './document-archive.service';
import { DocumentArchiveService } from './document-archive.service';
import {
  CitationHighlightBox,
  DocumentPreviewService,
} from './document-preview.service';
import {
  DocumentStorageService,
  StoredObjectReference,
} from './document-storage.service';
import {
  DocumentValidationService,
  ValidatedDocumentBuffer,
} from './document-validation.service';
import {
  DocumentUploadJobPatch,
  DocumentUploadQueueSummary,
  DocumentUploadJobsService,
  DocumentUploadJobView,
} from './document-upload-jobs.service';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { CommitUploadSessionDto } from './dto/commit-upload-session.dto';
import { ListPlatformDocumentsQueryDto } from './dto/list-platform-documents-query.dto';
import {
  RagDocumentScope,
  RagQueryDto,
  RagReindexDto,
} from './dto/rag-query.dto';
import {
  RagAskResponse,
  RagIngestPayload,
  RagOrchestratorService,
  RagSearchResponse,
} from './rag-orchestrator.service';

type RagAskSource = RagAskResponse['sources'][number];

export interface RagQueueSummary {
  pending: number;
  indexing: number;
  indexed: number;
  failed: number;
  noContent: number;
}

const ragChatSessionSelect = {
  id: true,
  organizationId: true,
  createdByUserId: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  selectedDocuments: {
    select: {
      documentId: true,
      document: {
        select: {
          id: true,
          name: true,
          originalFilename: true,
          extension: true,
        },
      },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.RagChatSessionSelect;

const ragChatDetailSelect = {
  id: true,
  organizationId: true,
  createdByUserId: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  selectedDocuments: {
    select: {
      documentId: true,
      document: {
        select: {
          id: true,
          name: true,
          originalFilename: true,
          extension: true,
        },
      },
    },
  },
  messages: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      summary: true,
      metadata: true,
      createdAt: true,
      sources: {
        orderBy: { createdAt: 'asc' },
      },
    },
  },
} as const satisfies Prisma.RagChatSessionSelect;

type RagChatSessionRecord = Prisma.RagChatSessionGetPayload<{
  select: typeof ragChatSessionSelect;
}>;

type RagChatDetailRecord = Prisma.RagChatSessionGetPayload<{
  select: typeof ragChatDetailSelect;
}>;

const documentSelect = {
  id: true,
  organizationId: true,
  name: true,
  originalFilename: true,
  extension: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  storageBucket: true,
  storageKey: true,
  status: true,
  createdByUserId: true,
  userDeletedAt: true,
  orgDeletedAt: true,
  restoredAt: true,
  purgedAt: true,
  createdAt: true,
  updatedAt: true,
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  userDeletedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  orgDeletedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  restoredBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  purgedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  versions: {
    orderBy: {
      versionNumber: 'desc',
    },
    take: 1,
    select: {
      id: true,
      documentId: true,
      organizationId: true,
      versionNumber: true,
      name: true,
      originalFilename: true,
      extension: true,
      mimeType: true,
      sizeBytes: true,
      checksumSha256: true,
      metadata: true,
      preview: true,
      createdAt: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
  accessGrants: {
    where: {
      revokedAt: null,
    },
    select: {
      id: true,
      userId: true,
      accessLevel: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      grantedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  },
  knowledgeBases: {
    select: {
      knowledgeBase: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      folder: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
  collections: {
    select: {
      collection: {
        select: {
          id: true,
          knowledgeBaseId: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
  categoryLinks: {
    select: {
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
  tags: {
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
} as const satisfies Prisma.DocumentSelect;

const documentVersionSelect = {
  id: true,
  documentId: true,
  organizationId: true,
  versionNumber: true,
  name: true,
  originalFilename: true,
  extension: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  metadata: true,
  preview: true,
  createdAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} as const satisfies Prisma.DocumentVersionSelect;

const uploadSessionSelect = {
  id: true,
  organizationId: true,
  createdByUserId: true,
  status: true,
  expiresAt: true,
  committedAt: true,
  createdAt: true,
  updatedAt: true,
  files: {
    orderBy: {
      position: 'asc',
    },
    select: {
      id: true,
      position: true,
      originalFilename: true,
      extension: true,
      mimeType: true,
      sizeBytes: true,
      checksumSha256: true,
      storageBucket: true,
      storageKey: true,
      metadata: true,
      preview: true,
      status: true,
      rejectionReason: true,
      sourceArchiveName: true,
      sourceArchivePath: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.DocumentUploadSessionSelect;

type DocumentRecord = Prisma.DocumentGetPayload<{
  select: typeof documentSelect;
}>;

type DocumentVersionRecord = Prisma.DocumentVersionGetPayload<{
  select: typeof documentVersionSelect;
}>;

type UploadSessionRecord = Prisma.DocumentUploadSessionGetPayload<{
  select: typeof uploadSessionSelect;
}>;

export interface DocumentUserSnapshot {
  id: string | null;
  name: string | null;
  email: string | null;
}

export interface DocumentView {
  id: string;
  organizationId: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  name: string;
  originalFilename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  status: DocumentStatus;
  createdBy: DocumentUserSnapshot;
  userDeletedBy: DocumentUserSnapshot | null;
  userDeletedAt: Date | null;
  orgDeletedBy: DocumentUserSnapshot | null;
  orgDeletedAt: Date | null;
  restoredBy: DocumentUserSnapshot | null;
  restoredAt: Date | null;
  purgedBy: DocumentUserSnapshot | null;
  purgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  latestVersion: DocumentVersionView | null;
  accessGrants: DocumentAccessGrantView[];
  knowledgeBases: Array<{
    id: string;
    name: string;
    slug: string;
    folder: { id: string; name: string; slug: string } | null;
  }>;
  collections: Array<{
    id: string;
    knowledgeBaseId: string;
    name: string;
    slug: string;
  }>;
  category: { id: string; name: string; slug: string } | null;
  tags: Array<{ id: string; name: string; slug: string }>;
}

export interface RagDocumentStatusView {
  documentId: string;
  status: DocumentRagIndexStatus | 'NOT_INDEXED';
  chunksCount: number;
  progress: number;
  message: string;
  errorMessage: string | null;
  indexedAt: Date | null;
  updatedAt: Date | null;
}

interface RagIndexRecord {
  documentId: string;
  versionId: string | null;
  versionNumber: number;
  status: DocumentRagIndexStatus;
  chunksCount: number;
  embeddingModel: string;
  errorMessage: string | null;
  indexedAt: Date | null;
  updatedAt: Date;
}

export interface RagSearchView extends RagSearchResponse {
  allowedDocumentIds: string[];
}

export interface RagAskView extends RagAskResponse {
  allowedDocumentIds: string[];
  chatSession: RagChatSessionView | null;
  chatMessages: RagChatMessageView[];
}

export interface RagChatSourceView {
  id: string;
  documentId: string | null;
  documentName: string;
  fileType: string | null;
  versionNumber: number;
  chunkIndex: number;
  pageNumber: number | null;
  slideNumber: number | null;
  sheetName: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  sectionTitle: string | null;
  locationLabel: string | null;
  score: number | null;
  metadata: Prisma.JsonValue | null;
}

export interface RagChatMessageView {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  summary: string | null;
  createdAt: Date;
  sources: RagChatSourceView[];
}

export interface RagChatSessionView {
  id: string;
  title: string;
  organizationId: string;
  createdByUserId: string;
  selectedDocumentIds: string[];
  selectedDocuments: Array<{
    id: string;
    name: string;
    originalFilename: string;
    extension: string;
  }>;
  lastMessage: {
    id: string;
    role: 'USER' | 'ASSISTANT';
    content: string;
    createdAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RagChatSessionListResult {
  chats: RagChatSessionView[];
}

export interface RagChatDetailView {
  chat: RagChatSessionView;
  messages: RagChatMessageView[];
}

export interface DocumentVersionView {
  id: string;
  documentId: string;
  organizationId: string;
  versionNumber: number;
  name: string;
  originalFilename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  metadata: Prisma.JsonValue | null;
  preview: Prisma.JsonValue | null;
  createdBy: DocumentUserSnapshot;
  createdAt: Date;
}

export interface DocumentAccessGrantView {
  id: string;
  userId: string;
  accessLevel: DocumentAccessLevel;
  createdAt: Date;
  user: DocumentUserSnapshot;
  grantedBy: DocumentUserSnapshot;
}

export interface DocumentListResult {
  documents: DocumentView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface UploadSessionView {
  id: string;
  organizationId: string;
  createdByUserId: string;
  status: DocumentUploadSessionStatus;
  expiresAt: Date;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  files: UploadSessionFileView[];
}

export interface UploadSessionFileView {
  id: string;
  position: number;
  originalFilename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  metadata: Prisma.JsonValue | null;
  preview: Prisma.JsonValue | null;
  status: DocumentStagedFileStatus;
  rejectionReason: string | null;
  sourceArchiveName: string | null;
  sourceArchivePath: string | null;
  createdAt: Date;
}

export interface CommitUploadSessionResult {
  documents: DocumentView[];
  warnings: Array<{
    stagedFileId: string;
    message: string;
    duplicateDocumentIds: string[];
  }>;
}

export interface DocumentStreamResult {
  stream: NodeJS.ReadableStream;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

function getDisplayName(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email.split('@')[0] || user.email;
}

function toUserSnapshot(
  user: {
    id: string;
    name: string | null;
    email: string;
  } | null,
): DocumentUserSnapshot | null {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: getDisplayName(user),
    email: user.email,
  };
}

function documentNameFromFilename(filename: string): string {
  const name = filename.replace(/\.[^.]+$/, '').trim();

  return name || filename;
}

function hasPermission(
  access: OrganizationAccess | null,
  permissionCode: string,
): boolean {
  return Boolean(access?.permissions.includes(permissionCode));
}

const DOCUMENT_ROLE_TIER = {
  none: 0,
  employee: 1,
  manager: 2,
  organizationAdmin: 3,
  platform: 4,
} as const;

type DocumentRoleTier =
  (typeof DOCUMENT_ROLE_TIER)[keyof typeof DOCUMENT_ROLE_TIER];

const UPDATED_RANGE_DAYS = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
} as const;

interface DocumentRoleAssignmentRecord {
  role: {
    systemKey: string | null;
    scope: AccessScope;
    permissions: Array<{
      permission: {
        code: string;
      };
    }>;
  };
}

type UploadProgressReporter = (patch: DocumentUploadJobPatch) => Promise<void>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

@Injectable()
export class DocumentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentsService.name);
  private uploadWorkerActive = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: DocumentStorageService,
    private readonly validationService: DocumentValidationService,
    private readonly previewService: DocumentPreviewService,
    private readonly archiveService: DocumentArchiveService,
    private readonly accessControlService: AccessControlService,
    private readonly envSuperAdminService: EnvSuperAdminService,
    private readonly ragOrchestrator: RagOrchestratorService,
    private readonly uploadJobsService: DocumentUploadJobsService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
  ) {}

  onModuleInit(): void {
    this.uploadWorkerActive = true;
    this.logger.log(formatSafeLogEvent('upload_worker_loop_started'));
    void this.processUploadJobs();
  }

  onModuleDestroy(): void {
    this.uploadWorkerActive = false;
    this.logger.log(formatSafeLogEvent('upload_worker_loop_stopping'));
  }

  private async processUploadJobs(): Promise<void> {
    while (this.uploadWorkerActive) {
      try {
        const job = await this.uploadJobsService.reserveNextJob(5);

        if (!job) {
          continue;
        }

        await this.processUploadJob(job);
      } catch (error: unknown) {
        if (this.uploadWorkerActive) {
          this.logger.error(
            formatSafeLogEvent('upload_worker_loop_failed', {
              ...safeErrorFields(error),
            }),
          );
          await delay(1000);
        }
      }
    }
  }

  private async processUploadJob(job: DocumentUploadJobView): Promise<void> {
    const startedAt = Date.now();

    this.logger.log(
      formatSafeLogEvent('upload_job_processing_started', {
        jobId: job.id,
        organizationId: job.organizationId,
        sessionId: job.sessionId,
        totalFiles: job.totalFiles,
      }),
    );

    await this.uploadJobsService.updateJob(job.id, {
      status: 'PROCESSING',
      stage: 'validating',
      progress: 2,
      message: 'Upload job started.',
      startedAt: new Date().toISOString(),
    });

    try {
      const result = await this.commitUploadSessionNow(
        job.organizationId,
        job.sessionId,
        job.createdByUserId,
        {
          knowledgeBaseIds: job.knowledgeBaseIds,
          folderId: job.folderId ?? undefined,
          collectionIds: job.collectionIds,
          categoryId: job.categoryId ?? undefined,
          tagIds: job.tagIds,
        },
        (patch) =>
          this.uploadJobsService.updateJob(job.id, patch).then(() => undefined),
      );

      await this.uploadJobsService.completeJob(job.id, {
        documents: result.documents.map((document) => ({
          id: document.id,
          name: document.name,
          originalFilename: document.originalFilename,
        })),
        warnings: result.warnings,
      });

      this.logger.log(
        formatSafeLogEvent('upload_job_processing_finished', {
          jobId: job.id,
          organizationId: job.organizationId,
          sessionId: job.sessionId,
          processedFiles: result.documents.length,
          warnings: result.warnings.length,
          durationMs: Date.now() - startedAt,
        }),
      );
    } catch (error: unknown) {
      await this.uploadJobsService.failJob(job.id, error);
    }
  }

  async getUploadQueueSummary(): Promise<DocumentUploadQueueSummary> {
    return this.uploadJobsService.getQueueSummary();
  }

  async getRagQueueSummary(): Promise<RagQueueSummary> {
    const groups = await this.prisma.documentRagIndex.groupBy({
      by: ['status'],
      where: {
        document: {
          status: DocumentStatus.ACTIVE,
        },
      },
      _count: {
        _all: true,
      },
    });
    const summary: RagQueueSummary = {
      pending: 0,
      indexing: 0,
      indexed: 0,
      failed: 0,
      noContent: 0,
    };

    for (const group of groups) {
      const count = group._count._all;

      if (group.status === DocumentRagIndexStatus.PENDING) {
        summary.pending = count;
      }

      if (group.status === DocumentRagIndexStatus.INDEXING) {
        summary.indexing = count;
      }

      if (group.status === DocumentRagIndexStatus.INDEXED) {
        summary.indexed = count;
      }

      if (group.status === DocumentRagIndexStatus.FAILED) {
        summary.failed = count;
      }

      if (group.status === DocumentRagIndexStatus.NO_CONTENT) {
        summary.noContent = count;
      }
    }

    return summary;
  }

  getZipManifest(archive: Express.Multer.File): ZipManifestView {
    return this.archiveService.getManifest(archive);
  }

  async stageFiles(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    files: Express.Multer.File[] | undefined,
  ): Promise<UploadSessionView> {
    this.validationService.assertUploadBatch(files);

    const validatedFiles = files!.map((file) => ({
      file: this.validationService.validateUploadedFile(file, {
        allowZip: false,
      }),
      sourceArchiveName: null,
      sourceArchivePath: null,
    }));

    return this.stageValidatedFiles(organizationId, principal, validatedFiles);
  }

  async stageZipArchive(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    archive: Express.Multer.File | undefined,
    selectedPaths: string[],
  ): Promise<UploadSessionView> {
    if (!archive) {
      throw new BadRequestException('Upload a ZIP archive.');
    }

    const extractedFiles = this.archiveService.extractSelectedFiles(
      archive,
      selectedPaths,
    );

    return this.stageValidatedFiles(
      organizationId,
      principal,
      extractedFiles.map((entry) => ({
        file: entry.file,
        sourceArchiveName: entry.sourceArchiveName,
        sourceArchivePath: entry.sourceArchivePath,
      })),
    );
  }

  async getUploadSession(
    organizationId: string,
    sessionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<UploadSessionView> {
    const session = await this.findOwnedUploadSession(
      organizationId,
      sessionId,
      principal.userId,
    );

    return this.toUploadSessionView(session);
  }

  async removeStagedFile(
    organizationId: string,
    sessionId: string,
    fileId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<UploadSessionView> {
    await this.assertPendingOwnedUploadSession(
      organizationId,
      sessionId,
      principal.userId,
    );

    const file = await this.prisma.documentUploadStagedFile.findFirst({
      where: {
        id: fileId,
        uploadSessionId: sessionId,
        status: DocumentStagedFileStatus.READY,
      },
      select: {
        id: true,
        storageBucket: true,
        storageKey: true,
      },
    });

    if (!file) {
      throw new NotFoundException('Staged file not found.');
    }

    await this.prisma.documentUploadStagedFile.update({
      where: { id: file.id },
      data: {
        status: DocumentStagedFileStatus.REMOVED,
      },
    });
    await this.storageService
      .removeObject(file.storageBucket, file.storageKey)
      .catch(() => undefined);

    return this.getUploadSession(organizationId, sessionId, principal);
  }

  async getStagedFileContent(
    organizationId: string,
    sessionId: string,
    fileId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentStreamResult> {
    await this.assertPendingOwnedUploadSession(
      organizationId,
      sessionId,
      principal.userId,
    );

    const file = await this.prisma.documentUploadStagedFile.findFirst({
      where: {
        id: fileId,
        uploadSessionId: sessionId,
        status: DocumentStagedFileStatus.READY,
      },
      select: {
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        storageBucket: true,
        storageKey: true,
      },
    });

    if (!file) {
      throw new NotFoundException('Staged file not found.');
    }

    return {
      stream: await this.storageService.getObject(
        file.storageBucket,
        file.storageKey,
      ),
      filename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }

  async commitUploadSession(
    organizationId: string,
    sessionId: string,
    principal: AuthenticatedPrincipal,
    dto: CommitUploadSessionDto = {},
  ): Promise<DocumentUploadJobView> {
    const existingJob = await this.uploadJobsService.getJobForSession(
      organizationId,
      sessionId,
    );

    if (existingJob) {
      if (existingJob.createdByUserId !== principal.userId) {
        throw new NotFoundException('Upload job not found.');
      }

      if (this.uploadJobsService.isStaleProcessingJob(existingJob)) {
        return this.uploadJobsService.requeueJob(existingJob);
      }

      return existingJob;
    }

    const session = await this.findOwnedUploadSession(
      organizationId,
      sessionId,
      principal.userId,
    );

    if (session.status !== DocumentUploadSessionStatus.PENDING) {
      throw new ConflictException('This upload session is not pending.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.documentUploadSession.update({
        where: { id: session.id },
        data: { status: DocumentUploadSessionStatus.EXPIRED },
      });

      throw new GoneException('This upload session has expired.');
    }

    const readyFiles = session.files.filter(
      (file) => file.status === DocumentStagedFileStatus.READY,
    );

    if (readyFiles.length === 0) {
      throw new ConflictException('There are no staged files to commit.');
    }

    const assignment =
      await this.knowledgeBasesService.validateDocumentAssignment(
        organizationId,
        dto,
      );

    await this.prisma.documentUploadSession.update({
      where: { id: session.id },
      data: {
        expiresAt: new Date(
          Date.now() + this.uploadJobsService.getTtlSeconds() * 1000,
        ),
      },
    });

    return this.uploadJobsService.createOrGetJob({
      organizationId,
      sessionId,
      createdByUserId: principal.userId,
      totalFiles: readyFiles.length,
      knowledgeBaseIds: assignment.knowledgeBaseIds,
      folderId: assignment.folderId,
      collectionIds: assignment.collectionIds,
      categoryId: assignment.categoryId,
      tagIds: assignment.tagIds,
    });
  }

  streamUploadJobEvents(
    organizationId: string,
    jobId: string,
    principal: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    return defer(async () => {
      await this.resolveOrganizationAccessOrThrow(
        principal.userId,
        organizationId,
      );

      const job = await this.uploadJobsService.getAuthorizedJob({
        organizationId,
        jobId,
        userId: principal.userId,
      });

      if (!job) {
        throw new NotFoundException('Upload job not found.');
      }

      return job;
    }).pipe(
      switchMap((job) =>
        interval(1000).pipe(
          startWith(0),
          switchMap(() =>
            from(
              this.uploadJobsService.getAuthorizedJob({
                organizationId,
                jobId,
                userId: principal.userId,
              }),
            ),
          ),
          map((currentJob) => {
            if (!currentJob) {
              return {
                data: {
                  ...job,
                  status: 'FAILED',
                  stage: 'failed',
                  error:
                    'Upload job state expired. Please refresh and try again.',
                  message: 'Upload job state expired.',
                },
              } satisfies MessageEvent;
            }

            return { data: currentJob } satisfies MessageEvent;
          }),
          takeWhile(
            (event) =>
              !this.uploadJobsService.isTerminalStatus(
                (event.data as DocumentUploadJobView).status,
              ),
            true,
          ),
          catchError((error: unknown) =>
            of({
              data: {
                ...job,
                status: 'FAILED',
                stage: 'failed',
                error:
                  error instanceof Error
                    ? error.message
                    : 'Unable to stream upload progress.',
                message: 'Unable to stream upload progress.',
              },
            } satisfies MessageEvent),
          ),
        ),
      ),
      catchError((error: unknown) =>
        of({
          data: {
            id: jobId,
            organizationId,
            sessionId: '',
            createdByUserId: principal.userId,
            status: 'FAILED',
            stage: 'failed',
            progress: 0,
            message: 'Unable to open upload progress stream.',
            totalFiles: 0,
            processedFiles: 0,
            currentFileName: null,
            documents: [],
            warnings: [],
            error:
              error instanceof Error
                ? error.message
                : 'Unable to stream upload progress.',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
          },
        } satisfies MessageEvent),
      ),
    );
  }

  private async commitUploadSessionNow(
    organizationId: string,
    sessionId: string,
    userId: string,
    assignmentInput: Partial<CommitUploadSessionDto> = {},
    reportProgress?: UploadProgressReporter,
  ): Promise<CommitUploadSessionResult> {
    const session = await this.findOwnedUploadSession(
      organizationId,
      sessionId,
      userId,
    );

    if (session.status !== DocumentUploadSessionStatus.PENDING) {
      throw new ConflictException('This upload session is not pending.');
    }

    const documents: DocumentView[] = [];
    const committedDocumentRecords: DocumentRecord[] = [];
    const warnings: CommitUploadSessionResult['warnings'] = [];
    const newObjectReferences: StoredObjectReference[] = [];
    const readyFiles = session.files.filter(
      (file) => file.status === DocumentStagedFileStatus.READY,
    );

    if (readyFiles.length === 0) {
      throw new ConflictException('There are no staged files to commit.');
    }

    const assignment =
      await this.knowledgeBasesService.validateDocumentAssignment(
        organizationId,
        assignmentInput,
      );
    const targetKnowledgeBaseId = assignment.knowledgeBaseIds[0];

    await reportProgress?.({
      status: 'PROCESSING',
      stage: 'validating',
      progress: 5,
      message: `Preparing ${readyFiles.length} staged file(s).`,
      totalFiles: readyFiles.length,
    });

    try {
      for (const stagedFile of readyFiles) {
        const duplicateDocument = await this.prisma.document.findFirst({
          where: {
            organizationId,
            checksumSha256: stagedFile.checksumSha256,
            status: DocumentStatus.ACTIVE,
            knowledgeBases: {
              some: {},
            },
          },
          select: {
            id: true,
            name: true,
            originalFilename: true,
            knowledgeBases: {
              select: {
                knowledgeBaseId: true,
                knowledgeBase: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        });

        if (duplicateDocument) {
          const existingKnowledgeBase = duplicateDocument.knowledgeBases[0];
          const existingKnowledgeBaseName =
            existingKnowledgeBase?.knowledgeBase.name ?? 'another Knowledge Base';
          const isSameTarget =
            existingKnowledgeBase?.knowledgeBaseId === targetKnowledgeBaseId;

          throw new ConflictException(
            isSameTarget
              ? `"${stagedFile.originalFilename}" already exists in the selected Knowledge Base.`
              : `"${stagedFile.originalFilename}" already exists in ${existingKnowledgeBaseName}. Move the existing document instead of uploading a duplicate.`,
          );
        }
      }

      for (const [index, stagedFile] of readyFiles.entries()) {
        await reportProgress?.({
          stage: 'copying',
          progress: 10 + Math.floor((index / readyFiles.length) * 65),
          message: `Copying ${stagedFile.originalFilename} into permanent storage.`,
          processedFiles: index,
          currentFileName: stagedFile.originalFilename,
        });

        const duplicateDocuments = await this.prisma.document.findMany({
          where: {
            organizationId,
            checksumSha256: stagedFile.checksumSha256,
            status: DocumentStatus.ACTIVE,
          },
          select: {
            id: true,
          },
          take: 5,
        });

        if (duplicateDocuments.length > 0) {
          warnings.push({
            stagedFileId: stagedFile.id,
            message:
              'A matching active document already exists in this organization. The file was still saved as a separate document.',
            duplicateDocumentIds: duplicateDocuments.map(({ id }) => id),
          });
        }

        const buffer = await this.storageService.getObjectBuffer(
          stagedFile.storageBucket,
          stagedFile.storageKey,
        );
        const documentId = randomUUID();
        const versionId = randomUUID();
        const storageKey = this.storageService.buildDocumentVersionKey({
          organizationId,
          documentId,
          versionId,
          filename: stagedFile.originalFilename,
        });

        const storedObject = await this.storageService.putObject(
          storageKey,
          buffer,
          {
            'content-type': stagedFile.mimeType,
          },
        );
        newObjectReferences.push(storedObject);

        const document = await this.prisma.document.create({
          data: {
            id: documentId,
            organizationId,
            name: documentNameFromFilename(stagedFile.originalFilename),
            originalFilename: stagedFile.originalFilename,
            extension: stagedFile.extension,
            mimeType: stagedFile.mimeType,
            sizeBytes: stagedFile.sizeBytes,
            checksumSha256: stagedFile.checksumSha256,
            storageBucket: storedObject.bucket,
            storageKey: storedObject.key,
            createdByUserId: userId,
            knowledgeBases: {
              create: assignment.knowledgeBaseIds.map((knowledgeBaseId) => ({
                knowledgeBaseId,
                folderId: assignment.folderId,
              })),
            },
            ...(assignment.collectionIds.length > 0
              ? {
                  collections: {
                    create: assignment.collectionIds.map((collectionId) => ({
                      collectionId,
                    })),
                  },
                }
              : {}),
            ...(assignment.categoryId
              ? {
                  categoryLinks: {
                    create: {
                      categoryId: assignment.categoryId,
                    },
                  },
                }
              : {}),
            ...(assignment.tagIds.length > 0
              ? {
                  tags: {
                    create: assignment.tagIds.map((tagId) => ({
                      tagId,
                    })),
                  },
                }
              : {}),
            versions: {
              create: {
                id: versionId,
                organizationId,
                versionNumber: 1,
                name: documentNameFromFilename(stagedFile.originalFilename),
                originalFilename: stagedFile.originalFilename,
                extension: stagedFile.extension,
                mimeType: stagedFile.mimeType,
                sizeBytes: stagedFile.sizeBytes,
                checksumSha256: stagedFile.checksumSha256,
                storageBucket: storedObject.bucket,
                storageKey: storedObject.key,
                metadata: stagedFile.metadata as Prisma.InputJsonValue,
                preview: stagedFile.preview as Prisma.InputJsonValue,
                createdByUserId: userId,
              },
            },
          },
          select: documentSelect,
        });

        committedDocumentRecords.push(document);
        documents.push(this.toDocumentView(document));
        await reportProgress?.({
          stage: 'saving',
          progress: 10 + Math.floor(((index + 1) / readyFiles.length) * 75),
          message: `${stagedFile.originalFilename} saved.`,
          processedFiles: index + 1,
          currentFileName: stagedFile.originalFilename,
        });
      }

      await reportProgress?.({
        stage: 'cleanup',
        progress: 90,
        message: 'Finalizing upload session and cleaning staged objects.',
        processedFiles: readyFiles.length,
        currentFileName: null,
      });

      await this.prisma.$transaction([
        this.prisma.documentUploadStagedFile.updateMany({
          where: {
            uploadSessionId: session.id,
            status: DocumentStagedFileStatus.READY,
          },
          data: {
            status: DocumentStagedFileStatus.COMMITTED,
          },
        }),
        this.prisma.documentUploadSession.update({
          where: { id: session.id },
          data: {
            status: DocumentUploadSessionStatus.COMMITTED,
            committedAt: new Date(),
          },
        }),
      ]);
    } catch (error: unknown) {
      await Promise.all([
        this.storageService
          .removeObjects(newObjectReferences)
          .catch(() => undefined),
        committedDocumentRecords.length
          ? this.prisma.document
              .deleteMany({
                where: {
                  id: {
                    in: committedDocumentRecords.map((document) => document.id),
                  },
                },
              })
              .catch(() => undefined)
          : Promise.resolve(),
      ]);

      throw error;
    }

    await this.storageService
      .removeObjects(
        readyFiles.map((file) => ({
          bucket: file.storageBucket,
          key: file.storageKey,
        })),
      )
      .catch(() => undefined);

    for (const document of committedDocumentRecords) {
      void this.scheduleRagIngestion(document);
    }

    return {
      documents,
      warnings,
    };
  }

  async listDocuments(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    query: ListDocumentsQueryDto,
  ): Promise<DocumentListResult> {
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = await this.buildOrganizationDocumentWhere(
      organizationId,
      principal.userId,
      access,
      query,
    );
    const orderBy = this.resolveDocumentOrderBy(query.sort);
    const [total, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        select: documentSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      documents: documents.map((document) => this.toDocumentView(document)),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async searchRagDocuments(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: RagQueryDto,
  ): Promise<RagSearchView> {
    this.assertRagConfigured();
    const documents = await this.resolveReadableRagDocumentRecords(
      organizationId,
      principal,
      dto,
    );
    const allowedDocumentIds = documents.map((document) => document.id);

    const response = await this.executeRagRequest(() =>
      this.ragOrchestrator.search({
        organization_id: organizationId,
        query: dto.query,
        allowed_document_ids: allowedDocumentIds,
        search_type: dto.searchType ?? 'hybrid',
      }),
    );

    return {
      ...response,
      allowedDocumentIds,
    };
  }

  async askRagDocuments(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: RagQueryDto,
  ): Promise<RagAskView> {
    this.assertRagConfigured();
    const documents = await this.resolveReadableRagDocumentRecords(
      organizationId,
      principal,
      dto,
    );
    const allowedDocumentIds = documents.map((document) => document.id);

    const response = await this.executeRagRequest(() =>
      this.ragOrchestrator.ask({
        organization_id: organizationId,
        query: dto.query,
        allowed_document_ids: allowedDocumentIds,
        search_type: dto.searchType ?? 'hybrid',
      }),
    );
    const savedChat = await this.saveRagChatExchange({
      allowedDocumentIds,
      organizationId,
      principal,
      query: dto.query,
      response,
      selectedDocumentIds:
        (dto.scope ?? RagDocumentScope.ALL) === RagDocumentScope.SELECTED
          ? [...new Set(dto.documentIds ?? [])]
          : [],
      chatSessionId: dto.chatSessionId,
    });

    return {
      ...response,
      allowedDocumentIds,
      chatSession: savedChat.chat,
      chatMessages: savedChat.messages,
    };
  }

  async listRagChatSessions(
    organizationId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<RagChatSessionListResult> {
    await this.resolveOrganizationAccessOrThrow(principal.userId, organizationId);

    const chats = await this.prisma.ragChatSession.findMany({
      where: {
        organizationId,
        createdByUserId: principal.userId,
        deletedAt: null,
      },
      select: ragChatSessionSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 50,
    });

    return {
      chats: chats.map((chat) => this.toRagChatSessionView(chat)),
    };
  }

  async getRagChatSession(
    organizationId: string,
    chatSessionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<RagChatDetailView> {
    await this.resolveOrganizationAccessOrThrow(principal.userId, organizationId);

    const chat = await this.prisma.ragChatSession.findFirst({
      where: {
        id: chatSessionId,
        organizationId,
        createdByUserId: principal.userId,
        deletedAt: null,
      },
      select: ragChatDetailSelect,
    });

    if (!chat) {
      throw new NotFoundException('Chat not found.');
    }

    return this.toRagChatDetailView(chat);
  }

  async deleteRagChatSession(
    organizationId: string,
    chatSessionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    await this.resolveOrganizationAccessOrThrow(principal.userId, organizationId);

    const result = await this.prisma.ragChatSession.updateMany({
      where: {
        id: chatSessionId,
        organizationId,
        createdByUserId: principal.userId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Chat not found.');
    }
  }

  async listRagStatuses(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: RagReindexDto = {},
  ): Promise<RagDocumentStatusView[]> {
    const documents = await this.resolveReadableRagDocumentRecords(
      organizationId,
      principal,
      {
        documentIds: dto.documentIds,
        query: 'status',
        scope:
          dto.documentIds && dto.documentIds.length > 0
            ? RagDocumentScope.SELECTED
            : RagDocumentScope.ALL,
      },
    );
    const indexes = await this.prisma.documentRagIndex.findMany({
      where: {
        documentId: {
          in: documents.map((document) => document.id),
        },
      },
    });
    const byDocumentId = new Map(
      indexes.map((index) => [index.documentId, index]),
    );

    return documents.map((document) =>
      this.toRagStatusView(document, byDocumentId.get(document.id)),
    );
  }

  async reindexRagDocuments(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: RagReindexDto,
  ): Promise<RagDocumentStatusView[]> {
    this.assertRagConfigured();
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const actorTier = await this.resolveActorDocumentTier(
      organizationId,
      principal.userId,
      access,
    );

    if (actorTier < DOCUMENT_ROLE_TIER.organizationAdmin) {
      throw new ForbiddenException(
        'Only an Organization Admin can reindex organization documents.',
      );
    }

    const documents = await this.resolveReadableRagDocumentRecords(
      organizationId,
      principal,
      {
        documentIds: dto.documentIds,
        query: 'reindex',
        scope:
          dto.documentIds && dto.documentIds.length > 0
            ? RagDocumentScope.SELECTED
            : RagDocumentScope.ALL,
      },
    );
    const indexes = await this.prisma.documentRagIndex.findMany({
      where: {
        documentId: {
          in: documents.map((document) => document.id),
        },
      },
    });
    const byDocumentId = new Map(
      indexes.map((index) => [index.documentId, index]),
    );
    const shouldForceDocuments = dto.force === true || Boolean(dto.documentIds?.length);
    const documentsToIndex = documents.filter((document) => {
      const index = byDocumentId.get(document.id);

      if (!index) return true;
      if (
        index.status === DocumentRagIndexStatus.PENDING ||
        index.status === DocumentRagIndexStatus.INDEXING
      ) {
        return false;
      }

      if (shouldForceDocuments) return true;

      return !this.isRagIndexCurrent(document, index);
    });

    await Promise.all(
      documentsToIndex.map((document) =>
        this.markRagIndexing(document).catch(() => undefined),
      ),
    );

    if (documentsToIndex.length > 0) {
      this.logger.log(
        `Starting background RAG reindex for ${documentsToIndex.length} document(s) in organization ${organizationId}.`,
      );
      void this.runRagReindexInBackground(
        documentsToIndex.map((document) => this.toRagIngestPayload(document)),
      );
    } else {
      this.logger.log(
        `Skipped RAG reindex for organization ${organizationId}; selected document(s) are already current or already indexing.`,
      );
    }

    return this.listRagStatuses(organizationId, principal, {
      documentIds: documents.map((document) => document.id),
    });
  }

  async listPlatformDocuments(
    query: ListPlatformDocumentsQueryDto,
  ): Promise<DocumentListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildPlatformDocumentWhere(query);
    const orderBy = this.resolveDocumentOrderBy(query.sort);
    const [total, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        select: documentSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      documents: documents.map((document) => this.toDocumentView(document)),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async getPlatformDocument(documentId: string): Promise<DocumentView> {
    return this.toDocumentView(
      await this.findPlatformDocumentRecord(documentId),
    );
  }

  async getPlatformDocumentContent(
    documentId: string,
  ): Promise<DocumentStreamResult> {
    const document = await this.findPlatformDocumentRecord(documentId);

    if (document.status === DocumentStatus.PURGED) {
      throw new NotFoundException('Document content has been purged.');
    }

    return this.toStreamResult(document);
  }

  async getPlatformDocumentPreview(
    documentId: string,
  ): Promise<Prisma.JsonValue | null> {
    const document = await this.findPlatformDocumentRecord(documentId);

    if (document.status === DocumentStatus.PURGED) {
      throw new NotFoundException('Document content has been purged.');
    }

    const preview = await this.resolveLatestDocumentPreview(document);

    if (!preview) return null;

    return {
      ...(preview as Record<string, unknown>),
      contentPath: `/platform/documents/${documentId}/content`,
    };
  }

  async getDocument(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentView> {
    const { document } = await this.findReadableOrganizationDocument(
      organizationId,
      documentId,
      principal,
    );

    return this.toDocumentView(document);
  }

  async getDocumentPreview(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<Prisma.JsonValue | null> {
    const { document } = await this.findReadableOrganizationDocument(
      organizationId,
      documentId,
      principal,
    );

    const preview = await this.resolveLatestDocumentPreview(document);

    if (!preview) return null;

    return {
      ...(preview as Record<string, unknown>),
      contentPath: `/organizations/${organizationId}/documents/${documentId}/content`,
    };
  }

  private async resolveLatestDocumentPreview(
    document: DocumentRecord,
  ): Promise<Prisma.JsonValue | null> {
    const latestVersion = document.versions[0] ?? null;

    if (!latestVersion) return null;

    let preview = latestVersion.preview ?? null;

    if (this.shouldRefreshPreview(document, preview)) {
      preview = await this.refreshLatestDocumentPreview(document).catch(
        () => preview,
      );
    }

    return preview;
  }

  async getDocumentContent(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentStreamResult> {
    const { document } = await this.findReadableOrganizationDocument(
      organizationId,
      documentId,
      principal,
    );

    return this.toStreamResult(document);
  }

  async getDocumentVersionContent(
    organizationId: string,
    documentId: string,
    versionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentStreamResult> {
    await this.findReadableOrganizationDocument(
      organizationId,
      documentId,
      principal,
    );

    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: versionId,
        documentId,
        organizationId,
      },
      select: {
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        storageBucket: true,
        storageKey: true,
      },
    });

    if (!version) {
      throw new NotFoundException('Document version not found.');
    }

    return {
      stream: await this.storageService.getObject(
        version.storageBucket,
        version.storageKey,
      ),
      filename: version.originalFilename,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
    };
  }

  async getDocumentVersionCitationPreviewContent(
    organizationId: string,
    documentId: string,
    versionId: string,
    principal: AuthenticatedPrincipal,
    highlightBoxesJson?: string,
    fallbackPageNumber?: number,
  ): Promise<DocumentStreamResult> {
    await this.findReadableOrganizationDocument(
      organizationId,
      documentId,
      principal,
    );

    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: versionId,
        documentId,
        organizationId,
      },
      select: {
        name: true,
        originalFilename: true,
        extension: true,
        storageBucket: true,
        storageKey: true,
      },
    });

    if (!version) {
      throw new NotFoundException('Document version not found.');
    }

    const buffer = await this.storageService.getObjectBuffer(
      version.storageBucket,
      version.storageKey,
    );
    const citationPdf = await this.previewService.convertToCitationPdf(
      buffer,
      version.extension,
      this.parseCitationHighlightBoxes(highlightBoxesJson),
      fallbackPageNumber,
    );

    if (!citationPdf) {
      throw new BadRequestException(
        'A page preview is not available for this file type.',
      );
    }

    return {
      stream: Readable.from(citationPdf),
      filename: `${documentNameFromFilename(version.originalFilename || version.name)}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: citationPdf.byteLength,
    };
  }

  private parseCitationHighlightBoxes(
    rawHighlights?: string,
  ): CitationHighlightBox[] {
    if (!rawHighlights || rawHighlights.length > 8000) return [];

    try {
      const parsed = JSON.parse(rawHighlights) as unknown;

      if (!Array.isArray(parsed)) return [];

      return parsed
        .slice(0, 12)
        .map((box): CitationHighlightBox | null => {
          if (!box || typeof box !== 'object') return null;

          return {
                page_number: this.toFiniteCitationNumber(
                  (box as Record<string, unknown>).page_number ??
                    (box as Record<string, unknown>).pageNumber,
                ),
                x0: this.toFiniteCitationNumber(
                  (box as Record<string, unknown>).x0,
                ),
                y0: this.toFiniteCitationNumber(
                  (box as Record<string, unknown>).y0,
                ),
                x1: this.toFiniteCitationNumber(
                  (box as Record<string, unknown>).x1,
                ),
                y1: this.toFiniteCitationNumber(
                  (box as Record<string, unknown>).y1,
                ),
                page_width: this.toFiniteCitationNumber(
                  (box as Record<string, unknown>).page_width ??
                    (box as Record<string, unknown>).pageWidth,
                ),
                page_height: this.toFiniteCitationNumber(
                  (box as Record<string, unknown>).page_height ??
                    (box as Record<string, unknown>).pageHeight,
                ),
              };
        })
        .filter((box): box is CitationHighlightBox => Boolean(box));
    } catch {
      return [];
    }
  }

  private toFiniteCitationNumber(value: unknown): number | null {
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  private shouldRefreshPreview(
    document: DocumentRecord,
    preview: Prisma.JsonValue | null,
  ): boolean {
    if (!['doc', 'ppt'].includes(document.extension)) {
      return false;
    }

    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
      return true;
    }

    const previewRecord = preview as Record<string, unknown>;
    const kind = String(previewRecord.kind ?? '');
    const message = String(previewRecord.message ?? '').toLowerCase();
    const previewAttemptedAt = previewRecord.previewAttemptedAt;

    if (kind === 'legacy-office' || message.includes('libreoffice')) {
      return true;
    }

    return (
      previewRecord.previewAvailable === false &&
      !previewAttemptedAt &&
      message.includes('could not prepare')
    );
  }

  private async refreshLatestDocumentPreview(
    document: DocumentRecord,
  ): Promise<Prisma.JsonValue | null> {
    const latestVersion = document.versions[0] ?? null;

    if (!latestVersion) return null;

    const buffer = await this.storageService.getObjectBuffer(
      document.storageBucket,
      document.storageKey,
    );
    const file: ValidatedDocumentBuffer = {
      buffer,
      checksumSha256: document.checksumSha256,
      extension: document.extension,
      mimeType: document.mimeType,
      originalFilename: document.originalFilename,
      sizeBytes: document.sizeBytes,
    };
    const { metadata, preview } = this.previewService.extractPreview(file);

    await this.prisma.documentVersion.update({
      where: { id: latestVersion.id },
      data: {
        metadata,
        preview,
      },
    });

    return preview as Prisma.JsonValue;
  }

  async downloadDocument(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentStreamResult> {
    await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );

    const { document } = await this.findReadableOrganizationDocument(
      organizationId,
      documentId,
      principal,
    );

    return this.toStreamResult(document);
  }

  async listDocumentVersions(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentVersionView[]> {
    await this.findReadableOrganizationDocument(
      organizationId,
      documentId,
      principal,
    );

    const versions = await this.prisma.documentVersion.findMany({
      where: {
        documentId,
        organizationId,
      },
      select: documentVersionSelect,
      orderBy: {
        versionNumber: 'desc',
      },
    });

    return versions.map((version) => this.toVersionView(version));
  }

  async uploadDocumentVersion(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
    upload: Express.Multer.File | undefined,
  ): Promise<DocumentView> {
    if (!upload) {
      throw new BadRequestException('Upload one replacement file.');
    }

    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const document = await this.findOrganizationDocumentRecord(
      organizationId,
      documentId,
    );

    if (document.status !== DocumentStatus.ACTIVE) {
      throw new ConflictException(
        'Only active documents can receive new versions.',
      );
    }

    if (
      !(await this.canModifyDocument(
        organizationId,
        document,
        access,
        principal.userId,
      ))
    ) {
      throw new ForbiddenException('You can update only documents you manage.');
    }

    const file = this.validationService.validateUploadedFile(upload, {
      allowZip: false,
    });
    const { metadata, preview } = this.previewService.extractPreview(file);
    const versionId = randomUUID();
    const storageKey = this.storageService.buildDocumentVersionKey({
      organizationId,
      documentId,
      versionId,
      filename: file.originalFilename,
    });
    const storedObject = await this.storageService.putObject(
      storageKey,
      file.buffer,
      {
        'content-type': file.mimeType,
      },
    );

    try {
      const updatedDocument = await this.prisma.$transaction(
        async (transaction) => {
          const latestVersion = await transaction.documentVersion.aggregate({
            where: {
              documentId,
              organizationId,
            },
            _max: {
              versionNumber: true,
            },
          });
          const nextVersionNumber = (latestVersion._max.versionNumber ?? 0) + 1;

          await transaction.documentVersion.create({
            data: {
              id: versionId,
              documentId,
              organizationId,
              versionNumber: nextVersionNumber,
              name: documentNameFromFilename(file.originalFilename),
              originalFilename: file.originalFilename,
              extension: file.extension,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              checksumSha256: file.checksumSha256,
              storageBucket: storedObject.bucket,
              storageKey: storedObject.key,
              metadata,
              preview,
              createdByUserId: principal.userId,
            },
          });

          return transaction.document.update({
            where: { id: documentId },
            data: {
              name: documentNameFromFilename(file.originalFilename),
              originalFilename: file.originalFilename,
              extension: file.extension,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              checksumSha256: file.checksumSha256,
              storageBucket: storedObject.bucket,
              storageKey: storedObject.key,
              restoredByUserId: null,
              restoredAt: null,
            },
            select: documentSelect,
          });
        },
      );

      void this.scheduleRagIngestion(updatedDocument);

      return this.toDocumentView(updatedDocument);
    } catch (error: unknown) {
      await this.storageService
        .removeObject(storedObject.bucket, storedObject.key)
        .catch(() => undefined);

      throw error;
    }
  }

  async softDeleteDocument(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentView> {
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const document = await this.findOrganizationDocumentRecord(
      organizationId,
      documentId,
    );

    if (document.status === DocumentStatus.PURGED) {
      throw new NotFoundException('Document not found.');
    }

    if (document.status === DocumentStatus.SOFT_DELETED_BY_ORG) {
      throw new NotFoundException('Document not found.');
    }

    const deleteDecision = await this.resolveDeleteDecision(
      organizationId,
      document,
      access,
      principal.userId,
    );

    if (!deleteDecision.allowed) {
      throw new ForbiddenException('You can delete only documents you manage.');
    }

    const now = new Date();

    if (deleteDecision.organizationLevel) {
      const updatedDocument = await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.SOFT_DELETED_BY_ORG,
          orgDeletedByUserId: principal.userId,
          orgDeletedAt: now,
        },
        select: documentSelect,
      });

      return this.toDocumentView(updatedDocument);
    }

    if (document.status !== DocumentStatus.ACTIVE) {
      throw new ConflictException(
        'This document is already in organization trash.',
      );
    }

    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.SOFT_DELETED_BY_USER,
        userDeletedByUserId: principal.userId,
        userDeletedAt: now,
      },
      select: documentSelect,
    });

    return this.toDocumentView(updatedDocument);
  }

  async restoreOrganizationDocument(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentView> {
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const document = await this.findOrganizationDocumentRecord(
      organizationId,
      documentId,
    );

    if (document.status !== DocumentStatus.SOFT_DELETED_BY_USER) {
      throw new ConflictException(
        'Only user-deleted documents can be restored from the organization panel.',
      );
    }

    if (
      !(await this.canReachDocumentByHierarchy(
        organizationId,
        document.createdByUserId,
        access,
        principal.userId,
      ))
    ) {
      throw new ForbiddenException(
        'You can restore only documents you manage.',
      );
    }

    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.ACTIVE,
        userDeletedByUserId: null,
        userDeletedAt: null,
        restoredByUserId: principal.userId,
        restoredAt: new Date(),
      },
      select: documentSelect,
    });

    return this.toDocumentView(updatedDocument);
  }

  async restorePlatformDocument(
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentView> {
    const document = await this.findPlatformDocumentRecord(documentId);

    if (document.status !== DocumentStatus.SOFT_DELETED_BY_ORG) {
      throw new ConflictException(
        'Only organization-deleted documents can be restored from the platform panel.',
      );
    }

    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.ACTIVE,
        orgDeletedByUserId: null,
        orgDeletedAt: null,
        restoredByUserId: principal.userId,
        restoredAt: new Date(),
      },
      select: documentSelect,
    });

    return this.toDocumentView(updatedDocument);
  }

  async grantDocumentAccess(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
    targetUserId: string,
  ): Promise<DocumentAccessGrantView> {
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const document = await this.findOrganizationDocumentRecord(
      organizationId,
      documentId,
    );

    if (document.status !== DocumentStatus.ACTIVE) {
      throw new ConflictException(
        'Access can be granted only to active documents.',
      );
    }

    if (
      !(await this.canModifyDocument(
        organizationId,
        document,
        access,
        principal.userId,
      ))
    ) {
      throw new ForbiddenException(
        'You can grant access only for documents you manage.',
      );
    }

    await this.assertCanReceiveDocumentAccess(organizationId, targetUserId);

    const existingGrant = await this.prisma.documentAccess.findFirst({
      where: {
        documentId,
        userId: targetUserId,
        revokedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (existingGrant) {
      throw new ConflictException(
        'This user already has document preview access.',
      );
    }

    const grant = await this.prisma.documentAccess.create({
      data: {
        documentId,
        userId: targetUserId,
        accessLevel: DocumentAccessLevel.PREVIEW,
        grantedByUserId: principal.userId,
      },
      select: {
        id: true,
        userId: true,
        accessLevel: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        grantedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.toAccessGrantView(grant);
  }

  async revokeDocumentAccess(
    organizationId: string,
    documentId: string,
    accessId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const document = await this.findOrganizationDocumentRecord(
      organizationId,
      documentId,
    );

    if (
      !(await this.canModifyDocument(
        organizationId,
        document,
        access,
        principal.userId,
      ))
    ) {
      throw new ForbiddenException(
        'You can revoke access only for documents you manage.',
      );
    }

    const revoked = await this.prisma.documentAccess.updateMany({
      where: {
        id: accessId,
        documentId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (revoked.count !== 1) {
      throw new NotFoundException('Active document access grant not found.');
    }
  }

  async purgePlatformDocument(
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentView> {
    if (
      !(await this.envSuperAdminService.isConfiguredUserId(principal.userId))
    ) {
      throw new ForbiddenException(
        'Only the environment Super Admin can purge documents.',
      );
    }

    const document = await this.findPlatformDocumentRecord(documentId, true);

    if (document.status === DocumentStatus.PURGED) {
      throw new ConflictException('This document has already been purged.');
    }

    const objectReferences = new Map<string, StoredObjectReference>();
    objectReferences.set(`${document.storageBucket}/${document.storageKey}`, {
      bucket: document.storageBucket,
      key: document.storageKey,
    });

    for (const version of document.versions) {
      if (!version.storageBucket || !version.storageKey) {
        continue;
      }

      const key = `${version.storageBucket}/${version.storageKey}`;
      objectReferences.set(key, {
        bucket: version.storageBucket,
        key: version.storageKey,
      });
    }

    await this.storageService
      .removeObjects([...objectReferences.values()])
      .catch(() => undefined);

    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.PURGED,
        purgedByUserId: principal.userId,
        purgedAt: new Date(),
      },
      select: documentSelect,
    });

    void this.ragOrchestrator.deleteDocument(
      updatedDocument.organizationId,
      updatedDocument.id,
    );

    return this.toDocumentView(updatedDocument);
  }

  private async saveRagChatExchange(input: {
    allowedDocumentIds: string[];
    organizationId: string;
    principal: AuthenticatedPrincipal;
    query: string;
    response: RagAskResponse;
    selectedDocumentIds: string[];
    chatSessionId?: string;
  }): Promise<{ chat: RagChatSessionView; messages: RagChatMessageView[] }> {
    const chat = input.chatSessionId
      ? await this.findOwnedRagChatSession(
          input.organizationId,
          input.chatSessionId,
          input.principal.userId,
        )
      : await this.prisma.ragChatSession.create({
          data: {
            organizationId: input.organizationId,
            createdByUserId: input.principal.userId,
            title: this.buildRagChatTitle(input.query),
          },
          select: {
            id: true,
          },
        });

    const validSelectedDocumentIds = input.selectedDocumentIds.filter(
      (documentId) => input.allowedDocumentIds.includes(documentId),
    );

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.ragChatSelectedDocument.deleteMany({
        where: { chatSessionId: chat.id },
      });

      if (validSelectedDocumentIds.length > 0) {
        await tx.ragChatSelectedDocument.createMany({
          data: validSelectedDocumentIds.map((documentId) => ({
            chatSessionId: chat.id,
            documentId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.ragChatMessage.create({
        data: {
          chatSessionId: chat.id,
          role: RagChatMessageRole.USER,
          content: input.query,
          summary: this.buildRagMessageSummary(input.query),
        },
      });

      const assistantMessage = await tx.ragChatMessage.create({
        data: {
          chatSessionId: chat.id,
          role: RagChatMessageRole.ASSISTANT,
          content: input.response.answer,
          summary: this.buildRagMessageSummary(input.response.answer),
          metadata: {
            llmModel: input.response.llm_model ?? null,
            llmAvailable: input.response.llm_available,
            processingTimeMs: input.response.processing_time_ms,
          },
        },
        select: { id: true },
      });
      const sourceData = input.response.sources
        .filter((source) =>
          input.allowedDocumentIds.includes(source.document_id),
        )
        .slice(0, 20)
        .map((source, index) => {
          const metadata = this.getRagSourceMetadata(source);
          const pageNumber = this.getRagSourceInteger(
            source.page_number,
            metadata,
            'page_number',
          );
          const slideNumber = this.getRagSourceInteger(
            source.slide_number,
            metadata,
            'slide_number',
          );
          const sheetName = this.getRagSourceString(
            source.sheet_name,
            metadata,
            'sheet_name',
            120,
          );
          const lineStart = this.getRagSourceInteger(
            source.line_start,
            metadata,
            'line_start',
          );
          const lineEnd = this.getRagSourceInteger(
            source.line_end,
            metadata,
            'line_end',
          );
          const sectionTitle = this.getRagSourceString(
            source.section_title,
            metadata,
            'section_title',
            255,
          );
          const sourceExcerpt =
            this.getRagSourceString(source.text, metadata, 'text', 1200) ??
            this.getRagSourceString(undefined, metadata, 'excerpt', 1200);
          const sourceMetadata: Record<string, unknown> = { ...metadata };
          const versionId =
            sourceMetadata.version_id ?? sourceMetadata.versionId ?? null;
          const highlightBoxes =
            sourceMetadata.highlight_boxes ??
            sourceMetadata.highlightBoxes ??
            [];
          const previewType =
            sourceMetadata.preview_type ?? sourceMetadata.previewType ?? null;

          if (sourceExcerpt) {
            sourceMetadata.excerpt = sourceExcerpt;

            if (!sourceMetadata.text) {
              sourceMetadata.text = sourceExcerpt;
            }
          }

          sourceMetadata.sourceNumber = index + 1;
          sourceMetadata.citationNumber = index + 1;
          sourceMetadata.versionId = versionId;
          sourceMetadata.version_id = versionId;
          sourceMetadata.highlightBoxes = highlightBoxes;
          sourceMetadata.highlight_boxes = highlightBoxes;
          sourceMetadata.previewType = previewType;
          sourceMetadata.preview_type = previewType;
          sourceMetadata.openPage = pageNumber;

          return {
            messageId: assistantMessage.id,
            documentId: source.document_id,
            documentName: source.document_name || 'Document',
            fileType: source.file_type ?? null,
            versionNumber: source.version_number,
            chunkIndex: source.chunk_index,
            pageNumber,
            slideNumber,
            sheetName,
            lineStart,
            lineEnd,
            sectionTitle,
            locationLabel: this.getRagSourceLocationLabel(source, {
              pageNumber,
              slideNumber,
              sheetName,
              lineStart,
              lineEnd,
              sectionTitle,
              metadata,
            }),
            score:
              typeof source.score === 'number' && Number.isFinite(source.score)
                ? source.score
                : null,
            metadata: sourceMetadata as Prisma.InputJsonValue,
          };
        });

      if (sourceData.length > 0) {
        await tx.ragChatMessageSource.createMany({ data: sourceData });
      }

      return tx.ragChatSession.update({
        where: { id: chat.id },
        data: {
          updatedAt: new Date(),
        },
        select: ragChatDetailSelect,
      });
    });

    const view = this.toRagChatDetailView(detail);

    return {
      chat: view.chat,
      messages: view.messages.slice(-2),
    };
  }

  private async findOwnedRagChatSession(
    organizationId: string,
    chatSessionId: string,
    userId: string,
  ): Promise<{ id: string }> {
    const chat = await this.prisma.ragChatSession.findFirst({
      where: {
        id: chatSessionId,
        organizationId,
        createdByUserId: userId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found.');
    }

    return chat;
  }

  private toRagChatDetailView(chat: RagChatDetailRecord): RagChatDetailView {
    return {
      chat: this.toRagChatSessionView(chat),
      messages: chat.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        summary: message.summary,
        createdAt: message.createdAt,
        sources: message.sources.map((source) => ({
          id: source.id,
          documentId: source.documentId,
          documentName: source.documentName,
          fileType: source.fileType,
          versionNumber: source.versionNumber,
          chunkIndex: source.chunkIndex,
          pageNumber: source.pageNumber,
          slideNumber: source.slideNumber,
          sheetName: source.sheetName,
          lineStart: source.lineStart,
          lineEnd: source.lineEnd,
          sectionTitle: source.sectionTitle,
          locationLabel: source.locationLabel,
          score: source.score,
          metadata: source.metadata,
        })),
      })),
    };
  }

  private toRagChatSessionView(
    chat: RagChatSessionRecord | RagChatDetailRecord,
  ): RagChatSessionView {
    const selectedDocuments = chat.selectedDocuments
      .map((item) => item.document)
      .filter(Boolean);
    const lastMessage =
      [...chat.messages].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0] ?? null;

    return {
      id: chat.id,
      title: chat.title,
      organizationId: chat.organizationId,
      createdByUserId: chat.createdByUserId,
      selectedDocumentIds: chat.selectedDocuments.map((item) => item.documentId),
      selectedDocuments: selectedDocuments.map((document) => ({
        id: document.id,
        name: document.name,
        originalFilename: document.originalFilename,
        extension: document.extension,
      })),
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            role: lastMessage.role,
            content: lastMessage.content,
            createdAt: lastMessage.createdAt,
          }
        : null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }

  private buildRagChatTitle(query: string): string {
    const normalized = query.replace(/\s+/g, ' ').trim();

    if (!normalized) return 'New document chat';

    return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized;
  }

  private buildRagMessageSummary(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();

    return normalized.length > 280 ? `${normalized.slice(0, 280)}...` : normalized;
  }

  private getRagSourceMetadata(source: RagAskSource): Record<string, unknown> {
    const metadata = source.metadata;

    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return metadata;
  }

  private getRagSourceString(
    directValue: unknown,
    metadata: Record<string, unknown>,
    metadataKey: string,
    maxLength: number,
  ): string | null {
    return (
      this.truncateNullable(directValue, maxLength) ??
      this.truncateNullable(metadata[metadataKey], maxLength) ??
      this.truncateNullable(metadata[this.toCamelCase(metadataKey)], maxLength)
    );
  }

  private getRagSourceInteger(
    directValue: unknown,
    metadata: Record<string, unknown>,
    metadataKey: string,
  ): number | null {
    return (
      this.toNullableInteger(directValue) ??
      this.toNullableInteger(metadata[metadataKey]) ??
      this.toNullableInteger(metadata[this.toCamelCase(metadataKey)])
    );
  }

  private getRagSourceLocationLabel(
    source: RagAskSource,
    input: {
      pageNumber: number | null;
      slideNumber: number | null;
      sheetName: string | null;
      lineStart: number | null;
      lineEnd: number | null;
      sectionTitle: string | null;
      metadata: Record<string, unknown>;
    },
  ): string | null {
    const directLabel = this.getRagSourceString(
      source.location_label,
      input.metadata,
      'location_label',
      255,
    );

    if (directLabel) return directLabel;

    if (input.pageNumber !== null) return `Page ${input.pageNumber}`;
    if (input.slideNumber !== null) return `Slide ${input.slideNumber}`;
    if (input.sectionTitle) return input.sectionTitle;

    if (
      input.sheetName &&
      input.lineStart !== null &&
      input.lineEnd !== null
    ) {
      return `${input.sheetName}, lines ${input.lineStart}-${input.lineEnd}`;
    }

    if (input.lineStart !== null && input.lineEnd !== null) {
      return input.lineStart === input.lineEnd
        ? `Line ${input.lineStart}`
        : `Lines ${input.lineStart}-${input.lineEnd}`;
    }

    const chunkIndex = this.toNullableInteger(source.chunk_index);
    if (chunkIndex !== null && chunkIndex >= 0) {
      return `Passage ${chunkIndex + 1}`;
    }

    return null;
  }

  private toCamelCase(value: string): string {
    return value.replace(/_([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
  }

  private toNullableInteger(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;

    const parsedValue = Number(value);

    return Number.isSafeInteger(parsedValue) ? parsedValue : null;
  }

  private truncateNullable(
    value: unknown,
    maxLength: number,
  ): string | null {
    if (typeof value !== 'string') return null;

    const normalized = value.trim();

    if (!normalized) return null;

    return normalized.length > maxLength
      ? normalized.slice(0, maxLength)
      : normalized;
  }

  private assertRagConfigured(): void {
    if (!this.ragOrchestrator.isConfigured()) {
      throw new ServiceUnavailableException(
        'RAG service is not configured. Set RAG_SERVICE_URL and RAG_HMAC_SECRET.',
      );
    }
  }

  private async executeRagRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error: unknown) {
      this.logger.warn(
        `Document AI request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.includes('aborted'))
      ) {
        throw new RequestTimeoutException(
          'Document AI operation is still processing. For long indexing or reindexing jobs, increase RAG_INDEXING_TIMEOUT_MS or retry after the current job finishes.',
        );
      }

      throw new ServiceUnavailableException(
        'Document AI service is currently unavailable. Start the FastAPI RAG service and verify RAG_SERVICE_URL and RAG_HMAC_SECRET.',
      );
    }
  }

  private async resolveReadableRagDocumentRecords(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: RagQueryDto,
  ): Promise<DocumentRecord[]> {
    const scope = dto.scope ?? RagDocumentScope.ALL;
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );

    if (scope === RagDocumentScope.SELECTED) {
      const documentIds = [...new Set(dto.documentIds ?? [])];

      if (documentIds.length === 0) {
        throw new BadRequestException('Select at least one document.');
      }

      const documents = await this.prisma.document.findMany({
        where: {
          id: { in: documentIds },
          organizationId,
          status: DocumentStatus.ACTIVE,
        },
        select: documentSelect,
      });
      const byId = new Map(
        documents.map((document) => [document.id, document]),
      );

      if (documents.length !== documentIds.length) {
        throw new NotFoundException('Document not found.');
      }

      for (const document of documents) {
        if (
          !(await this.canReadDocument(
            organizationId,
            document,
            access,
            principal.userId,
          ))
        ) {
          throw new NotFoundException('Document not found.');
        }
      }

      return documentIds
        .map((documentId) => byId.get(documentId))
        .filter((document): document is DocumentRecord => Boolean(document));
    }

    if (scope === RagDocumentScope.KNOWLEDGE_BASE) {
      const knowledgeBaseIds = [...new Set(dto.knowledgeBaseIds ?? [])];

      if (knowledgeBaseIds.length === 0) {
        throw new BadRequestException('Select at least one Knowledge Base.');
      }

      const knowledgeBaseCount = await this.prisma.knowledgeBase.count({
        where: {
          id: { in: knowledgeBaseIds },
          organizationId,
          status: KnowledgeBaseStatus.ACTIVE,
        },
      });

      if (knowledgeBaseCount !== knowledgeBaseIds.length) {
        throw new NotFoundException('Knowledge Base not found.');
      }

      const where = await this.buildOrganizationDocumentWhere(
        organizationId,
        principal.userId,
        access,
        {},
      );

      return this.prisma.document.findMany({
        where: {
          AND: [
            where,
            {
              knowledgeBases: {
                some: {
                  knowledgeBaseId: { in: knowledgeBaseIds },
                },
              },
            },
          ],
        },
        select: documentSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      });
    }

    if (scope === RagDocumentScope.COLLECTION) {
      const knowledgeBaseIds = [...new Set(dto.knowledgeBaseIds ?? [])];
      const collectionIds = [...new Set(dto.collectionIds ?? [])];

      if (knowledgeBaseIds.length === 0) {
        throw new BadRequestException('Select at least one Knowledge Base.');
      }

      if (collectionIds.length === 0) {
        throw new BadRequestException('Select at least one Collection.');
      }

      const collections = await this.prisma.knowledgeBaseCollection.findMany({
        where: {
          id: { in: collectionIds },
          organizationId,
          knowledgeBaseId: { in: knowledgeBaseIds },
          knowledgeBase: {
            status: KnowledgeBaseStatus.ACTIVE,
          },
        },
        select: { id: true },
      });

      if (collections.length !== collectionIds.length) {
        throw new NotFoundException('Collection not found.');
      }

      const where = await this.buildOrganizationDocumentWhere(
        organizationId,
        principal.userId,
        access,
        {},
      );

      return this.prisma.document.findMany({
        where: {
          AND: [
            where,
            {
              collections: {
                some: {
                  collectionId: { in: collectionIds },
                },
              },
            },
            {
              knowledgeBases: {
                some: {
                  knowledgeBaseId: { in: knowledgeBaseIds },
                },
              },
            },
          ],
        },
        select: documentSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      });
    }

    const where = await this.buildOrganizationDocumentWhere(
      organizationId,
      principal.userId,
      access,
      {},
    );

    return this.prisma.document.findMany({
      where,
      select: documentSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  private async scheduleRagIngestion(document: DocumentRecord): Promise<void> {
    await this.markRagIndexPending(document).catch(() => undefined);

    this.logger.log(
      formatSafeLogEvent('rag_prepare_queued', {
        documentId: document.id,
        organizationId: document.organizationId,
        versionNumber: document.versions[0]?.versionNumber ?? 1,
      }),
    );

    if (!this.ragOrchestrator.isConfigured()) {
      this.logger.warn(
        formatSafeLogEvent('rag_prepare_skipped_unconfigured', {
          documentId: document.id,
          organizationId: document.organizationId,
        }),
      );
      return;
    }

    await this.prisma.documentRagIndex
      .update({
        where: { documentId: document.id },
        data: {
          status: DocumentRagIndexStatus.INDEXING,
          errorMessage: null,
        },
      })
      .catch(() => undefined);

    const startedAt = Date.now();

    this.logger.log(
      formatSafeLogEvent('rag_prepare_started', {
        documentId: document.id,
        organizationId: document.organizationId,
        fileType: document.extension,
      }),
    );

    try {
      const result = await this.ragOrchestrator.ingest(
        this.toRagIngestPayload(document),
      );

      if (!result) {
        this.logger.warn(
          formatSafeLogEvent('rag_prepare_no_result', {
            documentId: document.id,
            organizationId: document.organizationId,
            durationMs: Date.now() - startedAt,
          }),
        );
        return;
      }

      await this.applyRagIngestResult(
        result.document_id,
        result.status,
        result.chunks_created,
        result.error_message ?? null,
      );

      this.logger.log(
        formatSafeLogEvent('rag_prepare_completed', {
          documentId: document.id,
          organizationId: document.organizationId,
          status: result.status,
          chunksCreated: result.chunks_created,
          durationMs: Date.now() - startedAt,
        }),
      );
    } catch (error: unknown) {
      await this.applyRagIngestResult(
        document.id,
        DocumentRagIndexStatus.FAILED,
        0,
        String(error).slice(0, 1000),
      ).catch(() => undefined);

      this.logger.warn(
        formatSafeLogEvent('rag_prepare_failed', {
          documentId: document.id,
          organizationId: document.organizationId,
          durationMs: Date.now() - startedAt,
          retryAfterMs: 2 * 60 * 1000,
          ...safeErrorFields(error),
        }),
      );
    }
  }

  async recoverRagIndexes(options?: {
    batchSize?: number;
    failedRetryAfterMs?: number;
    staleIndexingAfterMs?: number;
  }): Promise<{
    queued: number;
    pendingQueued: number;
    failedRetryQueued: number;
    staleReset: number;
  }> {
    if (!this.ragOrchestrator.isConfigured()) {
      return {
        queued: 0,
        pendingQueued: 0,
        failedRetryQueued: 0,
        staleReset: 0,
      };
    }

    const batchSize = Math.max(1, Math.min(options?.batchSize ?? 3, 10));
    const failedRetryAfterMs = Math.max(
      options?.failedRetryAfterMs ?? 2 * 60 * 1000,
      60 * 1000,
    );
    const staleIndexingAfterMs = Math.max(
      options?.staleIndexingAfterMs ?? 35 * 60 * 1000,
      5 * 60 * 1000,
    );
    const now = Date.now();
    const staleIndexingCutoff = new Date(now - staleIndexingAfterMs);
    const failedRetryCutoff = new Date(now - failedRetryAfterMs);

    const staleReset = await this.prisma.documentRagIndex.updateMany({
      where: {
        status: DocumentRagIndexStatus.INDEXING,
        updatedAt: { lt: staleIndexingCutoff },
      },
      data: {
        status: DocumentRagIndexStatus.PENDING,
        errorMessage:
          'Previous document preparation took too long and was queued again.',
      },
    });

    if (staleReset.count > 0) {
      this.logger.warn(
        formatSafeLogEvent('rag_stale_processing_reset', {
          count: staleReset.count,
          staleIndexingAfterMs,
        }),
      );
    }

    const candidates = await this.prisma.documentRagIndex.findMany({
      where: {
        document: { status: DocumentStatus.ACTIVE },
        OR: [
          { status: DocumentRagIndexStatus.PENDING },
          {
            status: DocumentRagIndexStatus.FAILED,
            updatedAt: { lt: failedRetryCutoff },
          },
        ],
      },
      select: {
        status: true,
        document: {
          select: documentSelect,
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    const documents = candidates.map((candidate) => candidate.document);
    const failedRetryQueued = candidates.filter(
      (candidate) => candidate.status === DocumentRagIndexStatus.FAILED,
    ).length;
    const pendingQueued = candidates.filter(
      (candidate) => candidate.status === DocumentRagIndexStatus.PENDING,
    ).length;

    if (documents.length === 0) {
      return {
        queued: 0,
        pendingQueued: 0,
        failedRetryQueued: 0,
        staleReset: staleReset.count,
      };
    }

    await Promise.all(
      documents.map((document) => this.markRagIndexing(document)),
    );

    void this.runRagReindexInBackground(
      documents.map((document) => this.toRagIngestPayload(document)),
    );

    this.logger.log(
      formatSafeLogEvent('rag_recovery_queued', {
        queued: documents.length,
        pendingQueued,
        failedRetryQueued,
        failedRetryAfterMs,
        staleReset: staleReset.count,
        documentIds: documents.map((document) => document.id),
      }),
    );

    return {
      queued: documents.length,
      pendingQueued,
      failedRetryQueued,
      staleReset: staleReset.count,
    };
  }

  private async markRagIndexPending(document: DocumentRecord): Promise<void> {
    const latestVersion = document.versions[0] ?? null;

    await this.prisma.documentRagIndex.upsert({
      where: { documentId: document.id },
      update: {
        organizationId: document.organizationId,
        versionId: latestVersion?.id ?? null,
        versionNumber: latestVersion?.versionNumber ?? 1,
        status: DocumentRagIndexStatus.PENDING,
        chunksCount: 0,
        embeddingModel: this.ragOrchestrator.getEmbeddingModel(),
        errorMessage: null,
        indexedAt: null,
      },
      create: {
        documentId: document.id,
        organizationId: document.organizationId,
        versionId: latestVersion?.id ?? null,
        versionNumber: latestVersion?.versionNumber ?? 1,
        status: DocumentRagIndexStatus.PENDING,
        chunksCount: 0,
        embeddingModel: this.ragOrchestrator.getEmbeddingModel(),
      },
    });
  }

  private async markRagIndexing(document: DocumentRecord): Promise<void> {
    const latestVersion = document.versions[0] ?? null;

    await this.prisma.documentRagIndex.upsert({
      where: { documentId: document.id },
      update: {
        organizationId: document.organizationId,
        versionId: latestVersion?.id ?? null,
        versionNumber: latestVersion?.versionNumber ?? 1,
        status: DocumentRagIndexStatus.INDEXING,
        chunksCount: 0,
        embeddingModel: this.ragOrchestrator.getEmbeddingModel(),
        errorMessage: null,
        indexedAt: null,
      },
      create: {
        documentId: document.id,
        organizationId: document.organizationId,
        versionId: latestVersion?.id ?? null,
        versionNumber: latestVersion?.versionNumber ?? 1,
        status: DocumentRagIndexStatus.INDEXING,
        chunksCount: 0,
        embeddingModel: this.ragOrchestrator.getEmbeddingModel(),
      },
    });
  }

  private async runRagReindexInBackground(
    payloads: RagIngestPayload[],
  ): Promise<void> {
    const startedAt = Date.now();

    this.logger.log(
      formatSafeLogEvent('rag_reindex_batch_started', {
        documents: payloads.length,
        documentIds: payloads.map((payload) => payload.document_id),
        organizationIds: [
          ...new Set(payloads.map((payload) => payload.organization_id)),
        ],
      }),
    );

    try {
      const results = await this.ragOrchestrator.reindex(payloads);

      if (!results) {
        this.logger.warn(
          formatSafeLogEvent('rag_reindex_batch_no_result', {
            documents: payloads.length,
            durationMs: Date.now() - startedAt,
          }),
        );
        return;
      }

      await Promise.all(
        results.map((result) =>
          this.applyRagIngestResult(
            result.document_id,
            result.status,
            result.chunks_created,
            result.error_message ?? null,
          ),
        ),
      );
      this.logger.log(
        formatSafeLogEvent('rag_reindex_batch_completed', {
          documents: results.length,
          indexed: results.filter(
            (result) => result.status === DocumentRagIndexStatus.INDEXED,
          ).length,
          failed: results.filter(
            (result) => result.status === DocumentRagIndexStatus.FAILED,
          ).length,
          noContent: results.filter(
            (result) => result.status === DocumentRagIndexStatus.NO_CONTENT,
          ).length,
          totalChunks: results.reduce(
            (sum, result) => sum + (result.chunks_created ?? 0),
            0,
          ),
          durationMs: Date.now() - startedAt,
        }),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Document AI reindex failed.';

      this.logger.warn(
        formatSafeLogEvent('rag_reindex_batch_failed', {
          documents: payloads.length,
          durationMs: Date.now() - startedAt,
          ...safeErrorFields(error),
        }),
      );
      await Promise.all(
        payloads.map((payload) =>
          this.applyRagIngestResult(
            payload.document_id,
            DocumentRagIndexStatus.FAILED,
            0,
            message.slice(0, 1000),
          ).catch(() => undefined),
        ),
      );
    }
  }

  private isRagIndexCurrent(
    document: DocumentRecord,
    index: RagIndexRecord,
  ): boolean {
    const latestVersion = document.versions[0] ?? null;
    const latestVersionNumber = latestVersion?.versionNumber ?? 1;
    const isTerminalCurrentStatus =
      index.status === DocumentRagIndexStatus.INDEXED ||
      index.status === DocumentRagIndexStatus.NO_CONTENT;

    return (
      isTerminalCurrentStatus &&
      index.versionNumber === latestVersionNumber &&
      (latestVersion?.id ? index.versionId === latestVersion.id : true) &&
      index.embeddingModel === this.ragOrchestrator.getEmbeddingModel()
    );
  }

  private toRagStatusView(
    document: DocumentRecord,
    index: RagIndexRecord | undefined,
  ): RagDocumentStatusView {
    const status = index?.status ?? 'NOT_INDEXED';

    return {
      documentId: document.id,
      status,
      chunksCount: index?.chunksCount ?? 0,
      progress: this.resolveRagStatusProgress(status),
      message: this.resolveRagStatusMessage(status, index),
      errorMessage: index?.errorMessage ?? null,
      indexedAt: index?.indexedAt ?? null,
      updatedAt: index?.updatedAt ?? null,
    };
  }

  private resolveRagStatusProgress(
    status: DocumentRagIndexStatus | 'NOT_INDEXED',
  ): number {
    if (status === DocumentRagIndexStatus.INDEXED) return 100;
    if (status === DocumentRagIndexStatus.NO_CONTENT) return 100;
    if (status === DocumentRagIndexStatus.FAILED) return 100;
    if (status === DocumentRagIndexStatus.INDEXING) return 55;
    if (status === DocumentRagIndexStatus.PENDING) return 15;

    return 0;
  }

  private resolveRagStatusMessage(
    status: DocumentRagIndexStatus | 'NOT_INDEXED',
    index: RagIndexRecord | undefined,
  ): string {
    if (status === DocumentRagIndexStatus.INDEXED) {
      return `Ready for Ask AI${
        index?.chunksCount ? ` · ${index.chunksCount} chunk(s)` : ''
      }`;
    }
    if (status === DocumentRagIndexStatus.INDEXING) {
      return 'Extracting text and building the search index.';
    }
    if (status === DocumentRagIndexStatus.PENDING) {
      return 'Queued for indexing.';
    }
    if (status === DocumentRagIndexStatus.NO_CONTENT) {
      return 'No readable text was found in this file.';
    }
    if (status === DocumentRagIndexStatus.FAILED) {
      return index?.errorMessage ?? 'Indexing failed. Reindex this file.';
    }

    return 'Not indexed yet.';
  }

  private async applyRagIngestResult(
    documentId: string,
    status: DocumentRagIndexStatus | keyof typeof DocumentRagIndexStatus,
    chunksCount: number,
    errorMessage: string | null,
  ): Promise<void> {
    await this.prisma.documentRagIndex.update({
      where: { documentId },
      data: {
        status,
        chunksCount,
        errorMessage,
        indexedAt:
          status === DocumentRagIndexStatus.INDEXED ||
          status === DocumentRagIndexStatus.NO_CONTENT
            ? new Date()
            : null,
      },
    });
  }

  private toRagIngestPayload(document: DocumentRecord): RagIngestPayload {
    const latestVersion = document.versions[0] ?? null;

    return {
      document_id: document.id,
      organization_id: document.organizationId,
      version_id: latestVersion?.id ?? null,
      version_number: latestVersion?.versionNumber ?? 1,
      document_name: document.name,
      file_type: document.extension,
      storage_bucket: document.storageBucket,
      storage_key: document.storageKey,
      uploaded_by_id: document.createdByUserId,
    };
  }

  private async stageValidatedFiles(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    files: Array<{
      file: ValidatedDocumentBuffer;
      sourceArchiveName: string | null;
      sourceArchivePath: string | null;
    }>,
  ): Promise<UploadSessionView> {
    if (files.length === 0) {
      throw new BadRequestException('Upload at least one file.');
    }

    if (files.length > this.validationService.getLimits().maxFilesPerBatch) {
      throw new BadRequestException(
        `Upload a maximum of ${this.validationService.getLimits().maxFilesPerBatch} files at a time.`,
      );
    }

    const session = await this.prisma.documentUploadSession.create({
      data: {
        organizationId,
        createdByUserId: principal.userId,
        expiresAt: new Date(
          Date.now() +
            this.validationService.getLimits().stagingTtlSeconds * 1000,
        ),
      },
      select: {
        id: true,
      },
    });
    const storedObjects: StoredObjectReference[] = [];

    try {
      for (const [index, entry] of files.entries()) {
        const stagedFileId = randomUUID();
        const { metadata, preview } = this.previewService.extractPreview(
          entry.file,
        );
        const storageKey = this.storageService.buildStagingKey({
          organizationId,
          sessionId: session.id,
          fileId: stagedFileId,
          filename: entry.file.originalFilename,
        });
        const storedObject = await this.storageService.putObject(
          storageKey,
          entry.file.buffer,
          {
            'content-type': entry.file.mimeType,
          },
        );
        storedObjects.push(storedObject);

        await this.prisma.documentUploadStagedFile.create({
          data: {
            id: stagedFileId,
            uploadSessionId: session.id,
            position: index,
            originalFilename: entry.file.originalFilename,
            extension: entry.file.extension,
            mimeType: entry.file.mimeType,
            sizeBytes: entry.file.sizeBytes,
            checksumSha256: entry.file.checksumSha256,
            storageBucket: storedObject.bucket,
            storageKey: storedObject.key,
            metadata,
            preview,
            sourceArchiveName: entry.sourceArchiveName,
            sourceArchivePath: entry.sourceArchivePath,
          },
        });
      }

      return this.getUploadSession(organizationId, session.id, principal);
    } catch (error: unknown) {
      await this.storageService
        .removeObjects(storedObjects)
        .catch(() => undefined);
      await this.prisma.documentUploadSession
        .update({
          where: { id: session.id },
          data: { status: DocumentUploadSessionStatus.CANCELED },
        })
        .catch(() => undefined);

      throw error;
    }
  }

  private async findOwnedUploadSession(
    organizationId: string,
    sessionId: string,
    userId: string,
  ): Promise<UploadSessionRecord> {
    const session = await this.prisma.documentUploadSession.findFirst({
      where: {
        id: sessionId,
        organizationId,
        createdByUserId: userId,
      },
      select: uploadSessionSelect,
    });

    if (!session) {
      throw new NotFoundException('Upload session not found.');
    }

    return session;
  }

  private async assertPendingOwnedUploadSession(
    organizationId: string,
    sessionId: string,
    userId: string,
  ): Promise<UploadSessionRecord> {
    const session = await this.findOwnedUploadSession(
      organizationId,
      sessionId,
      userId,
    );

    if (session.status !== DocumentUploadSessionStatus.PENDING) {
      throw new ConflictException('This upload session is not pending.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.documentUploadSession.update({
        where: { id: session.id },
        data: { status: DocumentUploadSessionStatus.EXPIRED },
      });

      throw new GoneException('This upload session has expired.');
    }

    return session;
  }

  private async buildOrganizationDocumentWhere(
    organizationId: string,
    userId: string,
    access: OrganizationAccess,
    query: ListDocumentsQueryDto,
  ): Promise<Prisma.DocumentWhereInput> {
    const search = query.search?.trim();
    const updatedAt = this.resolveUpdatedAtFilter(query.updatedRange);
    const actorTier = await this.resolveActorDocumentTier(
      organizationId,
      userId,
      access,
    );
    const visibleCreatorUserIds =
      await this.resolveVisibleDocumentCreatorUserIds(
        organizationId,
        userId,
        actorTier,
      );
    const filters: Prisma.DocumentWhereInput[] = [
      { organizationId },
      query.view === 'trash'
        ? {
            status: DocumentStatus.SOFT_DELETED_BY_USER,
            createdByUserId: { in: visibleCreatorUserIds },
            ...(actorTier <= DOCUMENT_ROLE_TIER.employee
              ? { userDeletedByUserId: userId }
              : {}),
          }
        : {
            status: DocumentStatus.ACTIVE,
            createdByUserId: { in: visibleCreatorUserIds },
          },
    ];

    if (search) {
      filters.push({
        OR: [
          {
            name: { contains: search, mode: Prisma.QueryMode.insensitive },
          },
          {
            originalFilename: {
              contains: search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            createdBy: {
              is: {
                email: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
          },
          {
            createdBy: {
              is: {
                name: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
          },
        ],
      });
    }

    if (updatedAt) {
      filters.push({ updatedAt });
    }

    if (query.ragStatus) {
      const ragStatusWhere = this.resolveDocumentRagStatusFilter(
        query.ragStatus,
      );

      if (ragStatusWhere) {
        filters.push(ragStatusWhere);
      }
    }

    if (query.knowledgeBaseId) {
      filters.push({
        knowledgeBases: {
          some: {
            knowledgeBaseId: query.knowledgeBaseId,
            knowledgeBase: {
              organizationId,
              status: KnowledgeBaseStatus.ACTIVE,
            },
          },
        },
      });
    }

    if (query.collectionId) {
      filters.push({
        collections: {
          some: {
            collectionId: query.collectionId,
            collection: {
              organizationId,
            },
          },
        },
      });
    }

    if (query.categoryId) {
      filters.push({
        categoryLinks: {
          some: {
            categoryId: query.categoryId,
            category: {
              organizationId,
            },
          },
        },
      });
    }

    if (query.tagId) {
      filters.push({
        tags: {
          some: {
            tagId: query.tagId,
            tag: {
              organizationId,
            },
          },
        },
      });
    }

    return { AND: filters };
  }

  private resolveDocumentRagStatusFilter(
    ragStatus: NonNullable<ListDocumentsQueryDto['ragStatus']>,
  ): Prisma.DocumentWhereInput | null {
    if (ragStatus === 'ready') {
      return {
        ragIndex: {
          is: {
            status: DocumentRagIndexStatus.INDEXED,
          },
        },
      };
    }

    if (ragStatus === 'preparing') {
      return {
        ragIndex: {
          is: {
            status: {
              in: [
                DocumentRagIndexStatus.PENDING,
                DocumentRagIndexStatus.INDEXING,
              ],
            },
          },
        },
      };
    }

    if (ragStatus === 'needs_attention') {
      return {
        ragIndex: {
          is: {
            status: DocumentRagIndexStatus.FAILED,
          },
        },
      };
    }

    if (ragStatus === 'no_readable_text') {
      return {
        ragIndex: {
          is: {
            status: DocumentRagIndexStatus.NO_CONTENT,
          },
        },
      };
    }

    return null;
  }

  private buildPlatformDocumentWhere(
    query: ListPlatformDocumentsQueryDto,
  ): Prisma.DocumentWhereInput {
    const search = query.search?.trim();
    const updatedAt = this.resolveUpdatedAtFilter(query.updatedRange);

    return {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.status
        ? { status: query.status }
        : { status: { not: DocumentStatus.PURGED } }),
      ...(updatedAt ? { updatedAt } : {}),
      ...(search
        ? {
            OR: [
              {
                name: { contains: search, mode: Prisma.QueryMode.insensitive },
              },
              {
                originalFilename: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                createdBy: {
                  is: {
                    email: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                createdBy: {
                  is: {
                    name: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                organization: {
                  is: {
                    name: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private resolveUpdatedAtFilter(
    updatedRange?: keyof typeof UPDATED_RANGE_DAYS,
  ): Prisma.DateTimeFilter | undefined {
    if (!updatedRange) {
      return undefined;
    }

    const days = UPDATED_RANGE_DAYS[updatedRange];

    return {
      gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    };
  }

  private resolveDocumentOrderBy(
    sort?: 'newest' | 'oldest',
  ): Prisma.DocumentOrderByWithRelationInput[] {
    return [{ updatedAt: sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }];
  }

  private async findReadableOrganizationDocument(
    organizationId: string,
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<{ access: OrganizationAccess; document: DocumentRecord }> {
    const access = await this.resolveOrganizationAccessOrThrow(
      principal.userId,
      organizationId,
    );
    const document = await this.findOrganizationDocumentRecord(
      organizationId,
      documentId,
    );

    if (
      !(await this.canReadDocument(
        organizationId,
        document,
        access,
        principal.userId,
      ))
    ) {
      throw new NotFoundException('Document not found.');
    }

    return { access, document };
  }

  private async findOrganizationDocumentRecord(
    organizationId: string,
    documentId: string,
  ): Promise<DocumentRecord> {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId,
        status: {
          not: DocumentStatus.PURGED,
        },
      },
      select: documentSelect,
    });

    if (!document) {
      throw new NotFoundException('Document not found.');
    }

    return document;
  }

  private async findPlatformDocumentRecord(
    documentId: string,
    includeAllVersions = false,
  ): Promise<
    DocumentRecord & {
      versions: Array<
        DocumentRecord['versions'][number] & {
          storageBucket?: string;
          storageKey?: string;
        }
      >;
    }
  > {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: includeAllVersions
        ? ({
            ...documentSelect,
            versions: {
              orderBy: {
                versionNumber: 'desc',
              },
              select: {
                id: true,
                versionNumber: true,
                name: true,
                originalFilename: true,
                extension: true,
                mimeType: true,
                sizeBytes: true,
                checksumSha256: true,
                storageBucket: true,
                storageKey: true,
                metadata: true,
                preview: true,
                createdAt: true,
                createdBy: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          } as const)
        : documentSelect,
    });

    if (!document) {
      throw new NotFoundException('Document not found.');
    }

    return document as DocumentRecord & {
      versions: Array<
        DocumentRecord['versions'][number] & {
          storageBucket?: string;
          storageKey?: string;
        }
      >;
    };
  }

  private async canReadDocument(
    organizationId: string,
    document: DocumentRecord,
    access: OrganizationAccess,
    userId: string,
  ): Promise<boolean> {
    if (document.status === DocumentStatus.PURGED) {
      return false;
    }

    if (document.status === DocumentStatus.SOFT_DELETED_BY_ORG) {
      return false;
    }

    if (
      document.status === DocumentStatus.SOFT_DELETED_BY_USER &&
      document.createdByUserId === userId &&
      document.userDeletedBy?.id &&
      document.userDeletedBy.id !== userId &&
      (await this.resolveActorDocumentTier(organizationId, userId, access)) <=
        DOCUMENT_ROLE_TIER.employee
    ) {
      return false;
    }

    return this.canReachDocumentByHierarchy(
      organizationId,
      document.createdByUserId,
      access,
      userId,
    );
  }

  private async resolveDeleteDecision(
    organizationId: string,
    document: DocumentRecord,
    access: OrganizationAccess,
    actorUserId: string,
  ): Promise<{ allowed: boolean; organizationLevel: boolean }> {
    const actorTier = await this.resolveActorDocumentTier(
      organizationId,
      actorUserId,
      access,
    );
    const creatorTier = await this.resolveUserDocumentTier(
      organizationId,
      document.createdByUserId,
    );
    const isOwnDocument = document.createdByUserId === actorUserId;

    if (actorTier === DOCUMENT_ROLE_TIER.platform) {
      return { allowed: true, organizationLevel: true };
    }

    if (isOwnDocument) {
      return {
        allowed: true,
        organizationLevel: actorTier >= DOCUMENT_ROLE_TIER.organizationAdmin,
      };
    }

    if (actorTier > creatorTier && actorTier >= DOCUMENT_ROLE_TIER.manager) {
      return {
        allowed: true,
        organizationLevel: actorTier >= DOCUMENT_ROLE_TIER.organizationAdmin,
      };
    }

    return { allowed: false, organizationLevel: false };
  }

  private async canReachDocumentByHierarchy(
    organizationId: string,
    creatorUserId: string,
    access: OrganizationAccess,
    actorUserId: string,
  ): Promise<boolean> {
    const actorTier = await this.resolveActorDocumentTier(
      organizationId,
      actorUserId,
      access,
    );

    if (actorTier === DOCUMENT_ROLE_TIER.platform) {
      return true;
    }

    if (creatorUserId === actorUserId) {
      return true;
    }

    const creatorTier = await this.resolveUserDocumentTier(
      organizationId,
      creatorUserId,
    );

    return actorTier > creatorTier;
  }

  private async resolveVisibleDocumentCreatorUserIds(
    organizationId: string,
    actorUserId: string,
    actorTier: DocumentRoleTier,
  ): Promise<string[]> {
    if (actorTier === DOCUMENT_ROLE_TIER.platform) {
      const creators = await this.prisma.document.findMany({
        where: {
          organizationId,
          status: { not: DocumentStatus.PURGED },
        },
        distinct: ['createdByUserId'],
        select: { createdByUserId: true },
      });

      return creators.map(({ createdByUserId }) => createdByUserId);
    }

    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId,
        status: { not: OrganizationMembershipStatus.REMOVED },
      },
      select: {
        userId: true,
        roles: this.documentRoleAssignmentsSelect(organizationId),
      },
    });
    const visibleUserIds = new Set<string>([actorUserId]);
    const usersWithMembership = new Set<string>();

    for (const membership of memberships) {
      usersWithMembership.add(membership.userId);

      if (membership.userId === actorUserId) {
        continue;
      }

      const creatorTier = this.getDocumentTierFromAssignments(membership.roles);

      if (actorTier > creatorTier) {
        visibleUserIds.add(membership.userId);
      }
    }

    if (actorTier > DOCUMENT_ROLE_TIER.employee) {
      const documentCreators = await this.prisma.document.findMany({
        where: {
          organizationId,
          status: { not: DocumentStatus.PURGED },
        },
        distinct: ['createdByUserId'],
        select: { createdByUserId: true },
      });

      for (const { createdByUserId } of documentCreators) {
        if (!usersWithMembership.has(createdByUserId)) {
          visibleUserIds.add(createdByUserId);
        }
      }
    }

    return [...visibleUserIds].sort((left, right) => left.localeCompare(right));
  }

  private async resolveActorDocumentTier(
    organizationId: string,
    actorUserId: string,
    access: OrganizationAccess,
  ): Promise<DocumentRoleTier> {
    if (access.roles.some((role) => role.scope === AccessScope.PLATFORM)) {
      return DOCUMENT_ROLE_TIER.platform;
    }

    return this.resolveUserDocumentTier(organizationId, actorUserId);
  }

  private async resolveUserDocumentTier(
    organizationId: string,
    userId: string,
  ): Promise<DocumentRoleTier> {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        status: { not: OrganizationMembershipStatus.REMOVED },
      },
      select: {
        roles: this.documentRoleAssignmentsSelect(organizationId),
      },
    });

    if (!membership) {
      return DOCUMENT_ROLE_TIER.employee;
    }

    return this.getDocumentTierFromAssignments(membership.roles);
  }

  private getDocumentTierFromAssignments(
    assignments: DocumentRoleAssignmentRecord[],
  ): DocumentRoleTier {
    if (assignments.length === 0) {
      return DOCUMENT_ROLE_TIER.employee;
    }

    return assignments.reduce<DocumentRoleTier>(
      (highestTier, assignment) =>
        Math.max(
          highestTier,
          this.getDocumentTierFromRole(assignment.role),
        ) as DocumentRoleTier,
      DOCUMENT_ROLE_TIER.none,
    );
  }

  private getDocumentTierFromRole(
    role: DocumentRoleAssignmentRecord['role'],
  ): DocumentRoleTier {
    if (role.scope === AccessScope.PLATFORM) {
      return DOCUMENT_ROLE_TIER.platform;
    }

    if (role.systemKey === ORGANIZATION_ROLE_KEYS.organizationAdmin) {
      return DOCUMENT_ROLE_TIER.organizationAdmin;
    }

    if (role.systemKey === ORGANIZATION_ROLE_KEYS.manager) {
      return DOCUMENT_ROLE_TIER.manager;
    }

    if (role.systemKey === ORGANIZATION_ROLE_KEYS.employee) {
      return DOCUMENT_ROLE_TIER.employee;
    }

    const permissionCodes = new Set(
      role.permissions.map(({ permission }) => permission.code),
    );

    if (
      permissionCodes.has(ORGANIZATION_PERMISSIONS.membersManage) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.rolesManage) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.permissionsAssign) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsDelete)
    ) {
      return DOCUMENT_ROLE_TIER.organizationAdmin;
    }

    if (permissionCodes.has(ORGANIZATION_PERMISSIONS.analyticsView)) {
      return DOCUMENT_ROLE_TIER.manager;
    }

    if (
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsRead) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsCreate) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsUpdate) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsUpload) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.aiAccess)
    ) {
      return DOCUMENT_ROLE_TIER.employee;
    }

    return DOCUMENT_ROLE_TIER.none;
  }

  private documentRoleAssignmentsSelect(organizationId: string) {
    return {
      where: {
        role: {
          is: {
            scope: AccessScope.ORGANIZATION,
            isActive: true,
            OR: [{ organizationId: null }, { organizationId }],
          },
        },
      },
      select: {
        role: {
          select: {
            systemKey: true,
            scope: true,
            permissions: {
              where: {
                permission: {
                  is: {
                    scope: AccessScope.ORGANIZATION,
                    isActive: true,
                  },
                },
              },
              select: {
                permission: {
                  select: {
                    code: true,
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  private async canModifyDocument(
    organizationId: string,
    document: DocumentRecord,
    access: OrganizationAccess,
    userId: string,
  ): Promise<boolean> {
    if (document.status !== DocumentStatus.ACTIVE) {
      return false;
    }

    return this.canReachDocumentByHierarchy(
      organizationId,
      document.createdByUserId,
      access,
      userId,
    );
  }

  private canReadAllDocuments(access: OrganizationAccess): boolean {
    return (
      this.canManageAllDocuments(access) ||
      hasPermission(access, ORGANIZATION_PERMISSIONS.membersManage)
    );
  }

  private canManageAllDocuments(access: OrganizationAccess): boolean {
    return (
      hasPermission(access, ORGANIZATION_PERMISSIONS.documentsDelete) ||
      access.roles.some((role) => role.scope === AccessScope.PLATFORM)
    );
  }

  private async assertCanReceiveDocumentAccess(
    organizationId: string,
    targetUserId: string,
  ): Promise<void> {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
      select: {
        status: true,
      },
    });

    if (
      !membership ||
      membership.status !== OrganizationMembershipStatus.ACTIVE
    ) {
      throw new NotFoundException(
        'Document access can be granted only to an active member of this organization.',
      );
    }

    const targetAccess =
      await this.accessControlService.resolveOrganizationAccess(
        targetUserId,
        organizationId,
      );

    if (
      !targetAccess?.permissions.includes(
        ORGANIZATION_PERMISSIONS.documentsRead,
      )
    ) {
      throw new ConflictException(
        'This user does not have document read permission.',
      );
    }
  }

  private async resolveOrganizationAccessOrThrow(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationAccess> {
    const access = await this.accessControlService.resolveOrganizationAccess(
      userId,
      organizationId,
    );

    if (!access) {
      throw new ForbiddenException('Organization access is required.');
    }

    return access;
  }

  private async toStreamResult(
    document: DocumentRecord,
  ): Promise<DocumentStreamResult> {
    return {
      stream: await this.storageService.getObject(
        document.storageBucket,
        document.storageKey,
      ),
      filename: document.originalFilename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    };
  }

  private toDocumentView(document: DocumentRecord): DocumentView {
    return {
      id: document.id,
      organizationId: document.organizationId,
      organization: document.organization,
      name: document.name,
      originalFilename: document.originalFilename,
      extension: document.extension,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      checksumSha256: document.checksumSha256,
      status: document.status,
      createdBy: toUserSnapshot(document.createdBy)!,
      userDeletedBy: toUserSnapshot(document.userDeletedBy),
      userDeletedAt: document.userDeletedAt,
      orgDeletedBy: toUserSnapshot(document.orgDeletedBy),
      orgDeletedAt: document.orgDeletedAt,
      restoredBy: toUserSnapshot(document.restoredBy),
      restoredAt: document.restoredAt,
      purgedBy: toUserSnapshot(document.purgedBy),
      purgedAt: document.purgedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      latestVersion: document.versions[0]
        ? this.toVersionView(document.versions[0])
        : null,
      accessGrants: document.accessGrants.map((grant) =>
        this.toAccessGrantView(grant),
      ),
      knowledgeBases: document.knowledgeBases.map((link) => ({
        id: link.knowledgeBase.id,
        name: link.knowledgeBase.name,
        slug: link.knowledgeBase.slug,
        folder: link.folder,
      })),
      collections: document.collections.map((link) => link.collection),
      category: document.categoryLinks[0]?.category ?? null,
      tags: document.tags.map((link) => link.tag),
    };
  }

  private toVersionView(version: DocumentVersionRecord): DocumentVersionView {
    return {
      id: version.id,
      documentId: version.documentId,
      organizationId: version.organizationId,
      versionNumber: version.versionNumber,
      name: version.name,
      originalFilename: version.originalFilename,
      extension: version.extension,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      checksumSha256: version.checksumSha256,
      metadata: version.metadata,
      preview: version.preview,
      createdBy: toUserSnapshot(version.createdBy)!,
      createdAt: version.createdAt,
    };
  }

  private toAccessGrantView(grant: {
    id: string;
    userId: string;
    accessLevel: DocumentAccessLevel;
    createdAt: Date;
    user: {
      id: string;
      name: string | null;
      email: string;
    };
    grantedBy: {
      id: string;
      name: string | null;
      email: string;
    };
  }): DocumentAccessGrantView {
    return {
      id: grant.id,
      userId: grant.userId,
      accessLevel: grant.accessLevel,
      createdAt: grant.createdAt,
      user: toUserSnapshot(grant.user)!,
      grantedBy: toUserSnapshot(grant.grantedBy)!,
    };
  }

  private toUploadSessionView(session: UploadSessionRecord): UploadSessionView {
    return {
      id: session.id,
      organizationId: session.organizationId,
      createdByUserId: session.createdByUserId,
      status: session.status,
      expiresAt: session.expiresAt,
      committedAt: session.committedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      files: session.files.map((file) => ({
        id: file.id,
        position: file.position,
        originalFilename: file.originalFilename,
        extension: file.extension,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        metadata: file.metadata,
        preview: file.preview,
        status: file.status,
        rejectionReason: file.rejectionReason,
        sourceArchiveName: file.sourceArchiveName,
        sourceArchivePath: file.sourceArchivePath,
        createdAt: file.createdAt,
      })),
    };
  }
}
