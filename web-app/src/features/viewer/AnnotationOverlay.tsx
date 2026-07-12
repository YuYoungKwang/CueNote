import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import {
  filterVisibleAnnotations,
  toRelativePoint as toAnchorRelativePoint,
  type Annotation,
  type AnnotationAnchor,
  type AnnotationLayerFilterState,
  type AnnotationScope,
  type AnnotationTool,
  type PlaybackStatus,
  type RelativePoint
} from '@cuenote/score-domain';
import { createAnnotationGeometryProvider, type AnnotationPageSurface } from '../../core/rendering/annotationGeometryProvider';
import { getStrokeWidthPx, getTextFontSizePx, getTextRect, hitTestAnnotation, toStrokeClientPoint } from './annotationMath';

export type ViewerInteractionMode = 'VIEW' | 'ANNOTATE';
export type ViewerAnnotationTool = 'SELECT' | AnnotationTool | 'ERASER' | 'TEXT';

interface AnnotationOverlayProps {
  stageRef: MutableRefObject<HTMLDivElement | null>;
  rendererReady: boolean;
  scoreId: string;
  scoreVersionId: string;
  annotations: Annotation[];
  filters: AnnotationLayerFilterState;
  currentPartId: string | null;
  currentPerformanceMeasureId: string | null;
  playbackStatus: PlaybackStatus;
  mode: ViewerInteractionMode;
  tool: ViewerAnnotationTool;
  scope: AnnotationScope;
  anchorType: AnnotationAnchor['type'];
  onUpsertAnnotation(annotation: Annotation): Promise<void>;
  onDeleteAnnotation(annotationId: string): Promise<void>;
  onRequestViewMode(): void;
}

interface DraftStrokeState {
  pointerId: number;
  pageNumber: number;
  anchorBounds: { left: number; top: number; width: number; height: number };
  annotation: Annotation;
  startedAtMs: number;
}

interface TextEditorState {
  annotationId?: string;
  pageNumber: number;
  anchor: AnnotationAnchor;
  createdAt?: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizeRatio: number;
}

const DEFAULT_STROKE_WIDTH_RATIO = 0.028;
const DEFAULT_HIGHLIGHT_WIDTH_RATIO = 0.09;
const DEFAULT_TEXT_WIDTH = 0.42;
const DEFAULT_TEXT_HEIGHT = 0.18;
const DEFAULT_TEXT_FONT_RATIO = 0.18;

