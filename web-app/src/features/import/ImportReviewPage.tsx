import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  applyImportCorrections,
  createOmrPreparationManifest,
  normalizedRectToPixel,
  validateImportRegions,
  type ImportCorrection,
  type ImportInteractionMode,
  type ImportRegion
} from '@cuenote/score-domain';
import { createImportProjectRepository, type ImportProjectBundle } from '../../core/storage/importProjectRepository';

export function ImportReviewPage() {
  const { projectId } = useParams();
  const repository = useMemo(() => createImportProjectRepository(), []);
  const [bundle, setBundle] = useState<ImportProjectBundle | null>(null);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportInteractionMode>('SELECT');
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('가져오기 프로젝트를 불러오는 중입니다.');
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; region: ImportRegion } | null>(null);

  const refresh = async () => {
    if (!projectId) {
      return;
    }
    const next = await repository.loadProject(projectId);
    setBundle(next);
    setCurrentPageId((current) => current ?? next?.preferences?.currentPageId ?? next?.project.currentPageId ?? next?.pages[0]?.id ?? null);
    setZoom(next?.preferences?.zoom ?? 1);
    setStatus(
      next
        ? next.project.status === 'REVIEW_COMPLETE'
          ? '검수가 완료되었습니다. OMR 준비 manifest를 사용할 수 있습니다.'
          : '레이아웃 영역을 검수하고 수정 내용을 저장하세요.'
        : '가져오기 프로젝트를 찾을 수 없습니다.'
    );
  };

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const currentPage = bundle?.pages.find((page) => page.id === currentPageId) ?? bundle?.pages[0] ?? null;
  const currentSnapshot = currentPage ? bundle?.snapshots.find((snapshot) => snapshot.pageId === currentPage.id) ?? null : null;
  const currentCorrections = currentPage ? bundle?.corrections.filter((correction) => correction.pageId === currentPage.id) ?? [] : [];
  const effectiveRegions = useMemo(() => applyImportCorrections(currentSnapshot ?? null, currentCorrections), [currentSnapshot, currentCorrections]);
  const selectedRegion = effectiveRegions.find((region) => region.id === selectedRegionId) ?? null;
  const validationIssues = currentPage ? validateImportRegions(currentPage, effectiveRegions) : [];

  const saveCorrection = async (operation: ImportCorrection['operation']) => {
    if (!bundle || !currentPage) {
      return;
    }
    const correction: ImportCorrection = {
      id: `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      projectId: bundle.project.id,
      pageId: currentPage.id,
      createdAt: Date.now(),
      operation
    };
    await repository.saveCorrection(correction);
    await repository.saveProject({ ...bundle.project, status: 'NEEDS_REVIEW', updatedAt: Date.now() });
    setStatus('수정 내용을 로컬에 저장했습니다.');
    await refresh();
  };

  const addRegion = (type: ImportRegion['type']) => {
    if (!currentPage) {
      return;
    }
    const system = effectiveRegions.find((region) => region.type === 'SYSTEM');
    const parentId = type === 'SYSTEM' ? null : selectedRegion?.type === 'SYSTEM' ? selectedRegion.id : system?.id ?? null;
    const region: ImportRegion = {
      id: `${currentPage.id}:${type.toLowerCase()}:user:${Date.now().toString(36)}`,
      type,
      pageId: currentPage.id,
      parentId,
      rect: type === 'SYSTEM' ? { x: 0.1, y: 0.18, width: 0.8, height: 0.22 } : { x: 0.12, y: 0.22, width: 0.26, height: 0.16 },
      orderIndex: effectiveRegions.filter((candidate) => candidate.type === type).length,
      confidence: 1,
      source: 'USER'
    };
    void saveCorrection({ type: 'ADD', region });
    setSelectedRegionId(region.id);
  };

  const deleteSelected = () => {
    if (selectedRegionId) {
      void saveCorrection({ type: 'DELETE', regionId: selectedRegionId });
      setSelectedRegionId(null);
    }
  };

  const splitSelected = () => {
    if (!selectedRegion) {
      return;
    }
    void saveCorrection({
      type: 'SPLIT',
      regionId: selectedRegion.id,
      axis: selectedRegion.type === 'MEASURE' ? 'vertical' : 'horizontal',
      ratio: 0.5,
      firstId: `${selectedRegion.id}:a`,
      secondId: `${selectedRegion.id}:b`
    });
  };

  const mergeFirstTwoMeasures = () => {
    const measures = effectiveRegions.filter((region) => region.type === 'MEASURE').slice(0, 2);
    if (measures.length === 2) {
      void saveCorrection({ type: 'MERGE', regionIds: measures.map((region) => region.id), mergedId: `${currentPage?.id}:measure:merged:${Date.now().toString(36)}` });
    }
  };

  const reorderMeasures = () => {
    const measures = effectiveRegions.filter((region) => region.type === 'MEASURE');
    void saveCorrection({ type: 'REORDER', orderedRegionIds: measures.map((region) => region.id).reverse() });
  };

  const resetPage = async () => {
    if (!currentPage) {
      return;
    }
    await repository.clearCorrections(currentPage.id);
    setSelectedRegionId(null);
    setStatus('이 페이지의 수정 내용을 감지 결과 초기 상태로 되돌렸습니다.');
    await refresh();
  };

  const completeReview = async () => {
    if (!bundle) {
      return;
    }
    const allIssues = bundle.pages.flatMap((page) => {
      const snapshot = bundle.snapshots.find((candidate) => candidate.pageId === page.id) ?? null;
      const corrections = bundle.corrections.filter((correction) => correction.pageId === page.id);
      return validateImportRegions(page, applyImportCorrections(snapshot, corrections));
    });
    if (allIssues.some((issue) => issue.blocking)) {
      setStatus('검수가 완료되지 않았습니다. 먼저 차단 수준의 검증 문제를 해결하세요.');
      return;
    }

    const completedAt = Date.now();
    await Promise.all(bundle.pages.map((page) => repository.savePage({ ...page, status: 'REVIEW_COMPLETE', updatedAt: completedAt })));
    await repository.saveProject({ ...bundle.project, status: 'REVIEW_COMPLETE', completedAt, updatedAt: completedAt });
    setStatus('검수가 완료되었습니다. OMR 준비 manifest를 사용할 수 있습니다.');
    await refresh();
  };

  const savePreferences = async (pageId: string | null, nextZoom = zoom) => {
    if (!bundle) {
      return;
    }
    await repository.savePreferences({
      projectId: bundle.project.id,
      currentPageId: pageId,
      zoom: nextZoom,
      pan: { x: 0, y: 0 },
      interactionMode: mode,
      updatedAt: Date.now()
    });
  };

  const manifestPreview =
    bundle && bundle.source
      ? createOmrPreparationManifest({
          project: bundle.project,
          source: bundle.source,
          pages: bundle.pages,
          snapshots: bundle.snapshots,
          corrections: bundle.corrections
        })
      : null;

  if (!bundle || !currentPage) {
    return (
      <main className="state-panel">
        <section className="panel">
          <h2>가져오기 검수</h2>
          <p data-testid="import-review-status">{status}</p>
          <Link to="/imports" className="secondary-link">
            가져오기 목록으로
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="import-review-layout">
      <section className="panel import-review-main">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">레이아웃 검수</p>
            <h2>{bundle.project.title}</h2>
            <p className="muted" data-testid="import-review-status">
              {status}
            </p>
          </div>
          <Link className="secondary-link" to="/imports">
            가져오기 목록
          </Link>
          <Link className="primary-link" to={`/imports/${bundle.project.id}/omr`} data-testid="open-omr-runtime">
            OMR 실행
          </Link>
        </div>

        <div className="import-toolbar">
          <label className="field">
            <span>모드</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as ImportInteractionMode)} data-testid="import-mode">
              <option value="PAN">이동</option>
              <option value="SELECT">선택</option>
              <option value="ADD_SYSTEM">시스템 추가</option>
              <option value="ADD_STAFF">보표 추가</option>
              <option value="ADD_MEASURE">마디 추가</option>
              <option value="SPLIT">나누기</option>
              <option value="MERGE">합치기</option>
              <option value="DELETE">삭제</option>
            </select>
          </label>
          <div className="playback-button-row">
            <button type="button" className="control-button" onClick={() => addRegion('SYSTEM')} data-testid="add-system-region">
              시스템 추가
            </button>
            <button type="button" className="control-button" onClick={() => addRegion('STAFF')} data-testid="add-staff-region">
              보표 추가
            </button>
            <button type="button" className="control-button" onClick={() => addRegion('MEASURE')} data-testid="add-measure-region">
              마디 추가
            </button>
            <button type="button" className="control-button" onClick={splitSelected} disabled={!selectedRegion} data-testid="split-region">
              나누기
            </button>
            <button type="button" className="control-button" onClick={mergeFirstTwoMeasures} data-testid="merge-regions">
              합치기
            </button>
            <button type="button" className="control-button" onClick={reorderMeasures} data-testid="reorder-regions">
              순서 뒤집기
            </button>
            <button type="button" className="control-button" onClick={deleteSelected} disabled={!selectedRegionId} data-testid="delete-region">
              삭제
            </button>
            <button type="button" className="control-button" onClick={() => void resetPage()} data-testid="reset-regions">
              초기화
            </button>
          </div>
          <div className="playback-button-row">
            <button
              type="button"
              className="control-button"
              onClick={() => {
                const nextZoom = Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10);
                setZoom(nextZoom);
                void savePreferences(currentPage.id, nextZoom);
              }}
            >
              -
            </button>
            <span data-testid="import-zoom">{zoom.toFixed(1)}x</span>
            <button
              type="button"
              className="control-button"
              onClick={() => {
                const nextZoom = Math.min(2, Math.round((zoom + 0.1) * 10) / 10);
                setZoom(nextZoom);
                void savePreferences(currentPage.id, nextZoom);
              }}
            >
              +
            </button>
            <button type="button" className="primary-link" onClick={() => void completeReview()} data-testid="complete-import-review">
              검수 완료
            </button>
          </div>
        </div>

        <div className="import-page-stage" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} data-testid="import-review-stage">
          {currentPage.thumbnailDataUrl ? <img src={currentPage.thumbnailDataUrl} alt="" className="import-page-image" /> : <div className="import-page-placeholder">미리보기가 없습니다</div>}
          <div
            className="import-region-overlay"
            ref={overlayRef}
            data-testid="import-region-overlay"
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || !overlayRef.current) {
                return;
              }
              const box = overlayRef.current.getBoundingClientRect();
              const deltaX = (event.clientX - drag.startX) / box.width;
              const deltaY = (event.clientY - drag.startY) / box.height;
              const rect = {
                ...drag.region.rect,
                x: Math.min(1 - drag.region.rect.width, Math.max(0, drag.region.rect.x + deltaX)),
                y: Math.min(1 - drag.region.rect.height, Math.max(0, drag.region.rect.y + deltaY))
              };
              setSelectedRegionId(drag.region.id);
              event.currentTarget.setPointerCapture(event.pointerId);
              const element = event.currentTarget.querySelector(`[data-region-id="${drag.region.id}"]`) as HTMLElement | null;
              if (element) {
                element.style.left = `${rect.x * 100}%`;
                element.style.top = `${rect.y * 100}%`;
              }
            }}
            onPointerUp={(event) => {
              const drag = dragRef.current;
              if (!drag || !overlayRef.current) {
                return;
              }
              const box = overlayRef.current.getBoundingClientRect();
              const deltaX = (event.clientX - drag.startX) / box.width;
              const deltaY = (event.clientY - drag.startY) / box.height;
              dragRef.current = null;
              void saveCorrection({
                type: 'UPDATE',
                regionId: drag.region.id,
                patch: {
                  rect: {
                    ...drag.region.rect,
                    x: Math.min(1 - drag.region.rect.width, Math.max(0, drag.region.rect.x + deltaX)),
                    y: Math.min(1 - drag.region.rect.height, Math.max(0, drag.region.rect.y + deltaY))
                  }
                }
              });
            }}
          >
            {effectiveRegions.map((region) => (
              <button
                type="button"
                key={region.id}
                data-testid={`import-region-${region.type.toLowerCase()}`}
                data-region-id={region.id}
                className={`import-region import-region--${region.type.toLowerCase()} ${region.id === selectedRegionId ? 'is-selected' : ''}`}
                style={regionStyle(region)}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedRegionId(region.id);
                }}
                onPointerDown={(event) => {
                  if (mode !== 'SELECT') {
                    return;
                  }
                  dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, region };
                }}
              >
                {regionTypeLabel(region.type)} {region.orderIndex + 1}
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="panel import-review-sidebar">
        <div>
          <p className="eyebrow">페이지</p>
          <div className="import-thumbnail-list">
            {bundle.pages.map((page) => (
              <button
                type="button"
                className={`import-thumbnail ${page.id === currentPage.id ? 'is-active' : ''}`}
                key={page.id}
                onClick={() => {
                  setCurrentPageId(page.id);
                  void savePreferences(page.id);
                }}
              >
                {page.thumbnailDataUrl ? <img src={page.thumbnailDataUrl} alt="" /> : null}
                <span>{page.pageIndex + 1}쪽</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="eyebrow">영역</p>
          <ul className="measure-list" data-testid="import-region-list">
            {effectiveRegions.map((region) => (
              <li key={region.id}>
                <button type="button" className={`measure-item ${region.id === selectedRegionId ? 'is-active' : ''}`} onClick={() => setSelectedRegionId(region.id)}>
                  <span className="measure-item__number">
                    {regionTypeLabel(region.type)} {region.orderIndex + 1}
                  </span>
                  <span className="measure-item__meta">{region.rect.x.toFixed(2)}, {region.rect.y.toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="eyebrow">경고</p>
          {validationIssues.length === 0 ? (
            <p className="muted" data-testid="import-warning-list">
              차단 수준의 레이아웃 문제가 없습니다.
            </p>
          ) : (
            <ul className="warning-list" data-testid="import-warning-list">
              {validationIssues.map((issue, index) => (
                <li className={`warning-item warning-item--${issue.severity}`} key={`${issue.code}-${index}`}>
                  <strong>{issue.code}</strong>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="eyebrow">준비 manifest</p>
          <p className="muted" data-testid="omr-preparation-manifest-summary">
            {manifestPreview ? `${manifestPreview.pages.length}쪽, 영역 ${manifestPreview.pages.reduce((sum, page) => sum + page.effectiveRegions.length, 0)}개` : '아직 준비되지 않음'}
          </p>
        </div>
      </aside>
    </main>
  );
}

function regionStyle(region: ImportRegion): CSSProperties {
  const pixel = normalizedRectToPixel(region.rect, { width: 100, height: 100 });
  return {
    left: `${pixel.x}%`,
    top: `${pixel.y}%`,
    width: `${pixel.width}%`,
    height: `${pixel.height}%`
  };
}

function regionTypeLabel(type: ImportRegion['type']): string {
  if (type === 'SYSTEM') {
    return '시스템';
  }
  if (type === 'STAFF') {
    return '보표';
  }
  if (type === 'MEASURE') {
    return '마디';
  }
  return type;
}
