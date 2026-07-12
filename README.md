# CueNote

CueNote는 브라우저에서 실행되고 설치 가능한 Web PWA 기반 협업형 디지털 악보 앱입니다. 악보 이미지 또는 PDF를 구조화된 악보로 바꾸고, 반복 기호를 실제 연주 순서로 펼치며, 필기·편집·합주 위치 동기화를 제공합니다.

1차 구현 플랫폼은 **React + TypeScript + Vite 기반 Web PWA**입니다. Windows 개발 환경에서 프론트엔드, 백엔드, AI 학습 파이프라인을 개발할 수 있도록 설계하며, 선택적 iOS 네이티브 앱은 웹 서비스 검증 이후 장기 확장 단계에서 검토합니다.

## 저장소 구조

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

### 역할

- `web-app`: React, TypeScript, PWA, 렌더링, 필기, 로컬 OMR, 합주 UI
- `backend`: 인증, 악보 공유, 버전 관리, 팀 메모, 합주 WebSocket
- `ai-training`: 데이터셋 검사, 합성 데이터 생성, PyTorch 학습, 평가, ONNX 변환
- `packages/score-domain`: 플랫폼 독립 악보 타입, 반복 펼치기 엔진, 재생 타임라인, 합주 메시지 타입, JSON Schema
- `deploy`: Docker Compose, K3s 매니페스트
- `docs`: 제품, 아키텍처, API, OMR, 동기화, 로드맵, 검증 문서

## 문서 순서

1. [docs/01-PRD.md](docs/01-PRD.md) — 제품 목표와 요구사항
2. [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) — 기술 구조
3. [docs/03-DOMAIN-MODEL.md](docs/03-DOMAIN-MODEL.md) — 악보·메모·합주 데이터 모델
4. [docs/04-API-SPEC.md](docs/04-API-SPEC.md) — REST API
5. [docs/05-OMR-SPEC.md](docs/05-OMR-SPEC.md) — 브라우저 로컬 OMR
6. [docs/06-SYNC-PROTOCOL.md](docs/06-SYNC-PROTOCOL.md) — 합주 동기화
7. [docs/07-ROADMAP.md](docs/07-ROADMAP.md) — 개발 단계
8. [docs/08-ACCEPTANCE-CRITERIA.md](docs/08-ACCEPTANCE-CRITERIA.md) — 완료 기준
9. [docs/09-CODEX-PROMPTS.md](docs/09-CODEX-PROMPTS.md) — Codex 작업 프롬프트
10. [docs/10-WEB-CAPABILITY-MATRIX.md](docs/10-WEB-CAPABILITY-MATRIX.md) — 브라우저 기능 매트릭스
11. [docs/11-PWA-OFFLINE-SPEC.md](docs/11-PWA-OFFLINE-SPEC.md) — PWA 오프라인 사양
12. [docs/12-MODEL-DELIVERY-SPEC.md](docs/12-MODEL-DELIVERY-SPEC.md) — OMR 모델 전달 사양

## 핵심 기술 방향

### Web PWA

- React
- TypeScript
- Vite
- Service Worker
- IndexedDB
- Cache Storage
- ONNX Runtime Web
- WebGPU 우선, WebAssembly fallback
- PDF.js
- OpenCV.js 또는 Canvas 기반 이미지 전처리
- OpenSheetMusicDisplay 또는 Verovio
- Canvas + Pointer Events 기반 필기
- 브라우저 WebSocket API
- Vitest
- Playwright

### Backend

- Java 21
- Spring Boot
- PostgreSQL
- Spring WebSocket
- S3-compatible object storage
- Docker Compose
- K3s

## 권장 개발 순서

```text
MusicXML 웹 뷰어
→ 반복 펼치기
→ 자동 넘김
→ 브라우저 필기
→ 서버 공유
→ 합주 동기화
→ 제한적 웹 악보 편집
→ ONNX 로컬 OMR
→ 필요할 경우 iOS 네이티브 앱
```

## Codex 작업 원칙

- 전체 기능을 한 번에 구현하지 않는다.
- [docs/07-ROADMAP.md](docs/07-ROADMAP.md)의 한 Phase만 선택해 작업한다.
- 작업 전 기존 코드와 문서를 읽고 `PLAN.md` 또는 작업 성격에 맞는 계획 문서를 작성한다.
- 다음 Phase 기능은 인터페이스만 준비하고 선행 구현하지 않는다.
- 작업 후 빌드·테스트·변경 파일 요약을 남긴다.
- 실행하지 못한 검증은 성공했다고 보고하지 않는다.
- 문서와 구현이 충돌하면 임의로 바꾸지 말고 변경 이유와 영향을 먼저 기록한다.
