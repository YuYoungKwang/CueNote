package com.cuenote.backend.api.rehearsal;

import com.cuenote.backend.api.auth.AuthService;
import com.cuenote.backend.api.auth.AuthenticatedUser;
import com.cuenote.backend.api.error.ApiException;
import com.cuenote.backend.api.error.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RehearsalService {

    private static final int DEFAULT_BPM = 80;
    private static final int DEFAULT_COUNT_IN_MEASURES = 1;
    private static final TypeReference<List<PerformanceMeasureEntry>> PERFORMANCE_ORDER_TYPE = new TypeReference<>() {
    };

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final RehearsalSocketNotifier notifier;
    private final long effectiveDelayMs;

    public RehearsalService(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            RehearsalSocketNotifier notifier,
            @Value("${cuenote.rehearsal.effective-delay-ms:150}") long effectiveDelayMs
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.notifier = notifier;
        this.effectiveDelayMs = effectiveDelayMs;
    }

    @Transactional
    public Map<String, Object> createSession(AuthenticatedUser user, String ensembleId, CreateRehearsalSessionRequest request) {
        ScoreVersionRef scoreVersion = requireScoreVersionMember(user, ensembleId, request.scoreId(), request.scoreVersionId());
        String role = requireMemberRole(user, ensembleId);
        if (!isOwnerOrAdmin(role)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Only OWNER or ADMIN can create rehearsal sessions");
        }
        if (request.performanceOrder() == null || request.performanceOrder().isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "performanceOrder is required");
        }
        validatePosition(request.performanceOrder(), request.initialPosition());

        String sessionId = AuthService.newId("reh");
        int bpm = clampBpm(request.bpm() == null ? DEFAULT_BPM : request.bpm());
        int countInMeasures = clampCountIn(request.countInMeasures() == null ? DEFAULT_COUNT_IN_MEASURES : request.countInMeasures());
        long now = nowMs();

        jdbcTemplate.update(
                """
                insert into rehearsal_sessions(
                    id, ensemble_id, score_id, score_version_id, leader_user_id, status,
                    created_by_user_id, created_at, revision, performance_order_json
                )
                values (?, ?, ?, ?, ?, 'CREATED', ?, now(), 1, ?)
                """,
                sessionId,
                ensembleId,
                scoreVersion.scoreId(),
                scoreVersion.versionId(),
                user.id(),
                user.id(),
                toJson(request.performanceOrder())
        );
        upsertParticipant(sessionId, user, "CONNECTED", "FOLLOWING_LEADER");
        jdbcTemplate.update(
                """
                insert into rehearsal_state_snapshots(
                    session_id, score_id, score_version_id, playback_status, performance_measure_id,
                    source_measure_id, occurrence, beat, bpm, count_in_measures, base_timeline_position_ms,
                    effective_at_server_time, sequence, updated_by_user_id, updated_at
                )
                values (?, ?, ?, 'STOPPED', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, now())
                """,
                sessionId,
                scoreVersion.scoreId(),
                scoreVersion.versionId(),
                request.initialPosition().performanceMeasureId(),
                request.initialPosition().sourceMeasureId(),
                request.initialPosition().occurrence(),
                BigDecimal.valueOf(request.initialPosition().beat()),
                bpm,
                countInMeasures,
                request.initialPosition().baseTimelinePositionMs() == null ? 0L : request.initialPosition().baseTimelinePositionMs(),
                now,
                user.id()
        );

        return getSession(user, sessionId);
    }

    public List<Map<String, Object>> listSessions(AuthenticatedUser user, String ensembleId) {
        requireMemberRole(user, ensembleId);
        return jdbcTemplate.query(
                """
                select id from rehearsal_sessions
                where ensemble_id = ?
                order by created_at desc
                """,
                (rs, rowNum) -> getSession(user, rs.getString("id")),
                ensembleId
        );
    }

    public Map<String, Object> getSession(AuthenticatedUser user, String sessionId) {
        Map<String, Object> session = readSessionRow(sessionId);
        requireMemberRole(user, String.valueOf(session.get("ensembleId")));
        session.put("state", readState(sessionId, session));
        session.put("participants", listParticipants(sessionId));
        return session;
    }

    @Transactional
    public Map<String, Object> joinSession(AuthenticatedUser user, String sessionId, String followMode) {
        Map<String, Object> session = readSessionRow(sessionId);
        requireMemberRole(user, String.valueOf(session.get("ensembleId")));
        rejectIfEnded(session);
        upsertParticipant(sessionId, user, "CONNECTED", normalizeFollowMode(followMode));
        Map<String, Object> joined = getSession(user, sessionId);
        notifier.broadcast(sessionId, RehearsalServerEnvelope.of("PARTICIPANT_JOINED", sessionId, null, stateSequence(joined), Map.of("participant", participantForUser(sessionId, user.id()))));
        notifier.broadcast(sessionId, RehearsalServerEnvelope.of("PARTICIPANT_LIST", sessionId, null, stateSequence(joined), joined.get("participants")));
        return joined;
    }

    @Transactional
    public void leaveSession(AuthenticatedUser user, String sessionId) {
        Map<String, Object> session = readSessionRow(sessionId);
        requireMemberRole(user, String.valueOf(session.get("ensembleId")));
        jdbcTemplate.update(
                "update rehearsal_participants set connection_state = 'DISCONNECTED', last_seen_at = now() where session_id = ? and user_id = ?",
                sessionId,
                user.id()
        );
        notifier.broadcast(sessionId, RehearsalServerEnvelope.of("PARTICIPANT_LEFT", sessionId, null, null, Map.of("userId", user.id())));
        notifier.broadcast(sessionId, RehearsalServerEnvelope.of("PARTICIPANT_LIST", sessionId, null, null, listParticipants(sessionId)));
    }

    @Transactional
    public Map<String, Object> endSession(AuthenticatedUser user, String sessionId) {
        Map<String, Object> session = readSessionRow(sessionId);
        String role = requireMemberRole(user, String.valueOf(session.get("ensembleId")));
        if (!user.id().equals(session.get("leaderUserId")) && !isOwnerOrAdmin(role)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Only the leader, OWNER, or ADMIN can end a rehearsal session");
        }
        if ("ENDED".equals(session.get("status"))) {
            return getSession(user, sessionId);
        }

        Map<String, Object> current = readState(sessionId, session);
        long sequence = ((Number) current.get("sequence")).longValue() + 1;
        jdbcTemplate.update(
                """
                update rehearsal_sessions
                set status = 'ENDED', ended_at = now(), revision = revision + 1
                where id = ?
                """,
                sessionId
        );
        updateSnapshot(
                sessionId,
                "ENDED",
                String.valueOf(current.get("performanceMeasureId")),
                String.valueOf(current.get("sourceMeasureId")),
                ((Number) current.get("occurrence")).intValue(),
                ((Number) current.get("beat")).doubleValue(),
                ((Number) current.get("bpm")).intValue(),
                ((Number) current.get("countInMeasures")).intValue(),
                ((Number) current.get("baseTimelinePositionMs")).longValue(),
                nowMs(),
                sequence,
                user.id()
        );
        Map<String, Object> ended = getSession(user, sessionId);
        notifier.broadcast(sessionId, RehearsalServerEnvelope.of("SESSION_ENDED", sessionId, null, sequence, ended));
        return ended;
    }

    @Transactional
    public Map<String, Object> transferLeader(AuthenticatedUser user, String sessionId, String nextLeaderUserId) {
        Map<String, Object> session = readSessionRow(sessionId);
        String role = requireMemberRole(user, String.valueOf(session.get("ensembleId")));
        if (!isOwnerOrAdmin(role)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Only OWNER or ADMIN can transfer leadership");
        }
        requireMemberRole(new AuthenticatedUser(nextLeaderUserId, "", ""), String.valueOf(session.get("ensembleId")));
        rejectIfEnded(session);
        jdbcTemplate.update(
                "update rehearsal_sessions set leader_user_id = ?, revision = revision + 1 where id = ?",
                nextLeaderUserId,
                sessionId
        );
        Map<String, Object> transferred = getSession(user, sessionId);
        notifier.broadcast(sessionId, RehearsalServerEnvelope.of("LEADER_CHANGED", sessionId, null, stateSequence(transferred), transferred));
        return transferred;
    }

    @Transactional
    public RehearsalCommandResult applyCommand(AuthenticatedUser user, String sessionId, String type, String clientCommandId, Map<String, Object> payload) {
        if (clientCommandId == null || clientCommandId.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "clientCommandId is required");
        }
        ExistingCommand existingCommand = findExistingCommand(sessionId, user.id(), clientCommandId);
        if (existingCommand != null) {
            if (existingCommand.rejected()) {
                throw new ApiException(ErrorCode.CONFLICT, existingCommand.rejectionCode() == null ? "Command was already rejected" : existingCommand.rejectionCode());
            }
            Map<String, Object> session = getSession(user, sessionId);
            return new RehearsalCommandResult(session, (Map<String, Object>) session.get("state"), true);
        }

        try {
            RehearsalCommandResult result = doApplyCommand(user, sessionId, type, payload == null ? Map.of() : payload);
            jdbcTemplate.update(
                    """
                    insert into rehearsal_processed_commands(
                        session_id, user_id, client_command_id, message_type, result_sequence, rejected, created_at
                    )
                    values (?, ?, ?, ?, ?, false, now())
                    """,
                    sessionId,
                    user.id(),
                    clientCommandId,
                    type,
                    ((Number) result.state().get("sequence")).longValue()
            );
            return result;
        } catch (ApiException exception) {
            jdbcTemplate.update(
                    """
                    insert into rehearsal_processed_commands(
                        session_id, user_id, client_command_id, message_type, rejected, rejection_code, created_at
                    )
                    values (?, ?, ?, ?, true, ?, now())
                    on conflict do nothing
                    """,
                    sessionId,
                    user.id(),
                    clientCommandId,
                    type,
                    exception.getErrorCode().name()
            );
            throw exception;
        }
    }

    @Transactional
    public Map<String, Object> updateFollowMode(AuthenticatedUser user, String sessionId, String followMode) {
        Map<String, Object> session = readSessionRow(sessionId);
        requireMemberRole(user, String.valueOf(session.get("ensembleId")));
        jdbcTemplate.update(
                """
                update rehearsal_participants
                set follow_mode = ?, last_seen_at = now()
                where session_id = ? and user_id = ?
                """,
                normalizeFollowMode(followMode),
                sessionId,
                user.id()
        );
        return participantForUser(sessionId, user.id());
    }

    public Map<String, Object> snapshot(AuthenticatedUser user, String sessionId, String reason) {
        Map<String, Object> session = getSession(user, sessionId);
        return Map.of(
                "session", session,
                "participants", session.get("participants"),
                "state", session.get("state"),
                "reason", reason == null ? "MANUAL_REFRESH" : reason
        );
    }

    private RehearsalCommandResult doApplyCommand(AuthenticatedUser user, String sessionId, String type, Map<String, Object> payload) {
        Map<String, Object> session = readSessionRow(sessionId);
        rejectIfEnded(session);
        requireMemberRole(user, String.valueOf(session.get("ensembleId")));

        if ("LEADER_TRANSFER_REQUEST".equals(type)) {
            String nextLeaderUserId = requiredString(payload, "leaderUserId");
            Map<String, Object> transferred = transferLeader(user, sessionId, nextLeaderUserId);
            return new RehearsalCommandResult(transferred, (Map<String, Object>) transferred.get("state"), false);
        }

        if (!user.id().equals(session.get("leaderUserId"))) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Only the leader can change shared playback state");
        }

        Map<String, Object> current = readState(sessionId, session);
        List<PerformanceMeasureEntry> performanceOrder = performanceOrder(session);
        String status = switch (type) {
            case "PLAY_REQUEST" -> "PLAYING";
            case "PAUSE_REQUEST" -> "PAUSED";
            case "STOP_REQUEST" -> "STOPPED";
            case "SEEK_REQUEST", "BPM_CHANGE_REQUEST", "COUNT_IN_CHANGE_REQUEST" -> String.valueOf(current.get("playbackStatus"));
            default -> throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unknown rehearsal command type");
        };

        PositionCommand position = positionFromPayloadOrCurrent(payload, current);
        if ("STOP_REQUEST".equals(type)) {
            PerformanceMeasureEntry first = performanceOrder.get(0);
            position = new PositionCommand(first.id(), first.sourceMeasureId(), first.occurrence(), 1.0, 0L);
        }
        validatePosition(performanceOrder, position.toRehearsalPosition());
        validateScoreVersion(session, payload);

        int bpm = "BPM_CHANGE_REQUEST".equals(type)
                ? clampBpm(number(payload.get("bpm"), ((Number) current.get("bpm")).intValue()).intValue())
                : ((Number) current.get("bpm")).intValue();
        int countInMeasures = "COUNT_IN_CHANGE_REQUEST".equals(type)
                ? clampCountIn(number(payload.get("countInMeasures"), ((Number) current.get("countInMeasures")).intValue()).intValue())
                : ((Number) current.get("countInMeasures")).intValue();

        if ("PLAY_REQUEST".equals(type) && payload.get("bpm") != null) {
            bpm = clampBpm(number(payload.get("bpm"), bpm).intValue());
        }
        if ("PLAY_REQUEST".equals(type) && payload.get("countInMeasures") != null) {
            countInMeasures = clampCountIn(number(payload.get("countInMeasures"), countInMeasures).intValue());
        }

        long effectiveAt = "PLAY_REQUEST".equals(type) ? nowMs() + effectiveDelayMs : nowMs();
        long sequence = ((Number) current.get("sequence")).longValue() + 1;
        jdbcTemplate.update(
                """
                update rehearsal_sessions
                set status = case when status = 'CREATED' then 'ACTIVE' else status end,
                    started_at = case when started_at is null then now() else started_at end,
                    revision = revision + 1
                where id = ?
                """,
                sessionId
        );
        updateSnapshot(
                sessionId,
                status,
                position.performanceMeasureId(),
                position.sourceMeasureId(),
                position.occurrence(),
                position.beat(),
                bpm,
                countInMeasures,
                position.baseTimelinePositionMs(),
                effectiveAt,
                sequence,
                user.id()
        );
        Map<String, Object> updated = getSession(user, sessionId);
        return new RehearsalCommandResult(updated, (Map<String, Object>) updated.get("state"), false);
    }

    private void updateSnapshot(
            String sessionId,
            String playbackStatus,
            String performanceMeasureId,
            String sourceMeasureId,
            int occurrence,
            double beat,
            int bpm,
            int countInMeasures,
            long baseTimelinePositionMs,
            long effectiveAtServerTime,
            long sequence,
            String updatedByUserId
    ) {
        jdbcTemplate.update(
                """
                update rehearsal_state_snapshots
                set playback_status = ?, performance_measure_id = ?, source_measure_id = ?, occurrence = ?,
                    beat = ?, bpm = ?, count_in_measures = ?, base_timeline_position_ms = ?,
                    effective_at_server_time = ?, sequence = ?, updated_by_user_id = ?, updated_at = now()
                where session_id = ?
                """,
                playbackStatus,
                performanceMeasureId,
                sourceMeasureId,
                occurrence,
                BigDecimal.valueOf(beat),
                bpm,
                countInMeasures,
                baseTimelinePositionMs,
                effectiveAtServerTime,
                sequence,
                updatedByUserId,
                sessionId
        );
    }

    private Map<String, Object> readSessionRow(String sessionId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                select id, ensemble_id, score_id, score_version_id, leader_user_id, status,
                       created_by_user_id, created_at, started_at, ended_at, revision, performance_order_json
                from rehearsal_sessions
                where id = ?
                """,
                (rs, rowNum) -> sessionRow(rs),
                sessionId
        );
        if (rows.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Rehearsal session not found");
        }
        return rows.get(0);
    }

    private Map<String, Object> sessionRow(ResultSet rs) throws SQLException {
        Map<String, Object> row = new HashMap<>();
        row.put("id", rs.getString("id"));
        row.put("ensembleId", rs.getString("ensemble_id"));
        row.put("scoreId", rs.getString("score_id"));
        row.put("scoreVersionId", rs.getString("score_version_id"));
        row.put("leaderUserId", rs.getString("leader_user_id"));
        row.put("status", rs.getString("status"));
        row.put("createdBy", rs.getString("created_by_user_id"));
        row.put("createdAt", timestampToString(rs.getTimestamp("created_at")));
        row.put("startedAt", timestampToString(rs.getTimestamp("started_at")));
        row.put("endedAt", timestampToString(rs.getTimestamp("ended_at")));
        row.put("revision", rs.getLong("revision"));
        row.put("performanceOrder", performanceOrder(rs.getString("performance_order_json")));
        return row;
    }

    private Map<String, Object> readState(String sessionId, Map<String, Object> session) {
        return jdbcTemplate.queryForObject(
                """
                select session_id, score_id, score_version_id, playback_status, performance_measure_id,
                       source_measure_id, occurrence, beat, bpm, count_in_measures, base_timeline_position_ms,
                       effective_at_server_time, sequence, updated_by_user_id, updated_at
                from rehearsal_state_snapshots
                where session_id = ?
                """,
                (rs, rowNum) -> {
                    Map<String, Object> row = new HashMap<>();
                    row.put("sessionId", rs.getString("session_id"));
                    row.put("scoreId", rs.getString("score_id"));
                    row.put("scoreVersionId", rs.getString("score_version_id"));
                    row.put("leaderUserId", session.get("leaderUserId"));
                    row.put("playbackStatus", rs.getString("playback_status"));
                    row.put("performanceMeasureId", rs.getString("performance_measure_id"));
                    row.put("sourceMeasureId", rs.getString("source_measure_id"));
                    row.put("occurrence", rs.getInt("occurrence"));
                    row.put("beat", rs.getBigDecimal("beat").doubleValue());
                    row.put("bpm", rs.getInt("bpm"));
                    row.put("countInMeasures", rs.getInt("count_in_measures"));
                    row.put("baseTimelinePositionMs", rs.getLong("base_timeline_position_ms"));
                    row.put("effectiveAtServerTime", rs.getLong("effective_at_server_time"));
                    row.put("sequence", rs.getLong("sequence"));
                    row.put("serverTimestamp", nowMs());
                    row.put("updatedByUserId", rs.getString("updated_by_user_id"));
                    return row;
                },
                sessionId
        );
    }

    private List<Map<String, Object>> listParticipants(String sessionId) {
        return jdbcTemplate.query(
                """
                select p.session_id, p.user_id, u.display_name, p.connection_state, p.follow_mode,
                       p.joined_at, p.last_seen_at
                from rehearsal_participants p
                join users u on u.id = p.user_id
                where p.session_id = ?
                order by p.joined_at asc
                """,
                (rs, rowNum) -> Map.of(
                        "sessionId", rs.getString("session_id"),
                        "userId", rs.getString("user_id"),
                        "displayName", rs.getString("display_name"),
                        "connectionState", rs.getString("connection_state"),
                        "followMode", rs.getString("follow_mode"),
                        "joinedAt", timestampToString(rs.getTimestamp("joined_at")),
                        "lastSeenAt", timestampToString(rs.getTimestamp("last_seen_at"))
                ),
                sessionId
        );
    }

    private Map<String, Object> participantForUser(String sessionId, String userId) {
        return listParticipants(sessionId).stream()
                .filter(participant -> userId.equals(participant.get("userId")))
                .findFirst()
                .orElse(Map.of("sessionId", sessionId, "userId", userId));
    }

    private void upsertParticipant(String sessionId, AuthenticatedUser user, String connectionState, String followMode) {
        jdbcTemplate.update(
                """
                insert into rehearsal_participants(session_id, user_id, joined_at, last_seen_at, connection_state, follow_mode)
                values (?, ?, now(), now(), ?, ?)
                on conflict (session_id, user_id)
                do update set last_seen_at = now(), connection_state = excluded.connection_state, follow_mode = excluded.follow_mode
                """,
                sessionId,
                user.id(),
                connectionState,
                followMode
        );
    }

    private ScoreVersionRef requireScoreVersionMember(AuthenticatedUser user, String ensembleId, String scoreId, String versionId) {
        String role = requireMemberRole(user, ensembleId);
        List<ScoreVersionRef> rows = jdbcTemplate.query(
                """
                select s.id as score_id, sv.id as version_id
                from scores s
                join score_versions sv on sv.score_id = s.id
                where s.id = ? and sv.id = ? and s.ensemble_id = ?
                """,
                (rs, rowNum) -> new ScoreVersionRef(rs.getString("score_id"), rs.getString("version_id"), role),
                scoreId,
                versionId,
                ensembleId
        );
        if (rows.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Score version not found in this ensemble");
        }
        return rows.get(0);
    }

    private String requireMemberRole(AuthenticatedUser user, String ensembleId) {
        List<String> roles = jdbcTemplate.query(
                "select role from ensemble_members where ensemble_id = ? and user_id = ?",
                (rs, rowNum) -> rs.getString("role"),
                ensembleId,
                user.id()
        );
        if (roles.isEmpty()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Ensemble membership is required");
        }
        return roles.get(0);
    }

    private void rejectIfEnded(Map<String, Object> session) {
        if ("ENDED".equals(session.get("status"))) {
            throw new ApiException(ErrorCode.CONFLICT, "Rehearsal session has ended");
        }
    }

    private void validateScoreVersion(Map<String, Object> session, Map<String, Object> payload) {
        Object payloadVersionId = payload.get("scoreVersionId");
        if (payloadVersionId != null && !String.valueOf(session.get("scoreVersionId")).equals(String.valueOf(payloadVersionId))) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Command scoreVersionId does not match the session");
        }
    }

    private void validatePosition(List<PerformanceMeasureEntry> performanceOrder, RehearsalPosition position) {
        if (position.beat() == null || position.beat() <= 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "beat must be greater than zero");
        }
        PerformanceMeasureEntry match = performanceOrder.stream()
                .filter(entry -> entry.id().equals(position.performanceMeasureId()))
                .findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.VALIDATION_FAILED, "performanceMeasureId is not in the session performance order"));
        if (!match.sourceMeasureId().equals(position.sourceMeasureId()) || !match.occurrence().equals(position.occurrence())) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "sourceMeasureId and occurrence must match performanceMeasureId");
        }
    }

    private PositionCommand positionFromPayloadOrCurrent(Map<String, Object> payload, Map<String, Object> current) {
        String performanceMeasureId = stringOrDefault(payload.get("performanceMeasureId"), String.valueOf(current.get("performanceMeasureId")));
        String sourceMeasureId = stringOrDefault(payload.get("sourceMeasureId"), String.valueOf(current.get("sourceMeasureId")));
        int occurrence = number(payload.get("occurrence"), ((Number) current.get("occurrence")).intValue()).intValue();
        double beat = number(payload.get("beat"), ((Number) current.get("beat")).doubleValue()).doubleValue();
        long baseTimelinePositionMs = number(payload.get("baseTimelinePositionMs"), ((Number) current.get("baseTimelinePositionMs")).longValue()).longValue();
        return new PositionCommand(performanceMeasureId, sourceMeasureId, occurrence, beat, baseTimelinePositionMs);
    }

    private ExistingCommand findExistingCommand(String sessionId, String userId, String clientCommandId) {
        List<ExistingCommand> rows = jdbcTemplate.query(
                """
                select result_sequence, rejected, rejection_code
                from rehearsal_processed_commands
                where session_id = ? and user_id = ? and client_command_id = ?
                """,
                (rs, rowNum) -> new ExistingCommand(rs.getLong("result_sequence"), rs.getBoolean("rejected"), rs.getString("rejection_code")),
                sessionId,
                userId,
                clientCommandId
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    @SuppressWarnings("unchecked")
    private List<PerformanceMeasureEntry> performanceOrder(Map<String, Object> session) {
        Object value = session.get("performanceOrder");
        if (value instanceof List<?> list) {
            return (List<PerformanceMeasureEntry>) list;
        }
        return List.of();
    }

    private List<PerformanceMeasureEntry> performanceOrder(String json) {
        try {
            return objectMapper.readValue(json, PERFORMANCE_ORDER_TYPE);
        } catch (JsonProcessingException exception) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Stored performance order is invalid");
        }
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "performanceOrder JSON is invalid");
        }
    }

    private static boolean isOwnerOrAdmin(String role) {
        return "OWNER".equals(role) || "ADMIN".equals(role);
    }

    private static String normalizeFollowMode(String followMode) {
        return "BROWSING_INDEPENDENTLY".equals(followMode) ? "BROWSING_INDEPENDENTLY" : "FOLLOWING_LEADER";
    }

    private static int clampBpm(int bpm) {
        if (bpm < 30 || bpm > 300) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "bpm must be between 30 and 300");
        }
        return bpm;
    }

    private static int clampCountIn(int countInMeasures) {
        if (countInMeasures < 0 || countInMeasures > 8) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "countInMeasures must be between 0 and 8");
        }
        return countInMeasures;
    }

    private static String requiredString(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, field + " is required");
        }
        return text;
    }

    private static String stringOrDefault(Object value, String fallback) {
        return value instanceof String text && !text.isBlank() ? text : fallback;
    }

    private static Number number(Object value, Number fallback) {
        return value instanceof Number number ? number : fallback;
    }

    private static long nowMs() {
        return Instant.now().toEpochMilli();
    }

    private static String timestampToString(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    private static Long stateSequence(Map<String, Object> session) {
        Object state = session.get("state");
        if (state instanceof Map<?, ?> map && map.get("sequence") instanceof Number sequence) {
            return sequence.longValue();
        }
        return null;
    }

    private record ScoreVersionRef(String scoreId, String versionId, String role) {
    }

    private record ExistingCommand(long resultSequence, boolean rejected, String rejectionCode) {
    }

    private record PositionCommand(String performanceMeasureId, String sourceMeasureId, int occurrence, double beat, long baseTimelinePositionMs) {
        RehearsalPosition toRehearsalPosition() {
            return new RehearsalPosition(performanceMeasureId, sourceMeasureId, occurrence, beat, baseTimelinePositionMs);
        }
    }
}
