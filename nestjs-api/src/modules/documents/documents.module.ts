import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentArchiveService } from './document-archive.service';
import { DocumentPreviewService } from './document-preview.service';
import { DocumentStorageService } from './document-storage.service';
import { DocumentUploadJobsService } from './document-upload-jobs.service';
import { DocumentValidationService } from './document-validation.service';
import {
  OrganizationDocumentsController,
  PlatformDocumentsController,
} from './documents.controller';
import { DocumentsService } from './documents.service';
import { RagOrchestratorService } from './rag-orchestrator.service';

@Module({
  imports: [AccessControlModule, PrismaModule],
  controllers: [OrganizationDocumentsController, PlatformDocumentsController],
  providers: [
    DocumentArchiveService,
    DocumentPreviewService,
    DocumentStorageService,
    DocumentUploadJobsService,
    DocumentValidationService,
    DocumentsService,
    RagOrchestratorService,
  ],
  exports: [DocumentStorageService, DocumentsService, RagOrchestratorService],
})
export class DocumentsModule {}
