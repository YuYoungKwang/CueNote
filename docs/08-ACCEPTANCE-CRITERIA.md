# 08. 완료 기준과 검증

## 1. 공통 Definition of Done

- 지정된 Phase 범위와 일치한다.
- 범위 밖 기능을 임의로 구현하지 않았다.
- 빌드가 성공한다.
- 핵심 도메인 로직에 단위 테스트가 있다.
- 실패 경로와 사용자 오류 메시지가 있다.
- 임시 하드코딩을 완료 기능으로 남기지 않았다.
- Secret·토큰·개인 파일을 커밋하지 않았다.
- 관련 문서가 갱신되었다.
- 변경 파일과 실제 검증 결과가 기록되었다.
- 실행하지 못한 검증을 성공했다고 보고하지 않는다.
- Mac, 특정 브라우저, 실제 기기 등 접근할 수 없는 환경의 검증은 미검증으로 표시한다.

## 2. 코드 품질

### Web PWA

- React component에 네트워크·DB·반복 해석 로직을 직접 넣지 않는다.
- 무거운 OMR 추론과 이미지 전처리는 Web Worker에서 실행한다.
- IndexedDB 오류와 저장 공간 부족을 사용자에게 설명한다.
- Service Worker 업데이트와 캐시 무효화 정책이 있다.
- WebGPU가 없거나 실패해도 WASM fallback을 제공한다.
- 화면 절대 픽셀만 필기 좌표로 저장하지 않는다.
- 브라우저 background/foreground 복구를 고려한다.

### Backend

- Controller/Service/Repository 책임을 분리한다.
- DTO와 Entity를 분리한다.
- 입력과 권한을 검증한다.
- Flyway로 DB schema를 관리한다.
- Testcontainers 통합 테스트를 작성한다.
- 민감 정보를 로그에 남기지 않는다.

### AI Training

- 학습은 Windows 또는 WSL2 Python/PyTorch 환경에서 수행한다.
- 브라우저에서 학습한다고 설명하지 않는다.
- ONNX export와 validation을 분리한다.
- 모델 파일은 version, hash, size, 호환성을 manifest로 관리한다.

## 3. Phase 0

- `npm install` 성공
- `npm run build` 성공
- `npm run test` 성공
- Playwright 기본 E2E 성공
- PWA manifest 유효
- Service Worker 등록
- `app/core/domain/features/ai/workers` 구조가 있다.
- IndexedDB adapter 기본 인터페이스가 있다.
- `MockOMRService`가 있으며 실제 ONNX 모델은 연결하지 않는다.
- Docker Compose 설정이 유효하다.
- Backend가 Java 21로 빌드된다.
- Backend build/test가 성공한다.
- Health API가 200을 반환한다.
- PostgreSQL Compose가 실행된다.
- Flyway migration이 적용된다.
- Testcontainers 통합 테스트가 실행된다.
- K3s Deployment/Service/Ingress 초안이 있다.
- `.env.example`에 실제 Secret이 없다.
- 실제 OMR과 실제 합주 WebSocket은 아직 구현하지 않는다.

> 관련 문서: [11-PWA-OFFLINE-SPEC.md](./11-PWA-OFFLINE-SPEC.md)

## 4. 브라우저 검증 대상

필수 또는 권장 검증 대상:

- Windows Chrome
- Windows Edge
- macOS Chrome 또는 Safari
- iPad Safari

현재 환경에 없는 브라우저 또는 실제 기기는 성공으로 주장하지 않고 미검증으로 기록한다.

> 관련 문서: [10-WEB-CAPABILITY-MATRIX.md](./10-WEB-CAPABILITY-MATRIX.md)

## 5. Phase 1

- 샘플 MusicXML 2개 이상을 불러온다.
- 파싱 실패를 사용자에게 표시한다.
- 마디마다 안정적인 ID가 있다.
- 렌더러가 마디 DOM 또는 equivalent mapping을 제공한다.
- 특정 마디를 하이라이트·스크롤할 수 있다.
- 회전 또는 viewport 변경 후 현재 마디가 유지된다.
- 최근 악보가 IndexedDB에 저장된다.
- 인터넷 없이 기존 샘플을 다시 열 수 있다.
- parser와 마디 매핑 테스트가 있다.

