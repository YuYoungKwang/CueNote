package com.cuenote.backend.api.common;

public record ApiResponse<T>(
        T data,
        ApiMeta meta
) {
}
