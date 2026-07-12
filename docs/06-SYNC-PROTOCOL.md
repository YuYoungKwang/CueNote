# 06. 합주 동기화 프로토콜

## 1. 목표

여러 브라우저/PWA 클라이언트가 동일한 악보 버전을 열고 리더 제어에 따라 같은 **연주 마디와 박자**를 표시한다.

```text
scoreVersionId
performanceMeasureId
beat
bpm
targetTimestamp
sequence
```

## 2. 원칙

1. 서버는 모든 프레임을 전송하지 않는다.
2. 각 클라이언트는 로컬 시계와 BPM으로 위치를 계산한다.
3. 리더 명령은 미래 절대 시각에 실행한다.
4. 서버는 sequence와 리더 권한을 검증한다.
5. 참여자는 잠시 독립 탐색할 수 있다.
6. 재연결 시 상태 스냅샷으로 복구한다.
7. 중복 이벤트는 idempotent하게 처리한다.
8. 브라우저 background timer throttling을 신뢰하지 않고 foreground 복귀 시 절대 시각과 `STATE_SNAPSHOT`으로 위치를 재계산한다.

## 3. 통신

- REST: 세션 생성, 참가, 종료, 초기 상태
- WebSocket API: 실시간 제어와 상태
- WSS
- JSON
- `protocolVersion` 포함

## 4. Envelope

```json
{
  "protocolVersion": 1,
  "eventId": "uuid",
  "type": "PLAYBACK_STARTED",
  "sessionId": "uuid",
  "sequence": 102,
  "serverTimestamp": 1783832414000,
  "sender": {
    "userId": "uuid",
    "deviceId": "uuid"
  },
  "payload": {}
}
```

## 5. 클라이언트 → 서버

### SESSION_JOIN

```json
{
  "type": "SESSION_JOIN",
  "payload": {
    "deviceId": "uuid",
    "appVersion": "0.1.0",
    "scoreVersionId": "uuid",
    "clientTimestamp": 1783832410000
  }
}
```

### PLAYBACK_START

리더 전용.

```json
{
  "type": "PLAYBACK_START",
  "payload": {
    "performanceMeasureId": "uuid",
    "beat": {"numerator": 1, "denominator": 1},
    "bpm": 92,
    "countInBeats": 4,
    "targetTimestamp": 1783832415000,
    "clientSequence": 33
  }
}
```

### PLAYBACK_PAUSE

```json
{
  "type": "PLAYBACK_PAUSE",
  "payload": {
    "targetTimestamp": 1783832425000,
    "clientSequence": 34
  }
}
```

### PLAYBACK_STOP

```json
{
  "type": "PLAYBACK_STOP",
  "payload": {
    "resetToPerformanceMeasureId": "uuid",
    "clientSequence": 35
  }
}
```

### POSITION_CHANGE

```json
{
  "type": "POSITION_CHANGE",
  "payload": {
    "performanceMeasureId": "uuid",
    "beat": {"numerator": 3, "denominator": 1},
    "targetTimestamp": 1783832430000,
    "clientSequence": 36
  }
}
```

### TEMPO_CHANGE

```json
{
  "type": "TEMPO_CHANGE",
  "payload": {
    "bpm": 96,
    "applyAtPerformanceMeasureId": "uuid",
    "applyAtBeat": {"numerator": 1, "denominator": 1},
    "targetTimestamp": 1783832440000,
    "clientSequence": 37
  }
}
```

### REQUEST_STATE

```json
{
  "type": "REQUEST_STATE",
  "payload": {
    "lastReceivedSequence": 101,
    "reason": "FOREGROUND"
  }
}
```

`reason` 후보:

- `RECONNECT`
- `SEQUENCE_GAP`
- `FOREGROUND`
- `MANUAL_REFRESH`
- `TIMER_DRIFT`

## 6. 서버 → 클라이언트

- SESSION_JOINED
- PARTICIPANT_JOINED
- PARTICIPANT_LEFT
- PLAYBACK_STARTED
- PLAYBACK_PAUSED
- PLAYBACK_STOPPED
- POSITION_CHANGED
- TEMPO_CHANGED
- LEADER_CHANGED
- STATE_SNAPSHOT
- ERROR

### STATE_SNAPSHOT

```json
{
  "type": "STATE_SNAPSHOT",
  "sequence": 110,
  "payload": {
    "status": "PLAYING",
    "scoreVersionId": "uuid",
    "performanceMeasureId": "uuid",
    "beat": {"numerator": 2, "denominator": 1},
    "bpm": 92,
    "positionAtTimestamp": 1783832450000,
    "leaderUserId": "uuid"
  }
}
```

## 7. 상태 머신

```text
WAITING
  ├─ START → COUNT_IN
  └─ END → ENDED

COUNT_IN
  ├─ 완료 → PLAYING
  ├─ PAUSE → PAUSED
  └─ STOP → WAITING

PLAYING
  ├─ PAUSE → PAUSED
  ├─ STOP → WAITING
  ├─ POSITION_CHANGE → PLAYING
  └─ END → ENDED

PAUSED
  ├─ START → PLAYING
  ├─ POSITION_CHANGE → PAUSED
  ├─ STOP → WAITING
  └─ END → ENDED
```