## 6. Phase 2

### 반복

- 단순 도돌이표
- 1·2번 ending
- D.C. al Fine
- D.S. al Fine
- D.S. al Coda
- 대상 누락 warning
- 무한 루프 방지
- sourceMeasureId와 occurrence 보존

### 자동 넘김

- BPM 변경 반영
- 재생/일시정지/정지
- 카운트인
- background/foreground 복구
- timer throttling 후 절대 시각 기반 재계산
- 자동 하이라이트·스크롤

## 7. Phase 3

- Canvas 기반 필기 overlay
- Pointer Events 처리
- 펜/형광펜/지우개
- 텍스트 메모 CRUD
- 마디/음표 anchor
- 회전·확대 후 위치 유지
- PRIVATE/PART/ENSEMBLE scope
- 메모 필터
- IndexedDB 저장
- 앱 재시작 후 복원

필기 입력 테스트:

- 마우스
- 터치
- 스타일러스
- pressure 정보가 없는 입력
- pressure 정보가 있는 입력은 가능한 환경에서 검증하고, 없으면 미검증으로 기록

## 8. Phase 4

- Phase 4 개발 인증 endpoint가 사용자를 생성/재사용하고 token을 발급한다. 실제 provider token 검증은 이후 인증 provider 통합 Phase에서 수행한다.
- access/refresh token이 동작한다.
- 악보 CRUD 권한 테스트가 있다.
- 권한 없는 악보 접근이 차단된다.
- multipart MusicXML upload의 MIME/크기/소유권을 검증한다.
- MusicXML은 object storage adapter 뒤에 저장된다.
- 버전 생성·다운로드가 된다.
- revision 충돌 시 409.
- 팀 메모 scope를 서버에서 필터링한다.
- batch 동기화가 중복 적용되지 않는다.
- 브라우저 로컬 동기화 큐 실패와 재시도를 테스트한다.

## 9. Phase 5

- 세션 생성과 참가가 된다.
- 악보 버전 불일치를 차단한다.
- 리더만 공용 상태를 변경한다.
- 미래 targetTimestamp에 시작한다.
- 오래된 sequence를 무시한다.
- 중복 이벤트가 idempotent하다.
- 개인 탐색 후 리더 위치로 복귀한다.
- 네트워크 단절 후 스냅샷으로 복구한다.
- 리더 변경이 전파된다.
- 종료 세션 명령을 거부한다.
- background/foreground 복구를 검증한다.
- 화면 회전 후 위치를 유지한다.
- PWA와 일반 브라우저 탭 간 동기화를 검증한다.
- Wake Lock 실패 시 기능이 중단되지 않는다.
- timer throttling 후 snapshot으로 복구한다.
- 최소 3개 브라우저 인스턴스 또는 동등 환경으로 검증한다.

## 10. Phase 6

- 편집과 필기 모드가 구분된다.
- 코드·가사 수정
- 제한적 음높이·음가 수정
- undo/redo
- 새 ScoreVersion 저장
- 원본 복구
- 유효한 MusicXML export
- 편집 후 PerformanceOrder 재계산
- revision 충돌 감지

## 11. Phase 7

- PDF.js page rendering
- 이미지/PDF import
- 카메라 input 가능 환경에서 검증
- 흐림/잘림/원근 경고
- 페이지 회전·순서 수정
- Canvas/OpenCV.js 전처리
- 시스템·오선·마디 검출
- 원본과 crop 비교
- Web Worker에서 이미지 처리
- 전체 PDF를 한 번에 고해상도로 rasterize하지 않음

## 12. Phase 8

- ONNX 모델 manifest를 받는다.
- 모델 hash를 검증한다.
- 최초 모델 다운로드 진행률을 표시한다.
- Cache Storage에 모델을 저장한다.
- 캐시 재사용이 된다.
- hash 변경 후 모델을 갱신한다.
- WebGPU 실행 경로를 검증한다.
- WASM fallback을 검증한다.
- Web Worker에서 추론한다.
- Tensor/ImageBitmap 해제가 확인된다.
- 저사양 순차 처리를 제공한다.
- 기본 음표·쉼표·조표·박자표 구조화
- 음높이·음가 규칙 검증
- 코드·가사 수정 가능
- 저신뢰 마디 검수
- MusicXML export
- 도돌이표 감지 또는 쉬운 수동 추가

