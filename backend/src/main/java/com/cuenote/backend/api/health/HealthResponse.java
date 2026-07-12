package com.cuenote.backend.api.health;

public record HealthResponse(
        String status,
        String version
) {
}
