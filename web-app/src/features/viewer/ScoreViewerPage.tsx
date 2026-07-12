import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
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
import { createMusicXMLService } from '../../core/musicxml/parser';
import { createVerovioScoreRenderer } from '../../core/rendering/verovioScoreRenderer';
import { createRecentScoreStore } from '../../core/storage/recentScoreStore';
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
    }
  | { kind: 'not-found' }
  | { kind: 'parse-error'; message: string };

type RendererState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export function ScoreViewerPage() {
  const { scoreId = '' } = useParams();
  const navigate = useNavigate();
  const rendererRef = useRef<ReturnType<typeof createVerovioScoreRenderer> | null>(null);
  const timelineRef = useRef<PlaybackTimeline | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedMeasureIdRef = useRef<StableMeasureId | null>(null);
  const playbackClock = useMemo(() => createBrowserPlaybackClock(), []);
  const recentStore = useMemo(() => createRecentScoreStore(), []);
  const musicXmlService = useMemo(() => createMusicXMLService(), []);
  const sample = useMemo(() => getSampleById(scoreId), [scoreId]);
  const [status, setStatus] = useState<ViewerStatus>({ kind: 'loading' });
  const [rendererState, setRendererState] = useState<RendererState>({ kind: 'idle' });
  const [rendererRetryKey, setRendererRetryKey] = useState(0);
  const [selectedMeasureId, setSelectedMeasureId] = useState<StableMeasureId | null>(null);
  const [zoom, setZoom] = useState(1);
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [countInMeasures, setCountInMeasures] = useState(DEFAULT_COUNT_IN_MEASURES);
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
    if (!sample) {
      timelineRef.current = null;
      setRendererState({ kind: 'idle' });
      setStatus({ kind: 'not-found' });
      return;
    }

    let cancelled = false;
    setRendererRetryKey(0);
    setRendererState({ kind: 'idle' });
    setStatus({ kind: 'loading' });

    try {
      const parsed = musicXmlService.parse(sample.sourceXml, {
        scoreId: sample.id,
        sample: true
      });

      const representativePart = parsed.version.parts[0];
      const measures = representativePart?.measures ?? [];
      const measuresById = Object.fromEntries(measures.map((measure) => [measure.id, measure]));
      const representativePartWarnings = analyzeRepresentativePartWarnings(parsed.version.parts);
      const performanceOrder = expandRepeats(measures);
      const warnings = [...representativePartWarnings, ...performanceOrder.warnings];
      const firstMeasureId = measures[0]?.id ?? null;

      void recentStore.load(parsed.document.id).then((record) => {
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
          document: parsed.document,
          version: parsed.version,
          representativePartName: representativePart?.name ?? 'Part 1',
          measures,
          measuresById,
          performanceMeasures: performanceOrder.measures,
          warnings
        });
        setZoom(restoredZoom);
        setBpm(restoredBpm);
        setCountInMeasures(restoredCountInMeasures);
        setPlaybackSnapshot(initialSnapshot);
        setSelectedMeasureId((initialSnapshot.currentSourceMeasureId as StableMeasureId | null) ?? restoredSelection ?? null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected MusicXML parse error.';
      timelineRef.current = null;
      setRendererState({ kind: 'idle' });
      setStatus({ kind: 'parse-error', message });
    }

    return () => {
      cancelled = true;
    };
  }, [musicXmlService, playbackClock, recentStore, sample]);

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

        <div className="score-stage" ref={containerRef} data-testid="score-renderer" />
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
