package com.cuenote.backend.api.auth;

import com.cuenote.backend.api.common.ApiEnvelopeFactory;
import com.cuenote.backend.api.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class AuthController {

    private final AuthService authService;
    private final ApiEnvelopeFactory envelopes;

    public AuthController(AuthService authService, ApiEnvelopeFactory envelopes) {
        this.authService = authService;
        this.envelopes = envelopes;
    }

    @PostMapping("/dev-auth/login")
    public ResponseEntity<ApiResponse<Map<String, Object>>> loginDev(@Valid @RequestBody DevLoginRequest body, HttpServletRequest request) {
        return ResponseEntity.ok(envelopes.success(authService.loginDev(body.email(), body.displayName()).toResponse(), request));
    }

    @PostMapping("/auth/refresh")
    public ResponseEntity<ApiResponse<Map<String, Object>>> refresh(@Valid @RequestBody RefreshRequest body, HttpServletRequest request) {
        return ResponseEntity.ok(envelopes.success(authService.refresh(body.refreshToken()).toResponse(), request));
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<ApiResponse<Map<String, String>>> logout(HttpServletRequest request) {
        authService.logout(request.getHeader("Authorization"));
        return ResponseEntity.ok(envelopes.success(Map.of("status", "LOGGED_OUT"), request));
    }

    @GetMapping("/auth/me")
    public ResponseEntity<ApiResponse<AuthenticatedUser>> me(HttpServletRequest request) {
        return ResponseEntity.ok(envelopes.success(authService.requireUser(request), request));
    }

    public record DevLoginRequest(
            @Email @NotBlank String email,
            @NotBlank String displayName
    ) {
    }

    public record RefreshRequest(@NotBlank String refreshToken) {
    }
}
