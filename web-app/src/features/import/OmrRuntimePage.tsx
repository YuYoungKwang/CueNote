import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  applyOmrCorrections,
  applyImportCorrections,
  createOmrCorrectionId,
  createOmrPreparationManifest,
  DEFAULT_PAGE_TRANSFORM,
  normalizeRect,
  type ImportPage,
  type ImportRegion,
  type ImportSource,
  type NormalizedRect,
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
import {
  createOmrRepository,
  type OmrAnalysisJobRecord,
  type OmrKnownFailureTag,
  type OmrManualEvaluationReport,
  type OmrSystemCropRecord
} from '../../core/storage/omrRepository';

const BUILT_IN_MODEL_OPTIONS = [
  { id: 'TEST_RUNTIME_MODEL', label: '테스트 런타임 모델 (TEST_RUNTIME_MODEL)', url: '/models/omr/test-runtime-manifest.json' },
  { id: 'LAYOUT_SMOKE_MODEL', label: '레이아웃 시험 모델 (LAYOUT_SMOKE_MODEL)', url: '/models/omr/layout-smoke-manifest.json' },
  { id: 'SYMBOL_SMOKE_MODEL', label: '기호 시험 모델 (SYMBOL_SMOKE_MODEL)', url: '/models/omr/symbol-smoke-manifest.json' }
] as const;

type ModelOption = { id: string; label: string; url: string };
type ModelCatalogState = 'loading' | 'ready' | 'fallback';

type ModelState =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number }
  | { kind: 'ready'; manifest: OmrModelManifest; provider: string; cacheHit: boolean; fallbackReason?: string; productState: string }
  | { kind: 'error'; message: string };

type RunState = { kind: 'idle' } | { kind: 'running'; progress: number } | { kind: 'ready'; result: OmrDetectionResult; outputNames: string[] } | { kind: 'error'; message: string };

