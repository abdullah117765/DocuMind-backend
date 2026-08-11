import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { StorageConfiguration } from '../../config/storage.config';
import {
  DOCUMENT_ALLOWED_EXTENSIONS,
  DOCUMENT_ARCHIVE_EXTENSION,
  DOCUMENT_UNSAFE_FILENAME_CHARS_PATTERN,
} from './documents.constants';

export interface ValidatedDocumentBuffer {
  originalFilename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  buffer: Buffer;
}

export interface DocumentUploadLimits {
  maxFileSizeBytes: number;
  maxFilesPerBatch: number;
  stagingTtlSeconds: number;
  maxZipExpandedBytes: number;
}

const EXTENSION_MIME_TYPES = new Map<string, string>([
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  [
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  ['ppt', 'application/vnd.ms-powerpoint'],
  [
    'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  ['csv', 'text/csv'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['txt', 'text/plain'],
  ['zip', 'application/zip'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['html', 'text/html'],
  ['xml', 'application/xml'],
  ['json', 'application/json'],
]);

const ALLOWED_EXTENSION_SET = new Set<string>(DOCUMENT_ALLOWED_EXTENSIONS);
const ZIP_EXTENSIONS = new Set(['zip', 'docx', 'pptx', 'xlsx']);
const OLE_EXTENSIONS = new Set(['doc', 'ppt']);
const TEXT_EXTENSIONS = new Set(['csv', 'txt', 'html', 'xml', 'json']);
const ZIP_HEADERS = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];
const OLE_HEADER = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function normalizeMimeType(
  mimeType: string | undefined,
  extension: string,
): string {
  const normalizedMimeType = mimeType?.trim().toLowerCase();

  if (normalizedMimeType && normalizedMimeType !== 'application/octet-stream') {
    return normalizedMimeType.slice(0, 120);
  }

  return EXTENSION_MIME_TYPES.get(extension) ?? 'application/octet-stream';
}

function stripPath(originalName: string): string {
  return (
    originalName.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
  );
}

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length &&
    signature.every((byte, index) => buffer[index] === byte)
  );
}

function looksLikeZip(buffer: Buffer): boolean {
  return ZIP_HEADERS.some((signature) => startsWith(buffer, signature));
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  const controlBytes = [...sample].filter(
    (byte) =>
      byte < 0x09 ||
      (byte > 0x0d && byte < 0x20) ||
      byte === 0x7f,
  ).length;

  return controlBytes / Math.max(sample.length, 1) < 0.02;
}

function decodeText(buffer: Buffer): string {
  return buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
}

@Injectable()
export class DocumentValidationService {
  private readonly limits: DocumentUploadLimits;

  constructor(configService: ConfigService) {
    const config = configService.get<StorageConfiguration>('storage');

    this.limits = config?.documents ?? {
      maxFileSizeBytes: 10 * 1024 * 1024,
      maxFilesPerBatch: 8,
      stagingTtlSeconds: 24 * 60 * 60,
      maxZipExpandedBytes: 40 * 1024 * 1024,
    };
  }

  getLimits(): DocumentUploadLimits {
    return this.limits;
  }

  assertUploadBatch(files: Express.Multer.File[] | undefined): void {
    if (!files || files.length === 0) {
      throw new BadRequestException('Upload at least one file.');
    }

    if (files.length > this.limits.maxFilesPerBatch) {
      throw new BadRequestException(
        `Upload a maximum of ${this.limits.maxFilesPerBatch} files at a time.`,
      );
    }
  }

