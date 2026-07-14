# 05. 브라우저 로컬 OMR 사양

## 1. 목표

사용자의 브라우저에서 악보 이미지 또는 PDF를 분석하여 편집 가능한 구조화 악보를 생성한다.

MVP 우선 대상:

- 인쇄된 단선율 오선 악보
- 오선 위 코드 기호
- 음표 아래 한글 가사
- 찬양·밴드 리드시트
- 깨끗한 스캔 또는 카메라 촬영본

## 2. 비목표

- 손글씨 악보
- 오케스트라 총보
- 복잡한 피아노 교차 보표
- 현대음악 특수 기보
- 심하게 구겨지거나 가려진 사진
- 영상 프레임마다 전체 악보 실시간 분석
- 거대 멀티모달 모델 하나로 MusicXML 직접 생성
- 브라우저 내 모델 학습

## 3. 웹 OMR 파이프라인

```text
File Input / Camera
→ PDF.js page rendering
→ Canvas / OpenCV.js preprocessing
→ Quality Validation
→ System crop
→ Staff detection
→ Measure crop
→ Web Worker
→ ONNX Runtime Web
   ├─ WebGPU execution provider
   └─ WASM fallback
→ Symbol / Text candidate result
→ Structure assembler
→ Navigation validation
→ Confidence review
→ Score Domain Model
→ MusicXML Export
```

OMR과 이미지 전처리는 UI 메인 스레드가 아닌 Web Worker에서 실행한다.

## 4. 입력

지원:

- JPEG
- PNG
- PDF
- MusicXML(OMR 우회 import)
- 브라우저가 디코딩 가능한 기타 이미지 형식

HEIC 등 브라우저 지원이 일관되지 않은 형식은 검증 후 지원 여부를 결정한다.

권장 조건:

- 페이지 전체가 잘리지 않음
- 충분한 해상도
- 심한 모션 블러 없음
- 오선이 그림자에 가려지지 않음
- 원근 보정 가능한 촬영 각도

## 5. 품질 검사

```text
BLUR_TOO_HIGH
PAGE_CROPPED
LOW_CONTRAST
STRONG_SHADOW
PERSPECTIVE_TOO_HIGH
RESOLUTION_TOO_LOW
NO_STAFF_FOUND
DEVICE_TOO_SLOW
STORAGE_QUOTA_LOW
```

사용자 메시지 예:

```text
오른쪽 아래 악보가 잘렸습니다.
그림자가 강해 일부 음표를 인식하지 못할 수 있습니다.
이미지가 흐립니다. 다시 촬영해 주세요.
이 기기에서는 자동 인식이 느릴 수 있습니다. 페이지별 순차 처리 또는 수동 입력을 권장합니다.
브라우저 저장 공간이 부족해 모델 또는 원본 파일을 저장하지 못했습니다.
```

경고를 무시하고 진행 가능한 경우와 재촬영 필수 경우를 구분한다.

## 6. 전처리

- PDF.js page rendering
- Canvas 또는 OpenCV.js 기반 문서 경계 검출
- 원근 보정
- 회전 보정
- 색상/그레이스케일 정규화
- 그림자 완화
- 대비 보정
- 필요 시 이진화
- 페이지 방향 판별

원본 이미지는 보존한다. 전처리 결과로 원본을 덮어쓰지 않는다.

## 7. 메모리 규칙

- 전체 PDF를 한 번에 rasterize하지 않는다.
- 현재 처리 중인 페이지 하나만 고해상도로 유지한다.
- 시스템, 오선, 마디 단위 crop으로 처리한다.
- crop 처리 후 ImageBitmap과 Tensor를 명시적으로 해제한다.
- Worker 통신 시 가능한 경우 transferable 객체를 사용한다.
- 저사양 기기에서는 페이지별 순차 처리한다.
- 최초 모델 다운로드 진행률을 보여준다.
- 모델 파일은 Cache Storage에 저장한다.
- 모델 hash 변경 시 캐시를 갱신한다.
- 모델 파일이 손상되면 삭제 후 재다운로드한다.

> 관련 문서: [12-MODEL-DELIVERY-SPEC.md](./12-MODEL-DELIVERY-SPEC.md)

## 8. 영역 분할

