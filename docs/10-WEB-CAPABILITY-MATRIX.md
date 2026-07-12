# 10. Web Capability Matrix

## 1. 목적

CueNote Web PWA가 브라우저별 기능 차이를 안전하게 처리하기 위한 capability 기준을 정의한다. 이 문서는 정확한 지원 여부를 확정하는 표가 아니라, 구현과 QA에서 검증해야 할 항목을 추적하는 매트릭스다.

정확한 브라우저 지원 여부가 확인되지 않은 항목은 “검증 필요”로 표시한다.

## 2. 표시 방식

| 표시 | 의미 |
|---|---|
| 지원 | 해당 브라우저와 버전에서 직접 검증됨 |
| 제한 지원 | 동작하지만 제약 또는 fallback 필요 |
| 미지원 | 직접 검증 결과 사용할 수 없음 |
| 검증 필요 | 현재 문서 작성 시점에 직접 검증하지 않음 |

## 3. 1차 검증 대상

- Windows Chrome
- Windows Edge
- macOS Chrome
- Safari
- iPad Safari

Mac 또는 iPad 실기기 접근이 없으면 해당 결과를 성공으로 기록하지 않고 “검증 필요”로 둔다.

## 4. Capability Matrix

| Capability | Chrome | Edge | Safari | iPad Safari | 비고 |
|---|---|---|---|---|---|
| WebGPU | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 미지원 또는 실패 시 WASM fallback 필수 |
| WebAssembly | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | ONNX Runtime Web fallback 경로 |
| PWA 설치 | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 설치 UX와 standalone 표시 방식은 브라우저별 차이 가능 |
| Service Worker | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 앱 셸 캐시와 offline fallback에 필요 |
| IndexedDB | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 악보 구조, 메모, 동기화 큐 저장 |
| Cache Storage | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 앱 셸, asset, 모델 캐시 |
| OPFS | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 원본 PDF/이미지 저장 후보. IndexedDB Blob fallback 필요 |
| Wake Lock | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 실패해도 합주 기능은 중단되지 않아야 함 |
| Pointer Events | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | Canvas 필기 입력 |
| pressure | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 없으면 기본 pressure로 처리 |
| camera input | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 권한 거부와 미지원 fallback 필요 |
| file input | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 이미지/PDF/MusicXML import |
| offline support | 검증 필요 | 검증 필요 | 검증 필요 | 검증 필요 | 설치 여부와 캐시 상태에 따라 다름 |

## 5. 알려진 제한 후보

- WebGPU는 브라우저, OS, GPU, 드라이버 상태에 따라 달라질 수 있다.
- Wake Lock은 브라우저 정책, 배터리 상태, 권한, 탭 visibility에 따라 실패할 수 있다.
- iPad Safari는 메모리 제한과 background 동작 제한을 별도 검증해야 한다.
- pressure 입력은 입력 장치와 브라우저 이벤트 구현에 따라 없을 수 있다.
- 저장 공간 quota와 eviction 정책은 브라우저별로 다를 수 있다.
- 카메라 input은 HTTPS와 사용자 권한이 필요하다.

## 6. Capability 검사 항목

앱 시작 시 또는 기능 진입 시 다음을 검사한다.

- `navigator.gpu`
- WebAssembly 사용 가능 여부
- `indexedDB`
- `navigator.serviceWorker`
- `window.PointerEvent`
- PointerEvent pressure 값 존재 여부
- Wake Lock API 후보
- camera input 또는 MediaDevices 후보
- `navigator.storage.estimate()`

검사 결과는 기능 활성화, 사용자 안내, fallback 선택에 사용한다.

## 7. 미검증 항목 기록 규칙

검증하지 않은 항목은 문서와 완료 보고에서 다음 형식으로 기록한다.

```text
macOS Safari: 미검증 - 현재 작업 환경에 macOS 장비 없음
iPad Safari: 미검증 - 현재 작업 환경에 iPad 실기기 없음
WebGPU on Windows Edge: 미검증 - 자동 테스트 환경 미구성
```

검증하지 않은 항목을 “지원”으로 표시하지 않는다.
