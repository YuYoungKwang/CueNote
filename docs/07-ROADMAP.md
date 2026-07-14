# 07. 개발 로드맵

## 기본 원칙

- 각 Phase는 독립적으로 빌드·테스트 가능한 상태로 끝낸다.
- 다음 Phase 기능을 미리 구현하지 않는다.
- OMR 없이도 핵심 사용자 경험부터 검증한다.
- 1차 구현 플랫폼은 Web PWA다.
- Windows 개발 환경에서 프론트엔드, 백엔드, AI 학습 파이프라인을 진행할 수 있어야 한다.
- macOS Safari와 iPad Safari 검증은 가능한 환경이 있을 때 수행하고, 실행하지 못한 검증은 미검증으로 기록한다.
- Phase 완료 후 데모와 회고를 기록한다.

## Phase 0 — Web PWA 프로젝트 기반

### 목표

모노레포, Web PWA, Backend, 로컬 DB, 테스트, 배포 뼈대를 준비한다.

### 범위

- 저장소 디렉터리 구성
- `web-app` React + TypeScript + Vite
- PWA manifest
- Service Worker 기본 등록
- app/core/domain/features/ai/workers 구조
- IndexedDB adapter 기본 인터페이스
- `MockOMRService`
- Vitest
- Playwright 기본 E2E
- Spring Boot 기본 프로젝트
- PostgreSQL Docker Compose
- Flyway 초기 설정
- Health API
- 공통 오류 응답
- 기본 CI
- K3s 매니페스트 초안
- 샘플 환경 변수
- 로컬 실행 문서

### 제외

- 실제 OMR
- 실제 ONNX 모델 연결
- 실제 악보 렌더링
- 로그인
- 실제 합주 WebSocket
- 편집기

## Phase 1 — MusicXML 웹 뷰어

### 목표

샘플 MusicXML을 웹 앱에서 열고 마디 단위로 탐색한다.

### 범위

- 샘플 MusicXML import
- 내부 ScoreVersion 변환
- OpenSheetMusicDisplay 또는 Verovio 비교 후 adapter 구현
- 마디 DOM 매핑
- 확대/축소
- 세로/가로 화면
- 마디 하이라이트
- 자동 스크롤
- IndexedDB 저장
- 최근 악보 목록

### 완료 데모

샘플 악보를 열고 특정 마디를 탭하면 강조되고 화면 중앙으로 이동한다.

## Phase 2 — 반복 펼치기와 BPM 자동 넘김

### 범위

- repeat start/end
- 1·2번 ending
- D.C. al Fine
- D.S. al Fine
- D.S. al Coda
- Segno/Coda/Fine
- PerformanceOrder
- 무한 루프 방지
- BPM
- 재생/일시정지/정지
- 카운트인
- 자동 하이라이트·스크롤
- browser visibility 복구

### 완료 데모

도돌이표 구간이 선형 순서로 표시되고 BPM에 맞춰 마디가 이동한다.

## Phase 3 — 브라우저 필기와 메모

### 범위

- Canvas overlay
- Pointer Events
- 펜/형광펜/지우개
- 텍스트 메모
- 마디/음표 anchor
- 개인/파트/전체 scope
- 레이어 토글
- IndexedDB 저장
- 회전·확대 후 위치 유지
- pressure 없는 입력 처리

### 완료 데모

특정 마디 위에 필기한 뒤 화면을 회전하거나 확대해도 같은 마디 기준 위치에 유지된다.

## Phase 4 — Backend 계정·공유

### 범위

- 인증 provider 구조
- access/refresh token
- Score CRUD
- ScoreVersion 업로드/다운로드
- multipart MusicXML upload
- object storage adapter
- 권한
- Ensemble
- Annotation 동기화
- 낙관적 잠금
- 오프라인 재시도

Phase 4 구현 선택:

- 인증은 개발·테스트용 `/dev-auth/login`과 opaque access/refresh token으로 시작한다.
- MusicXML은 presigned URL 대신 multipart endpoint로 업로드하고, backend의 object storage adapter 뒤에 저장한다.
- ScoreVersion은 append-only로 생성한다.
- Annotation sync는 `clientMutationId`, `baseRevision`, server `revision`으로 idempotency와 `409 CONFLICT`를 처리한다.
- PRIVATE/PART/ENSEMBLE visibility는 서버에서 membership과 owner 기준으로 필터링한다.

### 완료 데모

한 브라우저에서 만든 악보 버전과 팀 메모가 다른 브라우저에서도 보인다.

## Phase 5 — WebSocket 합주 동기화

### 범위

- 세션 생성
- 참가 코드
- 리더/참여자
- 브라우저 WebSocket API
- 절대 시각 동기화
- 마디/박자/BPM
- 상태 스냅샷
- sequence
- 재연결
- 개인 탐색과 리더 위치 복귀
- `document.visibilitychange` 복구
- Wake Lock 사용 가능 시 화면 절전 방지
- Wake Lock 실패 시 대체 안내

