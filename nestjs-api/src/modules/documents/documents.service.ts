import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccessScope,
  DocumentAccessLevel,
  DocumentStagedFileStatus,
  DocumentStatus,
  DocumentUploadSessionStatus,
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
import { PrismaService } from '../prisma/prisma.service';
import type {
  ExtractedArchiveFile,
  ZipManifestView,
} from './document-archive.service';
import { DocumentArchiveService } from './document-archive.service';
import { DocumentPreviewService } from './document-preview.service';
import {
  DocumentStorageService,
  StoredObjectReference,
} from './document-storage.service';
import {
  DocumentValidationService,
  ValidatedDocumentBuffer,
} from './document-validation.service';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { ListPlatformDocumentsQueryDto } from './dto/list-platform-documents-query.dto';

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

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: DocumentStorageService,
    private readonly validationService: DocumentValidationService,
    private readonly previewService: DocumentPreviewService,
    private readonly archiveService: DocumentArchiveService,
    private readonly accessControlService: AccessControlService,
    private readonly envSuperAdminService: EnvSuperAdminService,
  ) {}

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
  ): Promise<CommitUploadSessionResult> {
    const session = await this.assertPendingOwnedUploadSession(
      organizationId,
      sessionId,
      principal.userId,
    );
    const readyFiles = session.files.filter(
      (file) => file.status === DocumentStagedFileStatus.READY,
    );

    if (readyFiles.length === 0) {
      throw new ConflictException('There are no staged files to commit.');
    }

    const documents: DocumentView[] = [];
    const warnings: CommitUploadSessionResult['warnings'] = [];
    const newObjectReferences: StoredObjectReference[] = [];

    try {
      for (const stagedFile of readyFiles) {
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
            createdByUserId: principal.userId,
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
                createdByUserId: principal.userId,
              },
            },
          },
          select: documentSelect,
        });

        documents.push(this.toDocumentView(document));
      }
    } catch (error: unknown) {
      await this.storageService
        .removeObjects(newObjectReferences)
        .catch(() => undefined);

      throw error;
    }

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

    await this.storageService
      .removeObjects(
        readyFiles.map((file) => ({
          bucket: file.storageBucket,
          key: file.storageKey,
        })),
      )
      .catch(() => undefined);

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
    const [total, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        select: documentSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
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

  async listPlatformDocuments(
    query: ListPlatformDocumentsQueryDto,
  ): Promise<DocumentListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildPlatformDocumentWhere(query);
    const [total, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        select: documentSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
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

    const latestVersion = document.versions[0] ?? null;

    if (!latestVersion?.preview) {
      return null;
    }

    return {
      ...(latestVersion.preview as Record<string, unknown>),
      contentPath: `/organizations/${organizationId}/documents/${documentId}/content`,
    } as Prisma.JsonValue;
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

    return this.toDocumentView(updatedDocument);
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

    return { AND: filters };
  }

  private buildPlatformDocumentWhere(
    query: ListPlatformDocumentsQueryDto,
  ): Prisma.DocumentWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.status
        ? { status: query.status }
        : { status: { not: DocumentStatus.PURGED } }),
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