> 관련 문서: [12-MODEL-DELIVERY-SPEC.md](./12-MODEL-DELIVERY-SPEC.md)

## 13. Phase 9

- 다양한 카메라 조건 평가
- D.C./D.S./Coda 인식 고도화
- 붙임줄/이음줄 후보 처리
- 다중 절 가사 검수
- 복잡한 코드 parser 회귀 테스트
- 사용자 수정 기반 평가 리포트

## 14. Phase 10

- PWA 설치 동작
- 오프라인 앱 셸
- 기존 악보 오프라인 열람
- 오프라인 편집
- 동기화 큐
- 충돌 처리
- 캐시 업데이트
- 오래된 캐시 제거
- 모델 버전 관리
- 저장 공간 부족 안내
- 사용자 데이터 내보내기
- 로그아웃 시 로컬 데이터 처리
- 브라우저 호환성 결과 기록

## 15. Phase 11

- 웹 서비스 검증 이후 선택 여부를 결정한다.
- 기존 Backend, 도메인 모델, 모델 artifact 재사용성을 검토한다.
- 네이티브 전환이 필요하다는 제품/성능 근거를 기록한다.
- Web PWA와의 기능 차이를 명확히 문서화한다.

## 16. 측정 항목

```text
앱 시작 시간
악보 렌더링 시간
마디 이동 응답
1페이지 OMR 시간
Peak memory
모델 다운로드 시간
모델 로딩 시간
WebSocket RTT
합주 drift
재연결 시간
파일 업로드 시간
IndexedDB 저장 시간
Cache Storage hit rate
```

## 17. 보안

- Secret scanning
- 인증 없는 API 차단
- 권한 없는 객체 다운로드 차단
- presigned URL 수명
- WebSocket 권한
- 리더 위조 방지
- 토큰 로그 마스킹
- refresh token 폐기
- 브라우저 storage token 저장 전략 검토
- 모델 manifest hash 검증

## 18. 백업·복구

- PostgreSQL 일일 백업
- 외부 스토리지 복제
- 객체 저장소 백업
- 복구 절차 문서
- 실제 복구 테스트
- 서버 장애 중 Web PWA 로컬 열람
- K3s 재설치 후 복구 검증

## 19. Codex 완료 보고

```md
## 구현 요약
## 변경 파일
## 실행한 명령과 실제 결과
## 완료 기준 충족 여부
## 실행하지 못한 검증
## 알려진 제한
## 문서와 다른 결정
```

## Phase 5 Self Check

- PASS: REST session create/list/get/join/leave/end and leader transfer are implemented.
- PASS: Raw Spring WebSocket `/ws/rehearsal` is implemented.
- PASS: Authoritative state uses `performanceMeasureId`, `sourceMeasureId`, `occurrence`, `beat`, `bpm`, `playbackStatus`, `sequence`, and `effectiveAtServerTime`.
- PASS: Page number, scroll offset, SVG coordinate, DOM index, and absolute pixel sync are not used.
- PASS: Stale sequence, duplicate command idempotency, sequence gap snapshot request, reconnect, visibility recovery, and server clock estimation are covered in code/tests.
- PASS: Ensemble membership, leader-only playback commands, `OWNER`/`ADMIN` session creation, and leader transfer permissions are enforced.
- PASS: `FOLLOWING_LEADER` and `BROWSING_INDEPENDENTLY` are implemented.
- PASS: Backend PostgreSQL Testcontainers and real Spring WebSocket multi-client tests pass.
- PASS: Playwright real backend rehearsal E2E with two browser contexts passes.
- LIMITATION: Active WebSocket registry is single-backend in memory. Multi-instance broadcast needs future Redis/pub-sub or broker fanout.
- OUT OF SCOPE: realtime annotation push, cursors, audio/video, WebRTC, CRDT editing, Phase 6 score editing, and OMR/model work.

## Phase 6 Self Check

