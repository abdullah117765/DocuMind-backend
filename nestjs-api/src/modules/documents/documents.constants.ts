export const DOCUMENT_ALLOWED_EXTENSIONS = [
  'pdf',
  'docx',
  'doc',
  'ppt',
  'pptx',
  'csv',
  'xlsx',
  'txt',
  'zip',
  'png',
  'jpeg',
  'jpg',
  'html',
  'xml',
  'json',
] as const;

export const DOCUMENT_RENDERABLE_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpeg',
  'jpg',
  'html',
  'xml',
  'json',
  'txt',
  'csv',
]);

export const DOCUMENT_ARCHIVE_EXTENSION = 'zip';

export const DOCUMENT_CONTENT_DISPOSITION_INLINE_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpeg',
  'jpg',
  'html',
  'xml',
  'json',
  'txt',
  'csv',
]);

export const DOCUMENT_TEXT_PREVIEW_MAX_CHARS = 60_000;
export const DOCUMENT_TABLE_PREVIEW_MAX_ROWS = 100;

export const DOCUMENT_SAFE_FILENAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._ -]{0,253}[A-Za-z0-9)]?$/;

export const DOCUMENT_UNSAFE_FILENAME_CHARS_PATTERN =
  /[<>:"/\\|?*\u0000-\u001f]/g;
