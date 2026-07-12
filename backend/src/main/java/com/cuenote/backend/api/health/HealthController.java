package com.cuenote.backend.api.health;

import com.cuenote.backend.api.common.ApiEnvelopeFactory;
import com.cuenote.backend.api.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/health")
public class HealthController {

    private final ApiEnvelopeFactory envelopes;
    private final String version;

    public HealthController(ApiEnvelopeFactory envelopes, @Value("${cuenote.version:0.1.0}") String version) {
        this.envelopes = envelopes;
        this.version = version;
    }

    @GetMapping
    public ApiResponse<HealthResponse> health(HttpServletRequest request) {
        return envelopes.success(new HealthResponse("UP", version), request);
    }
}
