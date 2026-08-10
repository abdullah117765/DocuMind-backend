import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyOrganizationPermission,
  RequireOrganizationPermissions,
  RequirePlatformSuperAdmin,
} from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { OrganizationIdDto } from '../access-control/dto/organization-id.dto';
import { ORGANIZATION_PERMISSIONS } from '../access-control/rbac.constants';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { DocumentAccessIdDto } from './dto/document-access-id.dto';
import { DocumentIdDto } from './dto/document-id.dto';
import { DocumentStagedFileIdDto } from './dto/document-staged-file-id.dto';
import { DocumentUploadSessionIdDto } from './dto/document-upload-session-id.dto';
import { GrantDocumentAccessDto } from './dto/grant-document-access.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { ListPlatformDocumentsQueryDto } from './dto/list-platform-documents-query.dto';
import { PlatformDocumentIdDto } from './dto/platform-document-id.dto';
import { RagQueryDto, RagReindexDto } from './dto/rag-query.dto';
import { StageZipArchiveDto } from './dto/stage-zip-archive.dto';
import {
  CommitUploadSessionResult,
  DocumentListResult,
  DocumentStreamResult,
  DocumentView,
  DocumentVersionView,
  DocumentsService,
  RagAskView,
  RagDocumentStatusView,
  RagSearchView,
  UploadSessionView,
} from './documents.service';

const CSRF_HEADER = {
  name: 'x-csrf-token',
  required: true,
  description: 'Token returned by GET /auth/csrf',
} as const;

const FILE_UPLOAD_OPTIONS = {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 8,
  },
};

const SINGLE_FILE_UPLOAD_OPTIONS = {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
};

interface DocumentListResponse {
  data: DocumentListResult;
}

interface DocumentResponse {
  data: {
    document: DocumentView;
  };
}

interface UploadSessionResponse {
  data: {
    uploadSession: UploadSessionView;
  };
}

interface ZipManifestResponse {
  data: ReturnType<DocumentsService['getZipManifest']>;
}

interface CommitUploadSessionResponse {
  data: CommitUploadSessionResult;
}

interface PreviewResponse {
  data: {
    preview: unknown;
  };
}

interface DocumentVersionsResponse {
  data: {
    versions: DocumentVersionView[];
  };
}

interface RagSearchResponse {
  data: RagSearchView;
}

interface RagAskResponse {
  data: RagAskView;
}

interface RagStatusResponse {
  data: {
    documents: RagDocumentStatusView[];
  };
}

interface ActionResponse {
  message: string;
}

