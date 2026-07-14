import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  applyOmrCorrections,
  applyImportCorrections,
  createOmrCorrectionId,
  createOmrPreparationManifest,
  DEFAULT_PAGE_TRANSFORM,
  normalizeRect,
  type ImportRegion,
  type OmrCorrection,
  type OmrDetection,
  type OmrDetectionResult,
  type OmrModelInputManifest,
  type OmrModelManifest
} from '@cuenote/score-domain';
import { systemRectToPageRect } from '../../core/omr/coordinateMapper';
import { createOmrWorkerClient, isLatestOmrJob } from '../../core/omr/omrWorkerClient';
import type { OmrWorkerResponse } from '../../core/omr/workerProtocol';
import { OMR_SAMPLE_FIXTURES, type OmrSampleFixture } from '../../core/omr/sampleFixtures';
import { createImportProjectRepository, type ImportProjectBundle } from '../../core/storage/importProjectRepository';
import { createOmrRepository, type OmrAnalysisJobRecord, type OmrKnownFailureTag, type OmrManualEvaluationReport } from '../../core/storage/omrRepository';

const BUILT_IN_MODEL_OPTIONS = [
  { id: 'TEST_RUNTIME_MODEL', label: 'TEST_RUNTIME_MODEL', url: '/models/omr/test-runtime-manifest.json' },
  { id: 'LAYOUT_SMOKE_MODEL', label: 'LAYOUT_SMOKE_MODEL', url: '/models/omr/layout-smoke-manifest.json' },
  { id: 'SYMBOL_SMOKE_MODEL', label: 'SYMBOL_SMOKE_MODEL', url: '/models/omr/symbol-smoke-manifest.json' }
] as const;

type ModelOption = { id: string; label: string; url: string };

type ModelState =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number }
  | { kind: 'ready'; manifest: OmrModelManifest; provider: string; cacheHit: boolean; fallbackReason?: string; productState: string }
  | { kind: 'error'; message: string };

type RunState = { kind: 'idle' } | { kind: 'running'; progress: number } | { kind: 'ready'; result: OmrDetectionResult; outputNames: string[] } | { kind: 'error'; message: string };

const KNOWN_FAILURE_TAGS: Array<{ id: OmrKnownFailureTag; label: string }> = [
  { id: 'missed-notehead', label: '음표머리 누락' },
  { id: 'false-symbol', label: '잘못 검출된 기호' },
  { id: 'wrong-class', label: '기호 분류 오류' },
  { id: 'lyric-interference', label: '가사 간섭' },
  { id: 'chord-symbol-interference', label: '코드 기호 간섭' },
  { id: 'low-contrast', label: '낮은 대비' },
  { id: 'crop-stitch-duplicate', label: '타일 중복 검출' },
  { id: 'missing-staff-context', label: '보표 맥락 부족' }
];

const CLASS_LABELS: Record<string, string> = {
  'notehead.filled': '채운 음표머리',
  'notehead.hollow': '빈 음표머리',
  'notehead.whole.onLine': '온음표 머리(선 위)',
  'notehead.whole.inSpace': '온음표 머리(칸 안)',
  'stem.up': '위 방향 기둥',
  'stem.down': '아래 방향 기둥',
  beam: '빔',
  'ledger.line': '덧줄',
  ledgerLine: '덧줄',
  'rest.quarter': '4분쉼표',
  restQuarter: '4분쉼표',
  rest8th: '8분쉼표',
  rest16th: '16분쉼표',
  rest32nd: '32분쉼표',
  rest64th: '64분쉼표',
  'clef.treble': '높은음자리표',
  clefTreble: '높은음자리표',
  repeatDot: '반복점',
  flag8thUp: '8분음표 꼬리(위)',
  flag8thDown: '8분음표 꼬리(아래)',
  timeSig4: '박자표 숫자 4',
  timeSigCommon: '공통박자표'
};

const FIXTURE_LABELS: Record<string, { title: string; source: string; expectedNotationType: string; licenseUsageNote: string; localFileProcedure?: string }> = {
  'synthetic-basic-staff': {
    title: '합성 보표와 기호 샘플',
    source: 'CueNote 생성 샘플',
    expectedNotationType: '단일 보표 선율 기호',
    licenseUsageNote: '로컬 평가 전용으로 코드에서 생성한 CC0 성격의 테스트 샘플입니다.'
  },
  'korean-lyrics-chords-local': {
    title: '한국어 가사/코드 악보 샘플 슬롯',
    source: '사용자가 선택한 로컬 파일',
    expectedNotationType: '한국어 가사와 코드 기호가 있는 선율 악보',
    licenseUsageNote: '이미지는 저장소에 포함하지 않습니다. 직접 만들었거나 평가 권한이 있는 파일만 로컬에서 사용하세요.',
    localFileProcedure: '이 슬롯을 선택한 뒤 본인이 소유했거나 사용 허가를 받은 악보의 PNG/JPEG/BMP 파일을 고르세요. 파일은 브라우저 로컬 저장소에서만 평가에 사용됩니다.'
  }
};

