# 01. 제품 요구사항 문서(PRD)

## 1. 제품 개요

**CueNote**는 사용자가 악보 이미지 또는 PDF를 브라우저에 가져오면, 사용자 기기에서 로컬 OMR 추론을 수행하고 도돌이표·D.C.·D.S.·Segno·Coda·Fine 등을 해석하여 실제 연주 순서대로 펼쳐진 악보를 제공하는 Web PWA다.

사용자는 변환된 악보를 간단히 편곡하고 펜, 터치, 마우스, 스타일러스 입력으로 필기할 수 있다. 합주 세션에서는 여러 사용자의 악보 위치를 페이지 번호가 아닌 **마디와 박자 기준**으로 동기화한다.

1차 구현 플랫폼은 React + TypeScript 기반 Web PWA다. Windows 개발 환경에서 구현할 수 있어야 하며, 선택적 iOS 네이티브 앱은 웹 서비스 검증 이후 장기 확장 단계로 둔다.

## 2. 해결하려는 문제

- 반복기호 때문에 연주 중 악보 앞뒤를 찾아가야 한다.
- 연주자가 편곡한 내용을 원본 악보에 구조적으로 반영하기 어렵다.
- 종이 필기와 팀 공유가 분리되어 있다.
- 합주 인원이 각자 페이지를 넘겨 악보 위치가 어긋난다.
- 일반 PDF 뷰어는 마디·박자·음표 의미를 이해하지 못한다.
- 악보 스캐너, 편집기, 합주 뷰어가 서로 분리되어 있다.
- 특정 운영체제나 개발 장비가 없으면 초기 개발과 검증을 진행하기 어렵다.

## 3. 제품 비전

> 브라우저에서 악보를 연주 가능한 디지털 악보로 바꾸고, 실제 연주 순서에 맞게 펼치며, 팀이 같은 흐름으로 연주할 수 있게 한다.

## 4. 목표 사용자

### 1차 사용자

- 교회 찬양팀
- 소규모 밴드
- 합창단·성가대
- 코드와 한글 가사가 있는 단선율 리드시트 사용자

### 확장 사용자

- 피아노 연주자
- 실내악·앙상블
- 음악 교육자와 학생
- 오케스트라 파트 연주자

## 5. 플랫폼 지원 범위

### 1차 지원

- Windows Chrome
- Windows Edge
- macOS Chrome 또는 Safari
- iPad Safari

### 제한적 지원

- iPhone과 소형 스마트폰은 촬영, 간단 열람, 세션 참가 등 제한적 흐름을 우선 지원한다.
- 작은 화면에서는 정밀 편집, 긴 필기, 복잡한 검수 흐름이 제한될 수 있다.

### 브라우저 기능 원칙

- WebGPU는 우선 실행 경로지만 필수 조건으로 가정하지 않는다.
- WebGPU 미지원 또는 실패 시 WebAssembly fallback을 제공한다.
- Service Worker, IndexedDB, Cache Storage, Pointer Events 지원 여부를 앱 시작 시 검사한다.
- Wake Lock, pressure 입력, 카메라 접근, 사용 가능한 저장 공간은 기능별 capability로 검사하고 미지원 시 대체 흐름을 제공한다.

## 6. MVP 지원 범위

### 지원

- 깨끗한 인쇄 악보
- 단일 오선 중심 리드시트
- 멜로디 + 코드 + 한글 가사
- 음표, 쉼표, 조표, 박자표, 마디선
- 도돌이표와 1·2번 엔딩
- 제한적인 D.C., D.S., Segno, Coda, Fine
- 이미지/PDF/MusicXML
- 파일 업로드
- 브라우저 카메라 입력
- PDF import
- Pointer Events 기반 펜, 터치, 마우스, 스타일러스 입력
- Service Worker 기반 오프라인 앱 셸
- IndexedDB 기반 악보, 편곡 버전, 메모, 동기화 큐 저장
- ONNX 모델 파일 브라우저 캐시

### 초기 제외

- 손글씨 악보
- 오케스트라 총보
- 복잡한 교차 보표
- 타브 악보
- 실시간 카메라 영상 프레임마다 전체 악보 분석
- MuseScore/Sibelius 수준 전체 편집기
- 실제 연주 음원 추적
- 브라우저 내 모델 학습

## 7. 핵심 사용자 흐름

### 악보 가져오기

```text
파일 업로드 또는 카메라 입력
→ PDF.js 또는 이미지 디코딩
→ Canvas/OpenCV.js 기반 보정
→ Web Worker에서 로컬 OMR 추론
→ 저신뢰 마디 검수
→ 악보 문서 생성
```

### 연주 순서 펼치기

```text
인식된 악보
→ 반복·이동 기호 해석
→ 실제 연주 경로 계산
→ 마디 occurrence 생성
→ 직선형 연주 악보 렌더링
```

### 편곡 및 메모

