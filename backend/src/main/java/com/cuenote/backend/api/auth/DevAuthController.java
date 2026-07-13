package com.cuenote.backend.api.auth;

import com.cuenote.backend.api.common.ApiEnvelopeFactory;
import com.cuenote.backend.api.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Profile("!prod")
@RestController
@RequestMapping("/api/v1")
public class DevAuthController {

    private final AuthService authService;
    private final ApiEnvelopeFactory envelopes;

    public DevAuthController(AuthService authService, ApiEnvelopeFactory envelopes) {
        this.authService = authService;
        this.envelopes = envelopes;
    }

    @PostMapping("/dev-auth/login")
    public ResponseEntity<ApiResponse<Map<String, Object>>> loginDev(@Valid @RequestBody DevLoginRequest body, HttpServletRequest request) {
        return ResponseEntity.ok(envelopes.success(authService.loginDev(body.email(), body.displayName()).toResponse(), request));
    }

    public record DevLoginRequest(
            @Email @NotBlank String email,
            @NotBlank String displayName
    ) {
    }
}
