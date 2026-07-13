package com.cuenote.backend.api.rehearsal;

import com.cuenote.backend.api.auth.AuthService;
import com.cuenote.backend.api.auth.AuthenticatedUser;
import com.cuenote.backend.api.common.ApiEnvelopeFactory;
import com.cuenote.backend.api.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class RehearsalController {

    private final AuthService authService;
    private final RehearsalService rehearsalService;
    private final ApiEnvelopeFactory envelopes;

    public RehearsalController(AuthService authService, RehearsalService rehearsalService, ApiEnvelopeFactory envelopes) {
        this.authService = authService;
        this.rehearsalService = rehearsalService;
        this.envelopes = envelopes;
    }

    @PostMapping("/ensembles/{ensembleId}/rehearsal-sessions")
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @PathVariable String ensembleId,
            @Valid @RequestBody CreateRehearsalSessionRequest body,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(rehearsalService.createSession(user, ensembleId, body), request));
    }

    @GetMapping("/ensembles/{ensembleId}/rehearsal-sessions")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(@PathVariable String ensembleId, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(rehearsalService.listSessions(user, ensembleId), request));
    }

    @GetMapping("/rehearsal-sessions/{sessionId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> get(@PathVariable String sessionId, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(rehearsalService.getSession(user, sessionId), request));
    }

    @PostMapping("/rehearsal-sessions/{sessionId}/join")
    public ResponseEntity<ApiResponse<Map<String, Object>>> join(
            @PathVariable String sessionId,
            @RequestBody(required = false) JoinRehearsalSessionRequest body,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(rehearsalService.joinSession(user, sessionId, body == null ? null : body.followMode()), request));
    }

    @PostMapping("/rehearsal-sessions/{sessionId}/leave")
    public ResponseEntity<ApiResponse<Map<String, Object>>> leave(@PathVariable String sessionId, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        rehearsalService.leaveSession(user, sessionId);
        return ResponseEntity.ok(envelopes.success(Map.of("left", true), request));
    }

    @PostMapping("/rehearsal-sessions/{sessionId}/end")
    public ResponseEntity<ApiResponse<Map<String, Object>>> end(@PathVariable String sessionId, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(rehearsalService.endSession(user, sessionId), request));
    }

    @PatchMapping("/rehearsal-sessions/{sessionId}/leader")
    public ResponseEntity<ApiResponse<Map<String, Object>>> leader(
            @PathVariable String sessionId,
            @Valid @RequestBody TransferLeaderRequest body,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(rehearsalService.transferLeader(user, sessionId, body.leaderUserId()), request));
    }
}
