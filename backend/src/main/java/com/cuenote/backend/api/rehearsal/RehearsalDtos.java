package com.cuenote.backend.api.rehearsal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

record CreateRehearsalSessionRequest(
        @NotBlank String scoreId,
        @NotBlank String scoreVersionId,
        @Valid @NotNull RehearsalPosition initialPosition,
        Integer bpm,
        Integer countInMeasures,
        @NotEmpty List<PerformanceMeasureEntry> performanceOrder
) {
}

record JoinRehearsalSessionRequest(String followMode) {
}

record TransferLeaderRequest(@NotBlank String leaderUserId) {
}

record RehearsalPosition(
        @NotBlank String performanceMeasureId,
        @NotBlank String sourceMeasureId,
        @NotNull Integer occurrence,
        @NotNull Double beat,
        Long baseTimelinePositionMs
) {
}

record PerformanceMeasureEntry(
        @NotBlank String id,
        @NotBlank String sourceMeasureId,
        @NotNull Integer occurrence,
        @NotNull Integer orderIndex,
        Double beatCount
) {
}

record RehearsalClientEnvelope(
        Integer protocolVersion,
        @NotBlank String type,
        String sessionId,
        String clientCommandId,
        Long sequence,
        Map<String, Object> payload
) {
}

record RehearsalServerEnvelope(
        int protocolVersion,
        String type,
        String sessionId,
        String clientCommandId,
        Long sequence,
        Long serverTimestamp,
        Object payload
) {
    static RehearsalServerEnvelope of(String type, String sessionId, String clientCommandId, Long sequence, Object payload) {
        return new RehearsalServerEnvelope(1, type, sessionId, clientCommandId, sequence, System.currentTimeMillis(), payload);
    }
}

record RehearsalCommandResult(
        Map<String, Object> session,
        Map<String, Object> state,
        boolean idempotentReplay
) {
}
