import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import AdmZip from 'adm-zip';
import path from 'node:path';
import { DOCUMENT_ARCHIVE_EXTENSION } from './documents.constants';
import {
  DocumentValidationService,
  ValidatedDocumentBuffer,
} from './document-validation.service';

export interface ZipManifestEntryView {
  path: string;
  filename: string;
  extension: string | null;
  sizeBytes: number;
  compressedSizeBytes: number;
  selectable: boolean;
  rejectionReason: string | null;
}

export interface ZipManifestView {
  archiveName: string;
  totalEntries: number;
  selectableEntries: number;
  selectedLimit: number;
  maxExpandedBytes: number;
  entries: ZipManifestEntryView[];
}

export interface ExtractedArchiveFile {
  sourceArchiveName: string;
  sourceArchivePath: string;
  file: ValidatedDocumentBuffer;
}

function isEncrypted(entry: AdmZip.IZipEntry): boolean {
  return Boolean(entry.header.flags & 1);
}

function getNormalizedExtension(filename: string): string | null {
  const extension = path.extname(filename).replace('.', '').toLowerCase();

  if (!extension) {
    return null;
  }

  return extension === 'jpg' ? 'jpeg' : extension;
}

@Injectable()
export class DocumentArchiveService {
  constructor(private readonly validationService: DocumentValidationService) {}

  getManifest(archive: Express.Multer.File): ZipManifestView {
    const archiveFile = this.validationService.validateUploadedFile(archive, {
      allowZip: true,
    });

    if (archiveFile.extension !== DOCUMENT_ARCHIVE_EXTENSION) {
      throw new BadRequestException(
        'Upload a ZIP archive for manifest review.',
      );
    }

    const zip = this.openZip(archiveFile.buffer);
    const entries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => this.toManifestEntry(entry));

    const selectableEntries = entries.filter(
      (entry) => entry.selectable,
    ).length;

    return {
      archiveName: archiveFile.originalFilename,
      totalEntries: entries.length,
      selectableEntries,
      selectedLimit: this.validationService.getLimits().maxFilesPerBatch,
      maxExpandedBytes: this.validationService.getLimits().maxZipExpandedBytes,
      entries,
    };
  }

  extractSelectedFiles(
    archive: Express.Multer.File,
    selectedPaths: string[],
  ): ExtractedArchiveFile[] {
    const archiveFile = this.validationService.validateUploadedFile(archive, {
      allowZip: true,
    });

    if (archiveFile.extension !== DOCUMENT_ARCHIVE_EXTENSION) {
      throw new BadRequestException('Upload a ZIP archive to stage ZIP files.');
    }

    const uniqueSelectedPaths = [
      ...new Set(
        selectedPaths.map((entryPath) => entryPath.trim()).filter(Boolean),
      ),
    ];
    const limits = this.validationService.getLimits();

    if (uniqueSelectedPaths.length === 0) {
      throw new BadRequestException('Select at least one ZIP entry to stage.');
    }

    if (uniqueSelectedPaths.length > limits.maxFilesPerBatch) {
      throw new BadRequestException(
        `Select a maximum of ${limits.maxFilesPerBatch} ZIP entries.`,
      );
    }

    for (const selectedPath of uniqueSelectedPaths) {
      this.validationService.assertZipEntryPath(selectedPath);
    }

    const zip = this.openZip(archiveFile.buffer);
    const entriesByPath = new Map(
      zip.getEntries().map((entry) => [entry.entryName, entry]),
    );
    const manifestByPath = new Map(
      zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => [entry.entryName, this.toManifestEntry(entry)]),
    );
    let expandedBytes = 0;

    return uniqueSelectedPaths.map((selectedPath) => {
      const entry = entriesByPath.get(selectedPath);
      const manifestEntry = manifestByPath.get(selectedPath);

      if (!entry || !manifestEntry) {
        throw new BadRequestException(
          `ZIP entry "${selectedPath}" was not found in the archive.`,
        );
      }

      if (!manifestEntry.selectable) {
        throw new BadRequestException(
          `ZIP entry "${selectedPath}" cannot be staged: ${manifestEntry.rejectionReason ?? 'not selectable'}.`,
        );
      }

      expandedBytes += manifestEntry.sizeBytes;

      if (expandedBytes > limits.maxZipExpandedBytes) {
        throw new PayloadTooLargeException(
          `Selected ZIP files exceed the expanded limit of ${Math.floor(limits.maxZipExpandedBytes / 1024 / 1024)} MB.`,
        );
      }

      const buffer = entry.getData();
      const file = this.validationService.validateBuffer({
        buffer,
        originalFilename:
          this.validationService.getFilenameFromZipPath(selectedPath),
        allowZip: false,
      });

      return {
        sourceArchiveName: archiveFile.originalFilename,
        sourceArchivePath: selectedPath,
        file,
      };
    });
  }

  private openZip(buffer: Buffer): AdmZip {
    try {
      return new AdmZip(buffer);
    } catch (error: unknown) {
      throw new BadRequestException('The uploaded ZIP archive is invalid.', {
        cause: error,
      });
    }
  }

  private toManifestEntry(entry: AdmZip.IZipEntry): ZipManifestEntryView {
    const filename = entry.entryName.replace(/\\/g, '/').split('/').pop() ?? '';
    const extension = getNormalizedExtension(filename);
    const baseView = {
      path: entry.entryName,
      filename,
      extension,
      sizeBytes: entry.header.size,
      compressedSizeBytes: entry.header.compressedSize,
    };

    if (isEncrypted(entry)) {
      return {
        ...baseView,
        selectable: false,
        rejectionReason: 'Encrypted ZIP entries are not supported.',
      };
    }

    if (extension === DOCUMENT_ARCHIVE_EXTENSION) {
      return {
        ...baseView,
        selectable: false,
        rejectionReason: 'Nested ZIP files are not supported.',
      };
    }

    if (
      entry.header.size > this.validationService.getLimits().maxFileSizeBytes
    ) {
      return {
        ...baseView,
        selectable: false,
        rejectionReason: 'This file exceeds the per-file upload limit.',
      };
    }

    try {
      this.validationService.assertZipEntryPath(entry.entryName);
      const normalizedFilename = this.validationService.getFilenameFromZipPath(
        entry.entryName,
      );
      this.validationService.validateBuffer({
        buffer: Buffer.alloc(1),
        originalFilename: normalizedFilename,
        allowZip: false,
      });
    } catch (error: unknown) {
      return {
        ...baseView,
        selectable: false,
        rejectionReason:
          error instanceof Error ? error.message : 'Unsupported ZIP entry.',
      };
    }

    return {
      ...baseView,
      selectable: true,
      rejectionReason: null,
    };
  }
}
