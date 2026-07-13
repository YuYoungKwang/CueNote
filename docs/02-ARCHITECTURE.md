# 02. 시스템 아키텍처

## 1. 설계 원칙

- **Local First**: 악보 인식, 렌더링, 개인 연습·필기는 브라우저 로컬 우선
- **Structured Score**: 이미지가 아닌 마디·음표·코드·가사를 구조화
- **Server Assisted Collaboration**: 서버는 계정, 공유, 버전, 팀 메모, 합주 담당
- **Replaceable Components**: OMR·렌더러·저장소·동기화를 인터페이스로 분리
- **Phase Delivery**: OMR 없이 Mock/MusicXML로 앱 흐름부터 개발
- **No Page-Based Sync**: 합주 위치는 항상 마디와 박자 기준
- **Progressive Capability**: WebGPU, pressure, Wake Lock 같은 브라우저 기능은 검사 후 사용하고 대체 경로를 제공

## 2. 전체 구조

```text
┌──────────────────────────────────────────────┐
│ Web PWA                                      │
│ React + TypeScript + Vite                    │
│ ├─ Service Worker / PWA shell                │
│ ├─ IndexedDB / Cache Storage / OPFS 후보     │
│ ├─ Score Domain / Repeat Expander            │
│ ├─ MusicXML Import·Export                    │
│ ├─ Browser Score Renderer                    │
│ ├─ Canvas + Pointer Events Annotation        │
│ ├─ Web Worker OMR / Image Preprocessing      │
│ ├─ ONNX Runtime Web                          │
│ │  ├─ WebGPU execution provider              │
│ │  └─ WebAssembly fallback                   │
│ └─ REST / WebSocket API                      │
└───────────────────┬──────────────────────────┘
                    │ HTTPS / WSS
┌───────────────────▼──────────────────────────┐
│ Spring Boot API                              │
│ ├─ Auth Provider Verification                │
│ ├─ Score / Version / Permission              │
│ ├─ Annotation / Ensemble                     │
│ ├─ Rehearsal Session                         │
│ ├─ WebSocket Sync                            │
│ ├─ OMR Model Manifest                        │
│ └─ Presigned Upload                          │
└─────────────┬──────────────────┬─────────────┘
              │                  │
      PostgreSQL          S3-compatible Storage
```

## 3. 기술 스택

### Frontend Web PWA

- React
- TypeScript
- Vite
- PWA manifest
- Service Worker
- IndexedDB
- Dexie.js 사용 가능
- Cache Storage
- OPFS 후보
- ONNX Runtime Web
- WebGPU
- WebAssembly fallback
- PDF.js
- OpenCV.js 또는 Canvas 기반 이미지 전처리
- OpenSheetMusicDisplay 또는 Verovio
- Canvas
- Pointer Events
- Web Worker
- 브라우저 WebSocket API
- Vitest
- Playwright

### Backend

- Java 21
- Spring Boot 3.x
- Spring Security
- Spring Data JPA
- Spring WebSocket
- Bean Validation
- PostgreSQL
- Flyway
- Testcontainers
- JUnit 5
- OpenAPI
- Actuator
- S3-compatible SDK

Phase 4 구현은 Spring Security adapter를 아직 도입하지 않고 명시적 token/session service로 권한을 검증한다. MusicXML 원본은 `ObjectStorageService` adapter 뒤에 저장하며, dev/test 기본 구현은 로컬 파일 storage이고 Docker Compose에는 S3-compatible MinIO 초안을 포함한다.

### AI Training

- Windows 또는 WSL2
- Python
- PyTorch
- ONNX export
- ONNX validation
- quantization 또는 optimization
- evaluation scripts

브라우저에서는 모델을 학습하지 않는다. 브라우저는 전달받은 ONNX 모델을 검증된 manifest와 hash 기준으로 다운로드하고 추론만 수행한다.

### Infrastructure

#### 로컬 개발

- Docker Compose
- PostgreSQL
- 선택: MinIO

#### 온프레미스 개발·스테이징

- Ubuntu Server
- K3s
- Traefik Ingress
- cert-manager
- 외부 백업
- 선택: Redis, Prometheus, Grafana

## 4. 저장소 구조

```text
score-flow/
├─ web-app/
├─ backend/
├─ ai-training/
├─ packages/
│  └─ score-domain/
├─ deploy/
│  ├─ docker/
│  └─ k8s/
├─ docs/
└─ README.md
```

## 5. 권장 `web-app` 구조

