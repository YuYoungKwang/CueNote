package com.cuenote.backend.api.collaboration;

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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/ensembles")
public class EnsembleController {

    private final AuthService authService;
    private final CollaborationService collaborationService;
    private final ApiEnvelopeFactory envelopes;

    public EnsembleController(AuthService authService, CollaborationService collaborationService, ApiEnvelopeFactory envelopes) {
        this.authService = authService;
        this.collaborationService = collaborationService;
        this.envelopes = envelopes;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.listEnsembles(user), request));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(@Valid @RequestBody CreateEnsembleRequest body, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.createEnsemble(user, body.name()), request));
    }

    @PostMapping("/{ensembleId}/members")
    public ResponseEntity<ApiResponse<Map<String, Object>>> addMember(
            @PathVariable String ensembleId,
            @Valid @RequestBody AddMemberRequest body,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.addMember(user, ensembleId, body.userId(), body.role()), request));
    }

    @GetMapping("/{ensembleId}/scores")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listScores(@PathVariable String ensembleId, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.listScores(user, ensembleId), request));
    }

    @PostMapping(path = "/{ensembleId}/scores", consumes = "multipart/form-data")
    public ResponseEntity<ApiResponse<Map<String, Object>>> createScore(
            @PathVariable String ensembleId,
            @RequestParam String title,
            @RequestParam(required = false) String composer,
            @RequestPart("file") MultipartFile file,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.createScore(user, ensembleId, title, composer, file), request));
    }
}
