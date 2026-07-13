# 09. Codex 작업 프롬프트

## 1. 공통 시작 프롬프트

```text
이 저장소는 Web PWA 기반 협업형 디지털 악보 앱이다.

현재 1차 구현 플랫폼은 React + TypeScript + Vite 기반 Web PWA다.
현재 개발 환경은 Windows이며 Mac과 Xcode를 사용하지 않는다.
Backend 방향은 Java 21 / Spring Boot / PostgreSQL / K3s를 유지한다.

작업 전에 다음 문서를 순서대로 읽어라.

- README.md
- docs/01-PRD.md
- docs/02-ARCHITECTURE.md
- docs/03-DOMAIN-MODEL.md
- docs/04-API-SPEC.md
- docs/05-OMR-SPEC.md
- docs/06-SYNC-PROTOCOL.md
- docs/07-ROADMAP.md
- docs/08-ACCEPTANCE-CRITERIA.md
- docs/09-CODEX-PROMPTS.md
- docs/10-WEB-CAPABILITY-MATRIX.md
- docs/11-PWA-OFFLINE-SPEC.md
- docs/12-MODEL-DELIVERY-SPEC.md

규칙:

1. 전체 서비스를 한 번에 구현하지 마라.
2. 내가 지정한 Phase만 구현하라.
3. 다음 Phase 기능은 필요한 인터페이스 외에는 구현하지 마라.
4. 기존 코드를 먼저 분석하고 불필요한 전면 재작성을 하지 마라.
5. 하드코딩, 빈 catch, 무의미한 TODO를 완료 상태로 남기지 마라.
6. 설계 변경은 구현 전에 PLAN.md에 이유·영향·대안을 작성하라.
7. 작업 후 빌드·테스트·설정 검증을 실행하라.
8. 실행하지 못한 검증은 성공했다고 말하지 마라.
9. docs/08-ACCEPTANCE-CRITERIA.md의 해당 Phase로 자체 점검하라.
10. Mac, Safari, iPad 등 현재 환경에 없는 검증은 미검증으로 표시하라.

먼저 다음을 출력하라.

- 현재 저장소 분석
- 이번 작업 범위
- 생성/수정할 파일
- 구현 순서
- 위험요소와 결정 사항

그 다음 구현을 시작하라.
```

## 2. Phase 0

```text
공통 문서를 읽은 뒤 ROADMAP의 Phase 0만 구현하라.

목표:
- 모노레포 기반
- web-app React + TypeScript + Vite
- PWA manifest와 Service Worker
- app/core/domain/features/ai/workers 구조
- Vitest와 Playwright
- IndexedDB adapter
- MockOMRService
- Java 21 / Spring Boot Backend
- PostgreSQL 개발 환경
- K3s 배포 초안

구현:
1. 루트 구조와 README
2. web-app React + TypeScript + Vite
3. web-app/src/app
4. web-app/src/core/api, storage, pwa, capabilities
5. web-app/src/domain/score, navigation, annotation, rehearsal
6. web-app/src/features/library, import, viewer, editor, annotation, rehearsal
7. web-app/src/ai/runtime, preprocessing, layout, symbols
8. web-app/src/workers/omr.worker.ts, image.worker.ts
9. PWA manifest
10. Service Worker 기본 등록
11. IndexedDB adapter 인터페이스
12. MockOMRService
13. Vitest 기본 테스트
14. Playwright 기본 E2E
15. backend Spring Boot
16. GET /api/v1/health
17. 공통 성공/오류 응답
18. PostgreSQL Docker Compose
19. Flyway V1
20. Testcontainers 통합 테스트
21. K3s namespace, Deployment, Service, Ingress, Secret example
22. .env.example
23. GitHub Actions frontend/backend test

금지:
- Swift
- SwiftUI
- Xcode project
- Core ML
- PencilKit
- SwiftData
- 실제 OMR
- 실제 ONNX 모델 연결
- 실제 악보 렌더링
- 실제 합주 WebSocket
- 음표 편집기
- 인증 provider 실제 구현

검증:
- npm install
- npm run build
- npm run test
- Playwright 기본 E2E
- PWA manifest 확인
- Service Worker 등록 확인
- backend build/test
- docker compose config
- Kubernetes YAML 검증 가능한 범위
```

## 3. Phase 1

