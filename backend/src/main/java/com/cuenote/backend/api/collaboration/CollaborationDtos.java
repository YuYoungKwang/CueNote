package com.cuenote.backend.api.collaboration;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import java.util.Map;

record CreateEnsembleRequest(@NotBlank String name) {
}

record AddMemberRequest(@NotBlank String userId, @NotBlank String role) {
}

record AnnotationSyncRequest(
        @NotBlank String scoreVersionId,
        @NotEmpty List<AnnotationMutation> mutations
) {
}

record AnnotationMutation(
        @NotBlank String clientMutationId,
        Long baseRevision,
        @NotBlank String action,
        Map<String, Object> annotation,
        String annotationId
) {
}
