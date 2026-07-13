import { normalizeRect, type NormalizedRect } from '@cuenote/score-domain';

export interface LetterboxTransform {
  originalWidth: number;
  originalHeight: number;
  targetWidth: number;
  targetHeight: number;
  resizedWidth: number;
  resizedHeight: number;
  padLeft: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  scale: number;
}

export function createLetterboxTransform(originalWidth: number, originalHeight: number, targetWidth: number, targetHeight: number): LetterboxTransform {
  const scale = Math.min(targetWidth / originalWidth, targetHeight / originalHeight);
  const resizedWidth = Math.max(1, Math.round(originalWidth * scale));
  const resizedHeight = Math.max(1, Math.round(originalHeight * scale));
  const padLeft = Math.floor((targetWidth - resizedWidth) / 2);
  const padTop = Math.floor((targetHeight - resizedHeight) / 2);
  return {
    originalWidth,
    originalHeight,
    targetWidth,
    targetHeight,
    resizedWidth,
    resizedHeight,
    padLeft,
    padTop,
    padRight: targetWidth - resizedWidth - padLeft,
    padBottom: targetHeight - resizedHeight - padTop,
    scale
  };
}

export function tensorRectToSystemRect(rect: NormalizedRect, transform: LetterboxTransform): NormalizedRect {
  const x1 = rect.x * transform.targetWidth;
  const y1 = rect.y * transform.targetHeight;
  const x2 = (rect.x + rect.width) * transform.targetWidth;
  const y2 = (rect.y + rect.height) * transform.targetHeight;

  return normalizeRect({
    x: (x1 - transform.padLeft) / transform.resizedWidth,
    y: (y1 - transform.padTop) / transform.resizedHeight,
    width: (x2 - x1) / transform.resizedWidth,
    height: (y2 - y1) / transform.resizedHeight
  });
}

export function systemRectToPageRect(systemRect: NormalizedRect, systemBoundsInPage: NormalizedRect): NormalizedRect {
  const system = normalizeRect(systemRect);
  const page = normalizeRect(systemBoundsInPage);
  return normalizeRect({
    x: page.x + system.x * page.width,
    y: page.y + system.y * page.height,
    width: system.width * page.width,
    height: system.height * page.height
  });
}
