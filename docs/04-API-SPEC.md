# 04. REST API 사양

## 1. 공통 규칙

- Base URL: `/api/v1`
- Content-Type: `application/json`
- 인증: Bearer access token
- 시간: ISO 8601 UTC
- ID: UUID 문자열
- 페이지네이션: cursor 방식
- 대용량 파일은 presigned URL로 전송
- 오류 응답은 공통 형식 사용

### 성공 응답

```json
{
  "data": {},
  "meta": {
    "requestId": "req_123"
  }
}
```

### 오류 응답

```json
{
  "error": {
    "code": "SCORE_VERSION_CONFLICT",
    "message": "현재 악보 버전이 변경되었습니다.",
    "details": {
      "expectedRevision": 3,
      "actualRevision": 4
    }
  },
  "meta": {
    "requestId": "req_123"
  }
}
```

## 2. 인증

인증 provider는 특정 서비스로 고정하지 않는다. 후보는 `APPLE`, `GOOGLE`, `EMAIL_MAGIC_LINK`이며, 실제 구현 provider와 우선순위는 해당 Phase에서 결정한다.

Phase 4 구현은 production provider가 아니라 개발·테스트용 endpoint를 사용한다.

### POST `/dev-auth/login`

개발 환경에서만 사용하는 로그인이다. 사용자를 생성하거나 재사용하고 opaque access/refresh token을 반환한다. token은 서버 DB에 hash로 저장한다.

```json
{
  "email": "phase4@cuenote.local",
  "displayName": "Phase 4 Tester"
}
```

Response:

```json
{
  "data": {
    "user": {
      "id": "usr_xxx",
      "email": "phase4@cuenote.local",
      "displayName": "Phase 4 Tester"
    },
    "accessToken": "ct_access_xxx",
    "refreshToken": "ct_refresh_xxx",
    "accessTokenExpiresAt": "2026-07-13T10:00:00Z",
    "refreshTokenExpiresAt": "2026-07-27T08:00:00Z"
  }
}
```

실제 provider 검증은 이후 Phase에서 `/auth/provider` 후보 계약을 구체화한다.

### POST `/auth/provider`

```json
{
  "provider": "GOOGLE",
  "credential": "provider-token-or-code",
  "authorizationCode": "optional",
  "displayName": "사용자 이름"
}
```

Response:

```json
{
  "data": {
    "accessToken": "jwt",
    "refreshToken": "opaque-token",
    "expiresIn": 900,
    "user": {
      "id": "uuid",
      "displayName": "사용자 이름"
    }
  }
}
```

### POST `/auth/email-magic-link/request`

```json
{
  "email": "user@example.com"
}
```

이 endpoint는 후보 계약이며 실제 구현 여부는 인증 Phase에서 결정한다.

### POST `/auth/refresh`

```json
{
  "refreshToken": "opaque-token"
}
```

### POST `/auth/logout`

현재 refresh token을 폐기한다. 브라우저 로컬 데이터 삭제 여부는 클라이언트가 사용자에게 별도 확인한다.

### GET `/auth/me`

`Authorization: Bearer <accessToken>`으로 현재 사용자 정보를 반환한다.

## 3. 사용자

### GET `/me`

현재 사용자 정보를 반환한다.

### PATCH `/me`

```json
{
  "displayName": "새 이름"
}
```

## 4. 악보

Phase 4 구현은 ensemble-scoped score API를 사용한다. MusicXML 업로드는 presigned URL이 아니라 multipart endpoint로 처리하며, 서버는 MIME, 크기, MusicXML 구조, 소유 ensemble membership을 검증한다. ScoreVersion은 append-only이고 현재 version pointer만 갱신한다.

### POST `/ensembles/{ensembleId}/scores`

`multipart/form-data`

- `title`: string
- `composer`: optional string
- `file`: MusicXML XML file

### GET `/ensembles/{ensembleId}/scores`

해당 ensemble member에게 보이는 Score 목록을 반환한다.

### GET `/scores/{scoreId}`

Score metadata와 version 목록을 반환한다. ensemble member가 아니면 `FORBIDDEN`.

### POST `/scores/{scoreId}/versions`

`multipart/form-data`로 새 immutable ScoreVersion을 추가한다.

### GET `/scores/{scoreId}/versions/{versionId}/source`

권한 확인 후 MusicXML 원본을 반환한다.

### POST `/scores`

```json
{
  "title": "주님의 선하심",
  "composer": null,
  "lyricist": null,
  "defaultTempo": 92,
  "visibility": "PRIVATE"
}
```

### GET `/scores`

Query:

```text
cursor
limit
query
updatedAfter
```

### GET `/scores/{scoreId}`