```text
Phase 1 MusicXML 웹 뷰어만 구현하라.

1. 샘플 MusicXML 2개
2. MusicXML parser
3. 최소 ScoreVersion 도메인
4. OpenSheetMusicDisplay 또는 Verovio adapter 후보 비교
5. 선택한 렌더러 adapter
6. 마디 DOM 매핑
7. 렌더링 완료/마디 탭/오류 이벤트
8. 마디 highlight/scroll
9. 확대/축소
10. IndexedDB 최근 악보
11. parser와 매핑 테스트
12. Playwright viewer smoke test

금지:
- OMR
- 반복 펼치기
- Canvas 필기
- 서버 API
- WebSocket
- 악보 편집
```

## 4. Phase 2

```text
Phase 2 반복 펼치기와 자동 넘김만 구현하라.

핵심:
- Measure를 복제하지 말고 PerformanceMeasure가 sourceMeasureId와 occurrence를 참조한다.
- 반복 해석은 UI/렌더러 안에 넣지 않는다.
- 잘못된 악보에서도 무한 루프가 없어야 한다.
- browser timer throttling을 신뢰하지 말고 절대 시각으로 위치를 재계산한다.

지원:
- repeatStart/repeatEnd
- 1/2 ending
- D.C. al Fine
- D.S. al Fine
- D.S. al Coda
- Segno/Coda/To Coda/Fine

구현:
- RepeatExpander
- 상태 머신과 안전 제한
- warning
- 단위 테스트
- PlaybackTimeline
- 재생/일시정지/정지/카운트인
- 자동 하이라이트/스크롤
- document.visibilitychange 복구
```

## 5. Phase 3

```text
Phase 3 브라우저 필기와 메모만 구현하라.

- Canvas overlay
- Pointer Events
- 펜/형광펜/지우개
- 텍스트 메모
- Annotation 모델
- StrokePoint/Stroke payload
- Measure/Element/PerformanceMeasure anchor
- relative coordinate
- PRIVATE/PART/ENSEMBLE
- 레이어 필터
- IndexedDB
- pressure 없는 입력 처리

필기를 MusicXML에 저장하지 마라.
화면 절대 픽셀만 저장하지 마라.
편집 모드와 필기 모드를 분리하라.
서버 동기화는 구현하지 마라.
```

## 6. Phase 4

```text
Phase 4 Backend 계정·악보 공유만 구현하라.

- 인증 provider 구조
- APPLE, GOOGLE, EMAIL_MAGIC_LINK 후보를 표현하되 실제 provider는 Phase 결정에 따른다.
- access/refresh token
- User, AuthAccount, Score, ScoreVersion, Permission, Ensemble, Annotation
- Flyway
- REST API
- S3-compatible presigned upload
- revision
- Testcontainers
- Web API client
- offline annotation batch sync

클라이언트의 ownerId/authorId를 신뢰하지 마라.
Secret과 token을 로그에 남기지 마라.
모든 score/object 권한을 서버에서 검증하라.
```

## 7. Phase 5

```text
Phase 5 합주 동기화만 구현하라.
docs/06-SYNC-PROTOCOL.md를 계약으로 사용하라.

- 세션 생성/참가/종료 REST
- 브라우저 WebSocket API
- 리더 권한
- START/PAUSE/STOP
- POSITION_CHANGE
- TEMPO_CHANGE
- STATE_SNAPSHOT
- sequence/idempotency
- targetTimestamp
- clock offset
- 재연결
- document.visibilitychange
- foreground 복귀 시 REQUEST_STATE
- Wake Lock 사용 가능 시 화면 절전 방지
- Wake Lock 실패 fallback
- 개인 탐색과 복귀
- scoreVersion 불일치 차단

페이지 번호를 동기화하지 마라.
매 프레임 또는 매 음표 이벤트를 보내지 마라.
브라우저 timer tick 누적값만으로 위치를 계산하지 마라.
```

## 8. Phase 6

```text
Phase 6 제한적 웹 악보 편집기만 구현하라.

우선순위:
1. 코드
2. 가사
3. 마디 복사/삭제
4. 조옮김
5. 음높이
6. 음가
7. 음표/쉼표 추가 삭제
8. 반복기호

- 편집/필기 모드 분리
- command 기반 undo/redo
- 새 ScoreVersion
- revision 충돌
- PerformanceOrder 재계산
- MusicXML export
- 원본 복구

전체 기보 편집기를 만들지 마라.
```

## 9. Phase 7

```text
Phase 7 PDF·이미지 import와 OMR 레이아웃만 구현하라.

- PDF.js
- 이미지 import
- 카메라 input
- 페이지 순서/회전/삭제
- 흐림/잘림/대비/원근 검사
- Canvas 또는 OpenCV.js 전처리
- Web Worker image pipeline
- 시스템/오선/마디 detector adapter
- bounding box 표시
- crop 검수
- Mock symbol recognizer
- ImageBitmap 해제

실제 음표 인식과 MusicXML 생성은 구현하지 마라.
전체 PDF를 한 번에 고해상도로 rasterize하지 마라.
```