### 완료 데모

3개 이상의 브라우저/PWA 인스턴스가 같은 악보를 열고 리더 시작 후 같은 마디를 표시하며, background/foreground 전환 후 상태 스냅샷으로 복구된다.

## Phase 6 — 제한적 웹 악보 편집기

### 우선순위

1. 코드 수정
2. 가사 수정
3. 마디 복사/삭제
4. 조옮김
5. 음높이 변경
6. 음가 변경
7. 음표·쉼표 추가/삭제
8. 반복기호 수정

### 범위

- 편집/필기 모드 분리
- undo/redo
- 편곡 버전
- revision 충돌
- MusicXML export
- 원본 복구
- 편집 후 PerformanceOrder 재계산

### 완료 데모

코드와 음표를 수정한 새 편곡 버전을 만들고 MusicXML로 내보낸다.

## Phase 7 — PDF·이미지 import와 OMR 레이아웃

### 범위

- PDF.js
- 이미지 import
- 카메라 input
- 페이지 순서/회전/삭제
- 흐림/잘림/대비/원근 검사
- Canvas 또는 OpenCV.js 전처리
- 시스템 검출
- 오선 검출
- 마디 분할
- 원본 crop 검수
- Mock symbol result
- Web Worker image pipeline

### 완료 데모

예시와 유사한 악보 PDF/이미지에서 시스템·오선·마디 영역을 표시한다.

## Phase 8 — ONNX Runtime Web 기호 인식

### 범위

- PyTorch to ONNX export
- ONNX validation
- quantization 또는 optimization
- model manifest
- hash validation
- Cache Storage 모델 캐시
- ONNX Runtime Web
- WebGPU execution provider
- WASM fallback
- Web Worker inference
- Tensor/ImageBitmap release
- 저사양 브라우저 순차 처리
- 음표/쉼표/조표/박자표
- 코드 OCR 후보
- 한글 가사 OCR 후보
- 음높이/음가 조립
- MusicXML 생성
- 저신뢰 검수
- 도돌이표 인식

### 완료 데모

예시 형식 1페이지를 브라우저에서 로컬 분석해 수정 가능한 악보로 렌더링한다. WebGPU 실패 시 WASM fallback으로 처리한다.

## Phase 9 — OMR 고도화

- 다양한 카메라 조건
- D.C./D.S./Coda
- 붙임줄/이음줄
- 다중 절 가사
- 복잡한 코드
- 기본 피아노 양손 악보
- 모델 업데이트
- 사용자 수정 기반 개선

## Phase 10 — PWA 안정화와 오프라인 운영

### 범위

- PWA 설치 UX
- 오프라인 앱 셸
- 캐시 업데이트
- 모델 버전 관리
- 저장 공간 관리
- 사용자 데이터 내보내기
- 로그아웃 시 로컬 데이터 처리
- 브라우저 호환성 검증
- Windows Chrome
- Windows Edge
- macOS Chrome 또는 Safari
- iPad Safari

### 완료 데모

설치된 PWA가 오프라인에서 기존 악보를 열고, 필기와 개인 연습을 수행하며, 온라인 복귀 후 동기화 큐를 처리한다.

## Phase 11 — 선택적 네이티브 앱

웹 서비스 검증 이후 결정한다.

### 범위 후보

- 기존 Backend 재사용
- `packages/score-domain` 도메인 모델 재사용
- ONNX 모델을 네이티브 런타임 또는 Core ML로 변환 가능성 검토
- 플랫폼별 필기/저장 adapter 구현

이 Phase는 현재 1차 구현 범위가 아니다.

`legacy/ios-app`은 참고 자료로만 사용할 수 있으며, 현재 Web PWA 구현의 빌드 대상이나 기능 구현 출처로 포함하지 않는다.

## 리스크와 대응

### OMR 정확도

- 지원 범위 제한
- 검수 UI
- 합성 데이터
- OMR을 후반 Phase로 배치

### 브라우저 성능과 메모리

- Web Worker 분리
- 페이지/시스템/마디 단위 처리
- ImageBitmap/Tensor 해제
- 저사양 기기 순차 처리
- WASM fallback

### 렌더러 연동

- adapter 분리
- 마디 DOM 매핑 테스트
- 렌더러 내부 모델을 도메인에 노출하지 않음

### 네트워크 지연

- 미래 targetTimestamp
- 로컬 진행
- 상태 스냅샷
- sequence와 재연결
- foreground 복귀 시 snapshot 요청

### 편집 범위 폭증

- 코드·가사 우선
- 합주에 필요한 편집만 지원
- Phase별 기능 잠금

### 온프레미스 장애

- 외부 백업
- Web PWA 로컬 캐시
- 객체 저장소 분리
- 관리형 서비스로 이전 가능한 인터페이스 유지

## Phase 완료 보고 형식

```md
# Phase N 완료 보고

## 구현한 기능
## 제외한 기능
## 변경 파일
## 테스트 결과
## 알려진 제한
## 다음 단계 전에 결정할 사항
```