- PASS: Edit and view modes are separated through `/scores/:scoreId/edit`.
- PASS: Verovio is preview-only; editable score state is the source of truth.
- PASS: Note/rest selection uses a stable editable event list rather than SVG note DOM order.
- PASS: Pitch, note/rest duration, chord symbol, lyric, insert/delete/duplicate measure, transpose, undo/redo, cancel, validation, export, and publish are implemented.
- PASS: Editing commands are covered by unit tests and use injectable ID generation for deterministic tests.
- PASS: Validation reports blocking errors for invalid durations and warnings for non-blocking cases such as pickup measures.
- PASS: MusicXML parse -> edit -> serialize -> parse round trip is tested, including Unicode lyrics and XML escaping.
- PASS: IndexedDB draft autosave/restore stores are implemented and tested.
- PASS: Publish creates a new immutable `ScoreVersion` and does not overwrite the base MusicXML object.
- PASS: Backend validates publish role, base version, stale score revision, malformed XML, PostgreSQL migration V4, and MinIO/object-storage integration.
- PASS: Mock Playwright E2E covers edit UI, Verovio preview, publish request, and reopen.
- PASS: Real backend Playwright E2E covers dev login, server sample publish, edit, new version publish, and viewer reopen against PostgreSQL and MinIO.
- LIMITATION: Current backend roles map edit publishing to `OWNER`/`ADMIN`; explicit `EDITOR`/`VIEWER` roles are future work.
- LIMITATION: Unsupported MusicXML structures are warned or serialized through the supported subset, not fully opaque-preserved.
- OUT OF SCOPE: OMR, PDF/image import, ONNX inference, full composition tooling, and realtime collaborative score editing.

## Phase 8 Revised Acceptance Criteria

Phase 8 is complete only when the runtime infrastructure is verified without claiming product OMR capability.

- PASS required: `TEST_RUNTIME_MODEL` executes through actual ONNX Runtime Web in the browser.
- PASS required: model manifest validation checks schema, file, size, SHA-256, minimum app version, provider list, and class-index mapping.
- PASS required: model binaries are cached in Cache Storage, not base64 JSON in IndexedDB.
- PASS required: model metadata, jobs, results, corrections, and preferences are stored in IndexedDB.
- PASS required: hash mismatch removes corrupt cached model data and fails with a structured error.
- PASS required: WebGPU is attempted only when the environment is actually usable; WASM fallback is reported with a reason.
- PASS required: ONNX Runtime sessions are created in `omr.worker.ts`, not React components.
- PASS required: model input is a canonical SYSTEM crop from Phase 7 reviewed regions, not a whole page.
- PASS required: tensor preprocessing is manifest-driven and supports layout/range variants required by the contract.
- PASS required: tensor pixel coordinates are not persisted; results expose `boundsInSystem` and `boundsInPage`.
- PASS required: worker cancellation and stale job result handling are covered.
- PASS required: offline cached manifest/model loading is verified after an initial successful online load.
- PASS required: UI clearly shows `TEST_RUNTIME_MODEL` and `PRODUCT_MODEL_NOT_INSTALLED`.
- PASS required: detection overlay and correction UI foundations exist without presenting fixture detections as product output.
- PASS required: `ai-training` contains dataset/train/evaluate/export/validate scaffolds and an evaluation report schema.
- PASS required: Phase 1-7 regression tests still pass.

Explicit Phase 8 non-goals:

- product layout model: NOT IMPLEMENTED
- product symbol model: NOT IMPLEMENTED
- structure assembly: DEFERRED TO PHASE 10
- MusicXML automatic draft: DEFERRED TO PHASE 10
- Phase 6 editor handoff from OMR: DEFERRED TO PHASE 10
- OMR product accuracy: NOT EVALUATED

## Phase 9 Acceptance Criteria

Phase 9 is partial product-model readiness and complete smoke-pipeline readiness.

- PASS required: class taxonomy exists for layout and symbol detection with stable string IDs.
- PASS required: annotation schema, dataset manifest schema, source/license schema, split policy, metric/failure report contract, and model IO contract are documented and executable.
- PASS required: license validation rejects `UNKNOWN` or unapproved sources by default.
- PASS required: source-group leakage validation blocks the same source group across train/validation/test.
- PASS required: fixture dataset build uses copyright-safe generated data with provenance.
- PASS required: fixture dataset validation checks images, checksums, class IDs, bounds, duplicate item IDs, duplicate image checksums, source records, and split leakage.
- PASS required: layout smoke training, evaluation, ONNX export, manifest generation, and validation run successfully.
- PASS required: symbol smoke training, evaluation, ONNX export, manifest generation, and validation run successfully.
- PASS required: exported smoke manifests use `status: EXPERIMENTAL`, not `PRODUCT`.
- PASS required: browser E2E loads actual layout and symbol ONNX models through the Phase 8 worker and decodes detections.
- PASS required: offline cached model reuse is verified after first successful load.
- PASS required: Phase 10 draft route remains deferred and no automatic MusicXML is generated.
- PASS required: Phase 1-8 regression tests still pass.

