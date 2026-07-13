import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  type Annotation,
  type AnnotationAnchor,
  type AnnotationLayerFilterState,
  type AnnotationScope,
  PlaybackTimeline,
  analyzeRepresentativePartWarnings,
  expandRepeats,
  type Measure,
  type PerformanceMeasure,
  type PlaybackSnapshot,
  type PlaybackStatus,
  type RepeatExpansionWarning,
  type ScoreDocument,
  type ScoreVersion,
  type StableMeasureId
} from '@cuenote/score-domain';
import { createBrowserPlaybackClock, subscribeToPlaybackClock } from '../../core/playback/browserPlaybackClock';
import { createApiClient } from '../../core/api/client';
import { createServerSessionStore } from '../../core/api/sessionStore';
import { createMusicXMLService } from '../../core/musicxml/parser';
import { createAnnotationGeometryProvider } from '../../core/rendering/annotationGeometryProvider';
import { createVerovioScoreRenderer } from '../../core/rendering/verovioScoreRenderer';
import { createAnnotationPreferenceStore } from '../../core/storage/annotationPreferenceStore';
import { createAnnotationRepository } from '../../core/storage/annotationRepository';
import { createAnnotationSyncQueue } from '../../core/storage/annotationSyncQueue';
import { createAnnotationSyncService } from '../../core/storage/annotationSyncService';
import { createRecentScoreStore } from '../../core/storage/recentScoreStore';
import { AnnotationOverlay, type ViewerAnnotationTool, type ViewerInteractionMode } from './AnnotationOverlay';
import { getSampleById } from '../../samples/catalog';

const DEFAULT_BPM = 80;
const DEFAULT_COUNT_IN_MEASURES = 1;

type ViewerStatus =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      document: ScoreDocument;
      version: ScoreVersion;
      representativePartName: string;
      measures: Measure[];
      measuresById: Record<string, Measure>;
      performanceMeasures: PerformanceMeasure[];
      warnings: RepeatExpansionWarning[];
      serverContext?: ServerViewerContext;
    }
  | { kind: 'not-found' }
  | { kind: 'parse-error'; message: string };

type RendererState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

type AnnotationLoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };
type AnnotationSaveState =
  | { kind: 'idle'; message: string }
  | { kind: 'saving'; message: string }
  | { kind: 'saved'; message: string }
  | { kind: 'error'; message: string };

const DEFAULT_LAYER_FILTERS: AnnotationLayerFilterState = {
  privateVisible: true,
  partVisible: true,
  ensembleVisible: true
};

interface ServerViewerContext {
  accessToken: string;
  scoreId: string;
  scoreVersionId: string;
}