export function AnnotationOverlay({
  stageRef,
  rendererReady,
  scoreId,
  scoreVersionId,
  annotations,
  filters,
  currentPartId,
  currentPerformanceMeasureId,
  playbackStatus,
  mode,
  tool,
  scope,
  anchorType,
  onUpsertAnnotation,
  onDeleteAnnotation,
  onRequestViewMode
}: AnnotationOverlayProps) {
  const [pageSurfaces, setPageSurfaces] = useState<AnnotationPageSurface[]>([]);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const draftStrokeRef = useRef<DraftStrokeState | null>(null);
  const canvasMapRef = useRef(new Map<number, HTMLCanvasElement>());
  const redrawHandleRef = useRef<number | null>(null);
  const inputEnabled = mode === 'ANNOTATE' && playbackStatus !== 'PLAYING' && playbackStatus !== 'COUNT_IN';
  const visibleAnnotations = useMemo(
    () =>
      filterVisibleAnnotations(annotations, {
        filters,
        currentPartId,
        currentPerformanceMeasureId
      }),
    [annotations, currentPartId, currentPerformanceMeasureId, filters]
  );

  const refreshPageSurfaces = useCallback(() => {
    if (!rendererReady || !stageRef.current) {
      setPageSurfaces([]);
      setOverlayError(null);
      return;
    }

    const nextSurfaces = createAnnotationGeometryProvider(stageRef.current).listPageSurfaces();
    setPageSurfaces(nextSurfaces);
    setOverlayError(nextSurfaces.length > 0 ? null : 'Annotation overlay could not find rendered score pages.');
  }, [rendererReady, stageRef]);

  const redrawCanvases = useCallback(() => {
    if (!rendererReady || !stageRef.current) {
      return;
    }

    const geometryProvider = createAnnotationGeometryProvider(stageRef.current);
    const devicePixelRatio = window.devicePixelRatio || 1;

    pageSurfaces.forEach((surface) => {
      const canvas = canvasMapRef.current.get(surface.pageNumber);
      if (!canvas) {
        return;
      }

      const width = Math.max(1, Math.round(surface.element.clientWidth));
      const height = Math.max(1, Math.round(surface.element.clientHeight));
      if (canvas.width !== Math.round(width * devicePixelRatio) || canvas.height !== Math.round(height * devicePixelRatio)) {
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      visibleAnnotations.forEach((annotation) => {
        if (annotation.type !== 'STROKE') {
          return;
        }

        const resolved = geometryProvider.resolveAnchor(annotation.anchor, currentPerformanceMeasureId);
        if (!resolved || resolved.pageNumber !== surface.pageNumber) {
          return;
        }

        drawStrokeAnnotation(context, annotation, resolved.anchorBounds, resolved.pageBounds);
      });

      const draftStroke = draftStrokeRef.current;
      if (draftStroke && draftStroke.pageNumber === surface.pageNumber && draftStroke.annotation.type === 'STROKE') {
        const resolved = geometryProvider.resolveAnchor(draftStroke.annotation.anchor, currentPerformanceMeasureIdFromDraft(draftStroke.annotation.anchor));
        if (resolved) {
          drawStrokeAnnotation(context, draftStroke.annotation, resolved.anchorBounds, resolved.pageBounds);
        }
      }
    });
  }, [currentPerformanceMeasureId, pageSurfaces, rendererReady, stageRef, visibleAnnotations]);

  const scheduleRedraw = useCallback(() => {
    if (redrawHandleRef.current != null) {
      window.cancelAnimationFrame(redrawHandleRef.current);
    }

    redrawHandleRef.current = window.requestAnimationFrame(() => {
      redrawHandleRef.current = null;
      redrawCanvases();
    });
  }, [redrawCanvases]);

  useEffect(() => {
    refreshPageSurfaces();
  }, [refreshPageSurfaces]);

  useEffect(() => {
    if (!rendererReady || !stageRef.current) {
      return;
    }

    const mutationObserver = new MutationObserver(() => {
      refreshPageSurfaces();
      scheduleRedraw();
    });
    mutationObserver.observe(stageRef.current, {
      childList: true,
      subtree: true
    });

    return () => mutationObserver.disconnect();
  }, [refreshPageSurfaces, rendererReady, scheduleRedraw, stageRef]);

  useEffect(() => {
    if (pageSurfaces.length === 0) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleRedraw();
    });

    pageSurfaces.forEach((surface) => resizeObserver.observe(surface.element));
    window.addEventListener('resize', scheduleRedraw);
    scheduleRedraw();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleRedraw);
    };
  }, [pageSurfaces, scheduleRedraw]);

  useEffect(() => {
    scheduleRedraw();
  }, [scheduleRedraw, visibleAnnotations, textEditor]);

  useEffect(() => {
    return () => {
      if (redrawHandleRef.current != null) {
        window.cancelAnimationFrame(redrawHandleRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (draftStrokeRef.current) {
        draftStrokeRef.current = null;
        scheduleRedraw();
        return;
      }

      if (textEditor) {
        setTextEditor(null);
        return;
      }

      if (mode === 'ANNOTATE') {
        onRequestViewMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, onRequestViewMode, scheduleRedraw, textEditor]);

  const openTextEditorForPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!stageRef.current) {
        return;
      }

      const geometryProvider = createAnnotationGeometryProvider(stageRef.current);
      const candidate = geometryProvider.findAnchorAtPoint(clientX, clientY, anchorType, currentPerformanceMeasureId);
      if (!candidate) {
        return;
      }

      const point = geometryProvider.toRelativePoint(candidate.anchor, clientX, clientY, null);
      if (!point) {
        return;
      }

      setTextEditor({
        pageNumber: candidate.pageNumber,
        anchor: candidate.anchor,
        text: '',
        x: clampTextCoordinate(point.x),
        y: clampTextCoordinate(point.y),
        width: DEFAULT_TEXT_WIDTH,
        height: DEFAULT_TEXT_HEIGHT,
        fontSizeRatio: DEFAULT_TEXT_FONT_RATIO
      });
    },
    [anchorType, currentPerformanceMeasureId, stageRef]
  );

  const handlePointerDown = useCallback(
    (pageNumber: number, event: ReactPointerEvent<HTMLDivElement>) => {
      if (!stageRef.current || !inputEnabled) {
        return;
      }

      const geometryProvider = createAnnotationGeometryProvider(stageRef.current);

      if (tool === 'TEXT') {
        event.preventDefault();
        openTextEditorForPoint(event.clientX, event.clientY);
        return;
      }

      if (tool === 'ERASER') {
        const annotation = findTopmostAnnotationAtPoint(geometryProvider, visibleAnnotations, event.clientX, event.clientY, currentPerformanceMeasureId);
        if (annotation) {
          event.preventDefault();
          void onDeleteAnnotation(annotation.id);
        }
        return;
      }

      if (tool === 'SELECT') {
        return;
      }

      const candidate = geometryProvider.findAnchorAtPoint(event.clientX, event.clientY, anchorType, currentPerformanceMeasureId);
      if (!candidate) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const firstPoint = toAnchorRelativePoint(candidate.anchorBounds, { x: event.clientX, y: event.clientY }, event.pressure);

      const now = Date.now();
      draftStrokeRef.current = {
        pointerId: event.pointerId,
        pageNumber,
        anchorBounds: candidate.anchorBounds,
        startedAtMs: performance.now(),
        annotation: {
          id: createAnnotationId(),
          schemaVersion: 1,
          scoreId,
          scoreVersionId,
          type: 'STROKE',
          scope,
          partId: scope === 'PART' ? currentPartId ?? undefined : undefined,
          anchor: candidate.anchor,
          payload: {
            tool: tool === 'HIGHLIGHTER' ? 'HIGHLIGHTER' : 'PEN',
            points: [firstPoint],
            widthRatio: tool === 'HIGHLIGHTER' ? DEFAULT_HIGHLIGHT_WIDTH_RATIO : DEFAULT_STROKE_WIDTH_RATIO,
            opacity: tool === 'HIGHLIGHTER' ? 0.28 : 1,
            color: tool === 'HIGHLIGHTER' ? '#facc15' : '#111827'
          },
          createdAt: now,
          updatedAt: now
        }
      };

      scheduleRedraw();
    },
    [
      anchorType,
      currentPartId,
      currentPerformanceMeasureId,
      inputEnabled,
      onDeleteAnnotation,
      onUpsertAnnotation,
      openTextEditorForPoint,
      scheduleRedraw,
      scope,
      scoreId,
      scoreVersionId,
      stageRef,
      tool,
      visibleAnnotations
    ]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!stageRef.current) {
        return;
      }

      const draftStroke = draftStrokeRef.current;
      if (!draftStroke || draftStroke.pointerId !== event.pointerId) {
        return;
      }

      if (draftStroke.annotation.type !== 'STROKE') {
        return;
      }

      const nextPoint = toAnchorRelativePoint(draftStroke.anchorBounds, { x: event.clientX, y: event.clientY }, event.pressure);
      const previousPoint = draftStroke.annotation.payload.points[draftStroke.annotation.payload.points.length - 1];
      if (previousPoint && previousPoint.x === nextPoint.x && previousPoint.y === nextPoint.y) {
        return;
      }

      event.preventDefault();
      draftStroke.annotation.payload.points.push({
        ...nextPoint,
        timeOffsetMs: Math.max(0, Math.round(performance.now() - draftStroke.startedAtMs))
      });
      draftStroke.annotation.updatedAt = Date.now();
      scheduleRedraw();
    },
    [scheduleRedraw, stageRef]
  );

  const finishStroke = useCallback(
    async (pointerId: number, persist: boolean) => {
      const draftStroke = draftStrokeRef.current;
      if (!draftStroke || draftStroke.pointerId !== pointerId) {
        return;
      }

      draftStrokeRef.current = null;
      scheduleRedraw();

      if (!persist) {
        return;
      }

      if (draftStroke.annotation.type !== 'STROKE') {
        return;
      }

      await onUpsertAnnotation({
        ...draftStroke.annotation,
        updatedAt: Date.now()
      });
    },
    [onUpsertAnnotation, scheduleRedraw]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const currentTarget = event.currentTarget;
      const pointerId = event.pointerId;
      void finishStroke(event.pointerId, true).finally(() => {
        if (currentTarget.hasPointerCapture(pointerId)) {
          currentTarget.releasePointerCapture(pointerId);
        }
      });
    },
    [finishStroke]
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const currentTarget = event.currentTarget;
      const pointerId = event.pointerId;
      if (currentTarget.hasPointerCapture(pointerId)) {
        currentTarget.releasePointerCapture(pointerId);
      }
      void finishStroke(pointerId, false);
    },
    [finishStroke]
  );

  const handleLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      void finishStroke(event.pointerId, false);
    },
    [finishStroke]
  );

  const saveTextEditor = useCallback(async () => {
    if (!textEditor) {
      return;
    }

    const trimmedText = textEditor.text.trim();
    if (trimmedText.length === 0) {
      return;
    }

    const now = Date.now();
    await onUpsertAnnotation({
      id: textEditor.annotationId ?? createAnnotationId(),
      schemaVersion: 1,
      scoreId,
      scoreVersionId,
      type: 'TEXT',
      scope,
      partId: scope === 'PART' ? currentPartId ?? undefined : undefined,
      anchor: textEditor.anchor,
      payload: {
        text: trimmedText,
        x: textEditor.x,
        y: textEditor.y,
        width: textEditor.width,
        height: textEditor.height,
        fontSizeRatio: textEditor.fontSizeRatio
      },
      createdAt: textEditor.createdAt ?? now,
      updatedAt: now
    });
    setTextEditor(null);
  }, [currentPartId, onUpsertAnnotation, scope, scoreId, scoreVersionId, textEditor]);

  const deleteTextEditorAnnotation = useCallback(async () => {
    if (!textEditor?.annotationId) {
      setTextEditor(null);
      return;
    }

    await onDeleteAnnotation(textEditor.annotationId);
    setTextEditor(null);
  }, [onDeleteAnnotation, textEditor]);

  const overlayStateTestId = overlayError
    ? 'annotation-overlay-error'
    : rendererReady && pageSurfaces.length > 0
      ? 'annotation-overlay-ready'
      : 'annotation-overlay-loading';

  return (
    <>
      <div className="annotation-overlay-status" data-testid={overlayStateTestId}>
        {overlayError ?? 'Annotation overlay ready'}
      </div>

      {pageSurfaces.map((surface) =>
        createPortal(
          <div
            key={`overlay-${surface.pageNumber}`}
            className={`annotation-page-overlay${inputEnabled ? ' is-interactive' : ''}`}
            data-page-number={surface.pageNumber}
            onPointerDown={(event) => handlePointerDown(surface.pageNumber, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handleLostPointerCapture}
          >
            <canvas
              ref={(element) => {
                if (element) {
                  canvasMapRef.current.set(surface.pageNumber, element);
                } else {
                  canvasMapRef.current.delete(surface.pageNumber);
                }
              }}
              className="annotation-page-overlay__canvas"
              data-testid="annotation-canvas"
              data-page-number={surface.pageNumber}
            />

            {visibleAnnotations
              .filter((annotation) => annotation.type === 'TEXT')
              .map((annotation) => {
                if (!stageRef.current) {
                  return null;
                }

                const geometryProvider = createAnnotationGeometryProvider(stageRef.current);
                const resolved = geometryProvider.resolveAnchor(annotation.anchor, currentPerformanceMeasureId);
                if (!resolved || resolved.pageNumber !== surface.pageNumber) {
                  return null;
                }

                const rect = getTextRect(resolved.anchorBounds, annotation.payload);
                const fontSize = getTextFontSizePx(resolved.anchorBounds, annotation.payload);
                const textStyle = {
                  left: `${rect.left - resolved.pageBounds.left}px`,
                  top: `${rect.top - resolved.pageBounds.top}px`,
                  width: `${rect.width}px`,
                  minHeight: `${rect.height}px`,
                  fontSize: `${fontSize}px`
                };

                return (
                  <button
                    key={annotation.id}
                    type="button"
                    className="annotation-text-note"
                    style={textStyle}
                    onPointerDown={(event) => {
                      if (tool === 'ERASER' && inputEnabled) {
                        event.preventDefault();
                        event.stopPropagation();
                        void onDeleteAnnotation(annotation.id);
                        return;
                      }

                      if (tool === 'TEXT' || tool === 'SELECT') {
                        event.stopPropagation();
                      }
                    }}
                    onClick={(event) => {
                      if (!inputEnabled || (tool !== 'TEXT' && tool !== 'SELECT')) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      setTextEditor({
                        annotationId: annotation.id,
                        pageNumber: surface.pageNumber,
                        anchor: annotation.anchor,
                        createdAt: annotation.createdAt,
                        text: annotation.payload.text,
                        x: annotation.payload.x,
                        y: annotation.payload.y,
                        width: annotation.payload.width,
                        height: annotation.payload.height,
                        fontSizeRatio: annotation.payload.fontSizeRatio
                      });
                    }}
                  >
                    {annotation.payload.text}
                  </button>
                );
              })}

            {textEditor && textEditor.pageNumber === surface.pageNumber && stageRef.current
              ? renderTextEditorPortal(surface.pageNumber, stageRef.current, textEditor, setTextEditor, saveTextEditor, deleteTextEditorAnnotation)
              : null}
          </div>,
          surface.element
        )
      )}
    </>
  );
}

