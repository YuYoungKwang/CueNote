package com.cuenote.backend.api.auth;

public record AuthenticatedUser(
        String id,
        String email,
        String displayName
) {
}
