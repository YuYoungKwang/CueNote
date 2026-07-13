# 12. 모델 전달 사양

## 1. 목적

브라우저 OMR에 필요한 ONNX 모델을 안전하고 재현 가능하게 전달한다. 모델은 version, URL, SHA-256, size, 호환성, minimum app version을 manifest로 관리한다.

## 2. 모델 구성

초기 후보:

- layout model: 시스템, 오선, 마디 검출
- symbol model: 음표, 쉼표, 조표, 박자표, 반복기호 후보 검출

추가 후보:

- text/navigation model
- sequence recognizer
- OCR 보조 model

모델 구성은 Phase 8 이후 검증 결과에 따라 변경될 수 있다.

## Phase 8 Runtime Model Boundary

Phase 8 ships only `TEST_RUNTIME_MODEL` for ONNX Runtime Web infrastructure validation. It is not a product layout or symbol model.

- The test model may validate session creation, tensor input, output reception, provider fallback, cache/hash, rollback-ready metadata, and offline cached loading.
- Product layout and symbol models are Phase 9 deliverables.
- Structure assembly and MusicXML draft generation are Phase 10 deliverables.
- UI and reports must distinguish `TEST_RUNTIME_MODEL` from an installed product model with `PRODUCT_MODEL_NOT_INSTALLED`.

## 3. Manifest

### Endpoint

```text
GET /api/v1/models/omr/manifest
```

### 예시

```json
{
  "manifestVersion": 1,
  "minimumAppVersion": "0.1.0",
  "createdAt": "2026-07-12T00:00:00Z",
  "models": [
    {
      "id": "layout-v1",
      "role": "LAYOUT",
      "version": "2026.07.0",
      "url": "https://cdn.example.com/models/layout-v1.onnx",
      "sha256": "hex",
      "sizeBytes": 15728640,
      "executionProviders": {
        "webgpu": "compatible",
        "wasm": "compatible"
      },
      "minimumAppVersion": "0.1.0"
    }
  ]
}
```

## 4. 필드

- `manifestVersion`: manifest schema version
- `minimumAppVersion`: 전체 manifest를 사용할 수 있는 최소 앱 버전
- `id`: 모델 식별자
- `role`: `LAYOUT`, `SYMBOL`, `TEXT`, `NAVIGATION` 등 역할
- `version`: 모델 버전
- `url`: 다운로드 URL
- `sha256`: 파일 무결성 검증 hash
- `sizeBytes`: 예상 다운로드 크기
- `executionProviders`: WebGPU/WASM 호환성 정보
- `minimumAppVersion`: 모델별 최소 앱 버전

## 5. 다운로드

규칙:

- 최초 OMR 진입 전 또는 진입 시 모델 manifest를 확인한다.
- 로컬 캐시에 같은 `id`, `version`, `sha256` 모델이 있으면 재다운로드하지 않는다.
- 다운로드 진행률을 사용자에게 표시한다.
- 다운로드 중 네트워크가 끊기면 중단 상태를 표시하고 재시도한다.
- 다운로드 완료 후 SHA-256을 검증한다.
- hash가 맞지 않으면 파일을 폐기하고 다시 다운로드한다.

## 6. 캐시 저장

- 모델 파일은 Cache Storage 저장을 우선 후보로 한다.
- 브라우저별 quota와 eviction 정책은 검증 필요하다.
- Cache Storage 사용이 불안정한 경우 IndexedDB Blob fallback을 검토한다.
- 사용자가 캐시를 지우면 다음 OMR 실행 때 다시 다운로드할 수 있어야 한다.

## 7. 업데이트

업데이트 조건:

- manifest의 `sha256` 변경
- manifest의 `version` 변경
- 현재 앱 버전이 새 모델의 `minimumAppVersion`을 만족

업데이트 절차:

```text
manifest fetch
→ local cache compare
→ download changed model
→ hash validation
→ warmup optional
→ mark active
→ remove old model after grace period
```

다운로드 또는 검증 실패 시 기존 정상 모델을 계속 사용할 수 있어야 한다.

## 8. Rollback

- 서버는 배포 중 이전 manifest와 이전 모델 파일을 일정 기간 유지한다.
- 새 모델이 실패하면 manifest를 이전 version으로 되돌릴 수 있어야 한다.
- 클라이언트는 새 모델 활성화 전 검증에 실패하면 이전 모델을 삭제하지 않는다.

## 9. 손상된 파일 재다운로드

손상 판단:

- SHA-256 mismatch
- ONNX Runtime session 생성 실패
- 파일 크기 불일치
- manifest에 없는 role 또는 provider 설정

처리:

- 해당 모델 캐시 삭제
- manifest 재조회
- 재다운로드
- 반복 실패 시 사용자에게 모델 다운로드 실패를 표시하고 수동 검수/수동 입력 흐름 제공

## 10. WebGPU/WASM 호환성

- WebGPU는 우선 execution provider다.
- WebGPU 미지원, 권한/드라이버 문제, session 생성 실패 시 WASM fallback을 사용한다.
- WASM 경로는 느릴 수 있으므로 페이지별 순차 처리와 진행률 표시가 필요하다.
- WebGPU가 있다고 해서 모든 모델이 실행 가능하다고 가정하지 않는다.

## 11. 크기 목표

아래 값은 확정된 제약이 아니라 제품 목표다.

- layout model: 약 5~20MB 목표
- symbol model: 약 15~50MB 목표
- 전체 초기 다운로드: 가급적 100MB 이하 목표

정확도, 속도, 메모리, 캐시 안정성 검증 결과에 따라 조정한다.

## 12. 배포 중 이전 모델 유지 전략

- 새 모델 배포 후 최소 한 릴리스 기간 동안 이전 모델을 유지한다.
- manifest rollback 시 이전 모델 URL이 계속 유효해야 한다.
- CDN 또는 object storage lifecycle 정책이 이전 모델을 너무 빨리 삭제하지 않도록 한다.
- 서버 로그에서 모델 다운로드 실패율과 hash mismatch를 관측한다.

## 13. 보안과 무결성

- 모델 URL 전체를 민감 로그에 남기지 않는다.
- 모델 파일은 SHA-256으로 검증한다.
- manifest 자체도 HTTPS로만 제공한다.
- 공급망 보안을 위해 학습 artifact, 변환 artifact, 배포 artifact의 version을 연결해 기록한다.