악보 메타데이터, 현재 버전, 접근 권한 반환.

### PATCH `/scores/{scoreId}`

제목, 작곡가, BPM, 공개 범위 수정.

### DELETE `/scores/{scoreId}`

soft delete.

## 5. 원본 파일 업로드

브라우저 로컬 OMR이 기본 경로다. 서버 업로드는 공유, 백업, 여러 기기 동기화 또는 선택적 서버 분석이 필요할 때 사용자 동의 후 수행한다.

### POST `/scores/{scoreId}/sources/upload-requests`

```json
{
  "fileName": "score-page-1.jpg",
  "contentType": "image/jpeg",
  "size": 3421234,
  "sha256": "hex"
}
```

Response:

```json
{
  "data": {
    "uploadId": "uuid",
    "method": "PUT",
    "uploadUrl": "presigned-url",
    "objectKey": "scores/.../source.jpg",
    "expiresAt": "2026-07-12T10:00:00Z"
  }
}
```

### POST `/scores/{scoreId}/sources/complete`

```json
{
  "uploadId": "uuid",
  "objectKey": "scores/.../source.jpg",
  "pageNumber": 1,
  "width": 2480,
  "height": 3508,
  "sha256": "hex"
}
```

## 6. 악보 버전

### POST `/scores/{scoreId}/versions`

```json
{
  "parentVersionId": "uuid",
  "name": "합주 편곡 1",
  "changeSummary": "2절 코드와 엔딩 수정",
  "source": "EDIT",
  "document": {
    "schemaVersion": 1,
    "clientSchemaVersion": 1,
    "parts": [],
    "performanceOrder": []
  }
}
```

### GET `/scores/{scoreId}/versions`

### GET `/scores/{scoreId}/versions/{versionId}`

전체 구조화 악보 문서 반환.

### PUT `/scores/{scoreId}/versions/{versionId}`

낙관적 잠금 사용.

```json
{
  "revision": 3,
  "changeSummary": "코드 수정",
  "lastModifiedByDeviceId": "device-uuid",
  "document": {}
}
```

revision이 다르면 `409 SCORE_VERSION_CONFLICT`.

### POST `/scores/{scoreId}/versions/{versionId}/publish`

합주에서 사용할 published 버전으로 전환.

### POST `/scores/{scoreId}/versions/{versionId}/fork`

기존 버전에서 새 편곡 분기 생성.

### GET `/scores/{scoreId}/versions/{versionId}/export/musicxml`

MusicXML 다운로드.

## 7. 반복 펼치기 검증

기본 계산은 `packages/score-domain`과 Web PWA에서 수행하며 서버 검증이 필요할 때 사용한다.

### POST `/scores/{scoreId}/versions/{versionId}/expand`

```json
{
  "maxGeneratedMeasures": 1000,
  "strict": false
}
```

Response:

```json
{
  "data": {
    "performanceOrder": [],
    "warnings": [
      {
        "code": "CODA_TARGET_NOT_FOUND",
        "measureId": "uuid"
      }
    ]
  }
}
```

## 8. 메모

Phase 4 구현은 로컬-first annotation mutation queue와 다음 batch sync endpoint를 사용한다.

### POST `/scores/{scoreId}/annotations/sync`

```json
{
  "scoreVersionId": "ver_xxx",
  "mutations": [
    {
      "clientMutationId": "mut_xxx",
      "baseRevision": 0,
      "action": "UPSERT",
      "annotation": {
        "id": "annotation-id",
        "schemaVersion": 1,
        "scoreId": "scr_xxx",
        "scoreVersionId": "ver_xxx",
        "type": "TEXT",
        "scope": "ENSEMBLE",
        "partId": null,
        "anchor": {
          "type": "MEASURE",
          "sourceMeasureId": "scr_xxx:p1:m1:m1"
        },
        "payload": {
          "text": "cue",
          "x": 0.2,
          "y": 0.2,
          "width": 0.4,
          "height": 0.12,
          "fontSizeRatio": 0.1
        },
        "createdAt": 1700000000000,
        "updatedAt": 1700000000000
      }
    }
  ]
}
```

서버는 `clientMutationId`로 idempotency를 보장한다. 현재 서버 revision과 `baseRevision`이 다르면 `409 CONFLICT`와 `conflicts` 상세를 반환한다.

### GET `/scores/{scoreId}/annotations?scoreVersionId={versionId}`

PRIVATE는 owner 본인에게만 반환한다. PART와 ENSEMBLE은 score ensemble member에게 반환하며, PART는 `partId`가 필수다.

### POST `/scores/{scoreId}/versions/{versionId}/annotations`

