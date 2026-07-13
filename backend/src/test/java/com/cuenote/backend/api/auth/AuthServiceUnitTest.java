package com.cuenote.backend.api.auth;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("unit")
class AuthServiceUnitTest {

    @Test
    void tokenHashIsDeterministicAndDoesNotExposeRawToken() {
        String token = "ct_access_test_token";

        String firstHash = AuthService.hashToken(token);
        String secondHash = AuthService.hashToken(token);

        assertThat(firstHash).isEqualTo(secondHash);
        assertThat(firstHash).isNotEqualTo(token);
        assertThat(firstHash).isNotBlank();
    }

    @Test
    void generatedIdsUseRequestedPrefix() {
        assertThat(AuthService.newId("usr")).startsWith("usr_");
    }
}
