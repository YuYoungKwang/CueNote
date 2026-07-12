package com.cuenote.backend.api.common;

public record ApiErrorResponse(
        ApiError error,
        ApiMeta meta
) {
}
