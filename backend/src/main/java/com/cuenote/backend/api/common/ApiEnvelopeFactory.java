package com.cuenote.backend.api.common;

import com.cuenote.backend.api.web.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ApiEnvelopeFactory {

    public <T> ApiResponse<T> success(T data, HttpServletRequest request) {
        return new ApiResponse<>(data, meta(request));
    }

    public ApiErrorResponse error(String code, String message, Map<String, Object> details, HttpServletRequest request) {
        return new ApiErrorResponse(new ApiError(code, message, details), meta(request));
    }

    private ApiMeta meta(HttpServletRequest request) {
        Object requestId = request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE);
        return new ApiMeta(requestId instanceof String value ? value : RequestIdFilter.generateRequestId());
    }
}