```text
편곡 버전 생성
→ 코드·가사·음표·마디 수정
→ 개인/파트/전체 메모
→ IndexedDB에 로컬 우선 저장
→ 온라인 상태에서 서버 동기화
```

### 합주

```text
세션 생성
→ 악보 버전 선택
→ 초대 코드 공유
→ 리더가 재생 시작
→ 참여 브라우저가 같은 마디·박자로 이동
→ background/foreground 복귀 시 상태 스냅샷으로 보정
```

## 8. 기능 요구사항

### FR-01 악보 가져오기

- 사용자는 파일 선택으로 이미지/PDF/MusicXML을 가져올 수 있어야 한다.
- 사용자는 브라우저 카메라 입력으로 페이지 이미지를 추가할 수 있어야 한다.
- 페이지 순서 변경, 회전, 삭제가 가능해야 한다.
- 흐림, 잘림, 심한 그림자를 감지해 안내해야 한다.
- 고해상도 PDF 전체를 한 번에 rasterize하지 않고 페이지 단위로 처리해야 한다.
- 저장 공간 부족 또는 브라우저 quota 제한을 감지해 사용자에게 안내해야 한다.

### FR-02 브라우저 로컬 OMR

- 기본 인식은 인터넷 없이 동작해야 한다. 단, 최초 모델 다운로드와 앱 설치 전에는 네트워크가 필요할 수 있다.
- OMR 추론은 UI 메인 스레드가 아닌 Web Worker에서 실행해야 한다.
- ONNX Runtime Web을 사용하며 WebGPU 우선, WebAssembly fallback을 제공한다.
- 오선, 마디, 음표, 쉼표, 조표, 박자표, 마디선을 인식한다.
- 코드 기호와 한글 가사를 별도 레이어로 인식한다.
- 반복·이동 기호를 가능한 범위에서 인식한다.
- 결과마다 신뢰도와 원본 위치를 보관한다.
- 저신뢰 마디를 우선 검수할 수 있어야 한다.
- 기기 성능이 부족하면 수동 수정 흐름을 제공하고, 향후 선택적 서버 분석 가능성을 열어 둔다.

### FR-03 구조화 악보

- 인식 결과를 내부 악보 모델로 변환한다.
- MusicXML import/export를 지원한다.
- 원본 마디와 연주용 occurrence를 분리한다.
- 원본 이미지/PDF와 구조화 데이터를 연결한다.

### FR-04 반복 펼치기

- 도돌이표와 기본 반복 횟수를 처리한다.
- 1·2번 엔딩을 반복 차수에 따라 선택한다.
- D.C. al Fine, D.S. al Fine, D.S. al Coda를 처리한다.
- 잘못된 표기로 인한 무한 반복을 방지한다.
- 펼친 마디가 어떤 원본 마디에서 왔는지 보존한다.

### FR-05 렌더링과 자동 넘김

- 브라우저 viewport와 기기 화면 크기에 맞춰 악보를 재배치한다.
- 마디 ID로 하이라이트·스크롤할 수 있어야 한다.
- 확대/축소와 가로/세로 모드를 지원한다.
- BPM과 박자표로 진행 시간을 계산한다.
- 재생, 일시정지, 정지, 카운트인을 지원한다.
- 반복 펼친 버전과 원본 구조를 전환할 수 있어야 한다.
- 브라우저 timer throttling 후 foreground 복귀 시 절대 시각 기반으로 위치를 재계산한다.

### FR-06 제한적 악보 편집

- 코드와 한글 가사 수정
- 음높이와 음가 변경
- 음표·쉼표 추가/삭제
- 마디 복사/삭제
- 반복기호 수정
- 조옮김
- 새 편곡 버전 생성
- 이전 버전 복구

### FR-07 필기·메모

- Canvas + Pointer Events 기반 펜, 형광펜, 지우개를 제공한다.
- pressure 입력이 있으면 보존하고, 없으면 기본 압력으로 처리한다.
- 마우스, 터치, 스타일러스 입력을 모두 처리한다.
- 텍스트, 도형, 화살표 메모를 지원한다.
- 필기는 화면 절대 픽셀이 아니라 마디 또는 음표 기준 상대 좌표로 저장한다.
- 개인, 파트, 전체 공개 범위를 지원한다.
- 메모 레이어 필터를 제공한다.
- 화면 회전·확대 후 위치를 유지한다.

### FR-08 합주 세션

- 합주 세션 생성과 참가 코드를 지원한다.
- 리더/참여자 역할을 지원한다.
- 세션은 하나의 악보 버전에 고정한다.
- 리더가 시작, 정지, BPM, 위치를 제어한다.
- 참여자는 개인적으로 다른 마디를 볼 수 있다.
- “리더 위치로 돌아가기”를 제공한다.

### FR-09 합주 동기화