const RECOMMENDED_SYMBOL_TILE_MODEL_ID = 'cuenote-symbol-deepscores-exp-0.1.0-colab-tile';

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
  const modelSelectionTouchedRef = useRef(false);
  const pendingRunJobsRef = useRef(new Map<string, { resolve: (result: OmrDetectionResult) => void; reject: (error: Error) => void }>());
  const [bundle, setBundle] = useState<ImportProjectBundle | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ kind: 'idle' });
  const [runState, setRunState] = useState<RunState>({ kind: 'idle' });
  const [storedResults, setStoredResults] = useState<OmrDetectionResult[]>([]);
  const [corrections, setCorrections] = useState<OmrCorrection[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([...BUILT_IN_MODEL_OPTIONS]);
  const [modelCatalogState, setModelCatalogState] = useState<ModelCatalogState>('loading');
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
  const [trainingSampleJson, setTrainingSampleJson] = useState('');
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [localFixtureDataUrl, setLocalFixtureDataUrl] = useState<string | null>(null);
  const [systemCrops, setSystemCrops] = useState<OmrSystemCropRecord[]>([]);
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
  const [cropReviewJson, setCropReviewJson] = useState('');
  const [showCropBoxes, setShowCropBoxes] = useState(true);
  const [showDetectionOverlay, setShowDetectionOverlay] = useState(true);
  const [status, setStatus] = useState('모델을 불러와 브라우저 OMR 실행 환경을 확인하세요.');

  const selectedModel = modelOptions.find((option) => option.id === selectedModelId) ?? modelOptions[0] ?? BUILT_IN_MODEL_OPTIONS[0];
  const selectedFixture = OMR_SAMPLE_FIXTURES.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const fixtureDataUrl = selectedFixture?.imageDataUrl ?? (selectedFixture?.id === 'korean-lyrics-chords-local' ? localFixtureDataUrl : null);
  const reviewScopeId = selectedFixture ? `${projectId}:fixture:${selectedFixture.id}` : projectId;
  const samplePage = fixtureDataUrl && selectedFixture ? createFixturePage(selectedFixture, fixtureDataUrl) : null;
  const activeResult = runState.kind === 'ready' ? runState.result : storedResults.at(-1) ?? null;
  const displayedResults = activeResult ? mergeResults(storedResults, activeResult) : storedResults;
  const currentResults = displayedResults.filter((result) => result.projectId === reviewScopeId);
  const modelClasses = modelState.kind === 'ready' ? modelState.manifest.classes : [];
  const correctedDetections = useMemo(
    () => currentResults.flatMap((result) => applyOmrCorrections(result.detections, correctionsForResult(corrections, result))),
    [currentResults, corrections]
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
  const runSummary = useMemo(() => createRunSummary(correctedDetections, correctionsForResults(corrections, currentResults)), [currentResults, correctedDetections, corrections]);

  useEffect(() => {
    void importRepository.loadProject(projectId).then(setBundle);
    void loadModelCatalog().then(({ options, source }) => {
      setModelOptions(options);
      setSelectedModelId((current) => {
        if (current === 'TEST_RUNTIME_MODEL' && !modelSelectionTouchedRef.current) {
          return preferredModelId(options);
        }
        return options.some((option) => option.id === current) ? current : preferredModelId(options);
      });
      setModelCatalogState(source);
    });
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
    setTrainingSampleJson('');
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
      if (!pendingRunJobsRef.current.has(message.jobId) && !isLatestOmrJob(message.jobId, latestJobRef.current)) {
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
      setStatus(`WebGPU를 사용할 수 없어 WASM으로 전환했습니다. ${modelFallbackReasonLabel(message.reason)}`);
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
          ? `${message.manifest.modelId} 모델을 불러왔습니다. 실행 방식: ${message.provider}.`
          : `${message.manifest.modelId} 모델을 ${modelStatusLabel(message.manifest.status ?? 'RUNTIME_SMOKE')} 상태로 불러왔습니다. 실행 방식: ${message.provider}. 제품용 OMR 모델은 아직 설치되지 않았습니다.`
      );
    } else if (message.type === 'MODEL_FAILED') {
      const translated = modelErrorMessage(message.error);
      setModelState({ kind: 'error', message: translated });
      setStatus(translated);
    } else if (message.type === 'JOB_STARTED' || message.type === 'JOB_PROGRESS') {
      setRunState({ kind: 'running', progress: message.progress });
    } else if (message.type === 'JOB_COMPLETED') {
      await omrRepository.saveResult(message.result);
      const nextResults = await omrRepository.loadResults(reviewScopeIdRef.current);
      setStoredResults(mergeResults(nextResults, message.result));
      setRunState({ kind: 'ready', result: message.result, outputNames: message.runtimeOutputNames });
      setStatus(`ONNX 추론이 완료되었습니다. 검출 ${message.result.detections.length}개가 생성되었고, MusicXML 초안 생성은 10단계로 남겨둡니다.`);
      pendingRunJobsRef.current.get(message.jobId)?.resolve(message.result);
      pendingRunJobsRef.current.delete(message.jobId);
    } else if (message.type === 'JOB_CANCELLED') {
      setRunState({ kind: 'idle' });
      setStatus('OMR 실행 작업을 취소했습니다.');
      pendingRunJobsRef.current.get(message.jobId)?.reject(new Error('JOB_CANCELLED'));
      pendingRunJobsRef.current.delete(message.jobId);
    } else if (message.type === 'JOB_FAILED') {
      setRunState({ kind: 'error', message: message.error });
      pendingRunJobsRef.current.get(message.jobId)?.reject(new Error(message.error));
      pendingRunJobsRef.current.delete(message.jobId);
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
  const fallbackCrop = firstPage && systemRegion ? systemCropFromRegion(reviewScopeId, systemRegion, 0, 'DETECTED') : null;
  const effectiveSystemCrops = systemCrops.length > 0 ? systemCrops : fallbackCrop ? [fallbackCrop] : [];
  const selectedCrop = effectiveSystemCrops.find((crop) => crop.id === selectedCropId) ?? effectiveSystemCrops[0] ?? null;
  const cropSummaries = useMemo(() => createCropSummaries(effectiveSystemCrops, currentResults), [effectiveSystemCrops, currentResults]);

  useEffect(() => {
    if (!firstPage) {
      setSystemCrops([]);
      setSelectedCropId(null);
      return;
    }
    void omrRepository.loadSystemCrops(reviewScopeId, firstPage.page.id).then((crops) => {
      setSystemCrops(crops);
      setSelectedCropId((current) => current ?? crops[0]?.id ?? null);
    });
  }, [firstPage?.page.id, omrRepository, reviewScopeId]);

  const loadModel = () => {
    if (modelCatalogState === 'loading') {
      setStatus('모델 목록을 불러오는 중입니다. 잠시 후 다시 시도하세요.');
      return;
    }
    const jobId = createJobId('load');
    latestJobRef.current = jobId;
    setModelState({ kind: 'loading', progress: 0 });
    setStatus(`${displayModelOption(selectedModel)}을 불러오는 중입니다.`);
    workerClient.post({ type: 'LOAD_MODEL', jobId, manifestUrl: selectedModel.url });
  };

  const runSystem = async () => {
    if (!selectedCrop) {
      setStatus('먼저 분석할 시스템 영역을 선택하거나 추가하세요.');
      return;
    }
    try {
      await runCrop(selectedCrop);
    } catch (error) {
      setStatus(error instanceof Error ? `선택 영역 분석 실패: ${error.message}` : '선택 영역 분석에 실패했습니다.');
    }
  };

  const runAllCrops = async () => {
    if (effectiveSystemCrops.length === 0) {
      setStatus('분석할 시스템 영역이 없습니다. 영역을 먼저 추가하세요.');
      return;
    }
    const results: OmrDetectionResult[] = [];
    try {
      for (const crop of effectiveSystemCrops) {
        setSelectedCropId(crop.id);
        results.push(await runCrop(crop));
      }
    } catch (error) {
      setStatus(error instanceof Error ? `전체 영역 분석 실패: ${error.message}` : '전체 영역 분석에 실패했습니다.');
      return;
    }
    const detectionCount = results.reduce((sum, result) => sum + result.detections.length, 0);
    setStatus(`전체 시스템 영역 ${results.length}개 분석을 완료했습니다. 검출 ${detectionCount}개가 생성되었습니다.`);
  };

  const runCrop = async (crop: OmrSystemCropRecord): Promise<OmrDetectionResult> => {
    if ((!bundle && !selectedFixture) || !firstPage || modelState.kind !== 'ready') {
      setStatus('검토 완료된 페이지와 불러온 모델이 필요합니다.');
      throw new Error('OMR_INPUT_NOT_READY');
    }

    const imageData = await imageDataForSystem(firstPage.page.thumbnailDataUrl, cropToRegion(crop));
    const inputManifest: OmrModelInputManifest = {
      schemaVersion: 1,
      projectId: reviewScopeId,
      pageId: firstPage.page.id,
      systemId: crop.id,
      image: {
        reference: firstPage.page.rasterStorageKey ?? firstPage.page.id,
        sourceChecksum: bundle?.source?.sha256 ?? selectedFixture?.id ?? 'unknown',
        width: imageData.width,
        height: imageData.height,
        channels: modelState.manifest.input.channels,
        colorSpace: modelState.manifest.input.channels === 1 ? 'GRAYSCALE' : 'RGB'
      },
      crop: { pageBounds: crop.rect, paddingRatio: 0.02 },
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
      systemId: crop.id,
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
    return new Promise<OmrDetectionResult>((resolve, reject) => {
      pendingRunJobsRef.current.set(jobId, { resolve, reject });
      workerClient.post({ type: 'ANALYZE_SYSTEM', jobId, input: inputManifest, imageData });
    });
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

  const persistSystemCrops = async (nextCrops: OmrSystemCropRecord[], message = '시스템 영역을 저장했습니다.') => {
    if (!firstPage) {
      return;
    }
    const ordered = nextCrops.map((crop, index) => ({ ...crop, orderIndex: index, updatedAt: Date.now() }));
    setSystemCrops(ordered);
    setSelectedCropId((current) => (current && ordered.some((crop) => crop.id === current) ? current : ordered[0]?.id ?? null));
    await omrRepository.saveSystemCrops(reviewScopeId, firstPage.page.id, ordered);
    setStatus(message);
  };

  const addSystemCrop = async () => {
    if (!firstPage) {
      setStatus('시스템 영역을 추가할 페이지가 없습니다.');
      return;
    }
    const baseCrops = systemCrops.length > 0 ? systemCrops : fallbackCrop ? [makeUserCropFromCrop(reviewScopeId, fallbackCrop)] : [];
    const offset = Math.min(0.16, baseCrops.length * 0.04);
    const now = Date.now();
    const crop: OmrSystemCropRecord = {
      id: `${reviewScopeId}:system-crop:${now}`,
      projectId: reviewScopeId,
      pageId: firstPage.page.id,
      rect: normalizeRect({ x: 0.08 + offset, y: 0.16 + offset, width: 0.84, height: 0.42 }),
      orderIndex: baseCrops.length,
      source: 'USER',
      createdAt: now,
      updatedAt: now
    };
    await persistSystemCrops([...baseCrops, crop], '새 시스템 영역을 추가하고 저장했습니다.');
    setSelectedCropId(crop.id);
  };

  const deleteSelectedCrop = async () => {
    if (!selectedCrop || systemCrops.length === 0) {
      setStatus('삭제할 사용자 시스템 영역이 없습니다.');
      return;
    }
    await persistSystemCrops(systemCrops.filter((crop) => crop.id !== selectedCrop.id), '선택한 시스템 영역을 삭제했습니다.');
  };

  const updateSelectedCropRect = async (patch: Partial<NormalizedRect>, message = '시스템 영역을 수정했습니다.') => {
    if (!selectedCrop) {
      setStatus('수정할 시스템 영역을 선택하세요.');
      return;
    }
    const baseCrops = systemCrops.length > 0 ? systemCrops : [makeUserCropFromCrop(reviewScopeId, selectedCrop)];
    const next = baseCrops.map((crop) =>
      crop.id === selectedCrop.id
        ? {
            ...crop,
            rect: normalizeRect({ ...crop.rect, ...patch }),
            source: 'USER' as const,
            updatedAt: Date.now()
          }
        : crop
    );
    await persistSystemCrops(next, message);
  };

  const nudgeSelectedCrop = async (delta: { x?: number; y?: number; width?: number; height?: number }) => {
    if (!selectedCrop) {
      setStatus('이동하거나 조절할 시스템 영역을 선택하세요.');
      return;
    }
    await updateSelectedCropRect({
      x: selectedCrop.rect.x + (delta.x ?? 0),
      y: selectedCrop.rect.y + (delta.y ?? 0),
      width: selectedCrop.rect.width + (delta.width ?? 0),
      height: selectedCrop.rect.height + (delta.height ?? 0)
    });
  };

  const exportCropReviewJson = () => {
    if (!firstPage) {
      setStatus('내보낼 시스템 영역이 없습니다.');
      return;
    }
    setCropReviewJson(JSON.stringify(createCropReviewExport(reviewScopeId, firstPage.page.id, systemCrops), null, 2));
  };

  const importCropReviewJson = async () => {
    if (!firstPage) {
      setStatus('가져올 페이지가 없습니다.');
      return;
    }
    const parsed = JSON.parse(cropReviewJson) as { crops?: OmrSystemCropRecord[] };
    const crops = (parsed.crops ?? []).map((crop, index) => ({
      ...crop,
      projectId: reviewScopeId,
      pageId: firstPage.page.id,
      rect: normalizeRect(crop.rect),
      orderIndex: index,
      updatedAt: Date.now()
    }));
    await persistSystemCrops(crops, '시스템 영역 JSON을 가져왔습니다.');
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
    if (!addMode || !activeResult || !selectedCrop || !selectedClassId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const pageX = (event.clientX - rect.left) / rect.width;
    const pageY = (event.clientY - rect.top) / rect.height;
    const targetCrop =
      effectiveSystemCrops.find((crop) => pageX >= crop.rect.x && pageY >= crop.rect.y && pageX <= crop.rect.x + crop.rect.width && pageY <= crop.rect.y + crop.rect.height) ?? selectedCrop;
    const system = targetCrop.rect;
    const localX = Math.min(1, Math.max(0, (pageX - system.x) / system.width));
    const localY = Math.min(1, Math.max(0, (pageY - system.y) / system.height));
    const boundsInSystem = normalizeRect({
      x: localX - 0.015,
      y: localY - 0.015,
      width: 0.03,
      height: 0.03
    });
    const detection: OmrDetection = {
      id: `${projectId}:omr-user-detection:${Date.now()}`,
      classId: selectedClassId,
      className: selectedClassId,
      confidence: 1,
      systemId: targetCrop.id,
      pageId: activeResult.pageId,
      boundsInSystem,
      boundsInPage: systemRectToPageRect(boundsInSystem, targetCrop.rect),
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

  const exportTrainingSampleJson = () => {
    if (!firstPage) {
      setStatus('학습 샘플로 내보낼 페이지가 없습니다.');
      return;
    }
    const exportValue = createTrainingSampleExport({
      projectId: reviewScopeId,
      page: firstPage.page,
      source: bundle?.source ?? null,
      fixture: selectedFixture,
      crops: effectiveSystemCrops,
      results: currentResults,
      corrections,
      evaluationReport: evaluationReports.at(-1) ?? createCurrentEvaluationReport()
    });
    setTrainingSampleJson(JSON.stringify(exportValue, null, 2));
    setStatus('학습 샘플 JSON을 생성했습니다. 실제 이미지는 별도 안내에 따라 수동으로 모아야 합니다.');
  };

  const importTrainingSampleJson = () => {
    const parsed = JSON.parse(trainingSampleJson) as {
      kind?: string;
      correctedDetections?: unknown;
      cropBoxes?: unknown;
      yoloTileFineTuning?: { labelsByCrop?: unknown };
    };
    if (parsed.kind !== 'CUENOTE_OMR_TRAINING_SAMPLE_EXPORT') {
      setStatus('학습 샘플 JSON kind가 올바르지 않습니다.');
      return;
    }
    if (!Array.isArray(parsed.cropBoxes) || !Array.isArray(parsed.correctedDetections) || !Array.isArray(parsed.yoloTileFineTuning?.labelsByCrop)) {
      setStatus('학습 샘플 JSON 구조가 올바르지 않습니다.');
      return;
    }
      setStatus(`학습 샘플 JSON을 확인했습니다. 영역 ${parsed.cropBoxes.length}개, 검출 결과 ${parsed.correctedDetections.length}개가 포함되어 있습니다.`);
  };

  if (mode === 'draft') {
    return (
      <main className="panel state-panel" data-testid="omr-draft-deferred">
        <h2>OMR MusicXML 초안은 10단계 기능입니다</h2>
        <p>현재 화면은 OMR 실행 환경과 검수 흐름만 확인합니다. 구조 조립, MusicXML 초안 생성, 6단계 편집기 전달은 10단계로 남겨둡니다.</p>
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
            <p className="eyebrow">8-9단계</p>
            <h2>브라우저 악보 인식 실행 및 검수</h2>
            <p className="muted" data-testid="omr-runtime-status">
              {status}
            </p>
          </div>
          <div className="playback-button-row">
            <Link className="secondary-link" to={`/imports/${projectId}/review`}>
              레이아웃 검토
            </Link>
            <Link className="secondary-link" to={`/imports/${projectId}/omr/draft`} data-testid="omr-draft-link">
              초안 생성 준비 상태
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
            <strong data-testid="omr-model-status">{modelState.kind === 'ready' ? modelStatusLabel(modelState.manifest.status ?? 'RUNTIME_SMOKE') : '불러오지 않음'}</strong>
          </div>
          <div>
            <span className="summary-label">제품용 모델</span>
            <strong data-testid="omr-product-state">{modelState.kind === 'ready' ? productStateLabel(modelState.productState) : productStateLabel('PRODUCT_MODEL_NOT_INSTALLED')}</strong>
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
              modelSelectionTouchedRef.current = true;
              setSelectedModelId(event.target.value);
              setModelState({ kind: 'idle' });
              setRunState({ kind: 'idle' });
              setStatus('선택한 모델을 불러오려면 “모델 불러오기”를 누르세요.');
            }}
            data-testid="omr-model-select"
          >
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {displayModelOption(option)}
              </option>
            ))}
          </select>
          <button type="button" className="primary-link" onClick={loadModel} disabled={modelCatalogState === 'loading' || modelState.kind === 'loading'} data-testid="omr-load-model">
            모델 불러오기
          </button>
          <button type="button" className="primary-link" onClick={() => void runSystem()} disabled={modelState.kind !== 'ready' || !selectedCrop} data-testid="omr-run-system">
            선택 영역 분석
          </button>
          <button type="button" className="primary-link" onClick={() => void runAllCrops()} disabled={modelState.kind !== 'ready' || effectiveSystemCrops.length === 0} data-testid="omr-run-all-crops">
            전체 영역 분석
          </button>
          <button type="button" className="control-button" onClick={cancelJob} data-testid="omr-cancel-job">
            취소
          </button>
        </div>

        {modelCatalogState === 'loading' ? <p data-testid="omr-model-catalog-loading">모델 목록을 불러오는 중입니다.</p> : null}
        {modelCatalogState === 'fallback' ? <p data-testid="omr-model-catalog-fallback">설치된 모델 목록을 읽지 못해 기본 테스트 모델만 표시합니다.</p> : null}
        {modelState.kind === 'loading' ? <p data-testid="omr-model-loading">모델 불러오는 중 {Math.round(modelState.progress * 100)}%</p> : null}
        {modelState.kind === 'error' ? <p data-testid="omr-model-error">{modelState.message}</p> : null}
        {modelState.kind === 'ready' && modelState.fallbackReason ? <p data-testid="omr-fallback-reason">WASM으로 전환한 이유: {modelFallbackReasonLabel(modelState.fallbackReason)}</p> : null}
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

        <div className="omr-crop-review-panel" data-testid="omr-crop-review-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">페이지/시스템 영역 검수</p>
              <h3>페이지 시스템 영역 검토</h3>
              <p className="muted">전체 페이지 위에서 기호 인식에 사용할 시스템 영역을 직접 조정합니다.</p>
            </div>
          </div>
          <div className="playback-button-row">
            <button type="button" className="control-button" onClick={() => void addSystemCrop()} data-testid="omr-add-system-crop">
              영역 추가
            </button>
            <button type="button" className="control-button" onClick={() => void deleteSelectedCrop()} disabled={!selectedCrop} data-testid="omr-delete-system-crop">
              선택 영역 삭제
            </button>
            <button type="button" className="secondary-link" onClick={exportCropReviewJson} data-testid="omr-export-crop-json">
              영역 JSON 내보내기
            </button>
            <button type="button" className="secondary-link" onClick={() => void importCropReviewJson()} data-testid="omr-import-crop-json">
              영역 JSON 가져오기
            </button>
          </div>
          <div className="playback-button-row">
            <label className="checkbox-label">
              <input type="checkbox" checked={showCropBoxes} onChange={(event) => setShowCropBoxes(event.target.checked)} data-testid="omr-toggle-crop-boxes" />
              영역 박스 표시
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={showDetectionOverlay} onChange={(event) => setShowDetectionOverlay(event.target.checked)} data-testid="omr-toggle-detections" />
              기호 검출 표시
            </label>
          </div>
          <div className="playback-button-row">
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ y: -0.02 })} disabled={!selectedCrop} data-testid="omr-crop-move-up">
              위로
            </button>
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ y: 0.02 })} disabled={!selectedCrop} data-testid="omr-crop-move-down">
              아래로
            </button>
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ x: -0.02 })} disabled={!selectedCrop} data-testid="omr-crop-move-left">
              왼쪽
            </button>
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ x: 0.02 })} disabled={!selectedCrop} data-testid="omr-crop-move-right">
              오른쪽
            </button>
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ width: 0.03 })} disabled={!selectedCrop} data-testid="omr-crop-wider">
              넓게
            </button>
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ width: -0.03 })} disabled={!selectedCrop} data-testid="omr-crop-narrower">
              좁게
            </button>
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ height: 0.03 })} disabled={!selectedCrop} data-testid="omr-crop-taller">
              높게
            </button>
            <button type="button" className="control-button" onClick={() => void nudgeSelectedCrop({ height: -0.03 })} disabled={!selectedCrop} data-testid="omr-crop-shorter">
              낮게
            </button>
          </div>
          <p data-testid="omr-selected-crop-id">선택 영역: {selectedCrop?.id ?? '없음'}</p>
          <textarea className="omr-review-json" value={cropReviewJson} onChange={(event) => setCropReviewJson(event.target.value)} data-testid="omr-crop-json" />
        </div>

        <div className="import-page-stage" data-testid="omr-detection-overlay">
          {firstPage?.page.thumbnailDataUrl ? <img src={firstPage.page.thumbnailDataUrl} alt="" className="import-page-image" /> : <div className="import-page-placeholder">검토된 페이지가 없습니다</div>}
          <div className={`import-region-overlay ${addMode ? 'is-adding' : ''}`} onClick={(event) => void handleOverlayClick(event)} data-testid="omr-overlay-hit-area">
            {showCropBoxes
              ? effectiveSystemCrops.map((crop) => (
                  <button
                    key={crop.id}
                    type="button"
                    className={`import-region import-region--system ${selectedCrop?.id === crop.id ? 'is-selected' : ''}`}
                    style={rectStyle(crop.rect)}
                    onClick={(event) => {
                      if (addMode) {
                        return;
                      }
                      event.stopPropagation();
                      setSelectedCropId(crop.id);
                    }}
                    data-testid="omr-system-crop-box"
                  >
                    영역 {crop.orderIndex + 1}
                  </button>
                ))
              : null}
            {showDetectionOverlay ? visibleDetections.map((detection) => (
              <button
                key={detection.id}
                type="button"
                className={`import-region import-region--omr-detection ${selectedDetectionId === detection.id ? 'is-selected' : ''}`}
                style={rectStyle(detection.boundsInPage)}
                data-testid="omr-detection-box"
                title={`${detection.classId} ${Math.round(detection.confidence * 100)}%`}
                onClick={(event) => {
                  if (addMode) {
                    return;
                  }
                  event.stopPropagation();
                  setSelectedDetectionId(detection.id);
                }}
              >
                {displayClassLabel(detection.classId)}
              </button>
            )) : null}
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
        <div className="omr-crop-summary-panel" data-testid="omr-crop-summary">
          <p className="eyebrow">영역별 분석 요약</p>
          <ul className="measure-list">
            {cropSummaries.length === 0 ? <li>분석할 시스템 영역이 없습니다.</li> : null}
            {cropSummaries.map((summary) => (
              <li key={summary.cropId} data-testid="omr-crop-summary-item">
                <button
                  type="button"
                  className={`measure-item ${selectedCrop?.id === summary.cropId ? 'is-active' : ''}`}
                  onClick={() => setSelectedCropId(summary.cropId)}
                >
                  <span className="measure-item__number">영역 {summary.orderIndex + 1}</span>
                  <span className="measure-item__meta">
                    검출 {summary.detectionCount}개 / 평균 신뢰도 {summary.averageConfidence.toFixed(2)}
                  </span>
                </button>
                <p className="muted">{summary.classCountsText || '기호별 집계 없음'}</p>
              </li>
            ))}
          </ul>
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
        <div className="omr-training-export-panel" data-testid="omr-training-sample-panel">
          <p className="eyebrow">학습 샘플 내보내기</p>
          <p className="muted">
            검수한 시스템 영역과 수정 레이어를 합쳐 추가 학습용 JSON을 만듭니다. 실제 이미지 파일은 JSON의 안내에 따라 별도로 모아야 합니다.
          </p>
          <div className="playback-button-row">
            <button type="button" className="control-button" onClick={exportTrainingSampleJson} data-testid="omr-export-training-sample">
              학습 JSON 생성
            </button>
            <button type="button" className="secondary-link" onClick={importTrainingSampleJson} data-testid="omr-import-training-sample">
              학습 JSON 확인
            </button>
          </div>
          <p className="muted">kind, model id, class id, schema 값은 학습 파이프라인 호환성을 위해 내부 영어 값을 유지합니다.</p>
          <textarea
            className="omr-review-json"
            value={trainingSampleJson}
            onChange={(event) => setTrainingSampleJson(event.target.value)}
            data-testid="omr-training-sample-json"
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
          <p data-testid="omr-correction-count">저장된 수정 {correctionsForResults(corrections, currentResults).length}개</p>
        </div>
        <p className="eyebrow">10단계</p>
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

