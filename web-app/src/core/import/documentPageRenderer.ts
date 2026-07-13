import { MAX_IMPORT_PAGES, MAX_IMAGE_PIXELS } from './fileValidation';

export interface RenderedDocumentPage {
  pageIndex: number;
  imageData: ImageData;
  originalDimensions: { width: number; height: number };
  rasterDimensions: { width: number; height: number };
  thumbnailDataUrl: string;
}

export interface DocumentPageRenderer {
  render(file: File, signal?: AbortSignal): Promise<RenderedDocumentPage[]>;
}

export function createDocumentPageRenderer(): DocumentPageRenderer {
  return {
    async render(file, signal) {
      if ((file.type || '').includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
        return renderPdfPages(file, signal);
      }
      return [await renderImagePage(file, signal)];
    }
  };
}

async function renderImagePage(file: File, signal?: AbortSignal): Promise<RenderedDocumentPage> {
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new Error('IMAGE_TOO_LARGE');
    }
    return rasterizeBitmap(bitmap, 0, signal);
  } finally {
    bitmap.close();
  }
}

async function renderPdfPages(file: File, signal?: AbortSignal): Promise<RenderedDocumentPage[]> {
  signal?.throwIfAborted();
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const documentTask = pdfjs.getDocument({ data: bytes });

  try {
    const pdfDocument = await documentTask.promise;
    if (pdfDocument.numPages > MAX_IMPORT_PAGES) {
      throw new Error('TOO_MANY_PAGES');
    }

    const pages: RenderedDocumentPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: choosePdfScale(baseViewport.width, baseViewport.height) });
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new Error('PDF_WORKER_FAILED');
      }
      await page.render({ canvasContext: context, viewport }).promise;
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      pages.push({
        pageIndex: pageNumber - 1,
        imageData,
        originalDimensions: { width: baseViewport.width, height: baseViewport.height },
        rasterDimensions: { width: canvas.width, height: canvas.height },
        thumbnailDataUrl: createThumbnail(canvas)
      });
      page.cleanup();
    }

    pdfDocument.cleanup();
    return pages;
  } catch (error) {
    if (typeof documentTask.destroy === 'function') {
      await documentTask.destroy();
    }
    if (error instanceof Error && /password/i.test(error.message)) {
      throw new Error('PASSWORD_PROTECTED_PDF');
    }
    throw error;
  }
}

function choosePdfScale(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  if (longEdge <= 0) {
    return 1;
  }
  return Math.min(2, 1400 / longEdge);
}

function rasterizeBitmap(bitmap: ImageBitmap, pageIndex: number, signal?: AbortSignal): RenderedDocumentPage {
  signal?.throwIfAborted();
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('IMAGE_DECODE_FAILED');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return {
    pageIndex,
    imageData: context.getImageData(0, 0, width, height),
    originalDimensions: { width: bitmap.width, height: bitmap.height },
    rasterDimensions: { width, height },
    thumbnailDataUrl: createThumbnail(canvas)
  };
}

function createThumbnail(sourceCanvas: HTMLCanvasElement): string {
  const thumbnail = document.createElement('canvas');
  const scale = Math.min(1, 220 / Math.max(sourceCanvas.width, sourceCanvas.height));
  thumbnail.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  thumbnail.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const context = thumbnail.getContext('2d');
  if (!context) {
    return '';
  }
  context.drawImage(sourceCanvas, 0, 0, thumbnail.width, thumbnail.height);
  return thumbnail.toDataURL('image/png');
}