- 기준은 `performanceMeasureId + beat`다.
- 시작 명령은 미래 `targetTimestamp`를 포함한다.
- 각 브라우저는 로컬 시계와 BPM으로 진행한다.
- 서버는 상태 변경과 주기적 스냅샷만 전달한다.
- 연결이 끊겨도 잠시 로컬 진행한다.
- 재연결 또는 foreground 복귀 시 상태 스냅샷으로 복구한다.
- 이벤트 순서는 `sequence`로 검증한다.

### FR-10 오프라인·버전 관리

- 설치된 PWA 앱 셸은 인터넷 없이 열 수 있어야 한다.
- 다운로드하거나 생성한 악보는 인터넷 없이 열 수 있어야 한다.
- 개인 필기와 편곡은 IndexedDB에 로컬 우선 저장한다.
- 원본 악보를 직접 덮어쓰지 않는다.
- 버전마다 부모 버전, 작성자, 변경 설명을 저장한다.
- 합주 중 악보 버전을 임의 변경하지 않는다.
- 온라인 복귀 시 동기화 큐를 처리하고 충돌을 사용자에게 설명한다.

## 9. 비기능 요구사항

### 성능

- 일반 단선율 악보 1페이지를 사용자가 기다릴 수 있는 시간 안에 처리한다.
- OMR은 페이지, 시스템, 마디 crop 단위로 처리해 메모리 사용량을 제한한다.
- 렌더링과 스크롤이 체감상 끊기지 않아야 한다.
- 합주 이벤트를 매 프레임 전송하지 않는다.
- 원본 이미지와 모델 파일을 불필요하게 반복 다운로드하지 않는다.

### 안정성

- 잘못된 반복 구조에서도 무한 루프가 없어야 한다.
- 서버 연결이 끊겨도 로컬 악보와 개인 작업이 보존되어야 한다.
- 중복 이벤트를 받아도 상태가 일관되어야 한다.
- 로컬 스키마 마이그레이션 실패 시 기존 데이터를 보호한다.
- 모델 hash가 맞지 않거나 파일이 손상되면 재다운로드한다.

### 보안·저작권

- 원본 악보는 기본적으로 사용자의 브라우저에서 인식한다.
- 업로드 여부를 사용자에게 명확히 알린다.
- 외부 통신은 HTTPS/WSS를 사용한다.
- 인증 provider token 원문을 장기 저장하지 않는다.
- 업로드 악보 이용 권한 확인 절차를 둔다.
- 초기 공유는 비공개 팀 중심으로 제한한다.

## 10. 성공 지표

- 악보 가져오기 완료율
- 사용자 수정이 필요한 마디 비율
- 반복 펼치기 성공률
- 자동 넘김 사용률
- 합주 세션 참가·재연결 성공률
- 악보별 메모·편곡 재사용률
- 모델 다운로드 완료율과 캐시 재사용률
- 오프라인 열람/편집 성공률

## 11. 차별점

1. 반복기호를 실제 연주 순서의 직선형 악보로 펼친다.
2. 페이지가 아닌 마디·박자 단위로 합주 위치를 맞춘다.
3. 코드와 한글 가사가 있는 한국형 리드시트에 우선 집중한다.
4. 악보 인식을 사용자의 브라우저에서 우선 처리한다.
5. 구조 편집과 자유 필기를 별도 레이어로 관리한다.
6. 설치 가능한 Web PWA로 Windows, macOS, iPad 환경을 우선 지원한다.
## Phase 6 Implementation Note

- CueNote now supports limited structured score editing for server-backed MusicXML score versions.
- The editable model is separate from Verovio; rendered SVG is preview-only and is not the source of truth.
- Supported edits are pitch, note/rest duration, chord symbol, lyric, insert/delete/duplicate measure, transpose, validation, undo/redo, local MusicXML export, draft cancel, and publish as a new immutable score version.
- The edit workflow is base `ScoreVersion` -> local IndexedDB draft -> validation -> MusicXML serialization -> new `ScoreVersion`.
- Existing `ScoreVersion` object keys and MusicXML content are immutable.
- Active rehearsal sessions remain fixed to the old `scoreVersionId`.
- Phase 6 does not implement OMR, PDF/image import, ONNX inference, or realtime collaborative score editing.

## Phase 8 Product Boundary

Phase 8 validates browser-local ONNX Runtime infrastructure with `TEST_RUNTIME_MODEL`. Production OMR recognition, measured product accuracy, structure assembly, MusicXML draft generation, and Phase 6 editor handoff are not Phase 8 deliverables.

## Phase 9 Product Boundary

Phase 9 adds OMR dataset contracts, license validation, source-group leakage prevention, synthetic fixture generation, smoke training/evaluation, ONNX export, and browser inference for experimental layout/symbol models.

The current Phase 9 fixture data is synthetic-only. Product OMR accuracy is not evaluated, and layout/symbol product candidates are not ready until licensed real scan/photo data and fixed test-split metrics exist.