## Phase 5 Implementation Note

Phase 5 is implemented for the Web PWA with server-backed rehearsal sessions, raw Spring WebSocket sync, authoritative sequence snapshots, server clock estimation, reconnect/snapshot recovery, independent browsing, and leader-only shared playback commands.

The current implementation is intentionally single-backend. Redis pub/sub or broker fanout remains a future scaling task and is not Phase 5 scope.

Phase 6 score editing, realtime annotation push, audio/video, WebRTC, and OMR/model work remain out of scope.

## Phase 6 Implementation Note

Phase 6 is implemented as limited structured score editing for existing server-backed MusicXML versions.

- Editing uses a separate `SCORE_EDIT` route and does not modify annotation or rehearsal modes.
- The editable domain model, command reducer, validation, transpose, serializer, and annotation migration helpers live in `packages/score-domain/src/editing`.
- Supported editing is intentionally limited to pitch, duration, rest duration, chord symbol, lyric, measure insert/delete/duplicate, transpose, validation, undo/redo, MusicXML export, and publish.
- Publish creates a new immutable `ScoreVersion` and updates the score current-version pointer.
- Existing versions are never overwritten.
- OMR, PDF/image import, ONNX model integration, and realtime collaborative score editing remain future phases.

## Phase 8/9/10 Scope Correction

This section supersedes any earlier wording that implied Phase 8 completes production OMR symbol recognition, structure assembly, MusicXML draft generation, or Phase 6 editor handoff.

### Phase 8 — Browser OMR Runtime Infrastructure

- OMR model input/output contract
- model manifest schema and class-index mapping
- canonical system crop creation from Phase 7 reviewed SYSTEM regions
- manifest-driven tensor preprocessing
- ONNX Runtime Web adapter
- WebGPU-first provider selection with WASM fallback
- `omr.worker.ts` protocol, cancellation, and stale-result handling
- model download, Cache Storage cache, SHA-256 verification, and rollback-ready metadata
- actual ONNX Runtime execution using `TEST_RUNTIME_MODEL`
- layout/symbol model adapter interfaces for future product models
- detection result, confidence, and review decision domain
- detection overlay and correction UI foundation
- IndexedDB OMR job/result/correction/model metadata/preferences persistence
- reload restoration and offline cached model handling
- `PRODUCT_MODEL_NOT_INSTALLED` state when no evaluated product model is installed
- `ai-training` dataset/train/evaluate/export/validate scaffold and evaluation report schema

Phase 8 does not implement production layout model training, production symbol model training, fixture detections as product output, pitch/duration inference, structure assembly, automatic MusicXML draft generation, or Phase 6 editor handoff.

### Phase 9 — OMR Dataset And Model Development

- Phase 9A: dataset specification, label schema, source-level train/validation/test split, leakage prevention, synthetic rendered data plan, augmentation plan, license records, dataset validation, and class distribution reports
- Phase 9B: layout model training/evaluation/export for system, staff, measure, and barline classes
- Phase 9C: symbol model training/evaluation/export for notehead, stem, rest, accidental, clef, augmentation dot, repeat barline, and navigation symbol classes
- Phase 9D: browser optimization and parity validation for ONNX, WebGPU, WASM, quantization, model size, load time, inference time, and accuracy/performance tradeoffs

Phase 9 implementation status:

- `ai-training` contains runnable Node-based fixture dataset build, dataset/license/leakage validation, smoke training, smoke evaluation, ONNX export, and model-manifest validation.
- The fixture dataset is synthetic-only and uses code-generated images with explicit CC0 source records.
- Layout and symbol smoke models are exported as browser-loadable ONNX files with `status: EXPERIMENTAL`.
- Product layout and symbol candidates are not ready because no licensed real scan/photo corpus, GPU training run, or fixed product-quality test split exists in the current environment.
- Phase 8 runtime can execute the experimental layout/symbol ONNX files and display detections, but Phase 10 structure assembly remains deferred.
- Phase 9E-H prepares Google Colab notebooks, DeepScoresV2 dense source registry, class mapping, checkpoint/resume, YOLO training configs, artifact packaging, artifact validation, and model installation scripts.
- Phase 9K makes `SYMBOL_TILE_TRAIN` the recommended experimental symbol detector path; full-page `SYMBOL_TRAIN` remains deprecated/diagnostic-only and Phase 10 readiness remains `NOT READY` until browser tile inference orchestration and structure assembly are implemented.
- Actual Colab GPU training, actual checkpoints, actual trained ONNX, ONNX parity, candidate browser inference, and product accuracy remain waiting for user-run Colab execution.

### Phase 10 — OMR Structure And MusicXML Draft

- consume evaluated Phase 9 model outputs
- layout/symbol assignment
- notehead/stem association
- pitch inference
- duration inference
- accidental application
- voice/rhythm assembly
- repeat/navigation interpretation
- `EditableScoreDocument`
- MusicXML draft generation
- Phase 6 editor handoff