```json
{
  "type": "TEXT",
  "scope": "ENSEMBLE",
  "targetPartId": null,
  "anchor": {
    "kind": "MEASURE",
    "measureId": "uuid",
    "relativeRect": {
      "x": 0.3,
      "y": 0.1,
      "width": 0.2,
      "height": 0.1
    }
  },
  "payload": {
    "text": "여기서 작게"
  },
  "lastModifiedByDeviceId": "device-uuid"
}
```

필기 payload는 플랫폼 중립 stroke 데이터를 사용한다.

### GET `/scores/{scoreId}/versions/{versionId}/annotations`

권한과 공개 범위에 따라 필터링.

### PATCH `/annotations/{annotationId}`

### DELETE `/annotations/{annotationId}`

### POST `/annotations/batch`

오프라인 메모 일괄 동기화.

```json
{
  "operations": [
    {
      "operationId": "client-uuid",
      "type": "UPSERT",
      "annotation": {}
    }
  ]
}
```

## 9. 팀

### POST `/ensembles`

```json
{
  "name": "주일 2부 찬양팀"
}
```

### GET `/ensembles`

### GET `/ensembles/{ensembleId}`

### POST `/ensembles/{ensembleId}/invitations`

```json
{
  "role": "MEMBER",
  "expiresInHours": 72
}
```

### POST `/ensemble-invitations/{code}/accept`

### PATCH `/ensembles/{ensembleId}/members/{userId}`

```json
{
  "role": "LEADER",
  "partId": "optional-uuid"
}
```

### DELETE `/ensembles/{ensembleId}/members/{userId}`

## 10. 악보 공유 권한

### POST `/scores/{scoreId}/permissions`

```json
{
  "subjectType": "ENSEMBLE",
  "subjectId": "uuid",
  "role": "EDITOR"
}
```

### GET `/scores/{scoreId}/permissions`

### DELETE `/scores/{scoreId}/permissions/{permissionId}`

## 11. 합주 세션

### POST `/rehearsal-sessions`

```json
{
  "ensembleId": "uuid",
  "scoreId": "uuid",
  "scoreVersionId": "uuid",
  "initialBpm": 92
}
```

Response:

```json
{
  "data": {
    "sessionId": "uuid",
    "joinCode": "A7K4P2",
    "status": "WAITING",
    "webSocketUrl": "wss://.../ws/rehearsals/uuid"
  }
}
```

### POST `/rehearsal-sessions/join`

```json
{
  "joinCode": "A7K4P2",
  "deviceId": "device-uuid"
}
```

### GET `/rehearsal-sessions/{sessionId}`

현재 상태 스냅샷 포함.

### POST `/rehearsal-sessions/{sessionId}/end`

리더 전용.

### POST `/rehearsal-sessions/{sessionId}/leader`

```json
{
  "userId": "uuid"
}
```

## 12. WebSocket

```text
GET /ws/rehearsals/{sessionId}
```

브라우저 WebSocket API로 연결한다. 실제 인증 방식은 구현 시 보안 핸드셰이크로 결정한다. 이벤트 계약은 `06-SYNC-PROTOCOL.md`를 따른다.

## 13. 객체 다운로드

### POST `/objects/download-requests`

```json
{
  "objectKey": "scores/.../source.pdf"
}
```

권한 검증 후 짧은 수명의 URL 반환.

## 14. OMR 모델 manifest

### GET `/models/omr/manifest`

브라우저가 사용할 ONNX 모델 목록과 호환성을 반환한다. 클라이언트는 manifest의 hash가 변경된 경우에만 모델을 다시 다운로드한다.

Response:

```json
{
  "data": {
    "manifestVersion": 1,
    "minimumAppVersion": "0.1.0",
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
        }
      },
      {
        "id": "symbol-v1",
        "role": "SYMBOL",
        "version": "2026.07.0",
        "url": "https://cdn.example.com/models/symbol-v1.onnx",
        "sha256": "hex",
        "sizeBytes": 41943040,
        "executionProviders": {
          "webgpu": "compatible",
          "wasm": "compatible"
        }
      }
    ]
  },
  "meta": {
    "requestId": "req_123"
  }
}
```

규칙:

- `sha256`이 로컬 캐시와 같으면 재다운로드하지 않는다.
- hash 검증 실패 또는 파일 손상 시 캐시를 버리고 다시 다운로드한다.
- `minimumAppVersion`보다 낮은 앱은 모델을 사용하지 않는다.
- 배포 중 rollback을 위해 이전 모델 manifest도 일정 기간 유지한다.

## 15. 제한적 오프라인 동기화

### POST `/sync/push`

```json
{
  "deviceId": "uuid",
  "lastServerCursor": "cursor",
  "operations": []
}
```

### GET `/sync/pull?cursor=...`

