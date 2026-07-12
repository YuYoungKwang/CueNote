# Docs Migration Plan: Web PWA First

## 목적

현재 문서는 iOS/iPadOS 네이티브 앱을 1차 구현 플랫폼으로 전제한다. 개발 환경에 Mac과 Xcode가 없으므로 1차 구현 플랫폼을 Web PWA로 변경한다. 제품 정체성, 도메인 모델, REST API, 합주 동기화의 핵심 계약은 유지하고, 플랫폼 종속 표현과 기술 스택만 웹 기준으로 정렬한다.

## 문서별 유지/수정 계획

| 문서 | 유지할 내용 | 수정할 내용 |
|---|---|---|
| `README.md` | 제품 목표, 문서 순서, Phase 단위 작업 원칙, Backend 실행 방향 | iOS 앱 설명을 Web PWA로 변경, 저장소 구조를 `web-app` 중심으로 변경, Windows 개발 가능성 명시, 개발 순서 갱신 |
| `docs/01-PRD.md` | 핵심 사용자, 반복 펼치기, 편곡, 필기, 합주, 오프라인 목표 | 1차 플랫폼을 Web PWA로 변경, 브라우저 지원 범위, IndexedDB/Service Worker/ONNX Runtime Web/WebGPU/WASM 경로, Pointer Events, 저장 공간 부족 안내 추가 |
| `docs/02-ARCHITECTURE.md` | Local First, Structured Score, 서버 보조 협업, K3s/Backend 방향 | Frontend를 React/TypeScript/Vite/PWA로 재정의, `web-app` 구조 추가, IndexedDB/Cache Storage/OPFS 후보, capability 검사, Worker 기반 OMR 명시 |
| `docs/03-DOMAIN-MODEL.md` | Score, ScoreVersion, Measure, NavigationMark, PerformanceMeasure, Annotation, RehearsalSession, PlaybackState | Swift 예시를 TypeScript/언어 중립 구조로 변경, string ID, 플랫폼 중립 stroke 데이터, `clientSchemaVersion`, `rendererVersion`, `modelVersion`, `lastModifiedByDeviceId` 추가 |
| `docs/04-API-SPEC.md` | REST 구조, 공통 응답, Score/Version/Annotation/Ensemble/Rehearsal/Sync API, 권한 규칙 | 인증 provider 일반화, Apple 전용 표현 제거, OMR 모델 manifest API 추가, 모델 hash 기반 캐시 갱신 설명 |
| `docs/05-OMR-SPEC.md` | OMR 목표, 품질 검사, 영역 분할, 인식 대상, 검수, 데이터셋/평가 원칙 | Core ML을 ONNX Runtime Web로 변경, Web Worker, PDF.js/Canvas/OpenCV.js, WebGPU/WASM fallback, 메모리 해제 규칙, 모델 크기 목표, Windows/WSL2 학습 명시 |
| `docs/06-SYNC-PROTOCOL.md` | `performanceMeasureId + beat`, envelope, sequence, state snapshot, leader 권한 | 브라우저 visibility, foreground 복구, Wake Lock, timer throttling, AudioContext 제약 추가 |
| `docs/07-ROADMAP.md` | Phase Delivery, 반복/자동넘김/필기/공유/합주/편집/OMR 단계성 | 웹 중심 Phase 0~11로 재정렬, 선택적 iOS 네이티브 앱을 장기 확장으로 이동 |
| `docs/08-ACCEPTANCE-CRITERIA.md` | Phase별 DoD, 실행하지 못한 검증을 성공으로 보고하지 않는 원칙 | iOS/Xcode 기준을 npm/Vitest/Playwright/PWA/브라우저 검증으로 변경, WebGPU/WASM/캐시/Worker/입력 장치 테스트 추가 |
| `docs/09-CODEX-PROMPTS.md` | 공통 작업 규칙, Phase 단위 구현, 완료 보고 형식 | 모든 Phase 프롬프트를 Web PWA 기준으로 변경, Phase 0 금지 항목에 Swift/Xcode/Core ML/PencilKit/SwiftData 추가, Phase 8을 ONNX/Web Worker/model manifest 중심으로 변경 |
| `docs/10-WEB-CAPABILITY-MATRIX.md` | 새 문서 | 브라우저별 capability와 검증 필요 표시 방식 작성 |
| `docs/11-PWA-OFFLINE-SPEC.md` | 새 문서 | Service Worker, IndexedDB, Cache Storage, OPFS 후보, 오프라인 편집, 동기화 큐, 충돌/업데이트/저장 공간 전략 작성 |
| `docs/12-MODEL-DELIVERY-SPEC.md` | 새 문서 | 모델 manifest, hash, 캐시, 업데이트, rollback, 손상 파일 재다운로드, minimum app version 작성 |

## 주요 결정

- 1차 구현 플랫폼은 Web PWA다.
- Backend 방향은 Java 21, Spring Boot, PostgreSQL, Spring WebSocket, S3-compatible storage, Docker Compose, K3s를 유지한다.
- OMR 학습은 브라우저에서 수행하지 않는다. Windows 또는 WSL2의 Python/PyTorch 환경에서 학습하고, 브라우저에서는 ONNX Runtime Web 추론만 수행한다.
- WebGPU는 우선 경로지만 필수 전제가 아니다. WebGPU 미지원 또는 실패 시 WASM fallback을 제공한다.
- OMR과 이미지 전처리는 UI 메인 스레드가 아닌 Web Worker에서 실행한다.
- 원본 PDF와 고해상도 이미지는 전체를 한 번에 rasterize하거나 메모리에 올리지 않고 페이지, 시스템, 마디 단위로 처리한다.
- 필기는 화면 절대 픽셀이 아니라 마디 또는 음표 기준 상대 좌표로 저장한다.
- 합주 위치 동기화 기준은 계속 `performanceMeasureId + beat`다.
- 선택적 iOS 네이티브 앱은 웹 서비스 검증 이후 장기 Phase에서 결정한다.

## 문서 검증 계획

1. README와 docs의 기술 스택 표현을 검색한다.
2. `Swift`, `SwiftUI`, `Core ML`, `VisionKit`, `PencilKit`, `SwiftData`, `WKWebView`, `URLSessionWebSocketTask`, `XCTest`, `Xcode`, `iOS`, `iPadOS` 검색 결과를 분류한다.
3. 장기 선택적 iOS Phase 또는 역사적 비교 외의 종속 표현은 제거한다.
4. README와 docs 내부 Markdown 링크가 실제 파일을 가리키는지 확인한다.
5. 코드 파일은 수정하지 않는다.