  validateUploadedFile(
    file: Express.Multer.File,
    options: { allowZip: boolean } = { allowZip: false },
  ): ValidatedDocumentBuffer {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        `${file.originalname || 'File'} is empty or could not be read.`,
      );
    }

    return this.validateBuffer({
      buffer: file.buffer,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      allowZip: options.allowZip,
    });
  }

  validateBuffer(input: {
    buffer: Buffer;
    originalFilename: string;
    mimeType?: string;
    allowZip?: boolean;
  }): ValidatedDocumentBuffer {
    const originalFilename = this.normalizeOriginalFilename(
      input.originalFilename,
    );
    const extension = this.resolveExtension(originalFilename);

    if (!ALLOWED_EXTENSION_SET.has(extension)) {
      throw new BadRequestException(
        `${originalFilename} is not supported. Supported file types: ${DOCUMENT_ALLOWED_EXTENSIONS.join(', ').toUpperCase()}.`,
      );
    }

    if (extension === DOCUMENT_ARCHIVE_EXTENSION && !input.allowZip) {
      throw new BadRequestException(
        'ZIP files must be reviewed through the ZIP manifest flow before staging.',
      );
    }

    if (input.buffer.length > this.limits.maxFileSizeBytes) {
      throw new PayloadTooLargeException(
        `${originalFilename} exceeds the ${Math.floor(this.limits.maxFileSizeBytes / 1024 / 1024)} MB limit.`,
      );
    }

    this.assertFileContentMatchesExtension(input.buffer, extension);

    return {
      originalFilename,
      extension,
      mimeType:
        EXTENSION_MIME_TYPES.get(extension) ??
        normalizeMimeType(input.mimeType, extension),
      sizeBytes: input.buffer.length,
      checksumSha256: createHash('sha256').update(input.buffer).digest('hex'),
      buffer: input.buffer,
    };
  }

  normalizeOriginalFilename(originalFilename: string): string {
    const baseName = stripPath(originalFilename || '').trim();
    const withoutUnsafeCharacters = baseName
      .replace(DOCUMENT_UNSAFE_FILENAME_CHARS_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!withoutUnsafeCharacters) {
      throw new BadRequestException('File name is required.');
    }

    if (withoutUnsafeCharacters.length > 255) {
      throw new BadRequestException(
        'File name must not exceed 255 characters.',
      );
    }

    return withoutUnsafeCharacters;
  }

  resolveExtension(filename: string): string {
    const extension = path.extname(filename).replace('.', '').toLowerCase();

    if (!extension) {
      throw new BadRequestException(
        `${filename} must include a file extension.`,
      );
    }

    return extension === 'jpg' ? 'jpeg' : extension;
  }

  assertZipEntryPath(entryPath: string): void {
    const normalizedPath = entryPath.replace(/\\/g, '/').trim();
    const pathSegments = normalizedPath.split('/').filter(Boolean);

    if (
      !normalizedPath ||
      normalizedPath.startsWith('/') ||
      normalizedPath.includes('\0') ||
      pathSegments.some((segment) => segment === '..')
    ) {
      throw new BadRequestException(
        `ZIP entry "${entryPath}" contains an unsafe path.`,
      );
    }

    if (normalizedPath.length > 500) {
      throw new BadRequestException(
        `ZIP entry "${entryPath}" exceeds the 500 character path limit.`,
      );
    }
  }

  getFilenameFromZipPath(entryPath: string): string {
    this.assertZipEntryPath(entryPath);

    return this.normalizeOriginalFilename(entryPath);
  }

  private assertFileContentMatchesExtension(
    buffer: Buffer,
    extension: string,
  ): void {
    const isValid = this.isContentValidForExtension(buffer, extension);

    if (!isValid) {
      throw new BadRequestException(
        'The file content does not match the selected file type. Upload the original file or choose the correct file type.',
      );
    }
  }

  private isContentValidForExtension(
    buffer: Buffer,
    extension: string,
  ): boolean {
    if (extension === 'pdf') {
      return startsWith(buffer, Buffer.from('%PDF-', 'ascii'));
    }

    if (extension === 'png') {
      return startsWith(buffer, PNG_HEADER);
    }

    if (extension === 'jpeg') {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }

    if (ZIP_EXTENSIONS.has(extension)) {
      return looksLikeZip(buffer);
    }

    if (OLE_EXTENSIONS.has(extension)) {
      return startsWith(buffer, OLE_HEADER);
    }

    if (TEXT_EXTENSIONS.has(extension)) {
      return this.isValidTextContent(buffer, extension);
    }

    return false;
  }

  private isValidTextContent(buffer: Buffer, extension: string): boolean {
    if (!looksLikeText(buffer)) return false;

    const text = decodeText(buffer);

    if (extension === 'json') {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    }

    if (extension === 'xml') {
      return text.startsWith('<?xml') || text.startsWith('<');
    }

    if (extension === 'html') {
      return /^(<!doctype\s+html\b|<html\b|<head\b|<body\b|<meta\b|<title\b|<div\b|<section\b|<p\b)/i.test(
        text,
      );
    }

    return true;
  }
}
