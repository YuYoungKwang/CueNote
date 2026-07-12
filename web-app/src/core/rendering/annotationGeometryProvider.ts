import { toClientPoint, toRelativePoint, type AnnotationAnchor, type RelativeBounds, type RelativePoint } from '@cuenote/score-domain';
import { findRenderedMeasureElement } from './measureDom';

export interface AnnotationPageSurface {
  pageNumber: number;
  element: HTMLElement;
}

export interface ResolvedAnchorGeometry {
  anchor: AnnotationAnchor;
  pageNumber: number;
  anchorBounds: RelativeBounds;
  pageBounds: RelativeBounds;
  pageSurfaceElement: HTMLElement;
}

export interface AnnotationAnchorCandidate {
  anchor: AnnotationAnchor;
  pageNumber: number;
  anchorBounds: RelativeBounds;
  pageBounds: RelativeBounds;
  pageSurfaceElement: HTMLElement;
}

export interface AnnotationGeometryProvider {
  listPageSurfaces(): AnnotationPageSurface[];
  supportsElementAnchors(): boolean;
  resolveAnchor(anchor: AnnotationAnchor, currentPerformanceMeasureId?: string | null): ResolvedAnchorGeometry | null;
  findAnchorAtPoint(
    clientX: number,
    clientY: number,
    anchorType: AnnotationAnchor['type'],
    currentPerformanceMeasureId?: string | null
  ): AnnotationAnchorCandidate | null;
  toRelativePoint(anchor: AnnotationAnchor, clientX: number, clientY: number, pressure?: number | null): RelativePoint | null;
  toClientPoint(anchor: AnnotationAnchor, point: RelativePoint, currentPerformanceMeasureId?: string | null): { x: number; y: number } | null;
}

export function createAnnotationGeometryProvider(container: HTMLElement): AnnotationGeometryProvider {
  return {
    listPageSurfaces() {
      return listAnnotationPageSurfaces(container);
    },
    supportsElementAnchors() {
      return container.querySelector('[data-source-element-id]') != null;
    },
    resolveAnchor(anchor, currentPerformanceMeasureId) {
      if (anchor.type === 'PERFORMANCE_MEASURE' && anchor.performanceMeasureId !== currentPerformanceMeasureId) {
        return null;
      }

      if (anchor.type === 'ELEMENT') {
        const element = container.querySelector<Element>(`[data-source-element-id="${cssEscape(anchor.sourceElementId)}"]`);
        return element ? resolveElementGeometry(element, anchor) : null;
      }

      const measureElement = findRenderedMeasureElement(container, anchor.sourceMeasureId);
      return measureElement ? resolveElementGeometry(measureElement, anchor) : null;
    },
    findAnchorAtPoint(clientX, clientY, anchorType, currentPerformanceMeasureId) {
      const stack = document.elementsFromPoint(clientX, clientY);
      const pageSurface = findPageSurfaceAtPoint(container, stack, clientX, clientY);
      if (!pageSurface) {
        return null;
      }

      if (anchorType === 'ELEMENT') {
        const element = stack.find((entry) => entry instanceof Element && entry instanceof HTMLElement && entry.dataset.sourceElementId) as HTMLElement | undefined;
        if (!element || !element.dataset.measureId || !element.dataset.sourceElementId) {
          return null;
        }

        const anchor: AnnotationAnchor = {
          type: 'ELEMENT',
          sourceMeasureId: element.dataset.measureId,
          sourceElementId: element.dataset.sourceElementId
        };

        return resolveElementGeometry(element, anchor);
      }

      const measureElement = stack
        .map((entry) => (entry instanceof Element ? entry.closest('[data-measure-id]') : null))
        .find((entry): entry is Element => entry != null);

      const resolvedMeasureElement = measureElement ?? findMeasureElementByBounds(pageSurface, clientX, clientY);

      if (
        !(resolvedMeasureElement instanceof HTMLElement || resolvedMeasureElement instanceof SVGElement) ||
        !('dataset' in resolvedMeasureElement) ||
        !resolvedMeasureElement.dataset.measureId
      ) {
        return null;
      }

      const anchor: AnnotationAnchor =
        anchorType === 'PERFORMANCE_MEASURE'
          ? {
              type: 'PERFORMANCE_MEASURE',
              sourceMeasureId: resolvedMeasureElement.dataset.measureId,
              performanceMeasureId: currentPerformanceMeasureId ?? `${resolvedMeasureElement.dataset.measureId}::1`
            }
          : {
              type: 'MEASURE',
              sourceMeasureId: resolvedMeasureElement.dataset.measureId
            };

      return resolveElementGeometry(resolvedMeasureElement, anchor);
    },
    toRelativePoint(anchor, clientX, clientY, pressure) {
      const resolved = this.resolveAnchor(anchor, currentPerformanceMeasureIdFromAnchor(anchor));
      if (!resolved) {
        return null;
      }

      return toRelativePoint(resolved.anchorBounds, { x: clientX, y: clientY }, pressure);
    },
    toClientPoint(anchor, point, currentPerformanceMeasureId) {
      const resolved = this.resolveAnchor(anchor, currentPerformanceMeasureId);
      if (!resolved) {
        return null;
      }

      return toClientPoint(resolved.anchorBounds, point);
    }
  };
}

export function listAnnotationPageSurfaces(container: HTMLElement): AnnotationPageSurface[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.score-page__surface')).map((element) => {
    const pageNumber = Number.parseInt(element.dataset.pageNumber ?? element.closest<HTMLElement>('.score-page')?.dataset.pageNumber ?? '1', 10) || 1;
    return {
      pageNumber,
      element
    };
  });
}

function resolveElementGeometry(element: Element, anchor: AnnotationAnchor): ResolvedAnchorGeometry | null {
  const pageSurfaceElement = element.closest<HTMLElement>('.score-page__surface');
  if (!pageSurfaceElement) {
    return null;
  }

  const pageNumber = Number.parseInt(pageSurfaceElement.dataset.pageNumber ?? pageSurfaceElement.closest<HTMLElement>('.score-page')?.dataset.pageNumber ?? '1', 10) || 1;
  return {
    anchor,
    pageNumber,
    anchorBounds: toBounds(element.getBoundingClientRect()),
    pageBounds: toBounds(pageSurfaceElement.getBoundingClientRect()),
    pageSurfaceElement
  };
}

function findPageSurfaceAtPoint(
  container: HTMLElement,
  stack: Element[],
  clientX: number,
  clientY: number
): HTMLElement | null {
  const fromStack = stack
    .map((entry) => (entry instanceof Element ? entry.closest<HTMLElement>('.score-page__surface') : null))
    .find((entry): entry is HTMLElement => entry != null);

  if (fromStack) {
    return fromStack;
  }

  return listAnnotationPageSurfaces(container)
    .map((surface) => surface.element)
    .find((surface) => {
      const rect = surface.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }) ?? null;
}

function findMeasureElementByBounds(pageSurface: HTMLElement, clientX: number, clientY: number): Element | null {
  const measureElements = Array.from(pageSurface.querySelectorAll('[data-measure-id]'));

  return (
    measureElements.find((element) => {
      const rect = element.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }) ?? null
  );
}

function toBounds(rect: DOMRect): RelativeBounds {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function currentPerformanceMeasureIdFromAnchor(anchor: AnnotationAnchor): string | null {
  return anchor.type === 'PERFORMANCE_MEASURE' ? anchor.performanceMeasureId : null;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