```text
web-app/
├─ src/
│  ├─ app/
│  ├─ core/
│  │  ├─ api/
│  │  ├─ storage/
│  │  ├─ pwa/
│  │  └─ capabilities/
│  ├─ domain/
│  │  ├─ score/
│  │  ├─ navigation/
│  │  ├─ annotation/
│  │  └─ rehearsal/
│  ├─ features/
│  │  ├─ library/
│  │  ├─ import/
│  │  ├─ viewer/
│  │  ├─ editor/
│  │  ├─ annotation/
│  │  └─ rehearsal/
│  ├─ ai/
│  │  ├─ runtime/
│  │  ├─ preprocessing/
│  │  ├─ layout/
│  │  └─ symbols/
│  └─ workers/
│     ├─ omr.worker.ts
│     └─ image.worker.ts
└─ public/
   └─ models/
```

## 6. Frontend 레이어

### App

라우팅, 앱 셸, PWA 설치 유도, 전역 오류 처리, capability 검사 결과 표시를 담당한다.

### Core

- `api`: REST/WebSocket client
- `storage`: IndexedDB, Cache Storage, OPFS 후보 adapter
- `pwa`: Service Worker 등록, 앱 업데이트, 캐시 정책
- `capabilities`: WebGPU, WebAssembly, IndexedDB, Service Worker, Pointer Events, pressure, Wake Lock, 카메라, 저장 공간 검사

> 관련 문서: [10-WEB-CAPABILITY-MATRIX.md](./10-WEB-CAPABILITY-MATRIX.md)

### Domain

- 마디·음표 모델
- 반복 구조 해석
- BPM/박자 시간 계산
- 편곡 버전 규칙
- 메모 공개 범위
- 합주 상태 전이

플랫폼 독립 타입과 알고리즘은 가능하면 `packages/score-domain`에 둔다.

### Features

- `library`: 악보 목록과 최근 항목
- `import`: 파일 업로드, 카메라 입력, PDF import
- `viewer`: 악보 렌더링, 마디 하이라이트, 자동 스크롤
- `editor`: 제한적 악보 편집
- `annotation`: Canvas 필기와 텍스트 메모
- `rehearsal`: 합주 세션 UI

### AI

- ONNX Runtime Web session 관리
- WebGPU/WASM execution provider 선택
- PDF.js page rendering
- Canvas/OpenCV.js 전처리
- layout/symbol adapter
- model manifest 검증

### Workers

OMR과 이미지 전처리는 UI 메인 스레드에서 실행하지 않는다.

- `image.worker.ts`: PDF page rasterize 후 crop, 보정, ImageBitmap 관리
- `omr.worker.ts`: ONNX Runtime Web 추론, tensor 생성/해제, confidence result 반환

Worker 통신에는 가능한 경우 transferable 객체를 사용한다.

## 7. 핵심 인터페이스

```ts
export interface OMRService {
  recognize(pages: ScorePageImage[]): Promise<RecognitionResult>;
}

export interface ScoreRepository {
  save(score: ScoreDocument): Promise<void>;
  load(id: ScoreID): Promise<ScoreDocument | null>;
  list(): Promise<ScoreSummary[]>;
}

export interface MusicXMLService {
  parse(data: ArrayBuffer): Promise<ScoreVersion>;
  export(version: ScoreVersion): Promise<ArrayBuffer>;
}

export interface ScoreRenderer {
  load(version: ScoreVersion): Promise<void>;
  highlight(performanceMeasureId: PerformanceMeasureID, beat: Rational): Promise<void>;
  scrollTo(performanceMeasureId: PerformanceMeasureID): Promise<void>;
}

export interface SessionSyncService {
  connect(sessionId: SessionID, token: string): Promise<void>;
  send(command: SessionCommand): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}
```

## 8. 악보 렌더링

### MVP 후보

```text
React View
└─ Browser Score Renderer
   ├─ OpenSheetMusicDisplay
   └─ Verovio
```

렌더러 선택은 Phase 1에서 비교해 결정한다. 문서 단계에서는 특정 렌더러를 확정된 사실로 두지 않는다.

렌더러 계약:

- 악보 로드
- 마디 ID 조회
- 마디 하이라이트
- 특정 마디 스크롤
- 확대/축소
- 렌더링 완료 이벤트
- 사용자 탭 마디 반환

렌더러는 `ScoreRenderer` 뒤에 숨겨 장기적으로 교체 가능하게 한다.

## 9. OMR 실행

```text
File Input / Camera
→ PDF.js page rendering
→ Canvas / OpenCV.js preprocessing
→ System crop
→ Staff / Measure crop
→ Web Worker
→ ONNX Runtime Web
   ├─ WebGPU
   └─ WASM fallback
→ Structure assembler
→ Confidence Review
→ Internal Score Model
→ MusicXML Export
```

