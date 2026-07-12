package com.cuenote.backend.api.health;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HealthControllerIntegrationTest {

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
    void healthReturnsCommonSuccessEnvelope() {
        ResponseEntity<JsonNode> response = restTemplate.getForEntity("/api/v1/health", JsonNode.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getFirst("X-Request-Id")).isNotBlank();

        JsonNode body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.path("data").path("status").asText()).isEqualTo("UP");
        assertThat(body.path("data").path("version").asText()).isEqualTo("0.1.0");
        assertThat(body.path("meta").path("requestId").asText()).startsWith("req_");
    }

    @Test
    void flywayMigrationCreatesInitialMetadata() {
        Integer count = jdbcTemplate.queryForObject(
                "select count(*) from app_metadata where key = ? and value = ?",
                Integer.class,
                "schema.version",
                "1"
        );

        assertThat(count).isEqualTo(1);
    }
}
