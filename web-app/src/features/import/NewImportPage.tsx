import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_PAGE_TRANSFORM,
  type ImportDetectionSnapshot,
  type ImportPage,
  type ImportProject,
  type ImportSource,
  type ImportWarning
} from '@cuenote/score-domain';
import { sha256Hex } from '../../core/import/checksum';
import { createDocumentPageRenderer } from '../../core/import/documentPageRenderer';
import { MAX_IMPORT_PAGES, validateImportFile } from '../../core/import/fileValidation';
import { createImportWorkerClient } from '../../core/import/workerClient';
import { canUseOpfs, createImportProjectRepository } from '../../core/storage/importProjectRepository';

export function NewImportPage() {
  const navigate = useNavigate();
  const repository = useMemo(() => createImportProjectRepository(), []);
  const renderer = useMemo(() => createDocumentPageRenderer(), []);
  const workerClient = useMemo(() => createImportWorkerClient(), []);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('PDF 또는 악보 이미지를 선택하세요. 처리는 이 브라우저 안에서 로컬로 진행됩니다.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startImport = async () => {
    if (!file) {
      setError('시작하기 전에 파일을 선택하세요.');
      return;
    }

    const validation = validateImportFile(file);
    if ('code' in validation) {
      setError(`${validation.code}: ${validation.message}`);
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    setBusy(true);
    setError(null);

    try {
      setStatus('원본 파일 무결성을 확인하고 있습니다.');
      const sourceId = createId('src');
      const projectId = createId('imp');
      const now = Date.now();
      const source: ImportSource = {
        id: sourceId,
        projectId,
        type: validation.sourceType,
        fileName: file.name,
        mimeType: validation.mimeType,
        sizeBytes: file.size,
        sha256: await sha256Hex(file),
        storageBackend: canUseOpfs() ? 'OPFS' : 'INDEXEDDB_BLOB',
        storageKey: `${sourceId}-${file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`,
        createdAt: now
      };

      const project: ImportProject = {
        id: projectId,
        title: file.name.replace(/\.[^.]+$/, '') || '이름 없는 가져오기',
        sourceId,
        sourceType: source.type,
        status: 'PROCESSING',
        pageCount: 0,
        currentPageId: null,
        createdAt: now,
        updatedAt: now
      };

      await repository.saveSource(source, file);
      await repository.saveProject(project);

      setStatus('원본 파일을 페이지별 이미지로 변환하고 있습니다.');
      const renderedPages = await renderer.render(file, abortController.signal);
      if (renderedPages.length > MAX_IMPORT_PAGES) {
        throw new Error('TOO_MANY_PAGES');
      }

      const pages: ImportPage[] = [];
      const snapshots: ImportDetectionSnapshot[] = [];

      for (const renderedPage of renderedPages) {
        abortController.signal.throwIfAborted();
        const pageId = `${projectId}:page:${renderedPage.pageIndex + 1}`;
        setStatus(`${renderedPages.length}쪽 중 ${renderedPage.pageIndex + 1}쪽을 전처리하고 있습니다.`);
        const preprocessed = await workerClient.preprocessPage(pageId, renderedPage.imageData, DEFAULT_PAGE_TRANSFORM, abortController.signal);

        setStatus(`${renderedPage.pageIndex + 1}쪽의 보표/마디 영역 후보를 찾고 있습니다.`);
        const detected = await workerClient.detectLayout(pageId, preprocessed.imageData, abortController.signal);
        const warnings: ImportWarning[] = detected.warnings.map((code) => ({
          code,
          message: code,
          severity: code.includes('NO_') || code.includes('FALLBACK') ? 'warning' : 'info'
        }));
        const page: ImportPage = {
          id: pageId,
          projectId,
          sourceId,
          pageIndex: renderedPage.pageIndex,
          originalDimensions: renderedPage.originalDimensions,
          rasterDimensions: renderedPage.rasterDimensions,
          rasterStorageKey: `${pageId}:raster`,
          thumbnailDataUrl: renderedPage.thumbnailDataUrl,
          status: 'NEEDS_REVIEW',
          transform: DEFAULT_PAGE_TRANSFORM,
          warnings,
          updatedAt: Date.now()
        };
        const snapshot: ImportDetectionSnapshot = {
          id: `${pageId}:snapshot:${Date.now()}`,
          projectId,
          pageId,
          detectorVersion: detected.detectorVersion,
          createdAt: Date.now(),
          regions: detected.regions,
          warnings,
          preprocessing: DEFAULT_PAGE_TRANSFORM
        };
        pages.push(page);
        snapshots.push(snapshot);
        await repository.savePage(page);
        await repository.saveSnapshot(snapshot);
      }

      await repository.saveProject({
        ...project,
        status: 'NEEDS_REVIEW',
        pageCount: pages.length,
        currentPageId: pages[0]?.id ?? null,
        updatedAt: Date.now()
      });
      setStatus('검수할 가져오기 프로젝트가 준비되었습니다.');
      navigate(`/imports/${projectId}/review`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '가져오기에 실패했습니다.';
      setError(message);
      setStatus('가져오기에 실패했습니다. 원본 파일은 수정하지 않았습니다.');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <main className="import-layout">
      <section className="panel import-main-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">새 악보 가져오기</p>
            <h2>OMR 검수를 위한 PDF 또는 이미지 준비</h2>
            <p className="muted">이 단계에서는 시스템, 보표, 마디 영역만 찾습니다. 음표를 인식하거나 MusicXML을 만들지는 않습니다.</p>
          </div>
        </div>

        <div className="import-form">
          <label className="field">
            <span>PDF 또는 이미지</span>
            <input
              data-testid="import-file-input"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp"
              capture="environment"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="muted">
            지원 형식: PDF, PNG, JPEG, WebP, GIF, BMP. 이후 단계에서 명시적으로 업로드하기 전까지 원본 파일은 로컬에만 남습니다.
          </p>
          {file ? (
            <div className="viewer-summary">
              <div>
                <span className="summary-label">파일명</span>
                <strong>{file.name}</strong>
              </div>
              <div>
                <span className="summary-label">크기</span>
                <strong>{Math.round(file.size / 1024)} KB</strong>
              </div>
            </div>
          ) : null}
          <div className="playback-button-row">
            <button type="button" className="primary-link" data-testid="start-import" disabled={busy || !file} onClick={() => void startImport()}>
              처리 시작
            </button>
            <button
              type="button"
              className="control-button"
              disabled={!busy}
              onClick={() => {
                abortRef.current?.abort();
                setStatus('가져오기 작업을 취소하고 있습니다.');
              }}
            >
              취소
            </button>
          </div>
          <p data-testid="import-processing-status">{status}</p>
          {error ? (
            <p className="annotation-toolbar__notice" data-testid="import-error">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
