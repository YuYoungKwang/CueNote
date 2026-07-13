# 03. 도메인 모델

## 1. 원칙

1. 원본 악보와 편곡 버전을 분리한다.
2. 원본 마디와 실제 연주 occurrence를 분리한다.
3. 악보 편집과 자유 필기를 분리한다.
4. 합주 위치는 `performanceMeasureId + beat`로 표현한다.
5. 화면 좌표는 마디/음표 기준 상대 좌표로 저장한다.
6. OMR 신뢰도와 원본 이미지 위치를 보존한다.
7. ID는 클라이언트에서도 생성 가능한 UUID 문자열을 사용한다.
8. 도메인 모델은 Web PWA, Backend, 향후 네이티브 앱에서 재사용 가능한 플랫폼 독립 구조를 우선한다.

## 2. Aggregate

```text
User
Score
├─ ScoreSource
└─ ScoreVersion
   ├─ ScorePart
   │  └─ Measure
   │     ├─ Voice
   │     │  └─ MusicalElement
   │     ├─ NavigationMark
   │     ├─ ChordSymbol
   │     └─ Lyric
   ├─ PerformanceOrder
   └─ Annotation

Ensemble
└─ EnsembleMember

RehearsalSession
├─ SessionParticipant
└─ PlaybackState
```

## 3. 공통 타입

```ts
export type ScoreID = string;
export type ScoreVersionID = string;
export type MeasureID = string;
export type MusicalElementID = string;
export type PerformanceMeasureID = string;
export type AnnotationID = string;
export type SessionID = string;
export type DeviceID = string;

export interface Rational {
  numerator: number;
  denominator: number;
}
```

음가·박자 계산에는 가능한 범위에서 유리수를 사용한다.

## 4. Score

```text
Score
- id
- ownerId
- title
- composer
- lyricist
- defaultTempo
- visibility
- currentVersionId
- thumbnailObjectKey
- clientSchemaVersion
- lastModifiedByDeviceId
- createdAt
- updatedAt
```

실제 음표 내용은 `ScoreVersion`에 저장한다.

## 5. ScoreSource

```text
ScoreSource
- id
- scoreId
- sourceType: IMAGE | PDF | MUSICXML | MANUAL
- objectKey
- localBlobKey
- localFileHash
- pageCount
- importedAt
- omrStatus
- modelVersion
```

페이지 정보:

```text
ScoreSourcePage
- id
- sourceId
- pageNumber
- width
- height
- rotation
- cropMetadata
- objectKey
- localBlobKey
```

원본 파일은 서버 객체 저장소에 업로드될 수도 있고, 오프라인 작업 중에는 브라우저 IndexedDB Blob 또는 OPFS 후보 저장소에만 존재할 수도 있다.

## 6. ScoreVersion

```text
ScoreVersion
- id
- scoreId
- parentVersionId
- versionNumber
- name
- changeSummary
- createdBy
- createdAt
- status: DRAFT | PUBLISHED | ARCHIVED
- source: OMR | IMPORT | EDIT | FORK
- revision
- clientSchemaVersion
- rendererVersion
- modelVersion
- lastModifiedByDeviceId
```

편집 시 기존 버전을 덮어쓰기보다 새 버전을 생성하는 방식을 기본으로 한다.

## 7. ScorePart

```text
ScorePart
- id
- scoreVersionId
- name
- abbreviation
- instrument
- transposition
- orderIndex
```

MVP는 단일 파트 중심이지만 확장을 위해 Part를 유지한다.

## 8. Measure

```ts
export interface Measure {
  id: MeasureID;
  sourceNumber: number;
  displayNumber?: string;
  timeSignature: TimeSignature;
  keySignature?: KeySignature;
  divisions: number;
  voices: Voice[];
  chordSymbols: ChordSymbol[];
  lyrics: Lyric[];
  navigationMarks: NavigationMark[];
  sourceAnchor?: SourceAnchor;
}
```

## 9. MusicalElement

```ts
export interface Voice {
  id: string;
  index: number;
  elements: MusicalElement[];
}

export type MusicalElement =
  | { kind: "NOTE"; note: Note }
  | { kind: "REST"; rest: Rest }
  | { kind: "DIRECTION"; direction: Direction };
```

### Note

```text
- id
- pitch
- writtenDuration
- soundingDuration
- onset
- dots
- accidental
- tieStart/tieStop
- slurIds
- articulations
- lyricRefs
- confidence
- sourceAnchor
```

### Pitch

```ts
export interface Pitch {
  step: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  alter: number;
  octave: number;
}
```

## 10. ChordSymbol