export function ScoreViewerPage() {
  const { scoreId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const rendererRef = useRef<ReturnType<typeof createVerovioScoreRenderer> | null>(null);
  const timelineRef = useRef<PlaybackTimeline | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedMeasureIdRef = useRef<StableMeasureId | null>(null);
  const playbackClock = useMemo(() => createBrowserPlaybackClock(), []);
  const apiClient = useMemo(() => createApiClient(), []);
  const sessionStore = useMemo(() => createServerSessionStore(), []);
  const recentStore = useMemo(() => createRecentScoreStore(), []);
  const annotationRepository = useMemo(() => createAnnotationRepository(), []);
  const annotationSyncQueue = useMemo(() => createAnnotationSyncQueue(), []);
  const annotationSyncService = useMemo(
    () => createAnnotationSyncService(apiClient, annotationRepository, annotationSyncQueue),
    [apiClient, annotationRepository, annotationSyncQueue]
  );
  const annotationPreferenceStore = useMemo(() => createAnnotationPreferenceStore(), []);
  const musicXmlService = useMemo(() => createMusicXMLService(), []);
  const sourceMode = searchParams.get('source') === 'server' ? 'server' : 'sample';
  const requestedVersionId = searchParams.get('versionId');
  const sample = useMemo(() => (sourceMode === 'sample' ? getSampleById(scoreId) : null), [scoreId, sourceMode]);
  const [status, setStatus] = useState<ViewerStatus>({ kind: 'loading' });
  const [rendererState, setRendererState] = useState<RendererState>({ kind: 'idle' });
  const [rendererRetryKey, setRendererRetryKey] = useState(0);
  const [selectedMeasureId, setSelectedMeasureId] = useState<StableMeasureId | null>(null);
  const [zoom, setZoom] = useState(1);
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [countInMeasures, setCountInMeasures] = useState(DEFAULT_COUNT_IN_MEASURES);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationLoadState, setAnnotationLoadState] = useState<AnnotationLoadState>({ kind: 'idle' });
  const [annotationSaveState, setAnnotationSaveState] = useState<AnnotationSaveState>({ kind: 'idle', message: 'Annotations idle.' });
  const [annotationSyncState, setAnnotationSyncState] = useState({ message: 'Annotation sync idle.', pending: 0, failed: 0, conflicts: 0 });
  const [interactionMode, setInteractionMode] = useState<ViewerInteractionMode>('VIEW');
  const [annotationTool, setAnnotationTool] = useState<ViewerAnnotationTool>('SELECT');
  const [annotationScope, setAnnotationScope] = useState<AnnotationScope>('PRIVATE');
  const [annotationAnchorType, setAnnotationAnchorType] = useState<AnnotationAnchor['type']>('MEASURE');
  const [annotationFilters, setAnnotationFilters] = useState<AnnotationLayerFilterState>(DEFAULT_LAYER_FILTERS);
  const [currentPartId, setCurrentPartId] = useState<string | null>(null);
  const [playbackSnapshot, setPlaybackSnapshot] = useState<PlaybackSnapshot>({
    status: 'STOPPED',
    bpm: DEFAULT_BPM,
    countInMeasures: DEFAULT_COUNT_IN_MEASURES,
    currentPerformanceMeasureId: null,
    currentSourceMeasureId: null,
    currentOccurrence: null,
    currentBeat: 1,
    elapsedMs: 0,
    countInRemainingMs: 0
  });

  useEffect(() => {
    selectedMeasureIdRef.current = selectedMeasureId;
  }, [selectedMeasureId]);

  useEffect(() => {
    let cancelled = false;
    setRendererRetryKey(0);
    setRendererState({ kind: 'idle' });
    setAnnotationLoadState({ kind: 'idle' });
    setAnnotationSyncState({ message: 'Annotation sync idle.', pending: 0, failed: 0, conflicts: 0 });
    setAnnotations([]);
    setStatus({ kind: 'loading' });

    const loadScore = async () => {
      if (sourceMode === 'sample') {
        if (!sample) {
          timelineRef.current = null;
          setRendererState({ kind: 'idle' });
          setStatus({ kind: 'not-found' });
          return;
        }

        return {
          sourceXml: sample.sourceXml,
          parseScoreId: sample.id,
          sample: true,
          serverContext: undefined
        };
      }

      const session = sessionStore.load();
      if (!session) {
        throw new Error('Sign in from the library before opening a server score.');
      }

      const score = await apiClient.getScore(session.accessToken, scoreId);
      const scoreVersionId = requestedVersionId ?? score.current_version_id;
      if (!scoreVersionId) {
        throw new Error('Server score does not have a current version.');
      }
      const sourceXml = await apiClient.getScoreVersionSource(session.accessToken, score.id, scoreVersionId);
      return {
        sourceXml,
        parseScoreId: score.id,
        sample: false,
        serverContext: {
          accessToken: session.accessToken,
          scoreId: score.id,
          scoreVersionId
        } satisfies ServerViewerContext
      };
    };

    void loadScore()
      .then(async (loaded) => {
        if (!loaded || cancelled) {
          return;
        }

        const parsed = musicXmlService.parse(loaded.sourceXml, {
          scoreId: loaded.parseScoreId,
          sample: loaded.sample
        });
        const version: ScoreVersion = loaded.serverContext
          ? { ...parsed.version, id: loaded.serverContext.scoreVersionId }
          : parsed.version;
        const document: ScoreDocument = loaded.serverContext
          ? { ...parsed.document, currentVersionId: loaded.serverContext.scoreVersionId, versions: [version] }
          : parsed.document;

        const representativePart = version.parts[0];
        const measures = representativePart?.measures ?? [];
        const measuresById = Object.fromEntries(measures.map((measure) => [measure.id, measure]));
        const representativePartWarnings = analyzeRepresentativePartWarnings(version.parts);
        const performanceOrder = expandRepeats(measures);
        const warnings = [...representativePartWarnings, ...performanceOrder.warnings];
        const firstMeasureId = measures[0]?.id ?? null;
        const record = await recentStore.load(document.id);
        if (cancelled) {
          return;
        }

        const restoredZoom = record?.zoom ?? 1;
        const restoredBpm = clampBpm(record?.bpm ?? DEFAULT_BPM);
        const restoredCountInMeasures = clampCountIn(record?.countInMeasures ?? DEFAULT_COUNT_IN_MEASURES);
        const restoredStatus = normalizePersistedPlaybackStatus(record?.playbackStatus);
        const restoredSelection = (record?.currentMeasureId as StableMeasureId | undefined) ?? firstMeasureId;

        const initialPerformanceMeasureId =
          findPreferredPerformanceMeasureId(
            performanceOrder.measures,
            record?.currentPerformanceMeasureId ?? null,
            restoredSelection ?? firstMeasureId ?? null
          ) ?? performanceOrder.measures[0]?.id;

        const timeline = new PlaybackTimeline({
          performanceMeasures: performanceOrder.measures,
          measuresById,
          bpm: restoredBpm,
          countInMeasures: restoredCountInMeasures,
          clock: playbackClock,
          initialPerformanceMeasureId,
          initialStatus: restoredStatus
        });

        const initialSnapshot = timeline.getSnapshot();
        timelineRef.current = timeline;
        setStatus({
          kind: 'ready',
          document,
          version,
          representativePartName: representativePart?.name ?? 'Part 1',
          measures,
          measuresById,
          performanceMeasures: performanceOrder.measures,
          warnings,
          serverContext: loaded.serverContext
        });
        setZoom(restoredZoom);
        setBpm(restoredBpm);
        setCountInMeasures(restoredCountInMeasures);
        setPlaybackSnapshot(initialSnapshot);
        setSelectedMeasureId((initialSnapshot.currentSourceMeasureId as StableMeasureId | null) ?? restoredSelection ?? null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unexpected MusicXML parse error.';
        timelineRef.current = null;
        setRendererState({ kind: 'idle' });
        setStatus({ kind: 'parse-error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, musicXmlService, playbackClock, recentStore, requestedVersionId, sample, scoreId, sessionStore, sourceMode]);

  useEffect(() => {
    if (status.kind !== 'ready') {
      return;
    }

    let cancelled = false;
    const representativePartId = status.version.parts[0]?.id ?? null;
    setAnnotationLoadState({ kind: 'loading' });
    setAnnotationSaveState({ kind: 'idle', message: 'Loading annotations…' });
    setInteractionMode('VIEW');
    setAnnotationTool('SELECT');

    void Promise.all([
      annotationRepository.listByScore(status.document.id, status.version.id),
      annotationPreferenceStore.load(status.document.id, status.version.id),
      status.serverContext
        ? apiClient.listAnnotations(status.serverContext.accessToken, status.serverContext.scoreId, status.serverContext.scoreVersionId).catch(() => [])
        : Promise.resolve([])
    ])
      .then(async ([storedAnnotations, storedPreferences, serverAnnotations]) => {
        if (cancelled) {
          return;
        }

        const nextPartId =
          storedPreferences?.currentPartId && status.version.parts.some((part) => part.id === storedPreferences.currentPartId)
            ? storedPreferences.currentPartId
            : representativePartId;

        const mergedAnnotations = mergeAnnotations(storedAnnotations, serverAnnotations);
        if (serverAnnotations.length > 0) {
          await Promise.all(serverAnnotations.map((annotation) => annotationRepository.upsert({ ...annotation, syncState: 'SYNCED' })));
        }
        if (cancelled) {
          return;
        }

        setAnnotations(mergedAnnotations);
        setCurrentPartId(nextPartId);
        setAnnotationScope(storedPreferences?.activeScope ?? 'PRIVATE');
        setAnnotationAnchorType(storedPreferences?.activeAnchorType ?? 'MEASURE');
        setAnnotationFilters(storedPreferences?.filters ?? DEFAULT_LAYER_FILTERS);
        setAnnotationLoadState({ kind: 'ready' });
        setAnnotationSaveState({ kind: 'idle', message: 'Annotations ready.' });
        if (status.serverContext) {
          void syncPendingAnnotations(status.serverContext);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setAnnotationLoadState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Annotation storage failed to load.'
        });
        setAnnotationSaveState({ kind: 'error', message: 'Annotation storage failed to load.' });
      });

    return () => {
      cancelled = true;
    };
  }, [annotationPreferenceStore, annotationRepository, apiClient, status]);

  useEffect(() => {
    if (status.kind !== 'ready' || annotationLoadState.kind !== 'ready') {
      return;
    }

    void annotationPreferenceStore
      .save({
        scoreId: status.document.id,
        scoreVersionId: status.version.id,
        currentPartId,
        activeScope: annotationScope,
        activeAnchorType: annotationAnchorType,
        filters: annotationFilters
      })
      .catch(() => {
        // Preference persistence should not block the viewer.
      });
  }, [annotationAnchorType, annotationFilters, annotationLoadState.kind, annotationPreferenceStore, annotationScope, currentPartId, status]);

  useEffect(() => {
    if (annotationSaveState.kind !== 'saved') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAnnotationSaveState({ kind: 'idle', message: 'Annotations ready.' });
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [annotationSaveState]);

  useEffect(() => {
    if (status.kind !== 'ready' || !containerRef.current) {
      return;
    }

    let cancelled = false;
    const renderer = createVerovioScoreRenderer();
    rendererRef.current = renderer;
    setRendererState({ kind: 'loading' });
    containerRef.current.innerHTML = '';

    void renderer.mount(containerRef.current);

    void renderer
      .load(status.version, zoom)
      .then(() => {
        if (cancelled) {
          return;
        }

        renderer.onMeasureSelect((measureId) => {
          handleMeasureSelection(measureId);
        });

        if (selectedMeasureIdRef.current) {
          renderer.highlight(selectedMeasureIdRef.current);
          void renderer.scrollTo(selectedMeasureIdRef.current);
        }

        setRendererState({ kind: 'ready' });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setRendererState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Score rendering failed.'
        });
      });

    return () => {
      cancelled = true;
      renderer.destroy();
      rendererRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [rendererRetryKey, status.kind, status.kind === 'ready' ? status.version.id : null]);

  useEffect(() => {
    if (rendererState.kind === 'ready' && annotationAnchorType === 'ELEMENT' && containerRef.current) {
      const supportsElementAnchors = createAnnotationGeometryProvider(containerRef.current).supportsElementAnchors();
      if (!supportsElementAnchors) {
        setAnnotationAnchorType('MEASURE');
      }
    }
  }, [annotationAnchorType, rendererState.kind]);

  useEffect(() => {
    if (status.kind !== 'ready' || rendererState.kind !== 'ready' || !rendererRef.current || !selectedMeasureId) {
      return;
    }

    rendererRef.current.highlight(selectedMeasureId);
    void rendererRef.current.scrollTo(selectedMeasureId);
  }, [rendererState.kind, selectedMeasureId, status]);

  useEffect(() => {
    if (status.kind !== 'ready' || rendererState.kind !== 'ready' || !rendererRef.current) {
      return;
    }

    void rendererRef.current
      .setZoom(zoom)
      .then(() => {
        if (selectedMeasureIdRef.current) {
          rendererRef.current?.highlight(selectedMeasureIdRef.current);
        }
      })
      .catch((error) => {
        setRendererState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Zoom update failed.'
        });
      });
  }, [rendererState.kind, status, zoom]);

  useEffect(() => {
    if (status.kind !== 'ready') {
      return;
    }

    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    const refreshSnapshot = () => {
      const nextSnapshot = timeline.getSnapshot();
      setPlaybackSnapshot(nextSnapshot);
      if (nextSnapshot.currentSourceMeasureId) {
        setSelectedMeasureId(nextSnapshot.currentSourceMeasureId as StableMeasureId);
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        const nextSnapshot = timeline.syncAfterVisibilityChange();
        setPlaybackSnapshot(nextSnapshot);
        if (nextSnapshot.currentSourceMeasureId) {
          setSelectedMeasureId(nextSnapshot.currentSourceMeasureId as StableMeasureId);
        }
      }
    };

    const unsubscribeClock = subscribeToPlaybackClock(playbackClock, refreshSnapshot);
    document.addEventListener('visibilitychange', onVisibilityChange);

    let intervalId: number | undefined;
    if (playbackSnapshot.status === 'PLAYING' || playbackSnapshot.status === 'COUNT_IN') {
      intervalId = window.setInterval(refreshSnapshot, 100);
    }

    return () => {
      unsubscribeClock();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
    };
  }, [playbackClock, playbackSnapshot.status, status]);

  useEffect(() => {
    if (status.kind !== 'ready') {
      return;
    }

    void recentStore.save({
      scoreId: status.document.id,
      title: status.document.title,
      lastOpenedAt: Date.now(),
      currentMeasureId: selectedMeasureId ?? playbackSnapshot.currentSourceMeasureId ?? status.measures[0]?.id ?? '',
      currentPerformanceMeasureId: playbackSnapshot.currentPerformanceMeasureId ?? undefined,
      zoom,
      bpm,
      countInMeasures,
      playbackStatus: toPersistedPlaybackStatus(playbackSnapshot.status)
    });
  }, [
    bpm,
    countInMeasures,
    playbackSnapshot.currentPerformanceMeasureId,
    playbackSnapshot.currentSourceMeasureId,
    playbackSnapshot.status,
    recentStore,
    selectedMeasureId,
    status,
    zoom
  ]);

  const syncPendingAnnotations = async (serverContext: ServerViewerContext) => {
    try {
      const summary = await annotationSyncService.syncPending(serverContext.accessToken, serverContext.scoreId, serverContext.scoreVersionId);
      const queueRecords = await annotationSyncQueue.listByScore(serverContext.scoreId, serverContext.scoreVersionId);
      const refreshedAnnotations = await annotationRepository.listByScore(serverContext.scoreId, serverContext.scoreVersionId);
      setAnnotations(refreshedAnnotations);
      setAnnotationSyncState({
        message:
          summary.conflicts > 0
            ? 'Annotation sync conflict needs review.'
            : summary.failed > 0
              ? 'Annotation sync failed. Retry is available.'
              : summary.synced > 0
                ? 'Annotations synced.'
                : 'Annotation sync up to date.',
        pending: queueRecords.filter((record) => record.status === 'PENDING').length,
        failed: queueRecords.filter((record) => record.status === 'FAILED').length,
        conflicts: queueRecords.filter((record) => record.status === 'CONFLICT').length
      });
    } catch (error) {
      setAnnotationSyncState((current) => ({
        ...current,
        message: error instanceof Error ? error.message : 'Annotation sync failed.',
        failed: current.failed + 1
      }));
    }
  };

  const updatePlaybackSnapshot = (nextSnapshot: PlaybackSnapshot) => {
    setPlaybackSnapshot(nextSnapshot);
    if (nextSnapshot.currentSourceMeasureId) {
      setSelectedMeasureId(nextSnapshot.currentSourceMeasureId as StableMeasureId);
    }
  };

  const handleMeasureSelection = (measureId: StableMeasureId) => {
    setSelectedMeasureId(measureId);

    if (status.kind !== 'ready' || !timelineRef.current) {
      return;
    }

    const preferredPerformanceMeasureId = findPreferredPerformanceMeasureId(
      status.performanceMeasures,
      playbackSnapshot.currentPerformanceMeasureId,
      measureId
    );

    if (!preferredPerformanceMeasureId) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.seekToPerformanceMeasure(preferredPerformanceMeasureId));
  };

  const onPreviousMeasure = () => {
    if (status.kind !== 'ready') {
      return;
    }

    const currentIndex = status.measures.findIndex((measure) => measure.id === selectedMeasureId);
    const nextIndex = Math.max(0, currentIndex - 1);
    const nextMeasureId = status.measures[nextIndex]?.id;
    if (nextMeasureId) {
      handleMeasureSelection(nextMeasureId);
    }
  };

  const onNextMeasure = () => {
    if (status.kind !== 'ready') {
      return;
    }

    const currentIndex = status.measures.findIndex((measure) => measure.id === selectedMeasureId);
    const nextIndex = Math.min(status.measures.length - 1, currentIndex + 1);
    const nextMeasureId = status.measures[nextIndex]?.id;
    if (nextMeasureId) {
      handleMeasureSelection(nextMeasureId);
    }
  };

  const onPreviousPerformanceMeasure = () => {
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.previous());
  };

  const onNextPerformanceMeasure = () => {
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.next());
  };

  const onPlay = () => {
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.play());
  };

  const onPause = () => {
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.pause());
  };

  const onResume = () => {
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.resume());
  };

  const onStop = () => {
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.stop());
  };

  const onBpmChange = (value: string) => {
    const nextBpm = clampBpm(Number.parseInt(value, 10) || DEFAULT_BPM);
    setBpm(nextBpm);
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.setBpm(nextBpm));
  };

  const onCountInChange = (value: string) => {
    const nextCountInMeasures = clampCountIn(Number.parseInt(value, 10) || 0);
    setCountInMeasures(nextCountInMeasures);
    if (!timelineRef.current) {
      return;
    }

    updatePlaybackSnapshot(timelineRef.current.setCountInMeasures(nextCountInMeasures));
  };

  const onRetryRenderer = () => {
    setRendererRetryKey((value) => value + 1);
  };

  const upsertAnnotation = async (annotation: Annotation) => {
    setAnnotationSaveState({ kind: 'saving', message: status.kind === 'ready' && status.serverContext ? 'Saving annotation locally for sync…' : 'Saving annotation locally…' });

    try {
      const previous = annotations.find((item) => item.id === annotation.id);
      const serverContext = status.kind === 'ready' ? status.serverContext : undefined;
      const nextAnnotation: Annotation = serverContext
        ? {
            ...annotation,
            serverRevision: previous?.serverRevision ?? annotation.serverRevision ?? 0,
            syncState: 'PENDING',
            syncError: undefined
          }
        : annotation;

      await annotationRepository.upsert(nextAnnotation);
      if (serverContext) {
        await annotationSyncQueue.enqueue({
          clientMutationId: createAnnotationMutationId(),
          scoreId: serverContext.scoreId,
          scoreVersionId: serverContext.scoreVersionId,
          annotationId: nextAnnotation.id,
          action: 'UPSERT',
          baseRevision: nextAnnotation.serverRevision ?? 0,
          annotation: nextAnnotation
        });
      }

      setAnnotations((current) => upsertAnnotationRecord(current, nextAnnotation));
      setAnnotationSaveState({ kind: 'saved', message: serverContext ? 'Annotation saved locally and queued.' : 'Annotation saved locally.' });
      if (serverContext) {
        void syncPendingAnnotations(serverContext);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Annotation save failed.';
      setAnnotationSaveState({ kind: 'error', message });
      throw error;
    }
  };

  const deleteAnnotation = async (annotationId: string) => {
    setAnnotationSaveState({ kind: 'saving', message: status.kind === 'ready' && status.serverContext ? 'Deleting annotation locally for sync…' : 'Deleting annotation locally…' });

    try {
      const existing = annotations.find((annotation) => annotation.id === annotationId);
      const serverContext = status.kind === 'ready' ? status.serverContext : undefined;

      if (serverContext && existing) {
        const tombstone: Annotation = {
          ...existing,
          deletedAt: Date.now(),
          syncState: 'PENDING',
          syncError: undefined
        };
        await annotationRepository.upsert(tombstone);
        await annotationSyncQueue.enqueue({
          clientMutationId: createAnnotationMutationId(),
          scoreId: serverContext.scoreId,
          scoreVersionId: serverContext.scoreVersionId,
          annotationId,
          action: 'DELETE',
          baseRevision: existing.serverRevision ?? 0
        });
        setAnnotations((current) => upsertAnnotationRecord(current, tombstone));
        setAnnotationSaveState({ kind: 'saved', message: 'Annotation delete queued.' });
        void syncPendingAnnotations(serverContext);
      } else {
        await annotationRepository.delete(annotationId);
        setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
        setAnnotationSaveState({ kind: 'saved', message: 'Annotation deleted locally.' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Annotation delete failed.';
      setAnnotationSaveState({ kind: 'error', message });
      throw error;
    }
  };

  if (status.kind === 'not-found') {
    return (
      <section className="panel state-panel" data-testid="score-viewer-error">
        <h2>Score not found</h2>
        <p>The requested bundled sample score is not available.</p>
        <Link className="primary-link" to="/">
          Back to library
        </Link>
      </section>
    );
  }

  if (status.kind === 'parse-error') {
    return (
      <section className="panel state-panel" data-testid="score-viewer-error">
        <h2>MusicXML parse error</h2>
        <p>{status.message}</p>
        <Link className="primary-link" to="/">
          Back to library
        </Link>
      </section>
    );
  }

  if (status.kind === 'loading') {
    return (
      <main className="viewer-layout" data-testid="score-viewer-loading">
        <section className="viewer-main panel">
          <div className="panel-heading viewer-heading">
            <div>
              <p className="eyebrow">Viewer</p>
              <h2>Loading score</h2>
              <p className="muted">Preparing MusicXML parsing for the viewer route.</p>
            </div>
          </div>
          <div className="score-stage" data-testid="score-renderer">
            <p className="muted">Loading score...</p>
          </div>
        </section>

        <aside className="viewer-sidebar panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Measures</p>
              <h2>Measure list</h2>
            </div>
          </div>
        </aside>
      </main>
    );
  }

  const isRendererReady = rendererState.kind === 'ready';
  const representativePartId = status.version.parts[0]?.id ?? null;
  const elementAnchorSupported =
    rendererState.kind === 'ready' && containerRef.current ? createAnnotationGeometryProvider(containerRef.current).supportsElementAnchors() : false;
  const performanceAnchorAvailable = playbackSnapshot.currentPerformanceMeasureId != null;
  const annotationInputBlocked = playbackSnapshot.status === 'PLAYING' || playbackSnapshot.status === 'COUNT_IN';
  const annotationInputMessage = annotationInputBlocked
    ? 'Pause or stop playback before creating or editing annotations.'
    : interactionMode === 'VIEW'
      ? 'Viewer gestures stay active in view mode.'
      : 'Annotation input is active.';

  return (
    <main className="viewer-layout" data-testid={isRendererReady ? 'score-viewer-ready' : 'score-viewer-loading'}>
      <section className="viewer-main panel">
        <div className="panel-heading viewer-heading">
          <div>
            <p className="eyebrow">Viewer</p>
            <h2>{status.document.title}</h2>
            <p className="muted">{status.document.composer ?? 'Unknown composer'}</p>
          </div>
          <div className="viewer-actions">
            <button
              type="button"
              className="control-button"
              data-testid="previous-measure"
              onClick={onPreviousMeasure}
              disabled={!selectedMeasureId}
            >
              Previous measure
            </button>
            <button
              type="button"
              className="control-button"
              data-testid="next-measure"
              onClick={onNextMeasure}
              disabled={!selectedMeasureId}
            >
              Next measure
            </button>
            <button
              type="button"
              className="control-button"
              data-testid="previous-performance-measure"
              onClick={onPreviousPerformanceMeasure}
              disabled={!playbackSnapshot.currentPerformanceMeasureId}
            >
              Prev occurrence
            </button>
            <button
              type="button"
              className="control-button"
              data-testid="next-performance-measure"
              onClick={onNextPerformanceMeasure}
              disabled={!playbackSnapshot.currentPerformanceMeasureId}
            >
              Next occurrence
            </button>
            <button
              type="button"
              className="control-button"
              onClick={() => setZoom((value) => Math.max(0.6, Number((value - 0.1).toFixed(1))))}
            >
              -
            </button>
            <button
              type="button"
              className="control-button"
              onClick={() => setZoom((value) => Math.min(1.8, Number((value + 0.1).toFixed(1))))}
            >
              +
            </button>
          </div>
        </div>

        <div className="viewer-summary">
          <div>
            <span className="summary-label">Current source measure</span>
            <strong data-testid="current-measure-id">{selectedMeasureId ?? 'none'}</strong>
          </div>
          <div>
            <span className="summary-label">Current occurrence</span>
            <strong data-testid="current-performance-measure-id">{playbackSnapshot.currentPerformanceMeasureId ?? 'none'}</strong>
          </div>
          <div>
            <span className="summary-label">Playback state</span>
            <strong data-testid="playback-status">{playbackSnapshot.status}</strong>
          </div>
          <div>
            <span className="summary-label">Current beat</span>
            <strong data-testid="playback-current-beat">{playbackSnapshot.currentBeat}</strong>
          </div>
          <div>
            <span className="summary-label">Occurrence number</span>
            <strong data-testid="current-occurrence">{playbackSnapshot.currentOccurrence ?? 0}</strong>
          </div>
          <div>
            <span className="summary-label">Representative part</span>
            <strong>{status.representativePartName}</strong>
          </div>
          <div>
            <span className="summary-label">Warnings</span>
            <strong>{status.warnings.length}</strong>
          </div>
          <div>
            <span className="summary-label">Zoom</span>
            <strong data-testid="viewer-zoom">{zoom.toFixed(1)}x</strong>
          </div>
        </div>

        <div className="playback-panel">
          <div className="playback-panel__controls">
            <label className="field">
              <span>BPM</span>
              <input
                data-testid="playback-bpm"
                type="number"
                min={40}
                max={240}
                step={1}
                value={bpm}
                onChange={(event) => onBpmChange(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Count-in</span>
              <select data-testid="playback-count-in" value={countInMeasures} onChange={(event) => onCountInChange(event.target.value)}>
                <option value={0}>0 bars</option>
                <option value={1}>1 bar</option>
                <option value={2}>2 bars</option>
              </select>
            </label>

            <div className="playback-button-row">
              <button
                type="button"
                className="control-button"
                data-testid="playback-play"
                onClick={onPlay}
                disabled={playbackSnapshot.status === 'PLAYING' || playbackSnapshot.status === 'COUNT_IN'}
              >
                Play
              </button>
              <button
                type="button"
                className="control-button"
                data-testid="playback-pause"
                onClick={onPause}
                disabled={playbackSnapshot.status !== 'PLAYING' && playbackSnapshot.status !== 'COUNT_IN'}
              >
                Pause
              </button>
              <button
                type="button"
                className="control-button"
                data-testid="playback-resume"
                onClick={onResume}
                disabled={playbackSnapshot.status !== 'PAUSED'}
              >
                Resume
              </button>
              <button
                type="button"
                className="control-button"
                data-testid="playback-stop"
                onClick={onStop}
                disabled={playbackSnapshot.status === 'STOPPED'}
              >
                Stop
              </button>
            </div>
          </div>

          <div className="playback-panel__status">
            <div>
              <span className="summary-label">Count-in remaining</span>
              <strong data-testid="playback-count-in-remaining">{Math.ceil(playbackSnapshot.countInRemainingMs)}</strong>
            </div>
            <div>
              <span className="summary-label">Performance measures</span>
              <strong>{status.performanceMeasures.length}</strong>
            </div>
            <div>
              <span className="summary-label">Warnings</span>
              <strong data-testid="playback-warning-count">{status.warnings.length}</strong>
            </div>
          </div>

          {status.warnings.length > 0 ? (
            <ul className="warning-list" data-testid="playback-warning-list">
              {status.warnings.map((warning) => (
                <li key={`${warning.code}:${warning.sourceMeasureId ?? 'global'}`} className={`warning-item warning-item--${warning.severity.toLowerCase()}`}>
                  <strong>{warning.code}</strong>
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="annotation-toolbar" data-testid="annotation-toolbar">
          <div className="annotation-toolbar__row">
            <span className="summary-label">Mode</span>
            <div className="annotation-toolbar__buttons">
              <button
                type="button"
                className={`control-button${interactionMode === 'VIEW' ? ' is-active' : ''}`}
                onClick={() => setInteractionMode('VIEW')}
              >
                View mode
              </button>
              <button
                type="button"
                className={`control-button${interactionMode === 'ANNOTATE' ? ' is-active' : ''}`}
                onClick={() => setInteractionMode('ANNOTATE')}
              >
                Annotate mode
              </button>
            </div>
          </div>

          <div className="annotation-toolbar__grid">
            <label className="field">
              <span>Tool</span>
              <select value={annotationTool} onChange={(event) => setAnnotationTool(event.target.value as ViewerAnnotationTool)}>
                <option value="SELECT">Select</option>
                <option value="PEN">Pen</option>
                <option value="HIGHLIGHTER">Highlighter</option>
                <option value="ERASER">Eraser</option>
                <option value="TEXT">Text note</option>
              </select>
            </label>

            <label className="field">
              <span>Scope</span>
              <select value={annotationScope} onChange={(event) => setAnnotationScope(event.target.value as AnnotationScope)}>
                <option value="PRIVATE">Private</option>
                <option value="PART">Part</option>
                <option value="ENSEMBLE">Ensemble</option>
              </select>
            </label>

            <label className="field">
              <span>Anchor</span>
              <select
                value={annotationAnchorType}
                onChange={(event) => setAnnotationAnchorType(event.target.value as AnnotationAnchor['type'])}
              >
                <option value="MEASURE">Measure</option>
                <option value="ELEMENT" disabled={!elementAnchorSupported}>
                  Element
                </option>
                <option value="PERFORMANCE_MEASURE" disabled={!performanceAnchorAvailable}>
                  Performance measure
                </option>
              </select>
            </label>

            <label className="field">
              <span>Current part</span>
              <select value={currentPartId ?? representativePartId ?? ''} onChange={(event) => setCurrentPartId(event.target.value || null)}>
                {status.version.parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="annotation-toolbar__row">
            <span className="summary-label">Layer filters</span>
            <div className="annotation-filter-list">
              <label>
                <input
                  type="checkbox"
                  checked={annotationFilters.privateVisible}
                  onChange={(event) => setAnnotationFilters((current) => ({ ...current, privateVisible: event.target.checked }))}
                />
                Private
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={annotationFilters.partVisible}
                  onChange={(event) => setAnnotationFilters((current) => ({ ...current, partVisible: event.target.checked }))}
                />
                Part
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={annotationFilters.ensembleVisible}
                  onChange={(event) => setAnnotationFilters((current) => ({ ...current, ensembleVisible: event.target.checked }))}
                />
                Ensemble
              </label>
            </div>
          </div>

          <div className="annotation-toolbar__status">
            <div>
              <span className="summary-label">Input</span>
              <strong>{annotationInputMessage}</strong>
            </div>
          <div>
            <span className="summary-label">Save status</span>
            <strong data-testid="annotation-save-status">{annotationSaveState.message}</strong>
          </div>
          <div>
            <span className="summary-label">Sync status</span>
            <strong data-testid="annotation-sync-status">
              {annotationSyncState.message} P{annotationSyncState.pending} F{annotationSyncState.failed} C{annotationSyncState.conflicts}
            </strong>
          </div>
          <div>
            <span className="summary-label">Annotations</span>
            <strong>{annotations.length}</strong>
          </div>
        </div>

          {status.serverContext && (annotationSyncState.failed > 0 || annotationSyncState.conflicts > 0) ? (
            <button
              type="button"
              className="control-button"
              data-testid="annotation-sync-retry"
              onClick={() => void syncPendingAnnotations(status.serverContext!)}
            >
              Retry annotation sync
            </button>
          ) : null}

          {!elementAnchorSupported ? (
            <p className="annotation-toolbar__notice">
              Element anchors are unavailable for the current parser and fixtures because no stable source element IDs are exposed yet.
            </p>
          ) : null}
        </div>

        {rendererState.kind === 'loading' ? (
          <div className="panel state-panel stage-state" data-testid="score-renderer-loading">
            <h3>Loading renderer</h3>
            <p>Verovio is loading for this viewer route.</p>
          </div>
        ) : null}

        {rendererState.kind === 'error' ? (
          <div className="panel state-panel stage-state" data-testid="score-viewer-error">
            <h3>Renderer error</h3>
            <p>{rendererState.message}</p>
            <button type="button" className="primary-link" data-testid="score-renderer-retry" onClick={onRetryRenderer}>
              Retry renderer
            </button>
          </div>
        ) : null}
        <div className="score-stage">
          <div className="score-stage__renderer" ref={containerRef} data-testid="score-renderer" />
          {annotationLoadState.kind === 'loading' ? (
            <div className="annotation-inline-state">
              <p>Loading annotations…</p>
            </div>
          ) : null}
          {annotationLoadState.kind === 'error' ? (
            <div className="annotation-inline-state" data-testid="annotation-overlay-error">
              <p>{annotationLoadState.message}</p>
            </div>
          ) : null}
          {annotationLoadState.kind === 'ready' ? (
            <AnnotationOverlay
              stageRef={containerRef}
              rendererReady={rendererState.kind === 'ready'}
              scoreId={status.document.id}
              scoreVersionId={status.version.id}
              annotations={annotations}
              filters={annotationFilters}
              currentPartId={currentPartId}
              currentPerformanceMeasureId={playbackSnapshot.currentPerformanceMeasureId}
              playbackStatus={playbackSnapshot.status}
              mode={interactionMode}
              tool={annotationTool}
              scope={annotationScope}
              anchorType={annotationAnchorType}
              onUpsertAnnotation={upsertAnnotation}
              onDeleteAnnotation={deleteAnnotation}
              onRequestViewMode={() => setInteractionMode('VIEW')}
            />
          ) : null}
        </div>
      </section>

      <aside className="viewer-sidebar panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Measures</p>
            <h2>Measure list</h2>
          </div>
        </div>

        <ul className="measure-list">
          {status.measures.map((measure) => (
            <li key={measure.id}>
              <button
                type="button"
                className={`measure-item${selectedMeasureId === measure.id ? ' is-active' : ''}`}
                data-measure-id={measure.id}
                onClick={() => handleMeasureSelection(measure.id)}
              >
                <span className="measure-item__number">M{measure.number}</span>
                <span className="measure-item__meta">
                  {measure.timeSignature ? `${measure.timeSignature.beats}/${measure.timeSignature.beatType}` : 'no meter'}
                </span>
                <span className="measure-item__meta">
                  {measure.navigationMarks.length > 0
                    ? measure.navigationMarks.map((mark) => mark.type).join(', ')
                    : measure.chordSymbols.length > 0
                      ? measure.chordSymbols.join(', ')
                      : 'plain measure'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="viewer-footer">
          <Link className="secondary-link" to="/">
            Library
          </Link>
          <button type="button" className="secondary-link" onClick={() => navigate(0)}>
            Reload
          </button>
        </div>
      </aside>
    </main>
  );
}

function upsertAnnotationRecord(current: Annotation[], next: Annotation): Annotation[] {
  const existingIndex = current.findIndex((annotation) => annotation.id === next.id);
  if (existingIndex === -1) {
    return [...current, next].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  const updated = [...current];
  updated[existingIndex] = next;
  return updated.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function mergeAnnotations(localAnnotations: Annotation[], serverAnnotations: Annotation[]): Annotation[] {
  const merged = new Map<string, Annotation>();
  localAnnotations.forEach((annotation) => merged.set(annotation.id, annotation));
  serverAnnotations.forEach((annotation) => {
    const local = merged.get(annotation.id);
    if (local?.syncState === 'PENDING' || local?.syncState === 'CONFLICT' || local?.syncState === 'FAILED') {
      return;
    }
    merged.set(annotation.id, { ...annotation, syncState: 'SYNCED' });
  });
  return [...merged.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function createAnnotationMutationId(): string {
  return `mut_${crypto.randomUUID()}`;
}

function clampBpm(value: number): number {
  return Math.max(40, Math.min(240, value));
}

function clampCountIn(value: number): number {
  return Math.max(0, Math.min(2, value));
}

function normalizePersistedPlaybackStatus(status: string | undefined): PlaybackStatus {
  return status === 'PAUSED' ? 'PAUSED' : 'STOPPED';
}

function toPersistedPlaybackStatus(status: PlaybackStatus): 'STOPPED' | 'PAUSED' {
  return status === 'PLAYING' || status === 'COUNT_IN' || status === 'PAUSED' ? 'PAUSED' : 'STOPPED';
}

function findPreferredPerformanceMeasureId(
  performanceMeasures: PerformanceMeasure[],
  currentPerformanceMeasureId: string | null,
  sourceMeasureId: string | null
): string | null {
  if (!sourceMeasureId) {
    return null;
  }

  const matchingMeasures = performanceMeasures.filter((measure) => measure.sourceMeasureId === sourceMeasureId);
  if (matchingMeasures.length === 0) {
    return null;
  }

  if (!currentPerformanceMeasureId) {
    return matchingMeasures[0].id;
  }

  const currentIndex = performanceMeasures.findIndex((measure) => measure.id === currentPerformanceMeasureId);
  const currentMatch = matchingMeasures.find((measure) => measure.id === currentPerformanceMeasureId);
  if (currentMatch) {
    return currentMatch.id;
  }

  const futureMatch = matchingMeasures.find((measure) => measure.orderIndex >= currentIndex);
  return futureMatch?.id ?? matchingMeasures[0].id;
}
