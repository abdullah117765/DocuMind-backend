import { Injectable } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { Prisma } from '../../generated/prisma/client';
import {
  DOCUMENT_RENDERABLE_EXTENSIONS,
  DOCUMENT_TABLE_PREVIEW_MAX_ROWS,
  DOCUMENT_TEXT_PREVIEW_MAX_CHARS,
} from './documents.constants';
import type { ValidatedDocumentBuffer } from './document-validation.service';

export interface ExtractedDocumentPreview {
  metadata: Prisma.InputJsonValue;
  preview: Prisma.InputJsonValue;
}

interface TextPreview {
  content: string;
  truncated: boolean;
}

function decodeUtf8(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/\u0000/g, '');
}

function limitText(text: string): TextPreview {
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (normalizedText.length <= DOCUMENT_TEXT_PREVIEW_MAX_CHARS) {
    return {
      content: normalizedText,
      truncated: false,
    };
  }

  return {
    content: normalizedText.slice(0, DOCUMENT_TEXT_PREVIEW_MAX_CHARS),
    truncated: true,
  };
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentValue = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      currentValue += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = '';

      if (rows.length >= DOCUMENT_TABLE_PREVIEW_MAX_ROWS) {
        break;
      }

      continue;
    }

    currentValue += character;
  }

  if (
    rows.length < DOCUMENT_TABLE_PREVIEW_MAX_ROWS &&
    (currentValue || currentRow.length > 0)
  ) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows.slice(0, DOCUMENT_TABLE_PREVIEW_MAX_ROWS);
}

function readZipEntryText(zip: AdmZip, entryName: string): string | null {
  const entry = zip.getEntry(entryName);

  if (!entry) {
    return null;
  }

  return entry.getData().toString('utf8');
}

function getDocxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const documentXml = readZipEntryText(zip, 'word/document.xml');

  return documentXml ? stripXmlTags(documentXml) : '';
}

function getPptxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const slideEntries = zip
    .getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
    .sort((left, right) => left.entryName.localeCompare(right.entryName));

  return slideEntries
    .map((entry, index) => {
      const text = stripXmlTags(entry.getData().toString('utf8'));

      return text ? `Slide ${index + 1}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function parseSharedStrings(zip: AdmZip): string[] {
  const sharedStringsXml = readZipEntryText(zip, 'xl/sharedStrings.xml');

  if (!sharedStringsXml) {
    return [];
  }

  return [...sharedStringsXml.matchAll(/<si\b[\s\S]*?<\/si>/gi)].map(
    ([entry]) => stripXmlTags(entry),
  );
}

function getCellValue(cellXml: string, sharedStrings: string[]): string {
  const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/i);
  const inlineStringMatch = cellXml.match(/<is>([\s\S]*?)<\/is>/i);

  if (inlineStringMatch) {
    return stripXmlTags(inlineStringMatch[1]);
  }

  if (!valueMatch) {
    return '';
  }

  const rawValue = valueMatch[1];

  if (/\bt="s"/i.test(cellXml)) {
    const sharedStringIndex = Number(rawValue);

    return Number.isInteger(sharedStringIndex)
      ? (sharedStrings[sharedStringIndex] ?? '')
      : '';
  }

  return rawValue;
}

function getXlsxRows(buffer: Buffer): string[][] {
  const zip = new AdmZip(buffer);
  const sheetEntry =
    zip
      .getEntries()
      .filter((entry) =>
        /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName),
      )
      .sort((left, right) =>
        left.entryName.localeCompare(right.entryName),
      )[0] ?? null;

  if (!sheetEntry) {
    return [];
  }

  const sharedStrings = parseSharedStrings(zip);
  const sheetXml = sheetEntry.getData().toString('utf8');

  return [...sheetXml.matchAll(/<row\b[\s\S]*?<\/row>/gi)]
    .slice(0, DOCUMENT_TABLE_PREVIEW_MAX_ROWS)
    .map(([rowXml]) =>
      [...rowXml.matchAll(/<c\b[\s\S]*?<\/c>/gi)].map(([cellXml]) =>
        getCellValue(cellXml, sharedStrings),
      ),
    );
}

@Injectable()
export class DocumentPreviewService {
  extractPreview(file: ValidatedDocumentBuffer): ExtractedDocumentPreview {
    const metadata = {
      originalFilename: file.originalFilename,
      extension: file.extension,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      checksumSha256: file.checksumSha256,
      extractedAt: new Date().toISOString(),
    };

    const preview = this.buildPreview(file);

    return {
      metadata: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue,
      preview: JSON.parse(JSON.stringify(preview)) as Prisma.InputJsonValue,
    };
  }

  private buildPreview(file: ValidatedDocumentBuffer): Record<string, unknown> {
    if (
      DOCUMENT_RENDERABLE_EXTENSIONS.has(file.extension) &&
      ['pdf', 'png', 'jpeg', 'jpg'].includes(file.extension)
    ) {
      return {
        kind: 'binary',
        previewAvailable: true,
        mimeType: file.mimeType,
        message: 'Open the content endpoint inline for preview.',
      };
    }

    if (file.extension === 'csv') {
      const text = decodeUtf8(file.buffer);
      const rows = parseCsvRows(text);

      return {
        kind: 'table',
        previewAvailable: true,
        rows,
        rowLimit: DOCUMENT_TABLE_PREVIEW_MAX_ROWS,
        truncated: rows.length >= DOCUMENT_TABLE_PREVIEW_MAX_ROWS,
      };
    }

    if (['txt', 'html', 'xml'].includes(file.extension)) {
      const textPreview = limitText(decodeUtf8(file.buffer));

      return {
        kind: 'source',
        previewAvailable: true,
        language: file.extension,
        ...textPreview,
      };
    }

    if (file.extension === 'json') {
      const source = decodeUtf8(file.buffer);
      const formatted = this.formatJson(source);
      const textPreview = limitText(formatted);

      return {
        kind: 'source',
        previewAvailable: true,
        language: 'json',
        ...textPreview,
      };
    }

    if (file.extension === 'docx') {
      return this.buildOfficeTextPreview(file, () => getDocxText(file.buffer));
    }

    if (file.extension === 'pptx') {
      return this.buildOfficeTextPreview(file, () => getPptxText(file.buffer));
    }

    if (file.extension === 'xlsx') {
      const rows = getXlsxRows(file.buffer);

      return {
        kind: 'table',
        previewAvailable: rows.length > 0,
        rows,
        rowLimit: DOCUMENT_TABLE_PREVIEW_MAX_ROWS,
        truncated: rows.length >= DOCUMENT_TABLE_PREVIEW_MAX_ROWS,
        message:
          rows.length > 0
            ? 'Showing the first worksheet preview.'
            : 'No worksheet rows were found for preview.',
      };
    }

    if (['doc', 'ppt'].includes(file.extension)) {
      return {
        kind: 'legacy-office',
        previewAvailable: false,
        mimeType: file.mimeType,
        message:
          'Legacy DOC/PPT preview requires a conversion worker such as LibreOffice. The file is stored safely and can still be downloaded.',
      };
    }

    return {
      kind: 'unsupported',
      previewAvailable: false,
      message: 'Preview is not available for this file type.',
    };
  }

  private buildOfficeTextPreview(
    file: ValidatedDocumentBuffer,
    extractor: () => string,
  ): Record<string, unknown> {
    try {
      const textPreview = limitText(extractor());

      return {
        kind: 'office-text',
        previewAvailable: Boolean(textPreview.content),
        ...textPreview,
        message: textPreview.content
          ? 'Text preview extracted from the Office document.'
          : 'No readable text was found in this Office document.',
      };
    } catch {
      return {
        kind: 'office-text',
        previewAvailable: false,
        mimeType: file.mimeType,
        message: 'Office preview could not be extracted from this file.',
      };
    }
  }

  private formatJson(source: string): string {
    try {
      return JSON.stringify(JSON.parse(source) as unknown, null, 2);
    } catch {
      return source;
    }
  }
}