전체 페이지를 고정 크기로 축소해 한 번에 인식하지 않는다.

```text
Page
→ System
→ Staff
→ Measure
```

예시 출력:

```json
{
  "systems": [
    {
      "boundingBox": {},
      "staves": [
        {
          "staffLines": [],
          "measures": []
        }
      ]
    }
  ]
}
```

## 9. 인식 대상

### 음악 기호

- treble clef
- bass clef(확장)
- filled/empty notehead
- stem
- beam
- flag
- rests
- dot
- sharp/flat/natural
- barline/double/final barline
- time signature
- key signature
- tie/slur candidate
- fermata(확장)

### 반복·이동 기호

- repeat start/end
- ending bracket와 번호
- Segno
- Coda
- Fine
- D.C.
- D.S.
- To Coda
- al Fine
- al Coda

텍스트 OCR과 심볼 검출 결과를 함께 사용한다. 브라우저 OCR 전략은 Phase에서 검증 후 결정한다.

### 코드

우선 지원 패턴:

```text
A B C D E F G
♭ ♯ b #
m min maj M
7 maj7 m7
sus2 sus4
add9
dim aug
/
()
```

parse 실패 시에도 `rawText`를 보존한다.

### 한글 가사

- 한글 음절 OCR
- 공백과 하이픈
- 여러 절 번호
- 음표와 음절 연결
- melisma 연장선

텍스트 정확도와 음표 연결 정확도를 별도로 평가한다.

## 10. 모델 분리

```text
Model A: System / Staff / Measure Detector
Model B: Music Symbol Detector
Model C: Optional Sequence Recognizer
Browser OCR or rule-assisted OCR: Chords and Lyrics
TypeScript Rules: Pitch, Duration, Structure, Navigation
```

하나의 거대 모델보다 작은 모델과 규칙 기반 조립을 사용한다.

## 11. ONNX 배포

```text
PyTorch
→ ONNX export
→ ONNX validation
→ quantization or optimization
→ model manifest
→ ONNX Runtime Web
   ├─ WebGPU
   └─ WASM fallback
```

학습은 브라우저가 아닌 Windows 또는 WSL2의 Python/PyTorch 환경에서 수행한다.

최적화 후보:

- FP16 또는 INT8 quantization
- 마디 단위 crop
- batch size 1
- 모델 lazy loading
- 미사용 session 해제
- WebGPU 미지원 시 WASM fallback

> 관련 문서: [10-WEB-CAPABILITY-MATRIX.md](./10-WEB-CAPABILITY-MATRIX.md)

결과에 버전을 저장한다.

```text
modelVersion
layoutModelVersion
symbolModelVersion
ocrConfigurationVersion
assemblerVersion
```

## 12. 모델 크기 목표

아래 값은 확정된 제약이 아니라 제품 목표다.

- layout model: 약 5~20MB 목표
- symbol model: 약 15~50MB 목표
- 전체 초기 다운로드: 가급적 100MB 이하 목표

정확도와 속도, 브라우저 캐시 안정성 검증 결과에 따라 조정한다.

## 13. 구조 조립

AI는 기호 후보와 위치를 반환하고 TypeScript 규칙 엔진이 다음을 처리한다.

- 오선 위치에 따른 음높이
- notehead와 stem 결합
- beam과 음가
- 점음표
- 임시표·조표 적용 범위
- 마디 내 onset
- voice 분리
- tie/slur 후보 검증
- 가사와 음표 연결
- 코드의 마디/박자 위치
- 반복·이동 기호 연결

## 14. 결과 모델

```ts
export interface RecognitionResult {
  scoreVersion: ScoreVersion;
  pageResults: PageRecognitionResult[];
  reviewItems: RecognitionReviewItem[];
  warnings: RecognitionWarning[];
  modelVersions: ModelVersions;
}
```

저신뢰 항목:

```json
{
  "id": "uuid",
  "type": "LOW_CONFIDENCE_NOTE_DURATION",
  "measureId": "uuid",
  "elementId": "uuid",
  "confidence": 0.54,
  "candidateValues": ["quarter", "eighth"],
  "sourceAnchor": {}
}
```

## 15. 검수 화면