```text
- id
- measureId
- onset
- rootStep/rootAlter
- quality
- extensions
- bassStep/bassAlter
- rawText
- confidence
- sourceAnchor
```

예시:

```json
{
  "rootStep": "A",
  "rootAlter": -1,
  "quality": "major",
  "bassStep": "C",
  "bassAlter": 0,
  "rawText": "A♭/C"
}
```

## 11. Lyric

```text
- id
- noteId
- measureId
- verseNumber
- text
- syllabic: SINGLE | BEGIN | MIDDLE | END
- extend
- confidence
- sourceAnchor
```

음표 연결이 불확실하면 마디 단위 후보로 보관하고 검수 화면에서 수정한다.

## 12. NavigationMark

```ts
export type NavigationMarkType =
  | "REPEAT_START"
  | "REPEAT_END"
  | "ENDING_START"
  | "ENDING_STOP"
  | "DA_CAPO"
  | "DAL_SEGNO"
  | "SEGNO"
  | "CODA"
  | "TO_CODA"
  | "FINE";

export interface NavigationMark {
  id: string;
  type: NavigationMarkType;
  measureId: MeasureID;
  endingNumbers?: number[];
  repeatTimes?: number;
  label?: string;
  confidence?: number;
}
```

## 13. PerformanceOrder

```ts
export interface PerformanceOrder {
  measures: PerformanceMeasure[];
  warnings: NavigationWarning[];
}

export interface PerformanceMeasure {
  id: PerformanceMeasureID;
  sourceMeasureId: MeasureID;
  occurrence: number;
  orderIndex: number;
}
```

같은 원본 마디가 두 번 등장해도 `PerformanceMeasure.id`는 달라야 한다.

```json
[
  {"id":"pm-1","sourceMeasureId":"m1","occurrence":1,"orderIndex":0},
  {"id":"pm-2","sourceMeasureId":"m2","occurrence":1,"orderIndex":1},
  {"id":"pm-3","sourceMeasureId":"m1","occurrence":2,"orderIndex":2}
]
```

## 14. 반복 해석 상태

```text
ExpansionState
- currentSourceMeasureId
- visitCounts
- repeatStack
- currentPass
- daCapoExecuted
- dalSegnoExecuted
- codaArmed
- codaJumpExecuted
- terminated
```

안전 제한:

- 생성 마디 수 상한
- 동일 상태 재방문 상한
- D.C./D.S. 실행 횟수 상한
- 대상 기호 누락 시 warning
- 비정상 종료 시 부분 결과 반환

## 15. Annotation

```text
Annotation
- id
- scoreVersionId
- authorId
- scope: PRIVATE | PART | ENSEMBLE
- targetPartId
- type: STROKE | HIGHLIGHT | TEXT | SHAPE | SYMBOL
- anchor
- payload
- createdAt
- updatedAt
- deletedAt
- lastModifiedByDeviceId
```

Anchor:

```ts
export type AnnotationAnchor =
  | {
      kind: "MEASURE";
      measureId: MeasureID;
      relativeRect: RelativeRect;
    }
  | {
      kind: "ELEMENT";
      elementId: MusicalElementID;
      offset: RelativePoint;
    }
  | {
      kind: "PERFORMANCE_MEASURE";
      performanceMeasureId: PerformanceMeasureID;
      relativeRect: RelativeRect;
    };
```

특정 반복 occurrence에서만 보이는 메모도 지원할 수 있다.

## 16. 플랫폼 중립 필기 데이터

필기 데이터는 특정 플랫폼의 drawing 객체를 저장하지 않는다. Canvas + Pointer Events, 향후 다른 클라이언트 모두에서 해석 가능한 stroke 데이터로 저장한다.

```ts
export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
  timestamp: number;
}

export interface Stroke {
  id: string;
  tool: "PEN" | "HIGHLIGHTER" | "ERASER";
  points: StrokePoint[];
  width: number;
  color?: string;
  opacity: number;
}

export interface StrokePayload {
  strokes: Stroke[];
  coordinateSpace: "ANCHOR_RELATIVE";
  rendererVersion?: string;
}
```

- `x`, `y`는 anchor 기준 상대 좌표다.
- pressure가 없는 입력은 필드를 생략하거나 기본값으로 처리한다.
- 화면 절대 픽셀만 저장하지 않는다.

## 17. Ensemble

```text
Ensemble
- id
- ownerId
- name
- createdAt

EnsembleMember
- ensembleId
- userId
- role: OWNER | LEADER | MEMBER
- partId
- joinedAt
```

## 18. ScorePermission