메모리 원칙:

- 전체 PDF를 한 번에 고해상도로 rasterize하지 않는다.
- 현재 처리 중인 페이지 하나만 고해상도로 유지한다.
- 시스템, 오선, 마디 단위 crop으로 분리한다.
- crop 처리 후 ImageBitmap과 Tensor를 해제한다.
- 저사양 기기에서는 페이지별 순차 처리한다.

## 10. 저장

### IndexedDB

- 악보 구조
- 편곡 버전
- PerformanceOrder
- 개인 필기와 텍스트 메모
- 동기화 큐
- 최근 합주 상태
- 로컬 schema version

Dexie.js는 IndexedDB adapter 후보로 사용할 수 있다.

### Cache Storage

- JavaScript, CSS, 앱 셸
- ONNX 모델 파일
- 렌더러 asset
- 정적 이미지

모델 파일은 manifest의 hash가 변경된 경우에만 다시 다운로드한다.

> 관련 문서: [12-MODEL-DELIVERY-SPEC.md](./12-MODEL-DELIVERY-SPEC.md)

### OPFS 또는 IndexedDB Blob

- 원본 PDF
- 고해상도 이미지
- MusicXML export

브라우저 지원과 quota 동작은 검증 후 결정한다. 지원 여부가 불확실한 경우 IndexedDB Blob fallback을 유지한다.

> 관련 문서: [11-PWA-OFFLINE-SPEC.md](./11-PWA-OFFLINE-SPEC.md)

### 서버

PostgreSQL:

- 사용자
- 악보·버전·권한
- 공유 메모
- 팀
- 합주 세션
- 구조화 악보 JSONB

객체 저장소:

- 원본 이미지/PDF
- MusicXML export
- 썸네일
- ONNX 모델 파일
- 백업 파일

## 11. 인증

```text
Auth provider credential
→ Backend validates provider token or login code
→ Backend issues access/refresh token
→ Web client stores token using chosen browser-safe strategy
```

인증 provider는 Phase별 구현에서 결정한다. 후보는 Apple, Google, Email Magic Link다. WebSocket도 동일 사용자 인증을 사용한다.

Phase 4에서는 `/dev-auth/login` 개발 endpoint가 opaque access/refresh token을 발급한다. 외부 provider token 검증은 이후 provider 통합 Phase에서 수행한다.

## 12. 합주 동기화

```text
Leader browser
→ START(targetTimestamp, bpm, position)
→ Backend validates leader/sequence
→ Participants schedule locally
→ Local clock advances
→ Visibility or reconnect event requests STATE_SNAPSHOT
→ periodic snapshot corrects drift
```

서버는 매 프레임·매 음표를 전송하지 않는다. 브라우저 timer throttling을 신뢰하지 않고 절대 시각으로 현재 위치를 재계산한다.

## 13. K3s 배포

```text
Internet
→ DNS/Tunnel
→ Traefik Ingress
→ frontend static hosting 또는 web service
→ backend Service
→ backend Deployment
→ PostgreSQL StatefulSet 또는 외부 DB
→ S3-compatible Storage
```

권장 파일:

```text
deploy/k8s/
├─ namespace.yaml
├─ configmap.yaml
├─ secret.example.yaml
├─ backend-deployment.yaml
├─ backend-service.yaml
├─ frontend-deployment.yaml
├─ frontend-service.yaml
├─ ingress.yaml
├─ postgres-statefulset.yaml
├─ postgres-service.yaml
├─ pvc.yaml
└─ network-policy.yaml
```

## 14. 운영 관측

- `/actuator/health`
- 요청 correlation ID
- WebSocket 연결 수
- 세션 참여 인원
- 합주 이벤트 지연
- drift 보정 횟수
- API 오류율
- DB pool
- 모델 manifest 다운로드 수
- 모델 hash mismatch 수
- 백업 성공 여부

## 15. 금지 사항

- 페이지 번호를 합주 위치 기준으로 사용하지 않는다.
- 원본과 편곡 버전을 같은 레코드에 덮어쓰지 않는다.
- 필기를 MusicXML 문자열 안에 임의 저장하지 않는다.
- 매 프레임 위치를 서버로 보내지 않는다.
- OMR 출력을 검증 없이 확정하지 않는다.
- React component에서 DB/네트워크/반복 해석을 직접 수행하지 않는다.
- UI 메인 스레드에서 무거운 OMR 추론을 실행하지 않는다.
- 전체 PDF를 한 번에 고해상도로 rasterize하지 않는다.
- 브라우저에서 모델을 학습하지 않는다.
- 같은 서버 디스크의 복사본을 외부 백업으로 간주하지 않는다.