function renderTextEditorPortal(
  pageNumber: number,
  container: HTMLElement,
  textEditor: TextEditorState,
  setTextEditor: (state: TextEditorState | null) => void,
  onSave: () => Promise<void>,
  onDelete: () => Promise<void>
) {
  const geometryProvider = createAnnotationGeometryProvider(container);
  const resolved = geometryProvider.resolveAnchor(textEditor.anchor, currentPerformanceMeasureIdFromDraft(textEditor.anchor));
  if (!resolved || resolved.pageNumber !== pageNumber) {
    return null;
  }

  const rect = getTextRect(resolved.anchorBounds, {
    text: textEditor.text,
    x: textEditor.x,
    y: textEditor.y,
    width: textEditor.width,
    height: textEditor.height,
    fontSizeRatio: textEditor.fontSizeRatio
  });
  const fontSize = getTextFontSizePx(resolved.anchorBounds, {
    text: textEditor.text,
    x: textEditor.x,
    y: textEditor.y,
    width: textEditor.width,
    height: textEditor.height,
    fontSizeRatio: textEditor.fontSizeRatio
  });

  return (
    <div
      className="annotation-text-editor"
      data-testid="annotation-text-editor"
      style={{
        left: `${rect.left - resolved.pageBounds.left}px`,
        top: `${rect.top - resolved.pageBounds.top}px`,
        width: `${Math.max(rect.width, 160)}px`,
        minHeight: `${Math.max(rect.height, 90)}px`
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <textarea
        autoFocus
        value={textEditor.text}
        style={{ fontSize: `${fontSize}px` }}
        onChange={(event) => setTextEditor({ ...textEditor, text: event.target.value })}
      />
      <div className="annotation-text-editor__actions">
        <button type="button" className="control-button" onClick={() => void onSave()} disabled={textEditor.text.trim().length === 0}>
          Save note
        </button>
        <button type="button" className="control-button" onClick={() => setTextEditor(null)}>
          Cancel
        </button>
        {textEditor.annotationId ? (
          <button type="button" className="control-button" onClick={() => void onDelete()}>
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function drawStrokeAnnotation(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  anchorBounds: { left: number; top: number; width: number; height: number },
  pageBounds: { left: number; top: number }
) {
  if (annotation.type !== 'STROKE') {
    return;
  }

  const points = annotation.payload.points.map((point) => toStrokeClientPoint(anchorBounds, point));
  if (points.length === 0) {
    return;
  }

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = getStrokeWidthPx(anchorBounds, annotation.payload.widthRatio);
  context.strokeStyle = annotation.payload.color;
  context.fillStyle = annotation.payload.color;
  context.globalAlpha = annotation.payload.opacity;
  context.globalCompositeOperation = annotation.payload.tool === 'HIGHLIGHTER' ? 'multiply' : 'source-over';

  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x - pageBounds.left, points[0].y - pageBounds.top, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x - pageBounds.left, points[0].y - pageBounds.top);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x - pageBounds.left, points[index].y - pageBounds.top);
  }

  context.stroke();
  context.restore();
}

function findTopmostAnnotationAtPoint(
  geometryProvider: ReturnType<typeof createAnnotationGeometryProvider>,
  annotations: Annotation[],
  clientX: number,
  clientY: number,
  currentPerformanceMeasureId: string | null
): Annotation | null {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    const resolved = geometryProvider.resolveAnchor(annotation.anchor, currentPerformanceMeasureId);
    if (!resolved) {
      continue;
    }

    if (hitTestAnnotation(annotation, resolved.anchorBounds, { x: clientX, y: clientY })) {
      return annotation;
    }
  }

  return null;
}

function createAnnotationId(): string {
  return crypto.randomUUID();
}

function clampTextCoordinate(value: number): number {
  return Math.max(-0.25, Math.min(0.9, value));
}

function currentPerformanceMeasureIdFromDraft(anchor: AnnotationAnchor): string | null {
  return anchor.type === 'PERFORMANCE_MEASURE' ? anchor.performanceMeasureId : null;
}
