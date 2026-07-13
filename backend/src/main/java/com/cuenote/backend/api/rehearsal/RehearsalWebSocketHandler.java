package com.cuenote.backend.api.rehearsal;

import com.cuenote.backend.api.auth.AuthService;
import com.cuenote.backend.api.auth.AuthenticatedUser;
import com.cuenote.backend.api.error.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class RehearsalWebSocketHandler extends TextWebSocketHandler {

    private static final int MAX_MESSAGE_BYTES = 32 * 1024;
    private static final String SESSION_ID_ATTRIBUTE = "rehearsalSessionId";
    private static final String USER_ATTRIBUTE = "rehearsalUser";

    private final ObjectMapper objectMapper;
    private final AuthService authService;
    private final RehearsalService rehearsalService;
    private final RehearsalSocketNotifier notifier;

    public RehearsalWebSocketHandler(
            ObjectMapper objectMapper,
            AuthService authService,
            RehearsalService rehearsalService,
            RehearsalSocketNotifier notifier
    ) {
        this.objectMapper = objectMapper;
        this.authService = authService;
        this.rehearsalService = rehearsalService;
        this.notifier = notifier;
    }

    @Override
    protected void handleTextMessage(WebSocketSession webSocketSession, TextMessage message) {
        if (message.getPayloadLength() > MAX_MESSAGE_BYTES) {
            sendError(webSocketSession, null, null, "MESSAGE_TOO_LARGE", "Rehearsal WebSocket message is too large");
            return;
        }

        RehearsalClientEnvelope envelope;
        try {
            envelope = objectMapper.readValue(message.getPayload(), RehearsalClientEnvelope.class);
        } catch (JsonProcessingException exception) {
            sendError(webSocketSession, null, null, "MALFORMED_JSON", "Malformed rehearsal WebSocket JSON");
            return;
        }

        try {
            dispatch(webSocketSession, envelope);
        } catch (ApiException exception) {
            notifier.send(
                    webSocketSession,
                    RehearsalServerEnvelope.of(
                            "COMMAND_REJECTED",
                            envelope.sessionId(),
                            envelope.clientCommandId(),
                            null,
                            Map.of("code", exception.getErrorCode().name(), "message", exception.getMessage(), "clientCommandId", envelope.clientCommandId() == null ? "" : envelope.clientCommandId())
                    )
            );
        } catch (RuntimeException exception) {
            sendError(webSocketSession, envelope.sessionId(), envelope.clientCommandId(), "INTERNAL_ERROR", "Unexpected rehearsal WebSocket error");
        }
    }

    private void dispatch(WebSocketSession webSocketSession, RehearsalClientEnvelope envelope) {
        if (envelope.type() == null || envelope.type().isBlank()) {
            sendError(webSocketSession, envelope.sessionId(), envelope.clientCommandId(), "VALIDATION_FAILED", "type is required");
            return;
        }

        switch (envelope.type()) {
            case "JOIN_SESSION" -> join(webSocketSession, envelope);
            case "LEAVE_SESSION" -> leave(webSocketSession, envelope);
            case "REQUEST_STATE_SNAPSHOT" -> snapshot(webSocketSession, envelope);
            case "PING" -> pong(webSocketSession, envelope);
            case "FOLLOW_MODE_CHANGE" -> followMode(webSocketSession, envelope);
            case "PLAY_REQUEST", "PAUSE_REQUEST", "STOP_REQUEST", "SEEK_REQUEST", "BPM_CHANGE_REQUEST", "COUNT_IN_CHANGE_REQUEST", "LEADER_TRANSFER_REQUEST" ->
                    command(webSocketSession, envelope);
            default -> sendError(webSocketSession, envelope.sessionId(), envelope.clientCommandId(), "UNKNOWN_TYPE", "Unknown rehearsal WebSocket message type");
        }
    }

    private void join(WebSocketSession webSocketSession, RehearsalClientEnvelope envelope) {
        Map<String, Object> payload = payload(envelope);
        String accessToken = requiredString(payload, "accessToken");
        String sessionId = envelope.sessionId() == null ? requiredString(payload, "sessionId") : envelope.sessionId();
        AuthenticatedUser user = authService.requireUserByAccessToken(accessToken);
        Map<String, Object> session = rehearsalService.joinSession(user, sessionId, stringValue(payload.get("followMode")));

        webSocketSession.getAttributes().put(SESSION_ID_ATTRIBUTE, sessionId);
        webSocketSession.getAttributes().put(USER_ATTRIBUTE, user);
        notifier.register(sessionId, webSocketSession);

        Long sequence = stateSequence(session);
        notifier.send(webSocketSession, RehearsalServerEnvelope.of("SESSION_JOINED", sessionId, envelope.clientCommandId(), sequence, session));
        notifier.send(webSocketSession, RehearsalServerEnvelope.of("PARTICIPANT_LIST", sessionId, null, sequence, session.get("participants")));
        notifier.send(
                webSocketSession,
                RehearsalServerEnvelope.of(
                        "STATE_SNAPSHOT",
                        sessionId,
                        null,
                        sequence,
                        Map.of("session", session, "participants", session.get("participants"), "state", session.get("state"), "reason", "JOIN")
                )
        );
    }

    private void leave(WebSocketSession webSocketSession, RehearsalClientEnvelope envelope) {
        AuthenticatedUser user = requireJoinedUser(webSocketSession);
        String sessionId = joinedSessionId(webSocketSession, envelope.sessionId());
        rehearsalService.leaveSession(user, sessionId);
        notifier.unregister(sessionId, webSocketSession);
        notifier.send(webSocketSession, RehearsalServerEnvelope.of("SESSION_ENDED", sessionId, envelope.clientCommandId(), null, Map.of("left", true)));
    }

    private void snapshot(WebSocketSession webSocketSession, RehearsalClientEnvelope envelope) {
        AuthenticatedUser user = requireJoinedUser(webSocketSession);
        String sessionId = joinedSessionId(webSocketSession, envelope.sessionId());
        Map<String, Object> payload = payload(envelope);
        Map<String, Object> snapshot = rehearsalService.snapshot(user, sessionId, stringValue(payload.get("reason")));
        notifier.send(webSocketSession, RehearsalServerEnvelope.of("STATE_SNAPSHOT", sessionId, envelope.clientCommandId(), stateSequence(snapshot), snapshot));
    }

    private void pong(WebSocketSession webSocketSession, RehearsalClientEnvelope envelope) {
        long receivedAt = System.currentTimeMillis();
        Map<String, Object> payload = payload(envelope);
        Object clientSentAt = payload.getOrDefault("clientSentAt", receivedAt);
        notifier.send(
                webSocketSession,
                RehearsalServerEnvelope.of(
                        "PONG",
                        envelope.sessionId(),
                        envelope.clientCommandId(),
                        null,
                        Map.of("clientSentAt", clientSentAt, "serverReceivedAt", receivedAt, "serverSentAt", System.currentTimeMillis())
                )
        );
    }

    private void followMode(WebSocketSession webSocketSession, RehearsalClientEnvelope envelope) {
        AuthenticatedUser user = requireJoinedUser(webSocketSession);
        String sessionId = joinedSessionId(webSocketSession, envelope.sessionId());
        Map<String, Object> participant = rehearsalService.updateFollowMode(user, sessionId, stringValue(payload(envelope).get("followMode")));
        notifier.broadcast(sessionId, RehearsalServerEnvelope.of("PARTICIPANT_LIST", sessionId, envelope.clientCommandId(), null, Map.of("participant", participant)));
    }

    private void command(WebSocketSession webSocketSession, RehearsalClientEnvelope envelope) {
        AuthenticatedUser user = requireJoinedUser(webSocketSession);
        String sessionId = joinedSessionId(webSocketSession, envelope.sessionId());
        RehearsalCommandResult result = rehearsalService.applyCommand(user, sessionId, envelope.type(), envelope.clientCommandId(), payload(envelope));
        if (result.idempotentReplay()) {
            notifier.send(webSocketSession, RehearsalServerEnvelope.of("STATE_SNAPSHOT", sessionId, envelope.clientCommandId(), stateSequence(result.session()), result));
            return;
        }
        notifier.broadcast(
                sessionId,
                RehearsalServerEnvelope.of(
                        "PLAYBACK_STATE_CHANGED",
                        sessionId,
                        envelope.clientCommandId(),
                        ((Number) result.state().get("sequence")).longValue(),
                        Map.of("session", result.session(), "state", result.state())
                )
        );
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Object sessionId = session.getAttributes().get(SESSION_ID_ATTRIBUTE);
        Object user = session.getAttributes().get(USER_ATTRIBUTE);
        if (sessionId instanceof String rehearsalSessionId) {
            notifier.unregister(rehearsalSessionId, session);
            if (user instanceof AuthenticatedUser authenticatedUser) {
                rehearsalService.leaveSession(authenticatedUser, rehearsalSessionId);
            }
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        Object sessionId = session.getAttributes().get(SESSION_ID_ATTRIBUTE);
        if (sessionId instanceof String rehearsalSessionId) {
            notifier.unregister(rehearsalSessionId, session);
        }
    }

    private AuthenticatedUser requireJoinedUser(WebSocketSession webSocketSession) {
        Object user = webSocketSession.getAttributes().get(USER_ATTRIBUTE);
        if (user instanceof AuthenticatedUser authenticatedUser) {
            return authenticatedUser;
        }
        throw new ApiException(com.cuenote.backend.api.error.ErrorCode.UNAUTHORIZED, "JOIN_SESSION is required before commands");
    }

    private String joinedSessionId(WebSocketSession webSocketSession, String envelopeSessionId) {
        Object sessionId = webSocketSession.getAttributes().get(SESSION_ID_ATTRIBUTE);
        if (!(sessionId instanceof String joinedSessionId)) {
            throw new ApiException(com.cuenote.backend.api.error.ErrorCode.UNAUTHORIZED, "JOIN_SESSION is required before commands");
        }
        if (envelopeSessionId != null && !envelopeSessionId.equals(joinedSessionId)) {
            throw new ApiException(com.cuenote.backend.api.error.ErrorCode.VALIDATION_FAILED, "Envelope sessionId does not match joined session");
        }
        return joinedSessionId;
    }

    private void sendError(WebSocketSession session, String sessionId, String clientCommandId, String code, String message) {
        notifier.send(session, RehearsalServerEnvelope.of("ERROR", sessionId, clientCommandId, null, Map.of("code", code, "message", message)));
    }

    private static Map<String, Object> payload(RehearsalClientEnvelope envelope) {
        return envelope.payload() == null ? Map.of() : envelope.payload();
    }

    private static String requiredString(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new ApiException(com.cuenote.backend.api.error.ErrorCode.VALIDATION_FAILED, field + " is required");
    }

    private static String stringValue(Object value) {
        return value instanceof String text ? text : null;
    }

    private static Long stateSequence(Map<String, Object> sessionOrSnapshot) {
        Object state = sessionOrSnapshot.get("state");
        if (state instanceof Map<?, ?> map && map.get("sequence") instanceof Number sequence) {
            return sequence.longValue();
        }
        return null;
    }
}
