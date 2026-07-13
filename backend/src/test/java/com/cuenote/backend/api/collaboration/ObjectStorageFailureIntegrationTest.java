package com.cuenote.backend.api.collaboration;

import com.cuenote.backend.api.storage.ObjectStorageService;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@Tag("postgres")
@Tag("object-storage")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ObjectStorageFailureIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("cuenote")
            .withUsername("cuenote")
            .withPassword("cuenote_test_password");

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Test
    void scoreCreateRollsBackDatabaseWhenObjectStorageFails() {
        JsonNode session = postJson("/api/v1/dev-auth/login", null,
                Map.of("email", "storage-" + UUID.randomUUID() + "@cuenote.local", "displayName", "Storage User"),
                HttpStatus.OK);
        String token = session.path("accessToken").asText();
        JsonNode ensemble = postJson("/api/v1/ensembles", token, Map.of("name", "Storage Failure"), HttpStatus.OK);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("title", "Will Roll Back");
        body.add("composer", "CueNote Test");
        body.add("file", new ByteArrayResource(SAMPLE_MUSICXML.getBytes(StandardCharsets.UTF_8)) {
            @Override
            public String getFilename() {
                return "sample.musicxml";
            }
        });

        HttpHeaders headers = authHeaders(token);
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        ResponseEntity<JsonNode> response = restTemplate.exchange(
                "/api/v1/ensembles/" + ensemble.path("id").asText() + "/scores",
                HttpMethod.POST,
                new HttpEntity<>(body, headers),
                JsonNode.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(jdbcTemplate.queryForObject("select count(*) from scores", Integer.class)).isZero();
        assertThat(jdbcTemplate.queryForObject("select count(*) from score_versions", Integer.class)).isZero();
    }

    private JsonNode postJson(String url, String token, Object body, HttpStatus expectedStatus) {
        HttpHeaders headers = token == null ? new HttpHeaders() : authHeaders(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(expectedStatus);
        return expectedStatus.isError() ? response.getBody().path("error").path("details") : response.getBody().path("data");
    }

    private HttpHeaders authHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    @TestConfiguration
    static class FailingStorageConfiguration {
        @Bean
        @Primary
        ObjectStorageService failingObjectStorageService() {
            return new ObjectStorageService() {
                @Override
                public StoredObject put(String key, byte[] content, String contentType) {
                    throw new IllegalStateException("Intentional object storage failure");
                }

                @Override
                public StoredObject get(String key) {
                    throw new IllegalStateException("Intentional object storage failure");
                }
            };
        }
    }

    private static final String SAMPLE_MUSICXML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <score-partwise version="4.0">
              <part-list>
                <score-part id="P1"><part-name>Piano</part-name></score-part>
              </part-list>
              <part id="P1">
                <measure number="1">
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