```text
- scoreId
- userId 또는 ensembleId
- role: OWNER | EDITOR | VIEWER
- grantedBy
- grantedAt
```

## 19. RehearsalSession

```text
- id
- ensembleId
- scoreId
- scoreVersionId
- leaderUserId
- joinCode
- status: WAITING | COUNT_IN | PLAYING | PAUSED | ENDED
- createdAt/startedAt/endedAt
```

세션 도중 `scoreVersionId`는 고정한다.

## 20. PlaybackState

```ts
export interface PlaybackState {
  status: PlaybackStatus;
  performanceMeasureId: PerformanceMeasureID;
  beat: Rational;
  bpm: number;
  targetTimestamp?: number;
  sequence: number;
  leaderUserId: string;
}
```

## 21. SourceAnchor

```text
- sourcePageId
- normalizedBoundingBox
- systemIndex
- staffIndex
- measureCandidateIndex
- modelVersion
```

좌표는 0~1 정규화 값으로 저장한다.

## 22. 클라이언트 저장 전략

IndexedDB:

- 악보 메타데이터
- 구조화 악보 문서
- 편곡 버전
- PerformanceOrder
- 개인 필기와 메모
- 동기화 큐
- 최근 합주 상태
- local schema metadata

Cache Storage:

- 앱 셸
- 렌더러 asset
- ONNX 모델 파일

OPFS 또는 IndexedDB Blob:

- 원본 PDF
- 고해상도 이미지
- MusicXML export

## 23. 서버 저장 전략

정규화:

```text
users
auth_accounts
scores
score_sources
score_source_pages
score_versions
annotations
ensembles
ensemble_members
score_permissions
rehearsal_sessions
session_participants
session_events
object_files
model_manifests
```

JSONB:

- 버전별 전체 악보 문서
- PerformanceOrder
- OMR confidence detail
- Annotation payload

MVP에서는 음표마다 테이블을 과도하게 분리하지 않는다.

## 24. 동시 편집

MVP는 실시간 공동 음표 편집을 지원하지 않는다.

- 한 사용자가 편집 잠금 또는 revision을 사용
- 저장 시 `baseVersionId/revision` 검사
- 충돌 시 새 분기 버전 생성 안내
- 필기 메모는 객체 단위 병합
- `lastModifiedByDeviceId`로 오프라인 동기화 출처를 추적

## 25. 삭제

- 악보와 버전은 soft delete
- 객체 파일은 보존 기간 후 비동기 삭제
- 계정 삭제 시 소유 데이터와 공유 데이터 규칙 분리
- 로그아웃 시 브라우저 로컬 데이터 삭제 여부를 사용자에게 명확히 안내

## Phase 5 Rehearsal Domain

`RehearsalSession` contains `id`, `ensembleId`, `scoreId`, `scoreVersionId`, `leaderUserId`, `status`, `createdBy`, `createdAt`, `startedAt`, `endedAt`, and `revision`.

`RehearsalParticipant` contains `sessionId`, `userId`, `joinedAt`, `lastSeenAt`, `connectionState`, and `followMode`.

`AuthoritativePlaybackState` contains `sessionId`, `scoreId`, `scoreVersionId`, `leaderUserId`, `playbackStatus`, `performanceMeasureId`, `sourceMeasureId`, `occurrence`, `beat`, `bpm`, `countInMeasures`, `baseTimelinePositionMs`, `sequence`, `serverTimestamp`, `effectiveAtServerTime`, and `updatedByUserId`.

Participants can be `FOLLOWING_LEADER` or `BROWSING_INDEPENDENTLY`. Independent browsing never changes the authoritative playback state.

## Phase 6 Editable Score Domain

`EditableScoreDocument` contains `scoreId`, `baseScoreVersionId`, `title`, `parts`, `revision`, `dirty`, and `validationIssues`.

`EditablePart` contains stable part identity and ordered `EditableMeasure` records.

`EditableMeasure` contains stable measure identity, inherited attributes, note/rest events, chord symbols, lyrics, and navigation marks.

`EditableEvent` is either `NOTE` with `Pitch`, `DurationValue`, voice/staff, tie, and lyric references, or `REST` with `DurationValue`.

`EditCommand` is the only mutation surface for Phase 6 editing. The command reducer supports pitch, duration, chord, lyric, measure insert/delete/duplicate, range transpose, undo, and redo.

Validation issues carry `code`, `severity`, `message`, optional part/measure/event IDs, and `blocking`. Blocking issues prevent publish.

Annotation migration is explicit. The implemented safe policy migrates only `MEASURE` anchors and skips element/performance-measure anchors by default.