- 저신뢰 마디 목록
- 원본 crop과 변환 악보 비교
- 후보 값 선택
- 코드·가사 직접 수정
- 반복기호 위치 수정
- “나중에 확인”
- 검수 완료 상태

## 16. 구현 단계

### Phase 1 Mock

샘플 MusicXML을 반환하는 `MockOMRService`.

### Phase 2 Import-only

MusicXML import. 이미지/PDF는 원본으로만 저장.

### Phase 3 Layout

PDF.js, 이미지 import, Canvas/OpenCV.js 전처리, 페이지, 시스템, 오선, 마디 검출.

### Phase 4 Symbol

ONNX Runtime Web adapter, 음표, 쉼표, 마디선, 조표, 박자표.

### Phase 5 Text/Navigation

코드, 한글 가사, D.C./D.S./Coda, 반복 구조.

## 17. 데이터셋 전략

### 공개 데이터

기본 악보 기호 pretraining에 사용한다. 라이선스를 확인하지 않은 데이터셋은 배포 모델 학습에 사용하지 않는다.

### 자체 합성 데이터

```text
MusicXML template
→ 다양한 리듬·코드·한글 가사
→ 악보 렌더링
→ 원근/흐림/그림자/노이즈 증강
→ MusicXML을 정답으로 사용
```

변수:

- 기보 폰트
- 오선 크기
- 마디 폭
- 코드 위치
- 가사 간격
- 조표·박자표
- 카메라 원근
- 종이 휘어짐 근사
- 그림자
- 모션 블러
- JPEG 압축

### 실제 데이터

사용 권한이 확보된 악보와 직접 제작한 악보만 사용한다.

## 18. 라벨

```text
Page
- systems
- staves
- measures
- symbols
- text regions
- relationships
- MusicXML target
```

관계:

- notehead ↔ stem
- note ↔ lyric
- accidental ↔ note
- beam ↔ notes
- ending bracket ↔ measures
- D.S. ↔ Segno
- To Coda ↔ Coda

## 19. 평가

### 레이아웃

- 시스템·오선·마디 검출

### 기호

- 클래스별 precision/recall
- 작은 기호 정확도
- 조표/임시표 혼동률

### 구조

- 음높이 정확도
- 음가 정확도
- 마디 리듬 합 검증
- MusicXML 유효성
- 반복 펼치기 성공률

### 텍스트

- 코드 exact match
- 코드 parser 성공률
- 한글 가사 문자 오류율
- 음절-음표 연결 정확도

### 웹 앱

- 페이지당 추론 시간
- Peak memory
- 모델 다운로드 시간
- 모델 캐시 재사용률
- WebGPU 성공률
- WASM fallback 성공률
- 브라우저별 실패율

## 20. MVP 성공 기준

- 예시와 유사한 깨끗한 단선율 악보 처리
- 오선과 마디 분리
- 기본 음표·쉼표 구조화
- 코드·한글 가사를 수정 가능한 텍스트로 표시
- 도돌이표를 인식하거나 쉽게 수정
- 실패한 마디를 검수 항목으로 표시
- 모델 다운로드 이후 네트워크 없이 동작

> 관련 문서: [11-PWA-OFFLINE-SPEC.md](./11-PWA-OFFLINE-SPEC.md)

## 21. 금지 사항

- 저신뢰 결과를 확정값처럼 처리하지 않는다.
- 모델 출력만으로 임시표 범위와 박자를 결정하지 않는다.
- 전체 페이지를 무조건 작은 고정 입력으로 축소하지 않는다.
- 전체 PDF를 한 번에 고해상도로 rasterize하지 않는다.
- 원본 이미지를 전처리 결과로 덮어쓰지 않는다.
- 동의 없이 원본 악보를 서버로 자동 업로드하지 않는다.
- 브라우저 UI 메인 스레드에서 무거운 추론을 실행하지 않는다.
- 브라우저에서 모델을 학습한다고 설명하지 않는다.
- 데이터셋과 모델 라이선스를 확인하지 않고 배포하지 않는다.

## Phase 8 Runtime Boundary

Phase 8 implements browser OMR runtime infrastructure only.

