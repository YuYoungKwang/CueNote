package com.cuenote.backend.api.collaboration;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
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
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@Tag("postgres")
@Tag("object-storage")
@Tag("auth")
@Tag("api")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CollaborationIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("cuenote")
            .withUsername("cuenote")
            .withPassword("cuenote_test_password");

    @Container
    static final GenericContainer<?> minio = new GenericContainer<>("minio/minio:RELEASE.2025-09-07T16-13-09Z")
            .withEnv("MINIO_ROOT_USER", "cuenote")
            .withEnv("MINIO_ROOT_PASSWORD", "cuenote_dev_minio_password")
            .withCommand("server /data")
            .withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/minio/health/ready").forPort(9000));

    @Autowired
    private TestRestTemplate restTemplate;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("cuenote.object-storage.type", () -> "minio");
        registry.add("cuenote.object-storage.minio.endpoint", () -> "http://host.docker.internal:" + minio.getMappedPort(9000));
        registry.add("cuenote.object-storage.minio.access-key", () -> "cuenote");
        registry.add("cuenote.object-storage.minio.secret-key", () -> "cuenote_dev_minio_password");
        registry.add("cuenote.object-storage.minio.bucket", () -> "cuenote-test-scores");
    }

    @Test
    void devAuthSupportsLoginRefreshMeAndLogout() {
        JsonNode session = login(uniqueEmail("auth"), "Auth User");
        String accessToken = session.path("accessToken").asText();
        String refreshToken = session.path("refreshToken").asText();

        JsonNode me = getJson("/api/v1/auth/me", accessToken, HttpStatus.OK);
        assertThat(me.path("email").asText()).isEqualTo(session.path("user").path("email").asText());

        JsonNode refreshed = postJson("/api/v1/auth/refresh", null, Map.of("refreshToken", refreshToken), HttpStatus.OK);
        assertThat(refreshed.path("accessToken").asText()).isNotBlank().isNotEqualTo(accessToken);

        postJson("/api/v1/auth/logout", refreshed.path("accessToken").asText(), Map.of(), HttpStatus.OK);
        getJson("/api/v1/auth/me", refreshed.path("accessToken").asText(), HttpStatus.UNAUTHORIZED);
    }

    @Test
    void persistsScoresVersionsAndEnforcesAnnotationPermissions() {
        TestWorkspace workspace = createWorkspace();

        ResponseEntity<String> sourceResponse = restTemplate.exchange(
                "/api/v1/scores/" + workspace.scoreId() + "/versions/" + workspace.versionId() + "/source",
                HttpMethod.GET,
                new HttpEntity<>(authHeaders(workspace.memberToken())),
                String.class
        );
        assertThat(sourceResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sourceResponse.getBody()).contains("<score-partwise");

        JsonNode privateSync = sync(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-private", "PRIVATE", null, 0, "mutation-private", HttpStatus.OK);
        assertThat(privateSync.path("applied").size()).isEqualTo(1);

        JsonNode memberVisible = getJson(
                "/api/v1/scores/" + workspace.scoreId() + "/annotations?scoreVersionId=" + workspace.versionId(),
                workspace.memberToken(),
                HttpStatus.OK
        );
        assertThat(memberVisible.size()).isEqualTo(0);

        JsonNode ensembleSync = sync(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-ensemble", "ENSEMBLE", null, 0, "mutation-ensemble", HttpStatus.OK);
        assertThat(ensembleSync.path("applied").get(0).path("revision").asLong()).isEqualTo(1);

        JsonNode memberVisibleAfterEnsemble = getJson(
                "/api/v1/scores/" + workspace.scoreId() + "/annotations?scoreVersionId=" + workspace.versionId(),
                workspace.memberToken(),
                HttpStatus.OK
        );
        assertThat(memberVisibleAfterEnsemble.size()).isEqualTo(1);
        assertThat(memberVisibleAfterEnsemble.get(0).path("scope").asText()).isEqualTo("ENSEMBLE");

        JsonNode conflict = sync(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-ensemble", "ENSEMBLE", null, 0, "mutation-conflict", HttpStatus.CONFLICT);
        assertThat(conflict.path("conflicts").size()).isEqualTo(1);
        assertThat(conflict.path("conflicts").get(0).path("serverRevision").asLong()).isEqualTo(1);
    }

    @Test
    void createsScoreVersionsRejectsInvalidXmlAndBlocksUnauthorizedWrites() {
        TestWorkspace workspace = createWorkspace();
        JsonNode outsiderSession = login(uniqueEmail("outsider"), "Outsider");
        String outsiderToken = outsiderSession.path("accessToken").asText();

        JsonNode scoreBeforeEdit = getJson("/api/v1/scores/" + workspace.scoreId(), workspace.ownerToken(), HttpStatus.OK);
        long expectedRevision = scoreBeforeEdit.path("revision").asLong();
        JsonNode newVersion = uploadMusicXml(
                "/api/v1/scores/" + workspace.scoreId() + "/versions",
                workspace.ownerToken(),
                "Version Two",
                SECOND_SAMPLE_MUSICXML,
                Map.of(
                        "baseScoreVersionId", workspace.versionId(),
                        "editSummary", "Changed one pitch",
                        "annotationMigrationPolicy", "NONE",
                        "expectedScoreRevision", String.valueOf(expectedRevision)
                ),
                HttpStatus.OK
        );
        assertThat(newVersion.path("version_number").asInt()).isEqualTo(2);
        assertThat(newVersion.path("score_id").asText()).isEqualTo(workspace.scoreId());
        assertThat(newVersion.path("base_score_version_id").asText()).isEqualTo(workspace.versionId());
        assertThat(newVersion.path("edit_summary").asText()).isEqualTo("Changed one pitch");
        assertThat(newVersion.path("annotation_migration_policy").asText()).isEqualTo("NONE");

        uploadMusicXml(
                "/api/v1/scores/" + workspace.scoreId() + "/versions",
                workspace.ownerToken(),
                "Stale Edit",
                SECOND_SAMPLE_MUSICXML,
                Map.of("baseScoreVersionId", workspace.versionId(), "expectedScoreRevision", String.valueOf(expectedRevision)),
                HttpStatus.CONFLICT
        );

        uploadMusicXml(
                "/api/v1/scores/" + workspace.scoreId() + "/versions",
                workspace.memberToken(),
                "Member Edit",
                SECOND_SAMPLE_MUSICXML,
                Map.of("baseScoreVersionId", workspace.versionId()),
                HttpStatus.FORBIDDEN
        );

        uploadMusicXml(
                "/api/v1/scores/" + workspace.scoreId() + "/versions",
                workspace.ownerToken(),
                "Broken XML",
                "<score-partwise>",
                Map.of(),
                HttpStatus.BAD_REQUEST
        );
        uploadMusicXml(
                "/api/v1/scores/" + workspace.scoreId() + "/versions",
                workspace.ownerToken(),
                "Unsafe XML",
                UNSAFE_MUSICXML,
                Map.of(),
                HttpStatus.BAD_REQUEST
        );
        uploadMusicXml(
                "/api/v1/ensembles/" + workspace.ensembleId() + "/scores",
                outsiderToken,
                "Outsider Upload",
                SAMPLE_MUSICXML,
                Map.of(),
                HttpStatus.FORBIDDEN
        );
        postJson("/api/v1/ensembles/" + workspace.ensembleId() + "/members",
                workspace.memberToken(),
                Map.of("userId", outsiderSession.path("user").path("id").asText(), "role", "MEMBER"),
                HttpStatus.FORBIDDEN);
        getJson("/api/v1/scores/" + workspace.scoreId(), outsiderToken, HttpStatus.FORBIDDEN);
    }

    @Test
    void supportsEditorViewerRolesCapabilitiesAndLastOwnerProtection() {
        JsonNode ownerSession = login(uniqueEmail("owner"), "Owner");
        JsonNode adminSession = login(uniqueEmail("admin"), "Admin");
        JsonNode editorSession = login(uniqueEmail("editor"), "Editor");
        JsonNode viewerSession = login(uniqueEmail("viewer"), "Viewer");
        JsonNode ownerTwoSession = login(uniqueEmail("owner2"), "Owner Two");
        String ownerToken = ownerSession.path("accessToken").asText();
        String adminToken = adminSession.path("accessToken").asText();
        String editorToken = editorSession.path("accessToken").asText();
        String viewerToken = viewerSession.path("accessToken").asText();

        JsonNode ensemble = postJson("/api/v1/ensembles", ownerToken, Map.of("name", "Role Matrix"), HttpStatus.OK);
        String ensembleId = ensemble.path("id").asText();
        assertThat(ensemble.path("capabilities").path("canManageMembers").asBoolean()).isTrue();

        postJson("/api/v1/ensembles/" + ensembleId + "/members", ownerToken,
                Map.of("userId", adminSession.path("user").path("id").asText(), "role", "ADMIN"), HttpStatus.OK);
        postJson("/api/v1/ensembles/" + ensembleId + "/members", ownerToken,
                Map.of("userId", editorSession.path("user").path("id").asText(), "role", "EDITOR"), HttpStatus.OK);
        postJson("/api/v1/ensembles/" + ensembleId + "/members", ownerToken,
                Map.of("userId", viewerSession.path("user").path("id").asText(), "role", "VIEWER"), HttpStatus.OK);

        JsonNode editorEnsembles = getJson("/api/v1/ensembles", editorToken, HttpStatus.OK);
        assertThat(editorEnsembles.get(0).path("role").asText()).isEqualTo("EDITOR");
        assertThat(editorEnsembles.get(0).path("capabilities").path("canPublishScoreVersion").asBoolean()).isTrue();
        JsonNode viewerEnsembles = getJson("/api/v1/ensembles", viewerToken, HttpStatus.OK);
        assertThat(viewerEnsembles.get(0).path("capabilities").path("canPublishScoreVersion").asBoolean()).isFalse();

        JsonNode score = uploadMusicXml("/api/v1/ensembles/" + ensembleId + "/scores", editorToken, "Editor Upload", SAMPLE_MUSICXML, HttpStatus.OK);
        String scoreId = score.path("id").asText();
        String versionId = score.path("current_version_id").asText();

        uploadMusicXml(
                "/api/v1/scores/" + scoreId + "/versions",
                editorToken,
                "Editor Version",
                SECOND_SAMPLE_MUSICXML,
                Map.of("baseScoreVersionId", versionId, "expectedScoreRevision", String.valueOf(score.path("revision").asLong())),
                HttpStatus.OK
        );
        uploadMusicXml(
                "/api/v1/scores/" + scoreId + "/versions",
                viewerToken,
                "Viewer Version",
                SECOND_SAMPLE_MUSICXML,
                Map.of("baseScoreVersionId", versionId),
                HttpStatus.FORBIDDEN
        );
        sync(viewerToken, scoreId, versionId, "viewer-annotation", "PRIVATE", null, 0, "mutation-viewer", HttpStatus.FORBIDDEN);
        sync(editorToken, scoreId, versionId, "editor-ensemble", "ENSEMBLE", null, 0, "mutation-editor-ensemble", HttpStatus.OK);

        JsonNode outsider = login(uniqueEmail("new"), "New Member");
        postJson("/api/v1/ensembles/" + ensembleId + "/members", adminToken,
                Map.of("userId", outsider.path("user").path("id").asText(), "role", "VIEWER"), HttpStatus.OK);
        postJson("/api/v1/ensembles/" + ensembleId + "/members", editorToken,
                Map.of("userId", outsider.path("user").path("id").asText(), "role", "MEMBER"), HttpStatus.FORBIDDEN);
        postJson("/api/v1/ensembles/" + ensembleId + "/members", adminToken,
                Map.of("userId", ownerTwoSession.path("user").path("id").asText(), "role", "OWNER"), HttpStatus.FORBIDDEN);

        postJson("/api/v1/ensembles/" + ensembleId + "/members", ownerToken,
                Map.of("userId", ownerTwoSession.path("user").path("id").asText(), "role", "OWNER"), HttpStatus.OK);
        postJson("/api/v1/ensembles/" + ensembleId + "/members", adminToken,
                Map.of("userId", ownerTwoSession.path("user").path("id").asText(), "role", "EDITOR"), HttpStatus.FORBIDDEN);

        JsonNode solo = postJson("/api/v1/ensembles", ownerToken, Map.of("name", "Solo Owner"), HttpStatus.OK);
        postJson("/api/v1/ensembles/" + solo.path("id").asText() + "/members", ownerToken,
                Map.of("userId", ownerSession.path("user").path("id").asText(), "role", "VIEWER"), HttpStatus.CONFLICT);
    }

    @Test
    void handlesPartAnnotationsRevisionIdempotencyDeleteAndMismatchValidation() {
        TestWorkspace workspace = createWorkspace();

        sync(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-part-invalid", "PART", null, 0, "mutation-part-invalid", HttpStatus.BAD_REQUEST);

        JsonNode partCreate = sync(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-part", "PART", "P1", 0, "mutation-part-create", HttpStatus.OK);
        assertThat(partCreate.path("applied").get(0).path("revision").asLong()).isEqualTo(1);

        JsonNode partListForMember = getJson(
                "/api/v1/scores/" + workspace.scoreId() + "/annotations?scoreVersionId=" + workspace.versionId(),
                workspace.memberToken(),
                HttpStatus.OK
        );
        assertThat(partListForMember.size()).isEqualTo(1);
        assertThat(partListForMember.get(0).path("partId").asText()).isEqualTo("P1");

        JsonNode partUpdate = sync(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-part", "PART", "P1", 1, "mutation-part-update", HttpStatus.OK);
        assertThat(partUpdate.path("applied").get(0).path("revision").asLong()).isEqualTo(2);

        JsonNode replay = sync(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-part", "PART", "P1", 1, "mutation-part-update", HttpStatus.OK);
        assertThat(replay.path("applied").get(0).path("idempotentReplay").asBoolean()).isTrue();
        assertThat(replay.path("applied").get(0).path("revision").asLong()).isEqualTo(2);

        JsonNode tombstone = deleteAnnotation(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-part", 2, "mutation-part-delete", HttpStatus.OK);
        assertThat(tombstone.path("applied").get(0).path("revision").asLong()).isEqualTo(3);

        JsonNode annotations = getJson(
                "/api/v1/scores/" + workspace.scoreId() + "/annotations?scoreVersionId=" + workspace.versionId(),
                workspace.memberToken(),
                HttpStatus.OK
        );
        assertThat(annotations.get(0).path("deletedAt").isNumber()).isTrue();

        syncWithAnnotationIds(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-mismatch-score", "scr_mismatch", workspace.versionId(), HttpStatus.BAD_REQUEST);
        syncWithAnnotationIds(workspace.ownerToken(), workspace.scoreId(), workspace.versionId(),
                "annotation-mismatch-version", workspace.scoreId(), "ver_mismatch", HttpStatus.BAD_REQUEST);
    }

    private TestWorkspace createWorkspace() {
        JsonNode ownerSession = login(uniqueEmail("owner"), "Owner");
        String ownerToken = ownerSession.path("accessToken").asText();
        JsonNode memberSession = login(uniqueEmail("member"), "Member");
        String memberToken = memberSession.path("accessToken").asText();

        JsonNode ensemble = postJson("/api/v1/ensembles", ownerToken, Map.of("name", "Quartet"), HttpStatus.OK);
        String ensembleId = ensemble.path("id").asText();
        postJson("/api/v1/ensembles/" + ensembleId + "/members",
                ownerToken,
                Map.of("userId", memberSession.path("user").path("id").asText(), "role", "MEMBER"),
                HttpStatus.OK);

        JsonNode score = uploadMusicXml(
                "/api/v1/ensembles/" + ensembleId + "/scores",
                ownerToken,
                "Server Sample",
                SAMPLE_MUSICXML,
                HttpStatus.OK
        );
        return new TestWorkspace(ownerToken, memberToken, ensembleId, score.path("id").asText(), score.path("current_version_id").asText());
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

    private JsonNode uploadMusicXml(String url, String token, String title, String xml, HttpStatus expectedStatus) {
        return uploadMusicXml(url, token, title, xml, Map.of(), expectedStatus);
    }

    private JsonNode uploadMusicXml(String url, String token, String title, String xml, Map<String, String> extraFields, HttpStatus expectedStatus) {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("title", title);
        body.add("composer", "CueNote Test");
        extraFields.forEach(body::add);
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
        return syncWithAnnotation(token, scoreId, versionId, annotation(scoreId, versionId, annotationId, scope, partId), baseRevision, clientMutationId, expectedStatus);
    }

    private JsonNode syncWithAnnotationIds(
            String token,
            String pathScoreId,
            String requestVersionId,
            String annotationId,
            String annotationScoreId,
            String annotationVersionId,
            HttpStatus expectedStatus
    ) {
        return syncWithAnnotation(
                token,
                pathScoreId,
                requestVersionId,
                annotation(annotationScoreId, annotationVersionId, annotationId, "ENSEMBLE", null),
                0,
                "mutation-" + annotationId,
                expectedStatus
        );
    }

    private JsonNode syncWithAnnotation(
            String token,
            String scoreId,
            String versionId,
            Map<String, Object> annotation,
            long baseRevision,
            String clientMutationId,
            HttpStatus expectedStatus
    ) {
        Map<String, Object> mutation = Map.of(
                "clientMutationId", clientMutationId,
                "baseRevision", baseRevision,
                "action", "UPSERT",
                "annotation", annotation
        );
        return postJson(
                "/api/v1/scores/" + scoreId + "/annotations/sync",
                token,
                Map.of("scoreVersionId", versionId, "mutations", List.of(mutation)),
                expectedStatus
        );
    }

    private JsonNode deleteAnnotation(
            String token,
            String scoreId,
            String versionId,
            String annotationId,
            long baseRevision,
            String clientMutationId,
            HttpStatus expectedStatus
    ) {
        Map<String, Object> mutation = Map.of(
                "clientMutationId", clientMutationId,
                "baseRevision", baseRevision,
                "action", "DELETE",
                "annotationId", annotationId
        );
        return postJson(
                "/api/v1/scores/" + scoreId + "/annotations/sync",
                token,
                Map.of("scoreVersionId", versionId, "mutations", List.of(mutation)),
                expectedStatus
        );
    }

    private Map<String, Object> annotation(String scoreId, String versionId, String annotationId, String scope, String partId) {
        Map<String, Object> annotation = new HashMap<>();
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
        return annotation;
    }

    private HttpHeaders authHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    private String uniqueEmail(String prefix) {
        return prefix + "-" + UUID.randomUUID() + "@cuenote.local";
    }

    private record TestWorkspace(String ownerToken, String memberToken, String ensembleId, String scoreId, String versionId) {
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

    private static final String SECOND_SAMPLE_MUSICXML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <score-partwise version="4.0">
              <work><work-title>Server Sample Two</work-title></work>
              <part-list>
                <score-part id="P1"><part-name>Piano</part-name></score-part>
              </part-list>
              <part id="P1">
                <measure number="1">
                  <attributes>
                    <divisions>1</divisions>
                    <key><fifths>0</fifths></key>
                    <time><beats>3</beats><beat-type>4</beat-type></time>
                    <clef><sign>G</sign><line>2</line></clef>
                  </attributes>
                  <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><type>half</type></note>
                </measure>
              </part>
            </score-partwise>
            """;

    private static final String UNSAFE_MUSICXML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE score-partwise [
              <!ENTITY ext SYSTEM "file:///etc/passwd">
            ]>
            <score-partwise version="4.0">
              <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
              <part id="P1"><measure number="1"><note><rest/><duration>1</duration><type>quarter</type></note></measure></part>
            </score-partwise>
            """;
}
