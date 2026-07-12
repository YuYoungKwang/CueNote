package com.cuenote.backend.api.error;

import com.cuenote.backend.api.common.ApiEnvelopeFactory;
import com.cuenote.backend.api.common.ApiErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private final ApiEnvelopeFactory envelopes;

    public GlobalExceptionHandler(ApiEnvelopeFactory envelopes) {
        this.envelopes = envelopes;
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorResponse> handleApiException(ApiException exception, HttpServletRequest request) {
        ErrorCode errorCode = exception.getErrorCode();
        return ResponseEntity
                .status(errorCode.status())
                .body(envelopes.error(errorCode.name(), exception.getMessage(), exception.getDetails(), request));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException exception, HttpServletRequest request) {
        List<Map<String, String>> fields = exception.getBindingResult()
                .getFieldErrors()
                .stream()
                .map(this::fieldErrorDetails)
                .toList();

        return validationError(Map.of("fields", fields), request);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleConstraintViolation(ConstraintViolationException exception, HttpServletRequest request) {
        List<Map<String, String>> violations = exception.getConstraintViolations()
                .stream()
                .map(violation -> Map.of(
                        "path", violation.getPropertyPath().toString(),
                        "message", violation.getMessage()
                ))
                .toList();

        return validationError(Map.of("violations", violations), request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception exception, HttpServletRequest request) {
        log.error("Unexpected API error", exception);
        ErrorCode errorCode = ErrorCode.INTERNAL_ERROR;
        return ResponseEntity
                .status(errorCode.status())
                .body(envelopes.error(errorCode.name(), errorCode.defaultMessage(), Map.of(), request));
    }

    private ResponseEntity<ApiErrorResponse> validationError(Map<String, Object> details, HttpServletRequest request) {
        ErrorCode errorCode = ErrorCode.VALIDATION_FAILED;
        return ResponseEntity
                .status(errorCode.status())
                .body(envelopes.error(errorCode.name(), errorCode.defaultMessage(), details, request));
    }

    private Map<String, String> fieldErrorDetails(FieldError fieldError) {
        return Map.of(
                "field", fieldError.getField(),
                "message", fieldError.getDefaultMessage() == null ? "Invalid value" : fieldError.getDefaultMessage()
        );
    }
}
