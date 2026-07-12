import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Measure, ScoreDocument, ScoreVersion, StableMeasureId } from '@cuenote/score-domain';
import { createMusicXMLService } from '../../core/musicxml/parser';
import { createRecentScoreStore } from '../../core/storage/recentScoreStore';
import { createVerovioScoreRenderer } from '../../core/rendering/verovioScoreRenderer';
import { getSampleById } from '../../samples/catalog';

type ViewerStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; document: ScoreDocument; version: ScoreVersion; measures: Measure[] }
  | { kind: 'not-found' }
  | { kind: 'parse-error'; message: string }
  | { kind: 'render-error'; message: string };

export function ScoreViewerPage() {
  const { scoreId = '' } = useParams();
  const navigate = useNavigate();
  const rendererRef = useRef<ReturnType<typeof createVerovioScoreRenderer> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedMeasureIdRef = useRef<StableMeasureId | null>(null);
  const recentStore = useMemo(() => createRecentScoreStore(), []);
  const musicXmlService = useMemo(() => createMusicXMLService(), []);
  const sample = useMemo(() => getSampleById(scoreId), [scoreId]);
  const [status, setStatus] = useState<ViewerStatus>({ kind: 'loading' });
  const [selectedMeasureId, setSelectedMeasureId] = useState<StableMeasureId | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    selectedMeasureIdRef.current = selectedMeasureId;
  }, [selectedMeasureId]);

  useEffect(() => {
    if (!sample) {
      setStatus({ kind: 'not-found' });
      return;
    }

    let cancelled = false;

    try {
      const parsed = musicXmlService.parse(sample.sourceXml, {
        scoreId: sample.id,
        sample: true
      });
      const measures = parsed.version.parts.flatMap((part) => part.measures);
      const firstMeasureId = measures[0]?.id ?? null;

      void recentStore.load(parsed.document.id).then((record) => {
        if (cancelled) {
          return;
        }

        setStatus({ kind: 'ready', document: parsed.document, version: parsed.version, measures });
        setSelectedMeasureId(record?.currentMeasureId ?? firstMeasureId);
        setZoom(record?.zoom ?? 1);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 파싱 오류';
      setStatus({ kind: 'parse-error', message });
    }

    return () => {
      cancelled = true;
    };
  }, [musicXmlService, recentStore, sample]);

  useEffect(() => {
    if (status.kind !== 'ready' || !containerRef.current) {
      return;
    }

    let cancelled = false;
    const renderer = createVerovioScoreRenderer();
    rendererRef.current = renderer;
    renderer.mount(containerRef.current).catch(() => undefined);

    void renderer
      .load(status.version, zoom)
      .then(() => {
        if (cancelled) {
          return;
        }

        renderer.onMeasureSelect((measureId) => {
          setSelectedMeasureId(measureId);
        });

        if (selectedMeasureIdRef.current) {
          renderer.highlight(selectedMeasureIdRef.current);
          void renderer.scrollTo(selectedMeasureIdRef.current);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setStatus({
          kind: 'render-error',
          message: error instanceof Error ? error.message : '악보 렌더링에 실패했습니다.'
        });
      });

    return () => {
      cancelled = true;
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [status.kind, status.kind === 'ready' ? status.version : null]);

  useEffect(() => {
    if (status.kind !== 'ready' || !rendererRef.current || !selectedMeasureId) {
      return;
    }

    rendererRef.current.highlight(selectedMeasureId);
    void rendererRef.current.scrollTo(selectedMeasureId);
    void recentStore.save({
      scoreId: status.document.id,
      title: status.document.title,
      lastOpenedAt: Date.now(),
      currentMeasureId: selectedMeasureId,
      zoom
    });
  }, [recentStore, selectedMeasureId, status, zoom]);

  useEffect(() => {
    if (status.kind !== 'ready' || !rendererRef.current) {
      return;
    }

    void rendererRef.current.setZoom(zoom);
  }, [status, zoom]);

  const onPreviousMeasure = () => {
    if (status.kind !== 'ready') {
      return;
    }

    const currentIndex = status.measures.findIndex((measure) => measure.id === selectedMeasureId);
    const nextIndex = Math.max(0, currentIndex - 1);
    setSelectedMeasureId(status.measures[nextIndex]?.id ?? selectedMeasureId);
  };

  const onNextMeasure = () => {
    if (status.kind !== 'ready') {
      return;
    }

    const currentIndex = status.measures.findIndex((measure) => measure.id === selectedMeasureId);
    const nextIndex = Math.min(status.measures.length - 1, currentIndex + 1);
    setSelectedMeasureId(status.measures[nextIndex]?.id ?? selectedMeasureId);
  };

  const onMeasureClick = (measureId: StableMeasureId) => {
    setSelectedMeasureId(measureId);
  };

  if (status.kind === 'not-found') {
    return (
      <section className="panel state-panel" data-testid="score-viewer-error">
        <h2>악보를 찾을 수 없습니다.</h2>
        <p>존재하지 않는 샘플입니다.</p>
        <Link className="primary-link" to="/">
          라이브러리로 돌아가기
        </Link>
      </section>
    );
  }

  if (status.kind === 'parse-error') {
    return (
      <section className="panel state-panel" data-testid="score-viewer-error">
        <h2>MusicXML 파싱 오류</h2>
        <p>{status.message}</p>
        <Link className="primary-link" to="/">
          라이브러리로 돌아가기
        </Link>
      </section>
    );
  }

  if (status.kind === 'render-error') {
    return (
      <section className="panel state-panel" data-testid="score-viewer-error">
        <h2>렌더링 오류</h2>
        <p>{status.message}</p>
        <Link className="primary-link" to="/">
          라이브러리로 돌아가기
        </Link>
      </section>
    );
  }

  if (status.kind === 'loading') {
    return (
      <main className="viewer-layout">
        <section className="viewer-main panel">
          <div className="panel-heading viewer-heading">
            <div>
              <p className="eyebrow">Viewer</p>
              <h2>Loading score</h2>
              <p className="muted">불러오는 중...</p>
            </div>
          </div>
          <div className="score-stage" ref={containerRef} data-testid="score-renderer">
            <p className="muted">불러오는 중...</p>
          </div>
        </section>

        <aside className="viewer-sidebar panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Measures</p>
              <h2>마디 목록</h2>
            </div>
          </div>
        </aside>
      </main>
    );
  }

  return (
    <main className="viewer-layout" data-testid="score-viewer-ready">
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
              이전 마디
            </button>
            <button
              type="button"
              className="control-button"
              data-testid="next-measure"
              onClick={onNextMeasure}
              disabled={!selectedMeasureId}
            >
              다음 마디
            </button>
            <button type="button" className="control-button" onClick={() => setZoom((value) => Math.max(0.6, Number((value - 0.1).toFixed(1))))}>
              -
            </button>
            <button type="button" className="control-button" onClick={() => setZoom((value) => Math.min(1.8, Number((value + 0.1).toFixed(1))))}>
              +
            </button>
          </div>
        </div>

        <div className="viewer-summary">
          <div>
            <span className="summary-label">현재 선택 마디</span>
            <strong data-testid="current-measure-id">{selectedMeasureId ?? 'none'}</strong>
          </div>
          <div>
            <span className="summary-label">Zoom</span>
            <strong data-testid="viewer-zoom">{zoom.toFixed(1)}x</strong>
          </div>
          <div>
            <span className="summary-label">Measures</span>
            <strong>{status.measures.length}</strong>
          </div>
        </div>

        <div className="score-stage" ref={containerRef} data-testid="score-renderer">
          {status.kind === 'loading' ? <p className="muted">불러오는 중...</p> : null}
        </div>
      </section>

      <aside className="viewer-sidebar panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Measures</p>
            <h2>마디 목록</h2>
          </div>
        </div>

        <ul className="measure-list">
          {status.measures.map((measure) => (
            <li key={measure.id}>
              <button
                type="button"
                className={`measure-item${selectedMeasureId === measure.id ? ' is-active' : ''}`}
                data-measure-id={measure.id}
                onClick={() => onMeasureClick(measure.id)}
              >
                <span className="measure-item__number">M{measure.number}</span>
                <span className="measure-item__meta">
                  {measure.timeSignature ? `${measure.timeSignature.beats}/${measure.timeSignature.beatType}` : 'no meter'}
                </span>
                <span className="measure-item__meta">
                  {measure.chordSymbols.length > 0 ? measure.chordSymbols.join(', ') : 'no chord'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="viewer-footer">
          <Link className="secondary-link" to="/">
            라이브러리
          </Link>
          <button type="button" className="secondary-link" onClick={() => navigate(0)}>
            새로고침
          </button>
        </div>
      </aside>
    </main>
  );
}