MVP에서는 일반화된 동기화 엔진보다 메모와 악보 메타데이터부터 구현한다.

## 16. Health

### GET `/api/v1/health`

```json
{
  "data": {
    "status": "UP",
    "version": "0.1.0"
  },
  "meta": {
    "requestId": "req_123"
  }
}
```

### GET `/actuator/health`

운영 및 K3s probe용.

## 17. 오류 코드

```text
AUTH_INVALID_PROVIDER_TOKEN
AUTH_REFRESH_TOKEN_EXPIRED
AUTH_PROVIDER_NOT_SUPPORTED
SCORE_NOT_FOUND
SCORE_ACCESS_DENIED
SCORE_VERSION_CONFLICT
SCORE_VERSION_NOT_PUBLISHED
SOURCE_UPLOAD_EXPIRED
ANNOTATION_SCOPE_FORBIDDEN
ENSEMBLE_NOT_FOUND
SESSION_NOT_FOUND
SESSION_ALREADY_ENDED
SESSION_LEADER_REQUIRED
SESSION_SCORE_VERSION_MISMATCH
SYNC_SEQUENCE_OUTDATED
SYNC_INVALID_POSITION
OBJECT_ACCESS_DENIED
MODEL_MANIFEST_NOT_FOUND
MODEL_VERSION_UNSUPPORTED
VALIDATION_FAILED
```

## 18. 보안 규칙

- 모든 score/object 접근은 서버가 권한을 검증한다.
- 클라이언트의 ownerId, authorId, leaderId를 신뢰하지 않는다.
- 파일 업로드 전 크기와 MIME type을 검증한다.
- 완료 처리 시 실제 객체 메타데이터와 해시를 확인한다.
- WebSocket 명령은 현재 리더와 sequence를 검증한다.
- 종료된 세션의 제어 명령을 거부한다.
- 로그에 token과 presigned URL 전체를 남기지 않는다.
- 모델 manifest URL은 짧은 수명의 presigned URL 또는 CDN 정책으로 보호할 수 있다.

## Phase 5 Rehearsal API Update

Implemented REST endpoints:

- `POST /api/v1/ensembles/{ensembleId}/rehearsal-sessions`
- `GET /api/v1/ensembles/{ensembleId}/rehearsal-sessions`
- `GET /api/v1/rehearsal-sessions/{sessionId}`
- `POST /api/v1/rehearsal-sessions/{sessionId}/join`
- `POST /api/v1/rehearsal-sessions/{sessionId}/leave`
- `POST /api/v1/rehearsal-sessions/{sessionId}/end`
- `PATCH /api/v1/rehearsal-sessions/{sessionId}/leader`

Implemented WebSocket endpoint:

- `GET /ws/rehearsal`

Client messages: `JOIN_SESSION`, `LEAVE_SESSION`, `REQUEST_STATE_SNAPSHOT`, `PING`, `PLAY_REQUEST`, `PAUSE_REQUEST`, `STOP_REQUEST`, `SEEK_REQUEST`, `BPM_CHANGE_REQUEST`, `COUNT_IN_CHANGE_REQUEST`, `LEADER_TRANSFER_REQUEST`, `FOLLOW_MODE_CHANGE`.

Server messages: `SESSION_JOINED`, `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `PARTICIPANT_LIST`, `STATE_SNAPSHOT`, `PLAYBACK_STATE_CHANGED`, `LEADER_CHANGED`, `PONG`, `COMMAND_REJECTED`, `SESSION_ENDED`, `ERROR`.

Only ensemble members can view or join sessions. Only `OWNER`/`ADMIN` can create sessions and transfer leadership. Only the current leader can change shared playback state.

## Phase 6 Score Edit Publish API Update

`POST /api/v1/scores/{scoreId}/versions` remains the publish endpoint for edited MusicXML.

It accepts multipart fields:

- `title`
- `file`
- `baseScoreVersionId` optional but sent by the Phase 6 editor
- `editSummary` optional
- `annotationMigrationPolicy` optional: `NONE` or `MEASURE_ONLY`
- `expectedScoreRevision` optional optimistic lock value

Server behavior:

- Validates authentication and ensemble membership.
- Allows publish only for `OWNER` and `ADMIN` roles in the current role model.
- Validates that `baseScoreVersionId` belongs to the target score.
- Rejects stale `expectedScoreRevision` with `409 CONFLICT`.
- Validates MusicXML size, MIME type, XML well-formedness, and `score-partwise` for edited versions.
- Writes a new object-storage key and inserts a new append-only `score_versions` row.
- Updates `scores.current_version_id` and increments `scores.revision`.
- Does not mutate or overwrite existing score-version MusicXML.
