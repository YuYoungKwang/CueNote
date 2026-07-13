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
  const [status, setStatus] = useState('Choose a PDF or score image. Processing stays local in this browser.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startImport = async () => {
    if (!file) {
      setError('Choose a file before starting.');
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
      setStatus('Hashing original source.');
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
        title: file.name.replace(/\.[^.]+$/, '') || 'Untitled import',
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

      setStatus('Rendering source page by page.');
      const renderedPages = await renderer.render(file, abortController.signal);
      if (renderedPages.length > MAX_IMPORT_PAGES) {
        throw new Error('TOO_MANY_PAGES');
      }

      const pages: ImportPage[] = [];
      const snapshots: ImportDetectionSnapshot[] = [];

      for (const renderedPage of renderedPages) {
        abortController.signal.throwIfAborted();
        const pageId = `${projectId}:page:${renderedPage.pageIndex + 1}`;
        setStatus(`Preprocessing page ${renderedPage.pageIndex + 1} of ${renderedPages.length}.`);
        const preprocessed = await workerClient.preprocessPage(pageId, renderedPage.imageData, DEFAULT_PAGE_TRANSFORM, abortController.signal);

        setStatus(`Detecting layout candidates on page ${renderedPage.pageIndex + 1}.`);
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
      setStatus('Import project ready for review.');
      navigate(`/imports/${projectId}/review`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Import failed.';
      setError(message);
      setStatus('Import failed. The original file was not modified.');
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
            <p className="eyebrow">New import</p>
            <h2>Prepare a PDF or image for OMR</h2>
            <p className="muted">This phase detects systems, staves, and measure regions only. It does not recognize notes or create MusicXML.</p>
          </div>
        </div>

        <div className="import-form">
          <label className="field">
            <span>PDF or image</span>
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
            Supported: PDF, PNG, JPEG, WebP, GIF, BMP. Original files remain local unless a later phase explicitly uploads them.
          </p>
          {file ? (
            <div className="viewer-summary">
              <div>
                <span className="summary-label">Name</span>
                <strong>{file.name}</strong>
              </div>
              <div>
                <span className="summary-label">Size</span>
                <strong>{Math.round(file.size / 1024)} KB</strong>
              </div>
            </div>
          ) : null}
          <div className="playback-button-row">
            <button type="button" className="primary-link" data-testid="start-import" disabled={busy || !file} onClick={() => void startImport()}>
              Start processing
            </button>
            <button
              type="button"
              className="control-button"
              disabled={!busy}
              onClick={() => {
                abortRef.current?.abort();
                setStatus('Cancelling import job.');
              }}
            >
              Cancel
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