## 8. 시간 동기화

```text
t0 = client send
t1 = server echo
t2 = client receive

roundTrip = t2 - t0
estimatedServerAtReceive = t1 + roundTrip / 2
offset = estimatedServerAtReceive - t2
```

여러 번 측정하고 RTT가 큰 표본은 제외한다.

## 9. 로컬 위치 계산

입력:

- 시작 마디와 박자
- BPM
- 마디별 실제 박 길이
- 서버 기준 시작 시각
- 템포 변경 지점

클라이언트가 로컬로 현재 마디와 박자를 계산한다.

브라우저 timer는 background 상태에서 지연될 수 있으므로 `setInterval` tick 누적값을 신뢰하지 않는다. 항상 서버 기준 절대 시각, offset, BPM, timeline으로 현재 위치를 다시 계산한다.

## 10. 드리프트 보정

```text
abs(error) < 50ms
→ 보정 없음

50ms ~ 250ms
→ 짧게 커서 속도 조정

250ms 이상
→ 다음 박 또는 마디 경계에서 재설정
```

수치는 실제 테스트 후 조정 가능하다.

## 11. 브라우저 lifecycle

### `document.visibilitychange`

브라우저 탭이나 PWA가 background로 이동하면:

- 공용 playback state를 임의로 변경하지 않는다.
- 가능한 경우 로컬 예상 위치 계산에 필요한 기준 시각을 유지한다.
- WebSocket이 닫히면 재연결 큐를 준비한다.

foreground로 복귀하면:

```text
visibilitychange → visible
→ REQUEST_STATE(reason: FOREGROUND)
→ STATE_SNAPSHOT
→ absolute timestamp 기준 현재 위치 재계산
→ drift 보정
```

### WebSocket 재연결

```text
reconnect
→ SESSION_JOIN
→ lastReceivedSequence
→ STATE_SNAPSHOT
→ scoreVersion 검증
→ drift 보정
```

### Wake Lock

- Wake Lock을 사용할 수 있으면 연주/합주 중 화면 절전 방지를 요청한다.
- Wake Lock 요청 실패 또는 미지원은 합주 기능 실패로 처리하지 않는다.
- 실패 시 사용자가 시스템 절전 설정을 조정할 수 있도록 안내한다.

### AudioContext

- 카운트인 사운드는 사용자 상호작용 이후 AudioContext를 활성화해야 한다.
- 자동 재생 제한 때문에 사운드가 실패해도 시각적 카운트인은 유지한다.

## 12. 독립 탐색

```text
followLeader = true
→ 리더 위치 자동 추적

followLeader = false
→ 개인 탐색
→ 리더 현재 위치 표시
→ [리더 위치로 돌아가기]
```

개인 탐색은 공용 playback state를 변경하지 않는다.

## 13. sequence

- 승인된 상태 변경마다 서버 sequence 증가
- 마지막 sequence 이하 이벤트 무시
- clientSequence로 재전송 중복 식별
- 같은 eventId는 idempotent 처리
- gap 감지 시 REQUEST_STATE

## 14. 연결 끊김

### 짧은 끊김

- 로컬 진행 유지
- 연결 상태 표시
- 제어 명령 실패를 명시

### 긴 끊김

자동 추적을 중단하고 “리더 위치 다시 맞추기”를 제공할 수 있다.

## 15. 악보 버전 검증

참여자의 `scoreVersionId`가 세션과 다르면 시작하지 않는다.

```text
SESSION_SCORE_VERSION_MISMATCH
→ 올바른 버전 다운로드
→ 렌더링 준비
→ 다시 참가
```

## 16. 리더 권한

- 세션 생성자가 기본 리더
- 리더만 공용 재생 상태 변경
- 서버가 모든 명령에서 검증
- 리더 이탈 시 일시정지 또는 새 리더 지정
- 리더 변경 이벤트 전파

## 17. 저장

저장 권장:

- 세션 시작/종료
- 참여/이탈
- 리더 변경
- 주요 재생 명령
- 오류·재연결 통계
- foreground 복귀 후 snapshot 보정 횟수

모든 스냅샷을 영구 저장할 필요는 없다.

## 18. 테스트

- 2대 동시 시작
- 10대 참가
- BPM 변경
- 특정 마디 이동
- 개인 탐색 후 복귀
- 중복 이벤트
- sequence gap
- 10초 단절 후 복구
- 리더 강제 종료
- 서로 다른 악보 버전
- browser tab background/foreground
- PWA와 일반 브라우저 탭 간 동기화
- 화면 회전 후 위치 유지
- Wake Lock 실패
- timer throttling 후 snapshot 복구

## 19. MVP 제외

- 음표 단위 오디오 동기화
- 실제 연주 마이크 추적
- 완전 P2P 합주
- 실시간 공동 악보 편집
- 오디오 스트리밍
