package com.cuenote.backend.api.rehearsal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@Tag("postgres")
@Tag("websocket")
@Tag("rehearsal")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RehearsalIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("cuenote")
            .withUsername("cuenote")
            .withPassword("cuenote_test_password");

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @LocalServerPort
    private int port;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("cuenote.object-storage.type", () -> "local");
    }

    @Test
    void persistsSessionAndBroadcastsAuthoritativePlaybackToMultipleWebSocketClients() throws Exception {
        Workspace workspace = createWorkspace();
        JsonNode session = createRehearsalSession(workspace.ownerToken(), workspace.ensembleId(), workspace.scoreId(), workspace.versionId(), HttpStatus.OK);
        String sessionId = session.path("id").asText();
        assertThat(session.path("state").path("sequence").asLong()).isEqualTo(1);

        JsonNode listed = getJson("/api/v1/ensembles/" + workspace.ensembleId() + "/rehearsal-sessions", workspace.memberToken(), HttpStatus.OK);
        assertThat(listed).hasSize(1);

        SocketProbe ownerSocket = connectSocket();
        SocketProbe memberSocket = connectSocket();
        ownerSocket.send(joinMessage(sessionId, workspace.ownerToken(), "FOLLOWING_LEADER"));
        memberSocket.send(joinMessage(sessionId, workspace.memberToken(), "FOLLOWING_LEADER"));
        assertThat(ownerSocket.await("STATE_SNAPSHOT").path("payload").path("state").path("sequence").asLong()).isEqualTo(1);
        assertThat(memberSocket.await("STATE_SNAPSHOT").path("payload").path("state").path("sequence").asLong()).isEqualTo(1);

        ownerSocket.send(command(sessionId, "PLAY_REQUEST", "cmd-play", workspace, 92, 1));
        JsonNode ownerPlay = ownerSocket.await("PLAYBACK_STATE_CHANGED");
        JsonNode memberPlay = memberSocket.await("PLAYBACK_STATE_CHANGED");
        assertThat(ownerPlay.path("sequence").asLong()).isEqualTo(2);
        assertThat(memberPlay.path("payload").path("state").path("playbackStatus").asText()).isEqualTo("PLAYING");
        assertThat(memberPlay.path("payload").path("state").path("performanceMeasureId").asText()).isEqualTo(workspace.performanceMeasureId());
        assertThat(memberPlay.path("payload").path("state").path("effectiveAtServerTime").asLong()).isGreaterThan(0);

        ownerSocket.send(command(sessionId, "PLAY_REQUEST", "cmd-play", workspace, 92, 1));
        JsonNode replay = ownerSocket.await("STATE_SNAPSHOT");
        assertThat(replay.path("payload").path("state").path("sequence").asLong()).isEqualTo(2);

        memberSocket.send(command(sessionId, "PAUSE_REQUEST", "cmd-member-pause", workspace, 92, 1));
        JsonNode rejection = memberSocket.await("COMMAND_REJECTED");
        assertThat(rejection.path("payload").path("code").asText()).isEqualTo("FORBIDDEN");

        ownerSocket.send(command(sessionId, "SEEK_REQUEST", "cmd-seek", workspace, 92, 1));
        JsonNode seek = memberSocket.await("PLAYBACK_STATE_CHANGED");
        assertThat(seek.path("sequence").asLong()).isEqualTo(3);

        JsonNode ended = postJson("/api/v1/rehearsal-sessions/" + sessionId + "/end", workspace.ownerToken(), Map.of(), HttpStatus.OK);
        assertThat(ended.path("status").asText()).isEqualTo("ENDED");
        assertThat(memberSocket.await("SESSION_ENDED").path("payload").path("status").asText()).isEqualTo("ENDED");

        ownerSocket.send(command(sessionId, "STOP_REQUEST", "cmd-after-end", workspace, 92, 1));
        assertThat(ownerSocket.await("COMMAND_REJECTED").path("payload").path("code").asText()).isEqualTo("CONFLICT");

        ownerSocket.close();
        memberSocket.close();
    }

    @Test
    void blocksInvalidRolesVersionMismatchAndInvalidPositions() {
        Workspace workspace = createWorkspace();
        JsonNode outsider = login(uniqueEmail("outsider"), "Outsider");
        createRehearsalSession(outsider.path("accessToken").asText(), workspace.ensembleId(), workspace.scoreId(), workspace.versionId(), HttpStatus.FORBIDDEN);

        JsonNode session = createRehearsalSession(workspace.ownerToken(), workspace.ensembleId(), workspace.scoreId(), workspace.versionId(), HttpStatus.OK);
        String sessionId = session.path("id").asText();

        postJson("/api/v1/rehearsal-sessions/" + sessionId + "/join", outsider.path("accessToken").asText(), Map.of("followMode", "FOLLOWING_LEADER"), HttpStatus.FORBIDDEN);
        patchJson("/api/v1/rehearsal-sessions/" + sessionId + "/leader", workspace.memberToken(), Map.of("leaderUserId", workspace.memberUserId()), HttpStatus.FORBIDDEN);
    }

    private Workspace createWorkspace() {
        JsonNode ownerSession = login(uniqueEmail("owner"), "Owner");
        JsonNode memberSession = login(uniqueEmail("member"), "Member");
        String ownerToken = ownerSession.path("accessToken").asText();
        String memberToken = memberSession.path("accessToken").asText();
        String memberUserId = memberSession.path("user").path("id").asText();

        JsonNode ensemble = postJson("/api/v1/ensembles", ownerToken, Map.of("name", "Phase 5 Ensemble"), HttpStatus.OK);
        String ensembleId = ensemble.path("id").asText();
        postJson("/api/v1/ensembles/" + ensembleId + "/members", ownerToken, Map.of("userId", memberUserId, "role", "MEMBER"), HttpStatus.OK);
        JsonNode score = uploadMusicXml("/api/v1/ensembles/" + ensembleId + "/scores", ownerToken, "Rehearsal Score", SAMPLE_MUSICXML, HttpStatus.OK);

        String scoreId = score.path("id").asText();
        String versionId = score.path("current_version_id").asText();
        String sourceMeasureId = scoreId + ":p1:m1:m1";
        return new Workspace(ownerToken, memberToken, memberUserId, ensembleId, scoreId, versionId, sourceMeasureId, sourceMeasureId + "::1");
    }

    private JsonNode createRehearsalSession(String token, String ensembleId, String scoreId, String versionId, HttpStatus expectedStatus) {
        String sourceMeasureId = scoreId + ":p1:m1:m1";
        Map<String, Object> body = Map.of(
                "scoreId", scoreId,
                "scoreVersionId", versionId,
                "initialPosition", Map.of(
                        "performanceMeasureId", sourceMeasureId + "::1",
                        "sourceMeasureId", sourceMeasureId,
                        "occurrence", 1,
                        "beat", 1,
                        "baseTimelinePositionMs", 0
                ),
                "bpm", 80,
                "countInMeasures", 1,
                "performanceOrder", List.of(Map.of(
                        "id", sourceMeasureId + "::1",
                        "sourceMeasureId", sourceMeasureId,
                        "occurrence", 1,
                        "orderIndex", 0,
                        "beatCount", 4
                ))
        );
        return postJson("/api/v1/ensembles/" + ensembleId + "/rehearsal-sessions", token, body, expectedStatus);
    }

    private SocketProbe connectSocket() throws Exception {
        SocketProbe handler = new SocketProbe(objectMapper);
        WebSocketSession session = new StandardWebSocketClient()
                .execute(handler, "ws://127.0.0.1:" + port + "/ws/rehearsal")
                .get(10, TimeUnit.SECONDS);
        handler.session = session;
        return handler;
    }

    private Map<String, Object> joinMessage(String sessionId, String token, String followMode) {
        return Map.of(
                "protocolVersion", 1,
                "type", "JOIN_SESSION",
                "sessionId", sessionId,
                "clientCommandId", "join-" + UUID.randomUUID(),
                "payload", Map.of("accessToken", token, "followMode", followMode, "lastAppliedSequence", 0)
        );
    }

    private Map<String, Object> command(String sessionId, String type, String commandId, Workspace workspace, int bpm, int countInMeasures) {
        return Map.of(
                "protocolVersion", 1,
                "type", type,
                "sessionId", sessionId,
                "clientCommandId", commandId,
                "payload", Map.of(
                        "scoreVersionId", workspace.versionId(),
                        "performanceMeasureId", workspace.performanceMeasureId(),
                        "sourceMeasureId", workspace.sourceMeasureId(),
                        "occurrence", 1,
                        "beat", 1,
                        "baseTimelinePositionMs", 0,
                        "bpm", bpm,
                        "countInMeasures", countInMeasures
                )
        );
    }

    private JsonNode login(String email, String displayName) {
        return postJson("/api/v1/dev-auth/login", null, Map.of("email", email, "displayName", displayName), HttpStatus.OK);
    }

    private JsonNode postJson(String url, String token, Object body, HttpStatus expectedStatus) {
        HttpHeaders headers = token == null ? new HttpHeaders() : authHeaders(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(expectedStatus);
        return expectedStatus.isError() ? response.getBody().path("error").path("details") : response.getBody().path("data");
    }

    private JsonNode patchJson(String url, String token, Object body, HttpStatus expectedStatus) {
        HttpHeaders headers = token == null ? new HttpHeaders() : authHeaders(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.PATCH, new HttpEntity<>(body, headers), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(expectedStatus);
        return expectedStatus.isError() ? response.getBody().path("error").path("details") : response.getBody().path("data");
    }

    private JsonNode getJson(String url, String token, HttpStatus expectedStatus) {
        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.GET, new HttpEntity<>(authHeaders(token)), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(expectedStatus);
        return expectedStatus.isError() ? response.getBody().path("error").path("details") : response.getBody().path("data");
    }

    private JsonNode uploadMusicXml(String url, String token, String title, String xml, HttpStatus expectedStatus) {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("title", title);
        body.add("file", new ByteArrayResource(xml.getBytes(StandardCharsets.UTF_8)) {
            @Override
            public String getFilename() {
                return "sample.musicxml";
            }
        });

        HttpHeaders headers = authHeaders(token);
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(expectedStatus);
        return expectedStatus.isError() ? response.getBody().path("error").path("details") : response.getBody().path("data");
    }

    private HttpHeaders authHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    private String uniqueEmail(String prefix) {
        return prefix + "-" + UUID.randomUUID() + "@cuenote.local";
    }

    private record Workspace(
            String ownerToken,
            String memberToken,
            String memberUserId,
            String ensembleId,
            String scoreId,
            String versionId,
            String sourceMeasureId,
            String performanceMeasureId
    ) {
    }

    private class SocketProbe extends TextWebSocketHandler {
        private final ObjectMapper objectMapper;
        private final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
        private WebSocketSession session;

        SocketProbe(ObjectMapper objectMapper) {
            this.objectMapper = objectMapper;
        }

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
            messages.add(objectMapper.readTree(message.getPayload()));
        }

        void send(Object payload) throws Exception {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(payload)));
        }

        JsonNode await(String type) throws InterruptedException {
            long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
            while (System.nanoTime() < deadline) {
                JsonNode message = messages.poll(500, TimeUnit.MILLISECONDS);
                if (message != null && type.equals(message.path("type").asText())) {
                    return message;
                }
            }
            throw new AssertionError("Timed out waiting for " + type + ". Received: " + messages);
        }

        void close() throws Exception {
            session.close();
        }
    }

    private static final String SAMPLE_MUSICXML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <score-partwise version="4.0">
              <part-list>
                <score-part id="P1"><part-name>Piano</part-name></score-part>
              </part-list>
              <part id="P1">
                <measure number="1" xml:id="m1">
                  <attributes>
                    <divisions>1</divisions>
                    <key><fifths>0</fifths></key>
                    <time><beats>4</beats><beat-type>4</beat-type></time>
                    <clef><sign>G</sign><line>2</line></clef>
                  </attributes>
                  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
                </measure>
              </part>
            </score-partwise>
            """;
}