## 10. Phase 8

```text
Phase 8 ONNX Runtime Web 기호 인식만 구현하라.

먼저 ai-training과 모델 파일을 확인하라.
모델이 없다면 정확도를 주장하지 말고 학습/변환 파이프라인과 Web adapter를 분리하라.

- PyTorch to ONNX export
- ONNX validation
- quantization
- model versioning
- model manifest
- hash validation
- minimum app version
- Cache Storage 모델 캐시
- WebGPU execution provider
- WASM fallback
- Web Worker inference
- Tensor/ImageBitmap release
- 저사양 브라우저 순차 처리
- 마디 crop 추론
- 음표/쉼표/조표/박자표
- 코드 OCR 후보
- 한글 가사 OCR 후보
- 구조 조립
- confidence review
- MusicXML export
- repeat symbol

없는 모델을 동작하는 것처럼 하드코딩하지 마라.
브라우저에서 모델을 학습하지 마라.
WebGPU를 항상 사용할 수 있다고 가정하지 마라.
```

## 11. Phase 9

```text
Phase 9 OMR 고도화만 구현하라.

- 다양한 카메라 조건
- D.C./D.S./Coda
- 붙임줄/이음줄
- 다중 절 가사
- 복잡한 코드
- 사용자 수정 기반 평가
- 모델 업데이트 정책

기존 Phase 8 추론 계약과 model manifest를 깨지 마라.
```

## 12. Phase 10

```text
Phase 10 PWA 안정화와 오프라인 운영만 구현하라.

- PWA 설치
- 오프라인 앱 셸
- Cache Storage 업데이트
- 오래된 캐시 제거
- 모델 버전 관리
- 저장 공간 관리
- 사용자 데이터 내보내기
- 로그아웃 시 로컬 데이터 처리
- 충돌 처리
- 브라우저 호환성 기록

실행하지 못한 브라우저 검증을 성공으로 보고하지 마라.
```

## 13. Phase 11

```text
Phase 11 선택적 네이티브 앱 검토만 수행하라.

- 웹 서비스 검증 이후 필요성을 평가한다.
- 기존 Backend 재사용 가능성을 확인한다.
- packages/score-domain 재사용 가능성을 확인한다.
- ONNX 모델을 네이티브 런타임 또는 Core ML로 변환할 수 있는지 검토한다.
- 제품/성능상 근거 없이 네이티브 앱 구현을 시작하지 마라.
```

## 14. 버그 수정

```text
다음 버그를 수정하라.

[증상]
[재현 단계]
[기대 결과]
[실제 결과]
[로그/스크린샷]

1. 관련 문서와 코드를 읽어라.
2. 재현 테스트를 먼저 작성하라.
3. 원인을 설명하고 최소 범위로 수정하라.
4. 관련 없는 리팩터링을 섞지 마라.
5. 회귀 테스트를 실행하라.
6. 원인, 수정, 검증을 보고하라.
```

## 15. 코드 리뷰

```text
현재 변경사항을 구현하지 말고 코드 리뷰만 수행하라.

검토:
- 문서 위반
- Phase 범위 초과
- 도메인 모델 불일치
- 페이지 기반 동기화
- 반복 무한 루프
- 권한 누락
- 오프라인 데이터 손실
- sequence/idempotency
- React component 책임 과다
- Worker 미사용 OMR
- IndexedDB 오류 처리
- Service Worker 캐시 업데이트
- DB transaction/revision
- Secret 노출
- 테스트 누락

심각도 순으로 파일과 근거를 제시하라.
```

## 16. 작업 종료

```text
작업 종료 전에 다음을 보고하라.

1. 변경 파일
2. 구현·제외 기능
3. 실행한 명령과 실제 결과
4. 실패하거나 실행하지 못한 검증
5. Acceptance Criteria 자체 점검
6. 알려진 제한
7. 다음 작업의 결정 사항
```

## Phase 8 Scope Correction Prompt

Phase 8 must stop at browser OMR runtime infrastructure: contracts, manifest, system crop tensor preprocessing, ONNX Runtime Web worker execution, WebGPU/WASM fallback, Cache Storage model delivery, IndexedDB job/result/correction persistence, review UI foundation, `TEST_RUNTIME_MODEL`, `PRODUCT_MODEL_NOT_INSTALLED`, and ai-training scaffolds.

Do not complete or claim production layout/symbol recognition, pitch/duration inference, structure assembly, MusicXML draft generation, or Phase 6 editor handoff in Phase 8. Those belong to Phase 9 and Phase 10.
