package com.cuenote.backend.api.rehearsal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Component
public class RehearsalSocketNotifier {

    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, Set<WebSocketSession>> sessionsByRehearsal = new ConcurrentHashMap<>();

    public RehearsalSocketNotifier(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void register(String sessionId, WebSocketSession webSocketSession) {
        sessionsByRehearsal.computeIfAbsent(sessionId, ignored -> ConcurrentHashMap.newKeySet()).add(webSocketSession);
    }

    public void unregister(String sessionId, WebSocketSession webSocketSession) {
        Set<WebSocketSession> sessions = sessionsByRehearsal.get(sessionId);
        if (sessions == null) {
            return;
        }
        sessions.remove(webSocketSession);
        if (sessions.isEmpty()) {
            sessionsByRehearsal.remove(sessionId);
        }
    }

    public void send(WebSocketSession session, RehearsalServerEnvelope envelope) {
        if (!session.isOpen()) {
            return;
        }
        try {
            session.sendMessage(new TextMessage(toJson(envelope)));
        } catch (IOException ignored) {
            // A dead socket is removed by the close/error callbacks.
        }
    }

    public void broadcast(String sessionId, RehearsalServerEnvelope envelope) {
        Set<WebSocketSession> sessions = sessionsByRehearsal.get(sessionId);
        if (sessions == null) {
            return;
        }
        String json = toJson(envelope);
        sessions.removeIf(session -> !session.isOpen());
        for (WebSocketSession session : sessions) {
            try {
                session.sendMessage(new TextMessage(json));
            } catch (IOException ignored) {
                // A dead socket is removed by the next lifecycle callback.
            }
        }
    }

    private String toJson(RehearsalServerEnvelope envelope) {
        try {
            return objectMapper.writeValueAsString(envelope);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Rehearsal envelope serialization failed", exception);
        }
    }
}
