import type { ImportError, ImportSourceType } from '@cuenote/score-domain';

export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_PAGES = 24;
export const MAX_IMAGE_PIXELS = 20_000_000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
const PDF_TYPES = new Set(['application/pdf']);

export interface ValidatedImportFile {
  sourceType: ImportSourceType;
  mimeType: string;
}

export function validateImportFile(file: File): ValidatedImportFile | ImportError {
  if (file.size === 0) {
    return { code: 'EMPTY_FILE', message: 'The selected file is empty.' };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { code: 'FILE_TOO_LARGE', message: `Files larger than ${Math.floor(MAX_IMPORT_FILE_BYTES / 1024 / 1024)} MB are not supported in this phase.` };
  }

  const mimeType = file.type || inferMimeType(file.name);
  if (PDF_TYPES.has(mimeType)) {
    return { sourceType: 'PDF', mimeType };
  }
  if (IMAGE_TYPES.has(mimeType)) {
    return { sourceType: 'IMAGE', mimeType };
  }

  return {
    code: 'UNSUPPORTED_FILE_TYPE',
    message: 'Choose a PDF, PNG, JPEG, WebP, GIF, or BMP score image.'
  };
}

export function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.bmp')) {
    return 'image/bmp';
  }
  return 'application/octet-stream';
}