export function OmrRuntimePage({ mode = 'runtime' }: { mode?: 'runtime' | 'review' | 'draft' }) {
  const { projectId = '' } = useParams();
  const importRepository = useMemo(() => createImportProjectRepository(), []);
  const omrRepository = useMemo(() => createOmrRepository(), []);
  const workerClient = useMemo(() => createOmrWorkerClient(), []);
  const latestJobRef = useRef<string | null>(null);
  const reviewScopeIdRef = useRef(projectId);
  const [bundle, setBundle] = useState<ImportProjectBundle | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ kind: 'idle' });
  const [runState, setRunState] = useState<RunState>({ kind: 'idle' });
  const [storedResults, setStoredResults] = useState<OmrDetectionResult[]>([]);
  const [corrections, setCorrections] = useState<OmrCorrection[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([...BUILT_IN_MODEL_OPTIONS]);
  const [selectedModelId, setSelectedModelId] = useState('TEST_RUNTIME_MODEL');
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0);
  const [classVisibility, setClassVisibility] = useState<Record<string, boolean>>({});
  const [selectedClassId, setSelectedClassId] = useState('');
  const [addMode, setAddMode] = useState(false);
  const [reviewJson, setReviewJson] = useState('');
  const [evaluationReports, setEvaluationReports] = useState<OmrManualEvaluationReport[]>([]);
  const [reviewerNote, setReviewerNote] = useState('');
  const [knownFailureTags, setKnownFailureTags] = useState<OmrKnownFailureTag[]>([]);
  const [evaluationReportJson, setEvaluationReportJson] = useState('');
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [localFixtureDataUrl, setLocalFixtureDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('모델을 불러와 브라우저 OMR 실행 환경을 확인하세요.');

  const selectedModel = modelOptions.find((option) => option.id === selectedModelId) ?? modelOptions[0] ?? BUILT_IN_MODEL_OPTIONS[0];
  const selectedFixture = OMR_SAMPLE_FIXTURES.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const fixtureDataUrl = selectedFixture?.imageDataUrl ?? (selectedFixture?.id === 'korean-lyrics-chords-local' ? localFixtureDataUrl : null);
  const reviewScopeId = selectedFixture ? `${projectId}:fixture:${selectedFixture.id}` : projectId;
  const samplePage = fixtureDataUrl && selectedFixture ? createFixturePage(selectedFixture, fixtureDataUrl) : null;
  const activeResult = runState.kind === 'ready' ? runState.result : storedResults.at(-1) ?? null;
  const displayedResults = activeResult ? mergeResults(storedResults, activeResult) : storedResults;
  const modelClasses = modelState.kind === 'ready' ? modelState.manifest.classes : [];
  const correctedDetections = useMemo(
    () => (activeResult ? applyOmrCorrections(activeResult.detections, correctionsForResult(corrections, activeResult)) : []),
    [activeResult, corrections]
  );
  const visibleDetections = correctedDetections.filter((detection) => {
    if (detection.reviewDecision === 'REJECTED') {
      return false;
    }
    if (detection.confidence < confidenceThreshold) {
      return false;
    }
    return classVisibility[detection.classId] !== false;
  });
  const selectedDetection = correctedDetections.find((detection) => detection.id === selectedDetectionId) ?? null;
  const runSummary = useMemo(() => createRunSummary(correctedDetections, correctionsForResult(corrections, activeResult)), [activeResult, correctedDetections, corrections]);

  useEffect(() => {
    void importRepository.loadProject(projectId).then(setBundle);
    void loadModelCatalog().then(setModelOptions);
  }, [importRepository, omrRepository, projectId]);

  useEffect(() => {
    void omrRepository.loadResults(reviewScopeId).then((results) => {
      setStoredResults((current) => (results.length === 0 && current.length > 0 ? current : results));
    });
    void omrRepository.loadCorrections(reviewScopeId).then(setCorrections);
    void omrRepository.loadEvaluationReports(reviewScopeId).then((reports) => {
      setEvaluationReports(reports);
      const latest = reports.at(-1);
      setReviewerNote(latest?.reviewerNote ?? '');
      setKnownFailureTags(latest?.knownFailureTags ?? []);
    });
    setRunState({ kind: 'idle' });
    setSelectedDetectionId(null);
    setEvaluationReportJson('');
  }, [omrRepository, reviewScopeId]);

  useEffect(() => {
    reviewScopeIdRef.current = reviewScopeId;
  }, [reviewScopeId]);

  useEffect(() => {
    if (modelClasses.length && !selectedClassId) {
      setSelectedClassId(modelClasses[0]?.id ?? '');
    }
  }, [modelClasses, selectedClassId]);

  useEffect(() => {
    const unsubscribe = workerClient.subscribe((message) => {
      if (!isLatestOmrJob(message.jobId, latestJobRef.current)) {
        return;
      }
      void handleWorkerMessage(message);
    });
    return () => {
      unsubscribe();
      workerClient.terminate();
    };
  }, [workerClient]);

  const handleWorkerMessage = async (message: OmrWorkerResponse) => {
    if (message.type === 'MODEL_LOADING') {
      setModelState({ kind: 'loading', progress: message.progress });
    } else if (message.type === 'PROVIDER_FALLBACK') {
      setStatus(`WebGPU를 사용할 수 없어 WASM으로 전환했습니다: ${message.reason}`);
    } else if (message.type === 'MODEL_READY') {
      await omrRepository.saveManifest(message.manifest);
      await omrRepository.saveModelMetadata(message.metadata);
      setModelState({
        kind: 'ready',
        manifest: message.manifest,
        provider: message.provider,
        fallbackReason: message.fallbackReason,
        cacheHit: message.cacheHit,
        productState: message.readiness.modelState
      });
      setStatus(
        message.manifest.status === 'PRODUCT'
          ? `${message.manifest.modelId} 모델을 불러왔습니다.`
          : `${message.manifest.modelId} 모델을 ${message.manifest.status ?? 'RUNTIME_SMOKE'} 상태로 불러왔습니다. 제품용 OMR 모델은 아직 설치되지 않았습니다.`
      );
    } else if (message.type === 'MODEL_FAILED') {
      setModelState({ kind: 'error', message: message.error });
    } else if (message.type === 'JOB_STARTED' || message.type === 'JOB_PROGRESS') {
      setRunState({ kind: 'running', progress: message.progress });
    } else if (message.type === 'JOB_COMPLETED') {
      await omrRepository.saveResult(message.result);
      const nextResults = await omrRepository.loadResults(reviewScopeIdRef.current);
      setStoredResults(mergeResults(nextResults, message.result));
      setRunState({ kind: 'ready', result: message.result, outputNames: message.runtimeOutputNames });
      setStatus(`ONNX 추론이 완료되었습니다. 검출 ${message.result.detections.length}개가 생성되었고, MusicXML 초안 생성은 Phase 10으로 남겨둡니다.`);
    } else if (message.type === 'JOB_CANCELLED') {
      setRunState({ kind: 'idle' });
      setStatus('OMR 실행 작업을 취소했습니다.');
    } else if (message.type === 'JOB_FAILED') {
      setRunState({ kind: 'error', message: message.error });
    } else if (message.type === 'MODEL_CACHE_CLEARED') {
      setStatus('모델 캐시를 비웠습니다.');
    }
  };

  const manifest = bundle?.source
    ? createOmrPreparationManifest({
        project: bundle.project,
        source: bundle.source,
        pages: bundle.pages,
        snapshots: bundle.snapshots,
        corrections: bundle.corrections
      })
    : null;

  const firstPage = samplePage ?? manifest?.pages[0] ?? null;
  const systemRegion = firstPage?.effectiveRegions.find((region) => region.type === 'SYSTEM') ?? null;

  const loadModel = () => {
    const jobId = createJobId('load');
    latestJobRef.current = jobId;
    workerClient.post({ type: 'LOAD_MODEL', jobId, manifestUrl: selectedModel.url });
  };

  const runSystem = async () => {
    if ((!bundle && !selectedFixture) || !firstPage || !systemRegion || modelState.kind !== 'ready') {
      setStatus('검토 완료된 시스템 영역과 불러온 모델이 필요합니다.');
      return;
    }

    const imageData = await imageDataForSystem(firstPage.page.thumbnailDataUrl, systemRegion);
    const inputManifest: OmrModelInputManifest = {
      schemaVersion: 1,
      projectId: reviewScopeId,
      pageId: firstPage.page.id,
      systemId: systemRegion.id,
      image: {
        reference: firstPage.page.rasterStorageKey ?? firstPage.page.id,
        sourceChecksum: bundle?.source?.sha256 ?? selectedFixture?.id ?? 'unknown',
        width: imageData.width,
        height: imageData.height,
        channels: modelState.manifest.input.channels,
        colorSpace: modelState.manifest.input.channels === 1 ? 'GRAYSCALE' : 'RGB'
      },
      crop: { pageBounds: systemRegion.rect, paddingRatio: 0.02 },
      preprocessing: {
        rotationDegrees: firstPage.page.transform.rotation,
        deskewDegrees: firstPage.page.transform.deskewDegrees,
        grayscale: modelState.manifest.input.channels === 1,
        thresholdMode: firstPage.page.transform.threshold === null ? 'NONE' : 'GLOBAL',
        inverted: false,
        normalizationVersion: 'phase8-system-crop-v1'
      },
      expectedModelInput: modelState.manifest.input
    };
    const jobId = createJobId('run');
    latestJobRef.current = jobId;
    const job: OmrAnalysisJobRecord = {
      id: jobId,
      projectId: reviewScopeId,
      pageId: firstPage.page.id,
      systemId: systemRegion.id,
      status: 'RUNNING',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await omrRepository.saveJob(job);
    await omrRepository.savePreferences({
      projectId: reviewScopeId,
      modelManifestUrl: selectedModel.url,
      selectedResultId: undefined,
      confidenceFilter: 'ALL',
      updatedAt: Date.now()
    });
    workerClient.post({ type: 'ANALYZE_SYSTEM', jobId, input: inputManifest, imageData });
  };

  const cancelJob = () => {
    if (latestJobRef.current) {
      workerClient.post({ type: 'CANCEL_JOB', jobId: latestJobRef.current });
    }
  };

  const selectFixture = (fixtureId: string) => {
    setSelectedFixtureId(fixtureId || null);
    reviewScopeIdRef.current = fixtureId ? `${projectId}:fixture:${fixtureId}` : projectId;
    setLocalFixtureDataUrl(null);
    setStatus(fixtureId ? '평가 샘플을 선택했습니다. 모델을 불러온 뒤 시스템 영역 추론을 실행하세요.' : '가져온 프로젝트 이미지를 사용합니다.');
  };

  const handleLocalFixtureFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setSelectedFixtureId('korean-lyrics-chords-local');
    setLocalFixtureDataUrl(dataUrl);
    setStatus('한국어 가사/코드 악보 로컬 파일을 불러왔습니다. 파일은 브라우저 안에서만 평가합니다.');
  };

  const saveReviewCorrection = async (correction: OmrCorrection) => {
    await omrRepository.saveCorrection(correction);
    const next = await omrRepository.loadCorrections(reviewScopeId);
    setCorrections(next);
    await persistReviewSnapshot(reviewScopeId, createReviewExport(reviewScopeId, activeResult, next, selectedFixture));
    setStatus('검수 수정 내용을 IndexedDB에 저장했습니다. 가능한 환경에서는 OPFS 스냅샷도 갱신합니다.');
  };

  const rejectSelectedDetection = async () => {
    if (!selectedDetection) {
      return;
    }
    await saveReviewCorrection({
      id: createOmrCorrectionId(projectId, selectedDetection.id),
      projectId: reviewScopeId,
      pageId: selectedDetection.pageId,
      detectionId: selectedDetection.id,
      createdAt: Date.now(),
      operation: { type: 'REJECT' }
    });
  };

  const changeSelectedClass = async () => {
    if (!selectedDetection || !selectedClassId) {
      return;
    }
    await saveReviewCorrection({
      id: createOmrCorrectionId(projectId, selectedDetection.id),
      projectId: reviewScopeId,
      pageId: selectedDetection.pageId,
      detectionId: selectedDetection.id,
      createdAt: Date.now(),
      operation: { type: 'CHANGE_CLASS', classId: selectedClassId, className: selectedClassId }
    });
  };

  const handleOverlayClick = async (event: MouseEvent<HTMLDivElement>) => {
    if (!addMode || !activeResult || !systemRegion || !selectedClassId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const pageX = (event.clientX - rect.left) / rect.width;
    const pageY = (event.clientY - rect.top) / rect.height;
    const system = systemRegion.rect;
    if (pageX < system.x || pageY < system.y || pageX > system.x + system.width || pageY > system.y + system.height) {
      return;
    }
    const boundsInSystem = normalizeRect({
      x: (pageX - system.x) / system.width - 0.015,
      y: (pageY - system.y) / system.height - 0.015,
      width: 0.03,
      height: 0.03
    });
    const detection: OmrDetection = {
      id: `${projectId}:omr-user-detection:${Date.now()}`,
      classId: selectedClassId,
      className: selectedClassId,
      confidence: 1,
      systemId: activeResult.systemId,
      pageId: activeResult.pageId,
      boundsInSystem,
      boundsInPage: systemRectToPageRect(boundsInSystem, systemRegion.rect),
      source: 'USER',
      reviewDecision: 'CORRECTED',
      modelVersion: activeResult.modelVersion,
      attributes: { userAdded: true }
    };
    await saveReviewCorrection({
      id: createOmrCorrectionId(projectId, detection.id),
      projectId: reviewScopeId,
      pageId: detection.pageId,
      detectionId: detection.id,
      createdAt: Date.now(),
      operation: { type: 'ADD', detection }
    });
    setSelectedDetectionId(detection.id);
    setAddMode(false);
  };

  const exportReviewJson = () => {
    setReviewJson(JSON.stringify(createReviewExport(reviewScopeId, activeResult, correctionsForResult(corrections, activeResult), selectedFixture), null, 2));
  };

  const importReviewJson = async () => {
    const parsed = JSON.parse(reviewJson) as { corrections?: OmrCorrection[] };
    for (const correction of parsed.corrections ?? []) {
      await omrRepository.saveCorrection(correction);
    }
    const next = await omrRepository.loadCorrections(reviewScopeId);
    setCorrections(next);
    await persistReviewSnapshot(reviewScopeId, createReviewExport(reviewScopeId, activeResult, next, selectedFixture));
    setStatus('검수 JSON을 수정 레이어로 가져왔습니다.');
  };

  const toggleKnownFailureTag = (tag: OmrKnownFailureTag, checked: boolean) => {
    setKnownFailureTags((current) => (checked ? [...new Set([...current, tag])] : current.filter((candidate) => candidate !== tag)));
  };

  const createCurrentEvaluationReport = (): OmrManualEvaluationReport | null => {
    if (!activeResult) {
      return null;
    }
    const timestamp = Date.now();
    return {
      id: `${reviewScopeId}:manual-evaluation:${timestamp}`,
      projectId: reviewScopeId,
      fixture: selectedFixture
        ? {
            id: selectedFixture.id,
            title: selectedFixture.title
          }
        : null,
      modelId: activeResult.modelId,
      modelVersion: activeResult.modelVersion,
      detectionCount: runSummary.detectionCount,
      classCounts: runSummary.classCounts,
      averageConfidence: runSummary.averageConfidence,
      correctionCount: runSummary.deletedCount + runSummary.modifiedCount + runSummary.addedCount,
      deletedCount: runSummary.deletedCount,
      modifiedCount: runSummary.modifiedCount,
      addedCount: runSummary.addedCount,
      reviewerNote,
      knownFailureTags,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  };

  const saveEvaluationReport = async () => {
    const report = createCurrentEvaluationReport();
    if (!report) {
      setStatus('수동 평가 리포트를 저장하려면 먼저 OMR을 실행하세요.');
      return;
    }
    await omrRepository.saveEvaluationReport(report);
    const reports = await omrRepository.loadEvaluationReports(reviewScopeId);
    setEvaluationReports(reports);
    setEvaluationReportJson(JSON.stringify(createEvaluationReportExport(report), null, 2));
    setStatus('이 샘플의 수동 평가 리포트를 저장했습니다.');
  };

  const exportEvaluationReportJson = () => {
    const report = evaluationReports.at(-1) ?? createCurrentEvaluationReport();
    if (!report) {
      setStatus('수동 평가 리포트를 내보내려면 먼저 OMR을 실행하세요.');
      return;
    }
    setEvaluationReportJson(JSON.stringify(createEvaluationReportExport(report), null, 2));
  };

  const importEvaluationReportJson = async () => {
    const parsed = JSON.parse(evaluationReportJson) as { kind?: string; report?: OmrManualEvaluationReport; reports?: OmrManualEvaluationReport[] };
    const reports = parsed.report ? [parsed.report] : parsed.reports ?? [];
    for (const report of reports) {
      await omrRepository.saveEvaluationReport({ ...report, projectId: reviewScopeId, updatedAt: Date.now() });
    }
    const next = await omrRepository.loadEvaluationReports(reviewScopeId);
    setEvaluationReports(next);
    const latest = next.at(-1);
    setReviewerNote(latest?.reviewerNote ?? reviewerNote);
    setKnownFailureTags(latest?.knownFailureTags ?? knownFailureTags);
    setStatus('수동 평가 리포트 JSON을 가져왔습니다.');
  };

  if (mode === 'draft') {
    return (
      <main className="panel state-panel" data-testid="omr-draft-deferred">
        <h2>OMR MusicXML 초안은 Phase 10 기능입니다</h2>
        <p>현재 화면은 OMR 실행 환경과 검수 흐름만 확인합니다. 구조 조립, MusicXML 초안 생성, Phase 6 편집기 전달은 Phase 10으로 남겨둡니다.</p>
        <Link className="secondary-link" to={`/imports/${projectId}/omr`}>
          OMR 실행 화면으로 돌아가기
        </Link>
      </main>
    );
  }

  return (
    <main className="import-review-layout" data-testid="omr-runtime-page">
      <section className="panel import-review-main">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Phase 8</p>
            <h2>브라우저 OMR 실행 및 검수</h2>
            <p className="muted" data-testid="omr-runtime-status">
              {status}
            </p>
          </div>
          <div className="playback-button-row">
            <Link className="secondary-link" to={`/imports/${projectId}/review`}>
              레이아웃 검토
            </Link>
            <Link className="secondary-link" to={`/imports/${projectId}/omr/draft`} data-testid="omr-draft-link">
              초안 생성 상태
            </Link>
          </div>
        </div>

        <div className="viewer-summary">
          <div>
            <span className="summary-label">실행 모델</span>
            <strong data-testid="omr-model-kind">{selectedModel.id}</strong>
          </div>
          <div>
            <span className="summary-label">모델 상태</span>
            <strong data-testid="omr-model-status">{modelState.kind === 'ready' ? modelState.manifest.status ?? 'RUNTIME_SMOKE' : '불러오지 않음'}</strong>
          </div>
          <div>
            <span className="summary-label">제품용 모델</span>
            <strong data-testid="omr-product-state">{modelState.kind === 'ready' ? modelState.productState : 'PRODUCT_MODEL_NOT_INSTALLED'}</strong>
          </div>
          <div>
            <span className="summary-label">실행 방식</span>
            <strong data-testid="omr-provider">{modelState.kind === 'ready' ? modelState.provider : '불러오지 않음'}</strong>
          </div>
          <div>
            <span className="summary-label">캐시</span>
            <strong data-testid="omr-cache-state">{modelState.kind === 'ready' ? (modelState.cacheHit ? '캐시됨' : '다운로드됨') : '확인 전'}</strong>
          </div>
        </div>

        <div className="omr-fixture-gallery" data-testid="omr-fixture-gallery">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">평가 샘플</p>
              <h3>OMR 샘플 갤러리</h3>
            </div>
            <button type="button" className="secondary-link" onClick={() => selectFixture('')} data-testid="omr-use-import-project">
              가져온 이미지 사용
            </button>
          </div>
          <div className="score-grid">
            {OMR_SAMPLE_FIXTURES.map((fixture) => {
              const label = fixtureLabel(fixture);
              return (
              <button
                key={fixture.id}
                type="button"
                className={`score-card omr-fixture-card ${selectedFixtureId === fixture.id ? 'is-active' : ''}`}
                onClick={() => selectFixture(fixture.id)}
                data-testid={`omr-fixture-${fixture.id}`}
              >
                <span className="score-card__composer">{captureTypeLabel(fixture.captureType)}</span>
                <h3>{label.title}</h3>
                <p>{label.expectedNotationType}</p>
                <small>{label.licenseUsageNote}</small>
              </button>
              );
            })}
          </div>
          {selectedFixture ? (
            <div className="omr-fixture-metadata" data-testid="omr-fixture-metadata">
              <strong>{fixtureLabel(selectedFixture).title}</strong>
              <span>출처: {fixtureLabel(selectedFixture).source}</span>
              <span>가사: {selectedFixture.hasLyrics ? '있음' : '없음'} / 코드 기호: {selectedFixture.hasChordSymbols ? '있음' : '없음'}</span>
              {fixtureLabel(selectedFixture).localFileProcedure ? <span>{fixtureLabel(selectedFixture).localFileProcedure}</span> : null}
              {selectedFixture.id === 'korean-lyrics-chords-local' ? (
                <input type="file" accept="image/png,image/jpeg,image/bmp" onChange={(event) => void handleLocalFixtureFile(event.target.files?.[0] ?? null)} data-testid="omr-local-fixture-file" />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="import-toolbar">
          <label className="field-label" htmlFor="omr-model-select">
            모델
          </label>
          <select
            id="omr-model-select"
            className="select-input"
            value={selectedModelId}
            onChange={(event) => {
              setSelectedModelId(event.target.value);
              setModelState({ kind: 'idle' });
              setRunState({ kind: 'idle' });
            }}
            data-testid="omr-model-select"
          >
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" className="primary-link" onClick={loadModel} data-testid="omr-load-model">
            모델 불러오기
          </button>
          <button type="button" className="primary-link" onClick={() => void runSystem()} disabled={modelState.kind !== 'ready' || !systemRegion} data-testid="omr-run-system">
            시스템 영역 추론
          </button>
          <button type="button" className="control-button" onClick={cancelJob} data-testid="omr-cancel-job">
            취소
          </button>
        </div>

        {modelState.kind === 'loading' ? <p data-testid="omr-model-loading">모델 불러오는 중 {Math.round(modelState.progress * 100)}%</p> : null}
        {modelState.kind === 'error' ? <p data-testid="omr-model-error">{modelState.message}</p> : null}
        {modelState.kind === 'ready' && modelState.fallbackReason ? <p data-testid="omr-fallback-reason">대체 실행 사유: {modelState.fallbackReason}</p> : null}
        {runState.kind === 'running' ? <p data-testid="omr-job-progress">추론 실행 중 {Math.round(runState.progress * 100)}%</p> : null}
        {runState.kind === 'error' ? <p data-testid="omr-job-error">{runState.message}</p> : null}
        {runState.kind === 'ready' ? (
          <div data-testid="omr-runtime-result">
            실행 출력: {runState.outputNames.join(', ') || '없음'}; 검출: {runState.result.detections.length}
          </div>
        ) : null}

        <div className="omr-review-toolbar" data-testid="omr-review-toolbar">
          <label className="field">
            <span>신뢰도 기준값</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={confidenceThreshold}
              onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
              data-testid="omr-confidence-threshold"
            />
            <strong data-testid="omr-confidence-threshold-value">{confidenceThreshold.toFixed(2)}</strong>
          </label>
          <div className="omr-class-toggles" data-testid="omr-class-toggles">
            {modelClasses.map((klass) => (
              <label key={klass.id}>
                <input
                  type="checkbox"
                  checked={classVisibility[klass.id] !== false}
                  onChange={(event) => setClassVisibility((current) => ({ ...current, [klass.id]: event.target.checked }))}
                  data-testid={`omr-class-toggle-${testIdPart(klass.id)}`}
                />
                <span>{displayClassLabel(klass.id)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="import-page-stage" data-testid="omr-detection-overlay">
          {firstPage?.page.thumbnailDataUrl ? <img src={firstPage.page.thumbnailDataUrl} alt="" className="import-page-image" /> : <div className="import-page-placeholder">검토된 페이지가 없습니다</div>}
          <div className={`import-region-overlay ${addMode ? 'is-adding' : ''}`} onClick={(event) => void handleOverlayClick(event)} data-testid="omr-overlay-hit-area">
            {systemRegion ? <div className="import-region import-region--system is-selected" style={regionStyle(systemRegion)}>시스템 영역</div> : null}
            {visibleDetections.map((detection) => (
              <button
                key={detection.id}
                type="button"
                className={`import-region import-region--omr-detection ${selectedDetectionId === detection.id ? 'is-selected' : ''}`}
                style={rectStyle(detection.boundsInPage)}
                data-testid="omr-detection-box"
                title={`${detection.classId} ${Math.round(detection.confidence * 100)}%`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedDetectionId(detection.id);
                }}
              >
                {displayClassLabel(detection.classId)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="panel import-review-sidebar">
        <p className="eyebrow">검수 준비</p>
        <p data-testid="omr-review-foundation">검출 오버레이와 수정 저장 기능을 사용할 수 있습니다. 제품 수준 검출은 평가된 모델이 더 필요합니다.</p>
        <div className="omr-summary-panel" data-testid="omr-summary">
          <p className="eyebrow">실행 요약</p>
          <div className="viewer-summary">
            <div>
              <span className="summary-label">검출 수</span>
              <strong data-testid="omr-summary-detection-count">{runSummary.detectionCount}</strong>
            </div>
            <div>
              <span className="summary-label">평균 신뢰도</span>
              <strong data-testid="omr-summary-average-confidence">{runSummary.averageConfidence.toFixed(2)}</strong>
            </div>
          </div>
          <p data-testid="omr-summary-class-counts">{runSummary.classCountsText || '기호별 집계 없음'}</p>
          <p data-testid="omr-summary-correction-counts">
            삭제 {runSummary.deletedCount} / 수정 {runSummary.modifiedCount} / 추가 {runSummary.addedCount}
          </p>
        </div>
        <div className="omr-evaluation-report-panel" data-testid="omr-evaluation-report-panel">
          <p className="eyebrow">수동 평가 리포트</p>
          <div className="viewer-summary">
            <div>
              <span className="summary-label">저장된 리포트</span>
              <strong data-testid="omr-evaluation-report-count">{evaluationReports.length}</strong>
            </div>
            <div>
              <span className="summary-label">최근 모델 버전</span>
              <strong data-testid="omr-latest-evaluation-report">{evaluationReports.at(-1)?.modelVersion ?? '없음'}</strong>
            </div>
          </div>
          <label className="field">
            <span>검수 메모</span>
            <textarea
              className="omr-review-json"
              value={reviewerNote}
              onChange={(event) => setReviewerNote(event.target.value)}
              data-testid="omr-evaluation-reviewer-note"
            />
          </label>
          <p className="muted">현재 샘플과 실행 결과에 대한 평가 메모와 알려진 실패 유형을 기록합니다.</p>
          <div className="omr-class-toggles" data-testid="omr-known-failure-tags">
            {KNOWN_FAILURE_TAGS.map((tag) => (
              <label key={tag.id}>
                <input
                  type="checkbox"
                  checked={knownFailureTags.includes(tag.id)}
                  onChange={(event) => toggleKnownFailureTag(tag.id, event.target.checked)}
                  data-testid={`omr-known-failure-${testIdPart(tag.id)}`}
                />
                <span>{tag.label}</span>
              </label>
            ))}
          </div>
          <div className="playback-button-row">
            <button type="button" className="control-button" onClick={() => void saveEvaluationReport()} data-testid="omr-save-evaluation-report">
              리포트 저장
            </button>
            <button type="button" className="secondary-link" onClick={exportEvaluationReportJson} data-testid="omr-export-evaluation-report">
              리포트 내보내기
            </button>
            <button type="button" className="secondary-link" onClick={() => void importEvaluationReportJson()} data-testid="omr-import-evaluation-report">
              리포트 가져오기
            </button>
          </div>
          <p className="muted">JSON의 schema, kind, model id, class id 값은 호환성을 위해 영어 내부값 그대로 유지됩니다.</p>
          <textarea
            className="omr-review-json"
            value={evaluationReportJson}
            onChange={(event) => setEvaluationReportJson(event.target.value)}
            data-testid="omr-evaluation-report-json"
          />
        </div>
        <p className="eyebrow">저장된 실행 결과</p>
        <ul className="measure-list" data-testid="omr-result-list">
          {displayedResults.length === 0 ? <li>저장된 실행 결과가 없습니다.</li> : null}
          {displayedResults.map((result) => (
            <li key={result.id}>
              {result.modelId} {result.modelVersion} / {result.executionProvider} / 검출 {result.detections.length}개
            </li>
          ))}
        </ul>
        <p className="eyebrow">현재 검출 목록</p>
        <ul className="measure-list omr-detection-review-list" data-testid="omr-detection-list">
          {visibleDetections.length === 0 ? <li>표시할 검출 결과가 없습니다.</li> : null}
          {visibleDetections.map((detection) => (
            <li key={detection.id}>
              <button
                type="button"
                className={`measure-item ${selectedDetectionId === detection.id ? 'is-active' : ''}`}
                onClick={() => setSelectedDetectionId(detection.id)}
                data-testid="omr-detection-list-item"
                data-class-id={detection.classId}
              >
                <span className="measure-item__number">{displayClassLabel(detection.classId)}</span>
                <span className="measure-item__meta">
                  {Math.round(detection.confidence * 100)}% / {detectionSourceLabel(detection.source)} / {reviewDecisionLabel(detection.reviewDecision)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="omr-review-editor" data-testid="omr-review-editor">
          <p className="eyebrow">수정 레이어</p>
          <p data-testid="omr-selected-detection">{selectedDetection ? displayClassLabel(selectedDetection.classId) : '선택한 검출 결과가 없습니다'}</p>
          <label className="field">
            <span>기호 종류</span>
            <select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} data-testid="omr-symbol-class-select">
              {modelClasses.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {displayClassLabel(klass.id)}
                </option>
              ))}
            </select>
          </label>
          <div className="playback-button-row">
            <button type="button" className="control-button" onClick={() => void changeSelectedClass()} disabled={!selectedDetection} data-testid="omr-change-class">
              종류 변경
            </button>
            <button type="button" className="control-button" onClick={() => void rejectSelectedDetection()} disabled={!selectedDetection} data-testid="omr-delete-detection">
              삭제
            </button>
            <button type="button" className={`control-button ${addMode ? 'is-active' : ''}`} onClick={() => setAddMode((current) => !current)} data-testid="omr-add-detection-mode">
              수동 추가
            </button>
          </div>
          <div className="playback-button-row">
            <button type="button" className="secondary-link" onClick={exportReviewJson} data-testid="omr-export-review-json">
              검수 JSON 내보내기
            </button>
            <button type="button" className="secondary-link" onClick={() => void importReviewJson()} data-testid="omr-import-review-json">
              검수 JSON 가져오기
            </button>
          </div>
          <p className="muted">수정 레이어 JSON은 내부 스키마 호환성을 위해 영어 key와 class id를 유지합니다.</p>
          <textarea
            className="omr-review-json"
            value={reviewJson}
            onChange={(event) => setReviewJson(event.target.value)}
            data-testid="omr-review-json"
          />
          <p data-testid="omr-correction-count">저장된 수정 {correctionsForResult(corrections, activeResult).length}개</p>
        </div>
        <p className="eyebrow">Phase 10</p>
        <p>구조 조립과 MusicXML 초안 전달은 아직 구현하지 않았습니다.</p>
      </aside>
    </main>
  );
}

async function imageDataForSystem(thumbnailDataUrl: string | undefined, region: ImportRegion): Promise<ImageData> {
  if (!thumbnailDataUrl) {
    return new ImageData(64, 64);
  }
  const image = await loadImage(thumbnailDataUrl);
  const canvas = document.createElement('canvas');
  const width = Math.max(1, Math.round(region.rect.width * image.naturalWidth));
  const height = Math.max(1, Math.round(region.rect.height * image.naturalHeight));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('TENSOR_BUILD_FAILED');
  }
  context.drawImage(
    image,
    region.rect.x * image.naturalWidth,
    region.rect.y * image.naturalHeight,
    width,
    height,
    0,
    0,
    width,
    height
  );
  return context.getImageData(0, 0, width, height);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    image.src = src;
  });
}

function regionStyle(region: ImportRegion) {
  return rectStyle(region.rect);
}

function rectStyle(rect: { x: number; y: number; width: number; height: number }) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`
  };
}

function createJobId(prefix: string): string {
  return `omr-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function correctionsForResult(corrections: OmrCorrection[], result: OmrDetectionResult | null): OmrCorrection[] {
  if (!result) {
    return [];
  }
  const detectionIds = new Set(result.detections.map((detection) => detection.id));
  return corrections.filter((correction) => {
    if (correction.pageId !== result.pageId) {
      return false;
    }
    if (correction.operation.type === 'ADD') {
      return correction.operation.detection.systemId === result.systemId;
    }
    return detectionIds.has(correction.detectionId);
  });
}

function createReviewExport(projectId: string, result: OmrDetectionResult | null, corrections: OmrCorrection[], fixture: OmrSampleFixture | null = null) {
  return {
    schemaVersion: 1,
    kind: 'CUENOTE_OMR_REVIEW',
    projectId,
    fixture: fixture
      ? {
          id: fixture.id,
          title: fixture.title,
          source: fixture.source,
          expectedNotationType: fixture.expectedNotationType,
          hasLyrics: fixture.hasLyrics,
          hasChordSymbols: fixture.hasChordSymbols,
          captureType: fixture.captureType
        }
      : null,
    result: result
      ? {
          id: result.id,
          pageId: result.pageId,
          systemId: result.systemId,
          modelId: result.modelId,
          modelVersion: result.modelVersion,
          detectionCount: result.detections.length
        }
      : null,
    corrections,
    exportedAt: new Date().toISOString()
  };
}

function createEvaluationReportExport(report: OmrManualEvaluationReport) {
  return {
    schemaVersion: 1,
    kind: 'CUENOTE_OMR_MANUAL_EVALUATION',
    report,
    exportedAt: new Date().toISOString()
  };
}

function createRunSummary(detections: OmrDetection[], corrections: OmrCorrection[]) {
  const classCounts = new Map<string, number>();
  for (const detection of detections) {
    if (detection.reviewDecision === 'REJECTED') {
      continue;
    }
    classCounts.set(detection.classId, (classCounts.get(detection.classId) ?? 0) + 1);
  }
  const visible = detections.filter((detection) => detection.reviewDecision !== 'REJECTED');
  const averageConfidence = visible.length ? visible.reduce((sum, detection) => sum + detection.confidence, 0) / visible.length : 0;
  return {
    detectionCount: visible.length,
    averageConfidence,
    classCounts: Object.fromEntries(classCounts.entries()),
    classCountsText: [...classCounts.entries()].map(([classId, count]) => `${displayClassLabel(classId)}: ${count}`).join(', '),
    deletedCount: corrections.filter((correction) => correction.operation.type === 'REJECT').length,
    modifiedCount: corrections.filter((correction) => correction.operation.type === 'CHANGE_CLASS' || correction.operation.type === 'MOVE_RESIZE').length,
    addedCount: corrections.filter((correction) => correction.operation.type === 'ADD').length
  };
}

function createFixturePage(fixture: OmrSampleFixture, imageDataUrl: string) {
  const pageId = `fixture-page-${fixture.id}`;
  const systemId = `fixture-system-${fixture.id}`;
  return {
    page: {
      id: pageId,
      projectId: `fixture-project-${fixture.id}`,
      sourceId: `fixture-source-${fixture.id}`,
      pageIndex: 0,
      originalDimensions: { width: 960, height: 420 },
      rasterDimensions: { width: 960, height: 420 },
      rasterStorageKey: `fixture:${fixture.id}`,
      thumbnailDataUrl: imageDataUrl,
      status: 'REVIEW_COMPLETE' as const,
      transform: DEFAULT_PAGE_TRANSFORM,
      warnings: [],
      updatedAt: Date.now()
    },
    detectionSnapshot: null,
    effectiveRegions: [
      {
        id: systemId,
        type: 'SYSTEM' as const,
        pageId,
        parentId: null,
        rect: { x: 0.05, y: 0.18, width: 0.9, height: 0.5 },
        orderIndex: 0,
        confidence: 1,
        source: 'USER' as const
      }
    ],
    corrections: [],
    reviewComplete: true
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('LOCAL_FIXTURE_READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

function mergeResults(results: OmrDetectionResult[], result: OmrDetectionResult): OmrDetectionResult[] {
  return [...results.filter((candidate) => candidate.id !== result.id), result];
}

async function persistReviewSnapshot(projectId: string, payload: unknown): Promise<void> {
  const storageManager = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storageManager.getDirectory) {
    return;
  }
  try {
    const root = await storageManager.getDirectory();
    const file = await root.getFileHandle(`cuenote-omr-review-${projectId}.json`, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
  } catch (error) {
    console.debug('OPFS review snapshot skipped; IndexedDB correction persistence remains active.', error);
  }
}

function testIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function fixtureLabel(fixture: OmrSampleFixture): { title: string; source: string; expectedNotationType: string; licenseUsageNote: string; localFileProcedure?: string } {
  return FIXTURE_LABELS[fixture.id] ?? fixture;
}

function captureTypeLabel(value: string): string {
  if (value === 'synthetic') {
    return '합성 샘플';
  }
  if (value === 'scan') {
    return '스캔 이미지';
  }
  if (value === 'photo') {
    return '촬영 이미지';
  }
  return value;
}

function displayClassLabel(classId: string): string {
  const label = CLASS_LABELS[classId] ?? classId;
  return label === classId ? classId : `${label} (${classId})`;
}

function detectionSourceLabel(value: string): string {
  if (value === 'MODEL') {
    return '모델';
  }
  if (value === 'USER') {
    return '사용자';
  }
  return value;
}

function reviewDecisionLabel(value: string | undefined): string {
  if (value === 'ACCEPTED') {
    return '채택';
  }
  if (value === 'REJECTED') {
    return '삭제됨';
  }
  if (value === 'CORRECTED') {
    return '수정됨';
  }
  return value ?? '검토 전';
}

async function loadModelCatalog(): Promise<ModelOption[]> {
  try {
    const response = await fetch('/models/omr/model-catalog.json', { cache: 'no-cache' });
    if (!response.ok) {
      return [...BUILT_IN_MODEL_OPTIONS];
    }
    const value = (await response.json()) as { models?: ModelOption[] };
    const models = value.models?.filter((model) => model.id && model.label && model.url) ?? [];
    return models.length ? models : [...BUILT_IN_MODEL_OPTIONS];
  } catch {
    return [...BUILT_IN_MODEL_OPTIONS];
  }
}