- The model input unit is a reviewed SYSTEM crop from the Phase 7 OMR preparation manifest.
- The checked-in ONNX model is `TEST_RUNTIME_MODEL` and exists only to verify `InferenceSession`, tensor transfer, output reception, worker protocol, cache/hash, fallback, cancellation, and stale-result handling.
- When no evaluated product model is installed, UI must show `PRODUCT_MODEL_NOT_INSTALLED`.
- Test model output must not be converted into notes, rests, pitch, duration, structure assembly, MusicXML, or Phase 6 editor handoff.
- Product layout/symbol model development is Phase 9.
- Structure assembly and MusicXML draft generation are Phase 10.

## Phase 9 Dataset And Experimental Model Boundary

Phase 9 adds dataset and model-development infrastructure without claiming product OMR accuracy.

- Class taxonomy is split into `LAYOUT_DETECTION` and `SYMBOL_DETECTION`.
- Source annotations use pixel `x/y/width/height`; exported browser detections use normalized system coordinates.
- `UNKNOWN` or unverified licenses are excluded from training by default.
- Train/validation/test split is source-group based, not page-random.
- Synthetic and real data are reported separately.
- `layout-smoke.onnx` and `symbol-smoke.onnx` are `EXPERIMENTAL` smoke models generated from copyright-safe fixtures.
- Browser runtime verifies manifest parsing, SHA-256, Cache Storage reuse, ONNX Runtime Web execution, output decoding, coordinate mapping, and overlay rendering.
- Product candidates remain `NOT READY` until real licensed data, fixed test-split metrics, per-class reports, WebGPU/WASM verification, reproducible training config, and checkpoint preservation exist.

Phase 9 still does not implement pitch inference, duration inference, notehead/stem structure assembly, `EditableScoreDocument`, MusicXML draft generation, or Phase 6 editor handoff.

### Phase 9M-O 브라우저 검수 화면 사용법

OMR runtime/review/evaluation 화면은 제품용 자동 변환 화면이 아니라 실험 모델 결과를 검수하고 평가 기록을 남기는 화면이다.

- 사용자는 평가 샘플 또는 가져온 이미지를 선택한다.
- 모델 ID, 모델 버전, 모델 status는 내부 식별자이므로 원문을 유지한다.
- 화면의 안내 문구, 버튼, 검출 목록, 수정 레이어, 수동 평가 리포트는 한국어로 표시한다.
- 기호 class id는 저장값과 JSON에서는 영어 내부값을 유지하고, 화면에는 한국어 표시명을 함께 제공한다.
- 검수 JSON과 수동 평가 리포트 JSON의 `kind`, schema key, model id, class id는 변경하지 않는다.
- 수동 평가 리포트는 fixture/run별 검출 수, 기호별 수, 평균 신뢰도, 삭제/수정/추가 수, 검수 메모, 알려진 실패 유형을 기록한다.
- 이 화면은 pitch/duration 추론, 구조 조립, MusicXML 생성, ScoreVersion publish를 수행하지 않는다.

## Phase 9E-H Colab Model Pipeline

Phase 9E-H prepares real training outside the browser and outside the local RX 580 GPU.

- Training target: Google Colab GPU.
- Local target: validation, smoke/static checks, artifact validation, and browser inference.
- Primary external dataset path: DeepScoresV2 dense from the official Zenodo record, starting with a small dense/source-group subset rather than the full dataset.
- DeepScoresV2 is synthetic/engraved data, not real camera/photo data; scan/photo performance must remain limited or unknown until separately evaluated.
- Google Drive is assumed to have 14GB default capacity. Training must not start when less than 3GB is free.
- Drive permanently stores only dataset manifests/license evidence, the minimum converted subset, last checkpoint, best checkpoint, at most one recent epoch checkpoint, evaluation reports, ONNX/model manifest, and final artifact zip.
- Raw archives, extracted temporary files, training cache, and run directories are Colab `/content` scratch data and should be deleted after successful stages.
- Checkpoint writes must preserve last/best weights and metadata, retain only the configured recent checkpoint, and avoid treating incompatible config/dataset/taxonomy as resumable.
- Actual trained ONNX models use distinct model IDs such as `cuenote-layout-deepscores-exp` and `cuenote-symbol-deepscores-exp`.
- YOLOv8 raw ONNX outputs are decoded separately from the Phase 9 smoke `BOX_XYWH_CONF_CLASS` models.
- Candidate promotion requires actual Colab metrics, ONNX parity, browser runtime validation, and failure analysis.

