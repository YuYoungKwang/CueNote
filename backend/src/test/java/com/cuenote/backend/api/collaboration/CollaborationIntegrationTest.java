package com.cuenote.backend.api.collaboration;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CollaborationIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("cuenote")
            .withUsername("cuenote")
            .withPassword("cuenote_test_password");

    @Autowired
    private TestRestTemplate restTemplate;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("cuenote.object-storage.local-root", () -> "target/test-object-storage");
    }

    @Test
    void persistsScoresVersionsAndEnforcesAnnotationPermissions() {
        JsonNode ownerSession = login("owner@cuenote.local", "Owner");
        String ownerToken = ownerSession.path("accessToken").asText();
        JsonNode memberSession = login("member@cuenote.local", "Member");
        String memberToken = memberSession.path("accessToken").asText();

        JsonNode ensemble = postJson("/api/v1/ensembles", ownerToken, Map.of("name", "Quartet"), HttpStatus.OK);
        String ensembleId = ensemble.path("id").asText();
        String memberUserId = memberSession.path("user").path("id").asText();
        postJson("/api/v1/ensembles/" + ensembleId + "/members", ownerToken, Map.of("userId", memberUserId, "role", "MEMBER"), HttpStatus.OK);

        JsonNode score = uploadScore("/api/v1/ensembles/" + ensembleId + "/scores", ownerToken, "Server Sample");
        String scoreId = score.path("id").asText();
        String versionId = score.path("current_version_id").asText();
        assertThat(versionId).isNotBlank();

        ResponseEntity<String> sourceResponse = restTemplate.exchange(
                "/api/v1/scores/" + scoreId + "/versions/" + versionId + "/source",
                HttpMethod.GET,
                new HttpEntity<>(authHeaders(memberToken)),
                String.class
        );
        assertThat(sourceResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sourceResponse.getBody()).contains("<score-partwise");

        JsonNode privateSync = sync(ownerToken, scoreId, versionId, "annotation-private", "PRIVATE", null, 0, "mutation-private", HttpStatus.OK);
        assertThat(privateSync.path("applied").size()).isEqualTo(1);

        JsonNode memberVisible = getJson("/api/v1/scores/" + scoreId + "/annotations?scoreVersionId=" + versionId, memberToken, HttpStatus.OK);
        assertThat(memberVisible.size()).isEqualTo(0);

        JsonNode ensembleSync = sync(ownerToken, scoreId, versionId, "annotation-ensemble", "ENSEMBLE", null, 0, "mutation-ensemble", HttpStatus.OK);
        assertThat(ensembleSync.path("applied").get(0).path("revision").asLong()).isEqualTo(1);

        JsonNode memberVisibleAfterEnsemble = getJson("/api/v1/scores/" + scoreId + "/annotations?scoreVersionId=" + versionId, memberToken, HttpStatus.OK);
        assertThat(memberVisibleAfterEnsemble.size()).isEqualTo(1);
        assertThat(memberVisibleAfterEnsemble.get(0).path("scope").asText()).isEqualTo("ENSEMBLE");

        JsonNode conflict = sync(ownerToken, scoreId, versionId, "annotation-ensemble", "ENSEMBLE", null, 0, "mutation-conflict", HttpStatus.CONFLICT);
        assertThat(conflict.path("conflicts").size()).isEqualTo(1);
        assertThat(conflict.path("conflicts").get(0).path("serverRevision").asLong()).isEqualTo(1);
    }

    @Test
    void blocksScoresForUsersWithoutEnsembleMembership() {
        JsonNode ownerSession = login("owner2@cuenote.local", "Owner 2");
        JsonNode outsiderSession = login("outsider@cuenote.local", "Outsider");
        String ownerToken = ownerSession.path("accessToken").asText();
        String outsiderToken = outsiderSession.path("accessToken").asText();

        JsonNode ensemble = postJson("/api/v1/ensembles", ownerToken, Map.of("name", "Private Ensemble"), HttpStatus.OK);
        JsonNode score = uploadScore("/api/v1/ensembles/" + ensemble.path("id").asText() + "/scores", ownerToken, "Private Score");

        getJson("/api/v1/scores/" + score.path("id").asText(), outsiderToken, HttpStatus.FORBIDDEN);
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

    private JsonNode getJson(String url, String token, HttpStatus expectedStatus) {
        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.GET, new HttpEntity<>(authHeaders(token)), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(expectedStatus);
        return expectedStatus.isError() ? response.getBody().path("error").path("details") : response.getBody().path("data");
    }

    private JsonNode uploadScore(String url, String token, String title) {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("title", title);
        body.add("composer", "CueNote Test");
        body.add("file", new ByteArrayResource(SAMPLE_MUSICXML.getBytes(StandardCharsets.UTF_8)) {
            @Override
            public String getFilename() {
                return "sample.musicxml";
            }
        });

        HttpHeaders headers = authHeaders(token);
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody().path("data");
    }

    private JsonNode sync(
            String token,
            String scoreId,
            String versionId,
            String annotationId,
            String scope,
            String partId,
            long baseRevision,
            String clientMutationId,
            HttpStatus expectedStatus
    ) {
        Map<String, Object> annotation = new java.util.HashMap<>();
        annotation.put("id", annotationId);
        annotation.put("schemaVersion", 1);
        annotation.put("scoreId", scoreId);
        annotation.put("scoreVersionId", versionId);
        annotation.put("type", "TEXT");
        annotation.put("scope", scope);
        annotation.put("partId", partId);
        annotation.put("anchor", Map.of("type", "MEASURE", "sourceMeasureId", scoreId + ":p1:m1:m1"));
        annotation.put("payload", Map.of("text", "cue", "x", 0.2, "y", 0.2, "width", 0.4, "height", 0.12, "fontSizeRatio", 0.1));
        annotation.put("createdAt", 1700000000000L);
        annotation.put("updatedAt", 1700000000000L);

        Map<String, Object> mutation = Map.of(
                "clientMutationId", clientMutationId,
                "baseRevision", baseRevision,
                "action", "UPSERT",
                "annotation", annotation
        );
        return postJson(
                "/api/v1/scores/" + scoreId + "/annotations/sync",
                token,
                Map.of("scoreVersionId", versionId, "mutations", java.util.List.of(mutation)),
                expectedStatus
        );
    }

    private HttpHeaders authHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    private static final String SAMPLE_MUSICXML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <score-partwise version="4.0">
              <work><work-title>Server Sample</work-title></work>
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