function correctionsForResults(corrections: OmrCorrection[], results: OmrDetectionResult[]): OmrCorrection[] {
  const byId = new Map(results.map((result) => [result.id, result]));
  return [...new Map(results.flatMap((result) => correctionsForResult(corrections, byId.get(result.id) ?? null)).map((correction) => [correction.id, correction])).values()];
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

function createCropReviewExport(projectId: string, pageId: string, crops: OmrSystemCropRecord[]) {
  return {
    schemaVersion: 1,
    kind: 'CUENOTE_OMR_SYSTEM_CROP_REVIEW',
    projectId,
    pageId,
    crops,
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

type TrainingSampleExportInput = {
  projectId: string;
  page: ImportPage;
  source: ImportSource | null;
  fixture: OmrSampleFixture | null;
  crops: OmrSystemCropRecord[];
  results: OmrDetectionResult[];
  corrections: OmrCorrection[];
  evaluationReport: OmrManualEvaluationReport | null;
};

function createTrainingSampleExport(input: TrainingSampleExportInput) {
  const correctedDetections = uniqueDetections(
    input.results.flatMap((result) => applyOmrCorrections(result.detections, correctionsForResult(input.corrections, result)))
  ).filter((detection) => detection.reviewDecision !== 'REJECTED');
  const exportDetections = correctedDetections.map((detection) => createTrainingDetectionExport(detection, input.crops));
  const classIds = [...new Set(exportDetections.map((detection) => detection.classId))].sort();
  const classIndex = new Map(classIds.map((classId, index) => [classId, index]));
  const labelsByCrop = input.crops.map((crop) => {
    const labels = exportDetections
      .filter((detection) => detection.cropId === crop.id && detection.boundsInCrop)
      .map((detection) => ({
        detectionId: detection.id,
        classId: detection.classId,
        classIndex: classIndex.get(detection.classId) ?? -1,
        yolo: rectToYolo(detection.boundsInCrop as NormalizedRect)
      }))
      .filter((label) => label.classIndex >= 0 && label.yolo !== null);
    return {
      cropId: crop.id,
      orderIndex: crop.orderIndex,
      imageInstruction: '이 label file을 만들기 전에 cropBoxes[].boundsInPage 값을 사용해 원본 페이지 이미지를 잘라내세요.',
      labelText: labels.map((label) => `${label.classIndex} ${label.yolo}`).join('\n'),
      labels
    };
  });

  return {
    schemaVersion: 1,
    kind: 'CUENOTE_OMR_TRAINING_SAMPLE_EXPORT',
    projectId: input.projectId,
    exportedAt: new Date().toISOString(),
    sourceImage: {
      pageId: input.page.id,
      pageIndex: input.page.pageIndex,
      imageReference: input.page.rasterStorageKey ?? input.page.id,
      originalDimensions: input.page.originalDimensions,
      rasterDimensions: input.page.rasterDimensions,
      sourceId: input.source?.id ?? null,
      sourceType: input.source?.type ?? (input.fixture ? 'FIXTURE' : 'UNKNOWN'),
      fileName: input.source?.fileName ?? input.fixture?.title ?? null,
      mimeType: input.source?.mimeType ?? null,
      sha256: input.source?.sha256 ?? null,
      fixtureLocalFileRequired: input.fixture?.id === 'korean-lyrics-chords-local'
    },
    fixture: input.fixture
      ? {
          id: input.fixture.id,
          title: input.fixture.title,
          source: input.fixture.source,
          expectedNotationType: input.fixture.expectedNotationType,
          hasLyrics: input.fixture.hasLyrics,
          hasChordSymbols: input.fixture.hasChordSymbols,
          captureType: input.fixture.captureType,
          licenseUsageNote: input.fixture.licenseUsageNote
        }
      : null,
    modelRuns: input.results.map((result) => ({
      resultId: result.id,
      modelId: result.modelId,
      modelVersion: result.modelVersion,
      executionProvider: result.executionProvider,
      systemId: result.systemId,
      detectionCount: result.detections.length,
      createdAt: result.createdAt
    })),
    cropBoxes: input.crops.map((crop) => ({
      id: crop.id,
      pageId: crop.pageId,
      orderIndex: crop.orderIndex,
      source: crop.source,
      boundsInPage: crop.rect,
      createdAt: crop.createdAt,
      updatedAt: crop.updatedAt
    })),
    correctedDetections: exportDetections,
    review: input.evaluationReport
      ? {
          reportId: input.evaluationReport.id,
          reviewerNote: input.evaluationReport.reviewerNote,
          knownFailureTags: input.evaluationReport.knownFailureTags,
          correctionCount: input.evaluationReport.correctionCount,
          deletedCount: input.evaluationReport.deletedCount,
          modifiedCount: input.evaluationReport.modifiedCount,
          addedCount: input.evaluationReport.addedCount
        }
      : {
          reportId: null,
          reviewerNote: '',
          knownFailureTags: [],
          correctionCount: 0,
          deletedCount: 0,
          modifiedCount: 0,
          addedCount: 0
        },
    yoloTileFineTuning: {
      status: 'JSON_INSTRUCTIONS_ONLY',
      classIds,
      labelsByCrop,
      instructions: [
        '브라우저 export 흐름 밖에서 라이선스가 확인된 원본 페이지 이미지를 모으세요.',
        'cropBoxes[].boundsInPage 값을 사용해 각 페이지 이미지를 자르고, 안정적인 영역 id로 crop 이미지를 저장하세요.',
        'labelsByCrop[].labelText 값을 해당 crop 이미지와 같은 이름의 YOLO .txt 파일로 저장하세요.',
        '실험용 tile 기호 모델을 추가 학습하기 전에 실제 한국어 가사/코드 악보 10-30장을 검수하세요.',
        '고정 split metric과 브라우저 런타임 검증을 다시 통과하기 전까지 모델 상태는 EXPERIMENTAL로 유지하세요.'
      ]
    },
    boundaries: {
      modelStatus: 'EXPERIMENTAL',
      phase10Readiness: 'NOT_READY',
      serverUploadIncluded: false,
      musicXmlGenerationIncluded: false,
      candidatePromotionIncluded: false
    }
  };
}

function uniqueDetections(detections: OmrDetection[]): OmrDetection[] {
  const byId = new Map<string, OmrDetection>();
  for (const detection of detections) {
    byId.set(detection.id, detection);
  }
  return [...byId.values()];
}

function createTrainingDetectionExport(detection: OmrDetection, crops: OmrSystemCropRecord[]) {
  const crop = crops.find((candidate) => candidate.id === detection.systemId) ?? findCropForDetection(crops, detection);
  const boundsInCrop =
    crop && crop.id === detection.systemId ? clipNormalizedRect(detection.boundsInSystem) : crop ? rectInCropCoordinates(detection.boundsInPage, crop.rect) : null;
  return {
    id: detection.id,
    classId: detection.classId,
    className: detection.className,
    confidence: detection.confidence,
    source: detection.source,
    reviewDecision: detection.reviewDecision,
    pageId: detection.pageId,
    cropId: crop?.id ?? detection.systemId,
    systemId: detection.systemId,
    boundsInPage: clipNormalizedRect(detection.boundsInPage) ?? detection.boundsInPage,
    boundsInCrop,
    modelVersion: detection.modelVersion ?? null,
    attributes: detection.attributes ?? {}
  };
}

function findCropForDetection(crops: OmrSystemCropRecord[], detection: OmrDetection): OmrSystemCropRecord | null {
  const centerX = detection.boundsInPage.x + detection.boundsInPage.width / 2;
  const centerY = detection.boundsInPage.y + detection.boundsInPage.height / 2;
  return crops.find((crop) => centerX >= crop.rect.x && centerY >= crop.rect.y && centerX <= crop.rect.x + crop.rect.width && centerY <= crop.rect.y + crop.rect.height) ?? null;
}

function rectInCropCoordinates(pageRect: NormalizedRect, cropRect: NormalizedRect): NormalizedRect | null {
  if (cropRect.width <= 0 || cropRect.height <= 0) {
    return null;
  }
  return clipNormalizedRect({
    x: (pageRect.x - cropRect.x) / cropRect.width,
    y: (pageRect.y - cropRect.y) / cropRect.height,
    width: pageRect.width / cropRect.width,
    height: pageRect.height / cropRect.height
  });
}

function clipNormalizedRect(rect: NormalizedRect): NormalizedRect | null {
  const x1 = Math.max(0, Math.min(1, rect.x));
  const y1 = Math.max(0, Math.min(1, rect.y));
  const x2 = Math.max(0, Math.min(1, rect.x + rect.width));
  const y2 = Math.max(0, Math.min(1, rect.y + rect.height));
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function rectToYolo(rect: NormalizedRect): string | null {
  const clipped = clipNormalizedRect(rect);
  if (!clipped) {
    return null;
  }
  const centerX = clipped.x + clipped.width / 2;
  const centerY = clipped.y + clipped.height / 2;
  return [centerX, centerY, clipped.width, clipped.height].map((value) => value.toFixed(6)).join(' ');
}

function createCropSummaries(crops: OmrSystemCropRecord[], results: OmrDetectionResult[]) {
  return crops.map((crop) => {
    const detections = results.filter((result) => result.systemId === crop.id).flatMap((result) => result.detections);
    const classCounts = new Map<string, number>();
    for (const detection of detections) {
      if (detection.reviewDecision === 'REJECTED') {
        continue;
      }
      classCounts.set(detection.classId, (classCounts.get(detection.classId) ?? 0) + 1);
    }
    const visible = detections.filter((detection) => detection.reviewDecision !== 'REJECTED');
    return {
      cropId: crop.id,
      orderIndex: crop.orderIndex,
      detectionCount: visible.length,
      averageConfidence: visible.length ? visible.reduce((sum, detection) => sum + detection.confidence, 0) / visible.length : 0,
      classCountsText: [...classCounts.entries()].map(([classId, count]) => `${displayClassLabel(classId)}: ${count}`).join(', ')
    };
  });
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

function systemCropFromRegion(projectId: string, region: ImportRegion, orderIndex: number, source: 'DETECTED' | 'USER'): OmrSystemCropRecord {
  const now = Date.now();
  return {
    id: region.id,
    projectId,
    pageId: region.pageId,
    rect: region.rect,
    orderIndex,
    source,
    createdAt: now,
    updatedAt: now
  };
}

function makeUserCropFromCrop(projectId: string, crop: OmrSystemCropRecord): OmrSystemCropRecord {
  const now = Date.now();
  return {
    ...crop,
    id: crop.id,
    projectId,
    source: 'USER',
    createdAt: crop.createdAt || now,
    updatedAt: now
  };
}

function cropToRegion(crop: OmrSystemCropRecord): ImportRegion {
  return {
    id: crop.id,
    type: 'SYSTEM',
    pageId: crop.pageId,
    parentId: null,
    rect: crop.rect,
    orderIndex: crop.orderIndex,
    confidence: 1,
    source: crop.source
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

function displayModelOption(option: ModelOption): string {
  if (option.id === RECOMMENDED_SYMBOL_TILE_MODEL_ID) {
    return `권장 기호 타일 모델 - 실험용 (${option.id})`;
  }
  if (option.id === 'cuenote-symbol-deepscores-exp') {
    return `이전 전체 페이지 기호 모델 - 진단용 (${option.id})`;
  }
  if (option.id === 'cuenote-layout-deepscores-exp') {
    return `레이아웃 실험 모델 (${option.id})`;
  }
  if (option.id === 'TEST_RUNTIME_MODEL') {
    return '테스트 런타임 모델 (TEST_RUNTIME_MODEL)';
  }
  if (option.id === 'LAYOUT_SMOKE_MODEL') {
    return '레이아웃 시험 모델 (LAYOUT_SMOKE_MODEL)';
  }
  if (option.id === 'SYMBOL_SMOKE_MODEL') {
    return '기호 시험 모델 (SYMBOL_SMOKE_MODEL)';
  }
  return option.label;
}

function preferredModelId(options: ModelOption[]): string {
  return options.find((option) => option.id === RECOMMENDED_SYMBOL_TILE_MODEL_ID)?.id ?? options[0]?.id ?? 'TEST_RUNTIME_MODEL';
}

function modelStatusLabel(value: string): string {
  if (value === 'PRODUCT') {
    return '제품용 (PRODUCT)';
  }
  if (value === 'CANDIDATE') {
    return '후보 (CANDIDATE)';
  }
  if (value === 'EXPERIMENTAL') {
    return '실험용 (EXPERIMENTAL)';
  }
  if (value === 'RUNTIME_SMOKE') {
    return '런타임 확인용 (RUNTIME_SMOKE)';
  }
  return value;
}

function productStateLabel(value: string): string {
  if (value === 'PRODUCT_MODEL_READY') {
    return '제품용 모델 준비됨 (PRODUCT_MODEL_READY)';
  }
  if (value === 'PRODUCT_MODEL_NOT_INSTALLED') {
    return '제품용 모델 아님 (PRODUCT_MODEL_NOT_INSTALLED)';
  }
  return value;
}

function modelFallbackReasonLabel(reason: string): string {
  if (reason.includes('WEBGPU_UNAVAILABLE_CROSS_ORIGIN_ISOLATION')) {
    return '브라우저 보안 격리 조건이 맞지 않아 WebGPU를 사용할 수 없습니다.';
  }
  if (reason.includes('WEBGPU_UNAVAILABLE')) {
    return '이 브라우저 또는 장치에서 WebGPU를 사용할 수 없습니다.';
  }
  if (reason.includes('webgpu')) {
    return `WebGPU 세션 생성에 실패했습니다. 원문: ${reason}`;
  }
  return reason;
}

function modelErrorMessage(error: string): string {
  if (error.includes('MODEL_DOWNLOAD_FAILED')) {
    return `모델 파일을 내려받지 못했습니다. 개발 서버가 실행 중인지, 모델 파일 경로가 올바른지 확인하세요. 원문: ${error}`;
  }
  if (error.includes('MODEL_HASH_MISMATCH')) {
    return '모델 파일 검증에 실패했습니다. 파일이 손상되었거나 manifest checksum과 일치하지 않습니다.';
  }
  if (error.includes('WASM_INITIALIZATION_FAILED')) {
    return `WASM 실행 환경 초기화에 실패했습니다. 브라우저 새로고침 후 다시 시도하거나 캐시를 비워 보세요. 원문: ${error}`;
  }
  if (error.includes('MODEL_SESSION_FAILED')) {
    return `모델 세션을 만들지 못했습니다. 선택한 모델과 브라우저 실행 환경을 확인하세요. 원문: ${error}`;
  }
  if (error.includes('MODEL_MANIFEST_INVALID')) {
    return '모델 manifest 형식이 올바르지 않습니다.';
  }
  return `모델을 불러오지 못했습니다. 원문: ${error}`;
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

async function loadModelCatalog(): Promise<{ options: ModelOption[]; source: ModelCatalogState }> {
  try {
    const response = await fetch('/models/omr/model-catalog.json', { cache: 'no-cache' });
    if (!response.ok) {
      return { options: [...BUILT_IN_MODEL_OPTIONS], source: 'fallback' };
    }
    const value = (await response.json()) as { models?: ModelOption[] };
    const models = value.models?.filter((model) => model.id && model.label && model.url) ?? [];
    return { options: models.length ? models : [...BUILT_IN_MODEL_OPTIONS], source: models.length ? 'ready' : 'fallback' };
  } catch {
    return { options: [...BUILT_IN_MODEL_OPTIONS], source: 'fallback' };
  }
}