function setStreamHeaders(
  response: Response,
  result: DocumentStreamResult,
  disposition: 'inline' | 'attachment',
): void {
  const safeFilename = result.filename.replace(/["\\]/g, '_');

  response.setHeader('Content-Type', result.mimeType);
  response.setHeader('Content-Length', String(result.sizeBytes));
  response.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
  );
}

function streamFile(
  response: Response,
  result: DocumentStreamResult,
  disposition: 'inline' | 'attachment',
): void {
  setStreamHeaders(response, result, disposition);
  result.stream.pipe(response);
}

@ApiTags('Organization Documents')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({
  description: 'Access token is missing, invalid, or expired',
})
@ApiForbiddenResponse({
  description: 'The user does not have the required organization permission',
})
@Controller('organizations/:organizationId/documents')
export class OrganizationDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('zip-manifest')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @UseInterceptors(FileInterceptor('archive', SINGLE_FILE_UPLOAD_OPTIONS))
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpload)
  @ApiHeader(CSRF_HEADER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['archive'],
      properties: {
        archive: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Review ZIP contents before staging selected files',
  })
  @ApiOkResponse({ description: 'ZIP manifest with selectable entries' })
  getZipManifest(
    @UploadedFile() archive: Express.Multer.File,
  ): ZipManifestResponse {
    return {
      data: this.documentsService.getZipManifest(archive),
    };
  }

  @Post('stage')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @UseInterceptors(FilesInterceptor('files', 8, FILE_UPLOAD_OPTIONS))
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpload)
  @ApiHeader(CSRF_HEADER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Stage up to 8 files for preview before final upload',
  })
  async stageFiles(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<UploadSessionResponse> {
    return {
      data: {
        uploadSession: await this.documentsService.stageFiles(
          params.organizationId,
          principal,
          files,
        ),
      },
    };
  }

  @Post('stage-zip')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @UseInterceptors(FileInterceptor('archive', SINGLE_FILE_UPLOAD_OPTIONS))
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpload)
  @ApiHeader(CSRF_HEADER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['archive', 'selectedPaths'],
      properties: {
        archive: {
          type: 'string',
          format: 'binary',
        },
        selectedPaths: {
          description: 'JSON array of paths returned from zip-manifest',
          type: 'string',
          example: '["reports/q1.pdf","notes/summary.txt"]',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Stage selected files from a reviewed ZIP archive',
  })
  async stageZipArchive(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @UploadedFile() archive: Express.Multer.File | undefined,
    @Body() dto: StageZipArchiveDto,
  ): Promise<UploadSessionResponse> {
    return {
      data: {
        uploadSession: await this.documentsService.stageZipArchive(
          params.organizationId,
          principal,
          archive,
          dto.selectedPaths,
        ),
      },
    };
  }

  @Get('stage/:sessionId')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpload)
  @ApiOperation({ summary: 'Get a pending upload session and staged previews' })
  async getUploadSession(
    @Param() params: DocumentUploadSessionIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<UploadSessionResponse> {
    return {
      data: {
        uploadSession: await this.documentsService.getUploadSession(
          params.organizationId,
          params.sessionId,
          principal,
        ),
      },
    };
  }

  @Get('stage/:sessionId/files/:fileId/content')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpload)
  @ApiOperation({ summary: 'Preview a staged file inline before committing' })
  async getStagedFileContent(
    @Param() params: DocumentStagedFileIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res() response: Response,
  ): Promise<void> {
    streamFile(
      response,
      await this.documentsService.getStagedFileContent(
        params.organizationId,
        params.sessionId,
        params.fileId,
        principal,
      ),
      'inline',
    );
  }

  @Delete('stage/:sessionId/files/:fileId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpload)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Remove a staged file before final upload' })
  async removeStagedFile(
    @Param() params: DocumentStagedFileIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<UploadSessionResponse> {
    return {
      data: {
        uploadSession: await this.documentsService.removeStagedFile(
          params.organizationId,
          params.sessionId,
          params.fileId,
          principal,
        ),
      },
    };
  }

  @Post('stage/:sessionId/commit')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpload)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Commit staged files as organization documents' })
  async commitUploadSession(
    @Param() params: DocumentUploadSessionIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<CommitUploadSessionResponse> {
    return {
      data: await this.documentsService.commitUploadSession(
        params.organizationId,
        params.sessionId,
        principal,
      ),
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({ summary: 'List accessible organization documents' })
  async listDocuments(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentListResponse> {
    return {
      data: await this.documentsService.listDocuments(
        params.organizationId,
        principal,
        query,
      ),
    };
  }

  @Post('rag/search')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({
    summary: 'Search hierarchy-accessible documents with RAG',
  })
  async searchRagDocuments(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RagQueryDto,
  ): Promise<RagSearchResponse> {
    return {
      data: await this.documentsService.searchRagDocuments(
        params.organizationId,
        principal,
        dto,
      ),
    };
  }

  @Post('rag/ask')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.documentsRead,
    ORGANIZATION_PERMISSIONS.aiAccess,
  )
  @ApiOperation({
    summary: 'Ask AI from hierarchy-accessible selected documents',
  })
  async askRagDocuments(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RagQueryDto,
  ): Promise<RagAskResponse> {
    return {
      data: await this.documentsService.askRagDocuments(
        params.organizationId,
        principal,
        dto,
      ),
    };
  }

  @Get('rag/status')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({
    summary: 'List RAG indexing status for readable documents',
  })
  async listRagStatuses(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: RagReindexDto,
  ): Promise<RagStatusResponse> {
    return {
      data: {
        documents: await this.documentsService.listRagStatuses(
          params.organizationId,
          principal,
          query,
        ),
      },
    };
  }

  @Post('rag/reindex')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpdate,
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsDelete,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({
    summary: 'Reindex selected organization documents for RAG',
  })
  async reindexRagDocuments(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RagReindexDto,
  ): Promise<RagStatusResponse> {
    return {
      data: {
        documents: await this.documentsService.reindexRagDocuments(
          params.organizationId,
          principal,
          dto,
        ),
      },
    };
  }

  @Get(':documentId')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({ summary: 'Get one accessible organization document' })
  async getDocument(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<DocumentResponse> {
    return {
      data: {
        document: await this.documentsService.getDocument(
          params.organizationId,
          params.documentId,
          principal,
        ),
      },
    };
  }

  @Get(':documentId/preview')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({ summary: 'Get extracted preview data for a document' })
  async getDocumentPreview(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<PreviewResponse> {
    return {
      data: {
        preview: await this.documentsService.getDocumentPreview(
          params.organizationId,
          params.documentId,
          principal,
        ),
      },
    };
  }

  @Get(':documentId/content')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Stream document content inline for preview' })
  async getDocumentContent(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res() response: Response,
  ): Promise<void> {
    streamFile(
      response,
      await this.documentsService.getDocumentContent(
        params.organizationId,
        params.documentId,
        principal,
      ),
      'inline',
    );
  }

  @Get(':documentId/download')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsExport)
  @ApiOperation({ summary: 'Download a document' })
  async downloadDocument(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res() response: Response,
  ): Promise<void> {
    streamFile(
      response,
      await this.documentsService.downloadDocument(
        params.organizationId,
        params.documentId,
        principal,
      ),
      'attachment',
    );
  }

  @Get(':documentId/versions')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({ summary: 'List document version history' })
  async listDocumentVersions(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<DocumentVersionsResponse> {
    return {
      data: {
        versions: await this.documentsService.listDocumentVersions(
          params.organizationId,
          params.documentId,
          principal,
        ),
      },
    };
  }

  @Post(':documentId/versions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @UseInterceptors(FileInterceptor('file', SINGLE_FILE_UPLOAD_OPTIONS))
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a new version of an active document' })
  async uploadDocumentVersion(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<DocumentResponse> {
    return {
      data: {
        document: await this.documentsService.uploadDocumentVersion(
          params.organizationId,
          params.documentId,
          principal,
          file,
        ),
      },
    };
  }

  @Post(':documentId/access')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpdate)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({
    summary: 'Grant preview access to an active organization member',
  })
  async grantDocumentAccess(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: GrantDocumentAccessDto,
  ) {
    return {
      data: {
        accessGrant: await this.documentsService.grantDocumentAccess(
          params.organizationId,
          params.documentId,
          principal,
          dto.userId,
        ),
      },
    };
  }

  @Delete(':documentId/access/:accessId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsUpdate)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Revoke a document preview access grant' })
  async revokeDocumentAccess(
    @Param() params: DocumentAccessIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ActionResponse> {
    await this.documentsService.revokeDocumentAccess(
      params.organizationId,
      params.documentId,
      params.accessId,
      principal,
    );

    return { message: 'Document access revoked.' };
  }

  @Post(':documentId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpdate,
    ORGANIZATION_PERMISSIONS.documentsDelete,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Restore a user-deleted document' })
  async restoreOrganizationDocument(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<DocumentResponse> {
    return {
      data: {
        document: await this.documentsService.restoreOrganizationDocument(
          params.organizationId,
          params.documentId,
          principal,
        ),
      },
    };
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpdate,
    ORGANIZATION_PERMISSIONS.documentsDelete,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({
    summary:
      'Soft-delete a document. User deletion goes to org trash; org deletion goes to platform review.',
  })
  async softDeleteDocument(
    @Param() params: DocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<DocumentResponse> {
    return {
      data: {
        document: await this.documentsService.softDeleteDocument(
          params.organizationId,
          params.documentId,
          principal,
        ),
      },
    };
  }
}

@ApiTags('Platform Documents')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({
  description: 'Access token is missing, invalid, or expired',
})
@ApiForbiddenResponse({
  description: 'The user is not the environment Super Admin',
})
@RequirePlatformSuperAdmin()
@Controller('platform/documents')
export class PlatformDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List documents across organizations for platform review',
  })
  async listPlatformDocuments(
    @Query() query: ListPlatformDocumentsQueryDto,
  ): Promise<DocumentListResponse> {
    return {
      data: await this.documentsService.listPlatformDocuments(query),
    };
  }

  @Get(':documentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one platform-visible document' })
  async getPlatformDocument(
    @Param() params: PlatformDocumentIdDto,
  ): Promise<DocumentResponse> {
    return {
      data: {
        document: await this.documentsService.getPlatformDocument(
          params.documentId,
        ),
      },
    };
  }

  @Get(':documentId/content')
  @HttpCode(HttpStatus.OK)
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Stream a document inline for Super Admin review' })
  async getPlatformDocumentContent(
    @Param() params: PlatformDocumentIdDto,
    @Res() response: Response,
  ): Promise<void> {
    streamFile(
      response,
      await this.documentsService.getPlatformDocumentContent(params.documentId),
      'inline',
    );
  }

  @Post(':documentId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Restore an organization-deleted document' })
  async restorePlatformDocument(
    @Param() params: PlatformDocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<DocumentResponse> {
    return {
      data: {
        document: await this.documentsService.restorePlatformDocument(
          params.documentId,
          principal,
        ),
      },
    };
  }

  @Delete(':documentId/permanent')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({
    summary: 'Permanently purge document content from storage',
  })
  async purgePlatformDocument(
    @Param() params: PlatformDocumentIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<DocumentResponse> {
    return {
      data: {
        document: await this.documentsService.purgePlatformDocument(
          params.documentId,
          principal,
        ),
      },
    };
  }
}