Phase 9 product gates:

- layout product candidate: NOT READY until real licensed scan/photo data and fixed test metrics exist.
- symbol product candidate: NOT READY until real licensed scan/photo data and fixed test metrics exist.
- product OMR accuracy: NOT EVALUATED for synthetic-only smoke models.
- Phase 10 readiness: NOT READY until product candidate model output quality is evaluated.

## Phase 9E-H Colab Preparation Criteria

- PASS required: Colab notebook JSON parses and includes Drive mount, GPU/runtime guidance, run mode selection, checkpoint/resume, and artifact output instructions.
- PASS required: local Windows/RX 580 is documented as validation-only, not product GPU training.
- PASS required: dependency pins exist for Colab.
- PASS required: Drive storage structure is documented and configurable.
- PASS required: Drive policy assumes 14GB default capacity and stops training when free space is below 3GB.
- PASS required: raw archives, extracted temporary files, training cache, and run directories are scratch data outside persistent Drive storage.
- PASS required: DeepScoresV2 training modes start from the configured dense/source-group subset instead of the full dataset.
- PASS required: dataset source registry records eligibility and excludes unverified sources by default.
- PASS required: DeepScoresV2 dense source record includes official source, archive checksum, license evidence, attribution requirement, and user confirmation boundary.
- PASS required: class mapping file separates `EXACT`, `APPROXIMATE`, `MERGED`, and `EXCLUDED` mappings.
- PASS required: checkpoint metadata and run-state files are written with resume compatibility checks, while retaining only best, last, and the configured recent checkpoint.
- PASS required: artifact zip structure is documented and validator checks manifest/model/checksum/evaluation/taxonomy/config.
- PASS required: installer adds only validated artifacts to the static model catalog.
- PASS required: UI does not show fake candidate models when no artifact is installed.

Status before user-run Colab:

- Colab training pipeline preparation: PASS when static/local checks pass.
- actual licensed dataset import: WAITING_FOR_USER.
- actual Colab GPU training: WAITING_FOR_USER.
- actual checkpoint: WAITING_FOR_USER.
- actual trained ONNX: WAITING_FOR_USER.
- actual ONNX parity: NOT RUN.
- browser candidate inference: NOT RUN.
- layout candidate: NOT READY.
- symbol candidate: NOT READY.
- product OMR accuracy: NOT EVALUATED.
- Phase 10 readiness: NOT READY.

## Phase 9I Symbol Coverage Criteria

- PASS required: DeepScoresV2 symbol mapping covers safe detector-only classes for beams, ledger lines, repeat dots, shorter rests, directed eighth flags, whole noteheads, digit-4 time-signature glyphs, and common-time glyphs.
- PASS required: generic time-signature, key-signature, and directionless flag classes remain excluded unless a later phase adds structure/text interpretation.
- PASS required: symbol YOLO config classes are declared in taxonomy and remain `EXPERIMENTAL`.
- PASS required: existing installed experimental manifests remain compatible through manifest-local class indexes.
- PASS required: Phase 10 structure assembly, pitch/duration inference, and MusicXML generation remain out of scope.

## Phase 9I Symbol Tiny-Overfit Criteria

- PASS required: Colab run modes include `SYMBOL_OVERFIT`.
- PASS required: `SYMBOL_OVERFIT` derives a one- or two-image dataset from existing `deepscoresv2-dense-symbol` train images.
- PASS required: overfit config uses batch size 1, image size 1280, 100 epochs, pretrained weights, disabled early stopping, and plots disabled.
- PASS required: diagnostic report records label count, bad label count, class count, train mAP50, max confidence, and prediction counts at confidence thresholds `0.001`, `0.01`, and `0.05`.
- PASS required: prediction overlays are saved for the overfit train images.
- PASS required: failing overfit report recommends not repeating full `SYMBOL_TRAIN`.
- PASS required: diagnostic artifacts remain `EXPERIMENTAL` and are not promoted to `CANDIDATE` or `PRODUCT`.

