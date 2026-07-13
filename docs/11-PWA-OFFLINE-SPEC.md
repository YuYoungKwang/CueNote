# 11. PWA 오프라인 사양

## 1. 목표

CueNote Web PWA는 네트워크가 없어도 기존 악보 열람, 개인 연습, 필기, 제한적 편집을 수행할 수 있어야 한다. 온라인 복귀 후 서버와 동기화 가능한 변경 사항은 큐로 처리한다.

## 2. 저장소 역할

### Service Worker

- 앱 셸 캐시
- offline fallback
- 정적 asset 캐시
- 앱 업데이트 감지
- 네트워크 실패 시 기존 캐시 사용

### IndexedDB

- 악보 메타데이터
- 구조화 악보 문서
- 편곡 버전
- PerformanceOrder
- 필기와 텍스트 메모
- 동기화 큐
- 최근 열람 상태
- local schema version

### Cache Storage

- JavaScript, CSS, HTML 앱 셸
- 렌더러 asset
- ONNX 모델 파일
- 모델 manifest snapshot

### OPFS 후보

- 원본 PDF
- 고해상도 이미지
- 큰 MusicXML export

OPFS 지원 여부는 브라우저별 검증이 필요하다. 지원하지 않거나 quota 정책이 불안정하면 IndexedDB Blob fallback을 사용한다.

## 3. 앱 셸 캐시

앱 셸은 최소한 다음을 포함한다.

- 기본 HTML
- JavaScript bundle
- CSS
- PWA manifest
- 아이콘
- offline fallback 화면

앱 셸이 캐시된 이후에는 네트워크가 없어도 앱이 시작되어야 한다.

## 4. 모델 캐시

- 모델은 `docs/12-MODEL-DELIVERY-SPEC.md`의 manifest 기준으로 다운로드한다.
- 모델 파일은 Cache Storage에 저장한다.
- `sha256`이 변경되지 않으면 재다운로드하지 않는다.
- hash 검증 실패 또는 파일 손상 시 캐시를 삭제하고 다시 다운로드한다.
- 사용자는 최초 모델 다운로드 진행률을 볼 수 있어야 한다.

## 5. 오프라인 악보 열람

오프라인에서 열 수 있는 항목:

- IndexedDB에 저장된 구조화 악보
- 캐시된 렌더러 asset
- 로컬에 저장된 원본 PDF/이미지
- 캐시된 모델이 있는 경우 로컬 재분석 후보

네트워크가 필요한 항목:

- 서버에만 있는 악보 다운로드
- 새 모델 다운로드
- 공유 권한 갱신
- 합주 세션 참가

## 6. 오프라인 편집

오프라인에서 가능한 작업:

- 개인 필기
- 텍스트 메모
- 제한적 편곡 버전 생성
- 코드/가사 수정
- 로컬 PlaybackTimeline 계산

오프라인 변경은 sync operation으로 기록한다.

```json
{
  "operationId": "client-uuid",
  "deviceId": "device-uuid",
  "type": "UPSERT_ANNOTATION",
  "targetId": "annotation-id",
  "baseRevision": 3,
  "payload": {}
}
```

## 7. 동기화 큐

동기화 큐는 IndexedDB에 저장한다.

Phase 4 구현 store:

- DB: `cuenote`
- version: `3`
- annotation data store: `annotations`
- sync queue store: `annotation_sync_queue`

Annotation queue record는 `clientMutationId`, `scoreId`, `scoreVersionId`, `annotationId`, `action`, `baseRevision`, `annotation`, `status`, `attempts`, `lastError`를 가진다.

처리 원칙:

- `clientMutationId` 기준 idempotent
- 생성 순서 보존
- 실패 시 재시도
- 권한 오류는 사용자에게 표시
- revision 충돌은 자동 덮어쓰지 않음
- 네트워크 복귀 시 pull 후 push

## 8. 충돌 처리

충돌 유형:

- ScoreVersion revision 충돌
- 삭제된 악보에 대한 편집
- 권한 변경
- 같은 메모 객체의 동시 수정

처리:

- 구조 편집 충돌은 새 분기 버전 생성 안내
- 필기와 메모는 객체 단위 병합 가능성을 우선 검토
- 자동 병합이 불확실하면 사용자 선택을 받는다.

## 9. 앱 업데이트 전략

- Service Worker가 새 버전을 감지한다.
- 새 앱 셸은 background에서 설치한다.
- 사용 중인 악보 작업을 잃지 않도록 즉시 강제 새로고침하지 않는다.
- 업데이트 적용 전 동기화 큐와 로컬 저장 상태를 확인한다.
- breaking schema 변경은 migration 성공 후 활성화한다.

## 10. 오래된 캐시 제거

제거 대상:

- 이전 앱 셸 cache
- 사용하지 않는 렌더러 asset
- manifest에서 제거된 모델 파일
- 오래된 임시 crop 이미지
- 실패한 다운로드 잔여물

제거 전 사용자 데이터와 모델 파일을 혼동하지 않는다.

## 11. 저장 공간 부족

저장 공간 부족 시:

- `navigator.storage.estimate()` 결과를 참고한다.
- 사용자에게 원본 파일, 오래된 모델, 캐시 정리를 안내한다.
- 필수 사용자 데이터는 자동 삭제하지 않는다.
- 모델 다운로드 중 공간 부족이 발생하면 다운로드를 중단하고 재시도 방법을 제공한다.

## 12. 사용자 데이터 내보내기

지원 후보:

- 악보 구조 JSON export
- MusicXML export
- 메모/필기 JSON export
- 원본 PDF/image export

내보내기는 브라우저 File System Access API 사용 가능 여부에 따라 UX가 달라질 수 있다. 지원 여부는 검증 후 결정한다.

## 13. 로그아웃 시 데이터 처리

로그아웃 시 사용자가 선택할 수 있어야 한다.

- 이 기기의 로컬 데이터 유지
- 이 기기의 로컬 데이터 삭제

공유 또는 팀 데이터는 서버 권한 정책에 따르며, 로컬 삭제가 서버 삭제를 의미하지 않는다는 점을 안내한다.

## 14. 보안 주의

- token을 로그에 남기지 않는다.
- 민감한 인증 정보는 장기 저장하지 않는다.
- 로컬 저장소는 사용자가 같은 브라우저 프로필에서 접근할 수 있음을 전제로 안내한다.
- 공용 기기에서는 로그아웃 시 로컬 데이터 삭제를 권장한다.