### Phase 9I Symbol Coverage

Phase 9I expands the DeepScoresV2 dense symbol detector coverage before additional Colab training.

Safe detector-only classes:

- `beam`
- `ledger.line`
- `dot.repeat`
- `rest.16th`, `rest.32nd`, `rest.64th`
- `flag.eighth.up`, `flag.eighth.down`
- `notehead.whole`
- `time_signature.digit_4`
- `time_signature.common`

These classes may be detected as isolated glyph regions. They must not be interpreted as durations, pitches, repeat semantics, or MusicXML structure during Phase 9.

Still excluded:

- generic `time_signature`
- generic `key_signature`
- directionless flag classes

Those require text/structure interpretation or missing direction information and remain out of scope until a later phase.

### Phase 9I Tiny-Overfit Diagnostic

`SYMBOL_OVERFIT` is a diagnostic run mode for symbol models whose confidence remains near initialization level after normal smoke-training.

Policy:

- Use one or two existing `deepscoresv2-dense-symbol` train images.
- Use batch size 1, image size 1280, 100 epochs, pretrained YOLO weights, and disabled early stopping.
- Keep plots disabled, but save prediction overlays for the selected train images.
- Record train label count, bad label count, class count, train mAP50, max confidence, and prediction counts at confidence thresholds `0.001`, `0.01`, and `0.05`.
- Mark any resulting artifact as `EXPERIMENTAL` with diagnostic metadata only.
- If tiny-overfit fails, do not repeat full `SYMBOL_TRAIN` until the training/data path is fixed.

This mode does not add Phase 10 structure assembly, pitch/duration inference, or MusicXML generation.

### Phase 9J Tile/Crop Overfit Diagnostic

`SYMBOL_TILE_OVERFIT` diagnoses whether full-page resizing makes symbol objects too small or too dense for the detector to learn.

Policy:

- Use one or two existing `deepscoresv2-dense-symbol` train images.
- Generate object-containing crop/tile images from YOLO labels.
- Recalculate every included bbox into crop-relative YOLO coordinates.
- Supported crop sizes are `512`, `768`, and `1024`; default crop size is `768`.
- Supported overlap is 20-30%; default overlap is 25%.
- Keep 10-50 non-empty crops by default.
- Skip empty crops unless explicitly configured otherwise.
- Drop crop-relative boxes that are outside the crop or smaller than the configured minimum pixel size.
- Validate every output label coordinate is within `0..1`.
- Train with batch size 2 or 4, image size equal to the crop size by default, 100 epochs, pretrained weights, disabled early stopping, and plots disabled.
- Save label overlays and prediction overlays in crop coordinates.
- Record crop image count, crop label count, empty crop count, bad label count, train mAP50, max confidence, and prediction counts at confidence thresholds `0.001`, `0.01`, and `0.05`.

If tile/crop overfit fails, full `SYMBOL_TRAIN` must not be repeated until the crop/data/training path is fixed.

### Phase 9K Tile-Based Symbol Training

`SYMBOL_TILE_TRAIN` is the recommended experimental training path for the symbol detector after tile overfit confirmed that full-page symbol detection is unsuitable.

Policy:

- Build `deepscoresv2-dense-symbol-tile` from `deepscoresv2-dense-symbol`.
- Preserve source-group train/validation/test splits before generating tiles.
- Generate crop-relative YOLO labels with the same clipping and small-box policy as `SYMBOL_TILE_OVERFIT`.
- Default crop size is `768`, overlap is `0.25`, and empty crops are skipped.
- Record dropped small boxes, dropped outside boxes, empty crops, crop image count, and label count.
- Evaluate against tile validation/test splits and label reports as tile-based metrics.
- Keep model status `EXPERIMENTAL`; do not promote to `CANDIDATE` or `PRODUCT`.

The full-page `SYMBOL_TRAIN` path remains available only as a deprecated diagnostic baseline. Phase 8 runtime does not yet perform complete tile inference orchestration/stitching, so Phase 10 structure assembly, pitch/duration inference, and MusicXML generation remain `NOT READY`.