## Phase 9J Symbol Tile/Crop Overfit Criteria

- PASS required: Colab run modes include `SYMBOL_TILE_OVERFIT`.
- PASS required: tile/crop dataset is derived from one or two existing `deepscoresv2-dense-symbol` train images.
- PASS required: crop size is configurable among `512`, `768`, and `1024`.
- PASS required: overlap supports 20-30%.
- PASS required: generated crop count is limited to 10-50 crops.
- PASS required: crop-relative YOLO labels are recalculated and every coordinate is validated within `0..1`.
- PASS required: report records crop image count, crop label count, empty crop count, bad label count, train mAP50, max confidence, and prediction counts at `0.001`, `0.01`, and `0.05`.
- PASS required: label overlays and prediction overlays are saved in crop coordinates.
- PASS required: failing tile/crop overfit report recommends not repeating full `SYMBOL_TRAIN`.
- PASS required: diagnostic artifacts remain `EXPERIMENTAL` and are not promoted to `CANDIDATE` or `PRODUCT`.
- PASS required: Phase 10 structure assembly and MusicXML generation remain out of scope.

## Phase 9K Tile-Based Symbol Training Criteria

- PASS required: Colab run modes include `SYMBOL_TILE_TRAIN`.
- PASS required: `SYMBOL_TILE_TRAIN` creates `deepscoresv2-dense-symbol-tile` from the existing `deepscoresv2-dense-symbol` converted dataset.
- PASS required: tile generation preserves the source-group train/validation/test split and does not copy crops across splits.
- PASS required: default crop size is `768`, overlap is `0.25`, and empty crops are skipped.
- PASS required: crop-relative YOLO labels are recalculated with the same clipping/small-box policy as `SYMBOL_TILE_OVERFIT`.
- PASS required: tile dataset reports include `droppedSmallBoxCount`, `droppedOutsideBoxCount`, `emptyCropCount`, `cropImageCount`, and `labelCount`.
- PASS required: generated tile labels are validated within `0..1`.
- PASS required: YOLO `dataset.yaml` points at the tile dataset path.
- PASS required: training defaults are batch size `4`, image size `768`, epochs `40`, patience `5`, pretrained weights enabled, and plots disabled.
- PASS required: evaluation reports state that metrics are tile validation/test metrics.
- PASS required: ONNX export and artifact packaging reuse the existing symbol artifact flow.
- PASS required: artifacts remain `EXPERIMENTAL` and are not promoted to `CANDIDATE` or `PRODUCT`.
- PASS required: full-page `SYMBOL_TRAIN` remains available only as deprecated diagnostic-only baseline.
- PASS required: Phase 8 runtime tile inference orchestration is not marked complete and Phase 10 readiness remains `NOT READY`.
- PASS required: Phase 10 structure assembly, pitch/duration inference, and MusicXML generation remain out of scope.

## Phase 9N OMR Evaluation Fixture Criteria

- PASS required: Web PWA includes an OMR sample fixture gallery for browser runtime evaluation.
- PASS required: fixture metadata records title, source, license/usage note, notation type, lyrics/chord flags, and capture type.
- PASS required: Korean lyrics/chord sample is represented as a placeholder metadata slot only; no copyrighted image is committed.
- PASS required: users can attach a local image to the Korean lyrics/chord slot for browser-local evaluation.
- PASS required: selecting a fixture can feed its image into the OMR runtime without server upload.
- PASS required: OMR run summary reports detection count, per-class counts, average confidence, and correction counts.
- PASS required: review JSON export/import includes fixture context and correction layer data.
- PASS required: review corrections are restored per fixture.
- PASS required: Phase 10 remains `NOT READY` until sample fixture review is possible, minimum class coverage is documented, a tile model artifact is installed, and the correction layer persists.
- PASS required: pitch inference, duration inference, voice assembly, MusicXML generation, automatic ScoreVersion publish, and model promotion remain out of scope.
