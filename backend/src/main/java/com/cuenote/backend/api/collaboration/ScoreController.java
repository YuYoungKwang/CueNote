package com.cuenote.backend.api.collaboration;

import com.cuenote.backend.api.auth.AuthService;
import com.cuenote.backend.api.auth.AuthenticatedUser;
import com.cuenote.backend.api.common.ApiEnvelopeFactory;
import com.cuenote.backend.api.common.ApiResponse;
import com.cuenote.backend.api.storage.ObjectStorageService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
@RequestMapping("/api/v1/scores")
public class ScoreController {

    private final AuthService authService;
    private final CollaborationService collaborationService;
    private final ApiEnvelopeFactory envelopes;

    public ScoreController(AuthService authService, CollaborationService collaborationService, ApiEnvelopeFactory envelopes) {
        this.authService = authService;
        this.collaborationService = collaborationService;
        this.envelopes = envelopes;
    }

    @GetMapping("/{scoreId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getScore(@PathVariable String scoreId, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.getScore(user, scoreId), request));
    }

    @PostMapping(path = "/{scoreId}/versions", consumes = "multipart/form-data")
    public ResponseEntity<ApiResponse<Map<String, Object>>> createVersion(
            @PathVariable String scoreId,
            @RequestParam String title,
            @RequestPart("file") MultipartFile file,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.createScoreVersion(user, scoreId, title, file), request));
    }

    @GetMapping("/{scoreId}/versions/{versionId}/source")
    public ResponseEntity<byte[]> getVersionSource(@PathVariable String scoreId, @PathVariable String versionId, HttpServletRequest request) {
        AuthenticatedUser user = authService.requireUser(request);
        ObjectStorageService.StoredObject source = collaborationService.getVersionSource(user, scoreId, versionId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, source.contentType())
                .body(source.content());
    }

    @GetMapping("/{scoreId}/annotations")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listAnnotations(
            @PathVariable String scoreId,
            @RequestParam String scoreVersionId,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.listVisibleAnnotations(user, scoreId, scoreVersionId), request));
    }

    @PostMapping("/{scoreId}/annotations/sync")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncAnnotations(
            @PathVariable String scoreId,
            @Valid @RequestBody AnnotationSyncRequest body,
            HttpServletRequest request
    ) {
        AuthenticatedUser user = authService.requireUser(request);
        return ResponseEntity.ok(envelopes.success(collaborationService.syncAnnotations(user, scoreId, body), request));
    }
}
