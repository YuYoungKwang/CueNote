package com.cuenote.backend.api.common;

import java.util.Map;

public record ApiError(
        String code,
        String message,
        Map<String, Object> details
) {
    public ApiError {
        details = details == null ? Map.of() : Map.copyOf(details);
    }
}
